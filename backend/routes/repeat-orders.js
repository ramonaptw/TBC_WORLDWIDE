const router = require('express').Router();
const db = require('../models/database');
const { authenticate, requireRole } = require('../middleware/auth');

function visibleKundeIds(req) {
  const role = req.user.role;
  if (role === 'admin' || role === 'management') return null; // null = all visible
  if (role === 'customersuccess') {
    return new Set(db.find('kunden', k => k.created_by === req.user.id || k.assigned_cs_user_id === req.user.id).map(k => k.id));
  }
  return new Set(db.find('kunden', k => k.created_by === req.user.id).map(k => k.id));
}

router.get('/', authenticate, (req, res) => {
  const { month, kunde_id } = req.query;
  const visible = visibleKundeIds(req);
  let rows = db.find('repeat_orders');
  if (visible) rows = rows.filter(r => visible.has(r.kunde_id));
  if (month) rows = rows.filter(r => (r.date || '').startsWith(month));
  if (kunde_id) rows = rows.filter(r => r.kunde_id === Number(kunde_id));

  const kunden = db.find('kunden');
  const kundenMap = Object.fromEntries(kunden.map(k => [k.id, k]));
  const enriched = rows.map(r => ({
    ...r,
    kunde_firma: kundenMap[r.kunde_id]?.firma || null,
  }));
  enriched.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json(enriched);
});

router.post('/', authenticate, requireRole('admin', 'customersuccess'), (req, res) => {
  const { kunde_id, date, umsatz, marge, notes } = req.body;
  if (!kunde_id || !date) return res.status(400).json({ error: 'kunde_id und date erforderlich' });
  const kunde = db.findOne('kunden', k => k.id === Number(kunde_id));
  if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden' });
  const row = db.insert('repeat_orders', {
    kunde_id: Number(kunde_id),
    date,
    umsatz: Number(umsatz) || 0,
    marge: Number(marge) || 0,
    notes: notes || '',
    created_by: req.user.id,
  });
  res.status(201).json(row);
});

router.delete('/:id', authenticate, requireRole('admin', 'customersuccess'), (req, res) => {
  db.delete('repeat_orders', Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
