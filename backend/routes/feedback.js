const router = require('express').Router();
const db = require('../models/database');
const { authenticate } = require('../middleware/auth');

const VALID_TOPICS = ['TBC Deutschland Tool', 'Design', 'Produktion', 'Prozesse', 'Onboarding', 'Sonstiges'];

router.get('/', authenticate, (req, res) => {
  const isAdmin = ['admin', 'manager'].includes(req.user.role);
  if (!isAdmin) return res.status(403).json({ error: 'Keine Berechtigung' });

  const { topic } = req.query;
  const users = db.find('users');
  const userMap = {};
  users.forEach(u => { userMap[u.id] = { name: u.name, avatar: u.avatar || null }; });

  let rows = db.find('feedback');
  if (topic) rows = rows.filter(f => f.topic === topic);
  rows = rows.map(f => ({ ...f, user_name: (userMap[f.user_id] || {}).name || '–', user_avatar: (userMap[f.user_id] || {}).avatar || null }));
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(rows);
});

router.post('/', authenticate, (req, res) => {
  const { topic, rating, pros, cons } = req.body;
  if (!topic || !VALID_TOPICS.includes(topic)) return res.status(400).json({ error: 'Ungültiges Thema' });
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Bewertung (1-5) erforderlich' });

  const row = db.insert('feedback', {
    topic, rating: Number(rating),
    pros: pros || '', cons: cons || '',
    user_id: req.user.id,
  });
  res.status(201).json(row);
});

module.exports = router;
