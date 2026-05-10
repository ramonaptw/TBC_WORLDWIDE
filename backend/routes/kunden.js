const router = require('express').Router();
const db = require('../models/database');
const { authenticate } = require('../middleware/auth');

const SERVICE_TYPES = ['full_service', 'templates_only'];
const TEMPLATE_SENDERS = ['nb', 'cs'];

function checklistFor(serviceType, templatesSender) {
  if (serviceType === 'templates_only') {
    const senderLabel = templatesSender === 'nb' ? 'NB' : templatesSender === 'cs' ? 'Customer Success' : null;
    return [
      { label: 'WhatsApp kontaktiert',                                                    done: false },
      { label: senderLabel ? `Templates an Kunde gesendet (von ${senderLabel})` : 'Templates an Kunde gesendet', done: false },
      { label: 'Designs vom Kunden zurück',                                               done: false },
    ];
  }
  return [
    { label: 'WhatsApp kontaktiert',          done: false },
    { label: 'Erstgespräch mit Kunde geführt', done: false },
    { label: 'Design abgeklärt',              done: false },
    { label: 'In Design beim Designer',       done: false },
  ];
}

function handoverDescription(firma, nbName, serviceType, templatesSender) {
  if (serviceType === 'templates_only') {
    const who = templatesSender === 'nb' ? `${nbName}` : templatesSender === 'cs' ? 'dir' : 'noch zu klären';
    return `Du hast den Kunden "${firma}" von ${nbName} erhalten (Templates-Only). Templates werden von ${who} gesendet. Bitte WhatsApp-Kontakt innerhalb 24h aufnehmen.`;
  }
  return `Du hast den Kunden "${firma}" von ${nbName} erhalten (Full Service). Bitte WhatsApp-Kontakt innerhalb 24h aufnehmen und Onboarding durchführen.`;
}

router.get('/', authenticate, (req, res) => {
  const role = req.user.role;
  let kunden;
  if (role === 'admin' || role === 'management') {
    kunden = db.find('kunden');
  } else if (role === 'customersuccess') {
    kunden = db.find('kunden', k => k.created_by === req.user.id || k.assigned_cs_user_id === req.user.id);
  } else {
    kunden = db.find('kunden', k => k.created_by === req.user.id);
  }
  const users = db.find('users');
  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
  const result = kunden.map(k => ({
    ...k,
    mitarbeiter_name: userMap[k.created_by] || '–',
    assigned_cs_name: k.assigned_cs_user_id ? (userMap[k.assigned_cs_user_id] || null) : null,
  }));
  result.sort((a, b) => new Date(b.abschlussdatum) - new Date(a.abschlussdatum));
  res.json(result);
});

router.post('/', authenticate, (req, res) => {
  const { firma, telefon, kanal, abschlussdatum, umsatz, marge, hubspot_company_id, assigned_cs_user_id, service_type, templates_sender } = req.body;
  if (!firma || !kanal || !abschlussdatum) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  const stype = SERVICE_TYPES.includes(service_type) ? service_type : 'full_service';
  const tsender = TEMPLATE_SENDERS.includes(templates_sender) ? templates_sender : null;
  if (stype === 'templates_only' && !tsender) return res.status(400).json({ error: 'templates_sender Pflicht bei Templates-Only' });
  const row = db.insert('kunden', {
    firma, telefon: telefon || null, kanal, abschlussdatum,
    umsatz: Number(umsatz) || 0, marge: Number(marge) || 0,
    hubspot_company_id: hubspot_company_id || null,
    status: 'gewonnen',
    created_by: req.user.id,
    assigned_cs_user_id: assigned_cs_user_id ? Number(assigned_cs_user_id) : null,
    service_type: stype,
    templates_sender: tsender,
    handover_at: null,
    whatsapp_contact_at: null,
    sla_warned_at: null,
    sla_escalated_at: null,
    phase_history: [],
  });
  res.status(201).json(row);
});

