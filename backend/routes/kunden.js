const router = require('express').Router();
const db = require('../models/database');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const kunden = db.find('kunden', k => k.created_by === req.user.id);
  const users = db.find('users');
  const result = kunden.map(k => ({
    ...k,
    mitarbeiter_name: users.find(u => u.id === k.created_by)?.name || '–',
  }));
  result.sort((a, b) => new Date(b.abschlussdatum) - new Date(a.abschlussdatum));
  res.json(result);
});

router.post('/', authenticate, (req, res) => {
  const { firma, telefon, kanal, abschlussdatum, umsatz, marge, hubspot_company_id } = req.body;
  if (!firma || !kanal || !abschlussdatum) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  const row = db.insert('kunden', {
    firma, telefon: telefon || null, kanal, abschlussdatum,
    umsatz: Number(umsatz) || 0, marge: Number(marge) || 0,
    hubspot_company_id: hubspot_company_id || null,
    status: 'gewonnen',
    created_by: req.user.id,
  });
  res.status(201).json(row);
});

router.put('/:id', authenticate, (req, res) => {
  const { firma, telefon, kanal, abschlussdatum, umsatz, marge, status, hubspot_company_id } = req.body;
  const updated = db.update('kunden', Number(req.params.id), {
    firma, telefon: telefon || null, kanal, abschlussdatum,
    umsatz: Number(umsatz) || 0, marge: Number(marge) || 0,
    hubspot_company_id: hubspot_company_id || null,
    ...(status ? { status } : {}),
  });
  if (!updated) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(updated);
});

// PATCH status and/or onboarding_phase
router.patch('/:id/status', authenticate, (req, res) => {
  const { status, onboarding_phase } = req.body;
  const updates = {};
  if (status) {
    if (!['gewonnen', 'übergeben'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
    updates.status = status;
  }
  if (onboarding_phase) {
    const valid = ['übergeben', 'pre_onboarding', 'onboarding', 'design', 'fertig'];
    if (!valid.includes(onboarding_phase)) return res.status(400).json({ error: 'Ungültige Phase' });
    updates.onboarding_phase = onboarding_phase;
  }
  const updated = db.update('kunden', Number(req.params.id), updates);
  if (!updated) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(updated);
});

router.delete('/:id', authenticate, (req, res) => {
  db.delete('kunden', Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
