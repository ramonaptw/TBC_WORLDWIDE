const router = require('express').Router();
const db = require('../models/database');
const { authenticate } = require('../middleware/auth');

// GET /api/commitments?month=2026-05
router.get('/', authenticate, (req, res) => {
  const month = req.query.month;
  if (!month) return res.status(400).json({ error: 'month fehlt' });
  const row = db.findOne('commitments', r => r.user_id === req.user.id && r.month === month);
  res.json(row || null);
});

// POST /api/commitments  { month, targetKunden, targetUmsatz }
router.post('/', authenticate, (req, res) => {
  const { month, targetKunden, targetUmsatz } = req.body;
  if (!month) return res.status(400).json({ error: 'month fehlt' });
  const row = db.upsert(
    'commitments',
    r => r.user_id === req.user.id && r.month === month,
    { user_id: req.user.id, month, targetKunden: Number(targetKunden) || 0, targetUmsatz: Number(targetUmsatz) || 0 }
  );
  res.json(row);
});

module.exports = router;
