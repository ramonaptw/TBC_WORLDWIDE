const router = require('express').Router();
const db = require('../models/database');
const { authenticate } = require('../middleware/auth');
const { notifyUser } = require('../lib/push-notify');

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
  const { firma, telefon, kanal, abschlussdatum, umsatz, marge, hubspot_company_id, assigned_cs_user_id } = req.body;
  if (!firma || !kanal || !abschlussdatum) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  const row = db.insert('kunden', {
    firma, telefon: telefon || null, kanal, abschlussdatum,
    umsatz: Number(umsatz) || 0, marge: Number(marge) || 0,
    hubspot_company_id: hubspot_company_id || null,
    status: 'gewonnen',
    created_by: req.user.id,
    assigned_cs_user_id: assigned_cs_user_id ? Number(assigned_cs_user_id) : null,
    phase_history: [],
  });
  res.status(201).json(row);
});

router.put('/:id', authenticate, (req, res) => {
  const { firma, telefon, kanal, abschlussdatum, umsatz, marge, status, hubspot_company_id, assigned_cs_user_id } = req.body;
  const patch = {
    firma, telefon: telefon || null, kanal, abschlussdatum,
    umsatz: Number(umsatz) || 0, marge: Number(marge) || 0,
    hubspot_company_id: hubspot_company_id || null,
    ...(status ? { status } : {}),
  };
  if (assigned_cs_user_id !== undefined) {
    patch.assigned_cs_user_id = assigned_cs_user_id ? Number(assigned_cs_user_id) : null;
  }
  const updated = db.update('kunden', Number(req.params.id), patch);
  if (!updated) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(updated);
});

// PATCH status and/or onboarding_phase
router.patch('/:id/status', authenticate, (req, res) => {
  const { status, onboarding_phase, assigned_cs_user_id } = req.body;
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

  let phaseEnteredDesign = false;
  if (onboarding_phase) {
    const valid = ['übergeben', 'pre_onboarding', 'onboarding', 'design', 'production', 'fertig'];
    if (!valid.includes(onboarding_phase)) return res.status(400).json({ error: 'Ungültige Phase' });
    updates.onboarding_phase = onboarding_phase;
    const wasUnsetOrInitial = !before.onboarding_phase || before.onboarding_phase === 'übergeben';
    if (onboarding_phase === 'design' && wasUnsetOrInitial) {
      updates.status = 'übergeben';
      phaseEnteredDesign = true;
    }
    const history = Array.isArray(before.phase_history) ? before.phase_history.slice() : [];
    history.push({ phase: onboarding_phase, at: new Date().toISOString(), by: req.user.id });
    updates.phase_history = history;
  }

  const updated = db.update('kunden', id, updates);

  // Notify the assigned CS user when the kunde just entered design (= handover)
  if (phaseEnteredDesign && updated.assigned_cs_user_id) {
    notifyUser(updated.assigned_cs_user_id, {
      title: 'Neuer Member zugewiesen',
      body: updated.firma,
      url: '/app/datenbank',
    }).catch(err => console.error('[kunden] push notify failed:', err.message));
  }

  res.json(updated);
});

router.delete('/:id', authenticate, (req, res) => {
  db.delete('kunden', Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