router.put('/:id', authenticate, (req, res) => {
  const { firma, telefon, kanal, abschlussdatum, umsatz, marge, status, hubspot_company_id, assigned_cs_user_id, service_type, templates_sender } = req.body;
  const patch = {
    firma, telefon: telefon || null, kanal, abschlussdatum,
    umsatz: Number(umsatz) || 0, marge: Number(marge) || 0,
    hubspot_company_id: hubspot_company_id || null,
    ...(status ? { status } : {}),
  };
  if (assigned_cs_user_id !== undefined) {
    patch.assigned_cs_user_id = assigned_cs_user_id ? Number(assigned_cs_user_id) : null;
  }
  if (service_type !== undefined && SERVICE_TYPES.includes(service_type)) patch.service_type = service_type;
  if (templates_sender !== undefined) patch.templates_sender = TEMPLATE_SENDERS.includes(templates_sender) ? templates_sender : null;
  const updated = db.update('kunden', Number(req.params.id), patch);
  if (!updated) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(updated);
});

// PATCH status and/or onboarding_phase
router.patch('/:id/status', authenticate, (req, res) => {
  const { status, onboarding_phase, assigned_cs_user_id, service_type, templates_sender } = req.body;
  const id = Number(req.params.id);
  const before = db.findOne('kunden', k => k.id === id);
  if (!before) return res.status(404).json({ error: 'Nicht gefunden' });

  const updates = {};
  if (status) {
    if (!['gewonnen', 'übergeben'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
    updates.status = status;
  }
  if (assigned_cs_user_id !== undefined) {
    updates.assigned_cs_user_id = assigned_cs_user_id ? Number(assigned_cs_user_id) : null;
  }
  if (service_type !== undefined && SERVICE_TYPES.includes(service_type)) updates.service_type = service_type;
  if (templates_sender !== undefined) updates.templates_sender = TEMPLATE_SENDERS.includes(templates_sender) ? templates_sender : null;

  let phaseEnteredDesign = false;
  if (onboarding_phase) {
    const valid = ['übergeben', 'pre_onboarding', 'onboarding', 'design', 'production', 'fertig'];
    if (!valid.includes(onboarding_phase)) return res.status(400).json({ error: 'Ungültige Phase' });
    updates.onboarding_phase = onboarding_phase;
    const wasUnsetOrInitial = !before.onboarding_phase || before.onboarding_phase === 'übergeben';
    if (onboarding_phase === 'design' && wasUnsetOrInitial) {
      updates.status = 'übergeben';
      phaseEnteredDesign = true;
      if (!before.handover_at) updates.handover_at = new Date().toISOString();
    }
    const history = Array.isArray(before.phase_history) ? before.phase_history.slice() : [];
    history.push({ phase: onboarding_phase, at: new Date().toISOString(), by: req.user.id });
    updates.phase_history = history;
  }

  const updated = db.update('kunden', id, updates);

  // Trigger CS handover (push + task) when either:
  //  (a) phase just entered 'design' (first hand-off), OR
  //  (b) the assigned CS user just changed to a new value (e.g. reassigned via edit modal)
  const csNewlyAssigned = updates.assigned_cs_user_id !== undefined
    && !!updated.assigned_cs_user_id
    && (before.assigned_cs_user_id || null) !== updated.assigned_cs_user_id;
  const shouldHandover = updated.assigned_cs_user_id && (phaseEnteredDesign || csNewlyAssigned);

  if (shouldHandover) {
    // Set handover_at also for the CS-reassignment path if missing
    if (!updated.handover_at) {
      db.update('kunden', id, { handover_at: new Date().toISOString() });
    }

    const existingOpen = db.findOne('tasks', t =>
      t.kunde_id === id &&
      t.project === 'Onboarding' &&
      t.assigned_to === updated.assigned_cs_user_id &&
      t.status !== 'done'
    );
    if (!existingOpen) {
      const nbName = (db.findOne('users', u => u.id === updated.created_by)?.name) || 'New Business';
      const due = new Date(); due.setDate(due.getDate() + 3);
      db.insert('tasks', {
        title: 'Onboarding-Übergabe: ' + updated.firma,
        description: handoverDescription(updated.firma, nbName, updated.service_type || 'full_service', updated.templates_sender),
        status: 'open',
        priority: 'high',
        assigned_to: updated.assigned_cs_user_id,
        created_by: req.user.id,
        due_date: due.toISOString().slice(0, 10),
        project: 'Onboarding',
        kunde_id: id,
        sourcing: null,
        checklist: checklistFor(updated.service_type || 'full_service', updated.templates_sender),
      });
    }
  }

  res.json(updated);
});

router.delete('/:id', authenticate, (req, res) => {
  db.delete('kunden', Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
