const router = require('express').Router();
const db = require('../models/database');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const users = db.find('users');
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.name; });

  const news = db.find('announcements')
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.created_at) - new Date(a.created_at);
    })
    .map(n => ({ ...n, author_name: userMap[n.author_id] || 'Unbekannt' }));

  res.json(news);
});

router.post('/', authenticate, requireRole('admin', 'management', 'sellsupport'), (req, res) => {
  const { title, content, pinned } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Titel und Inhalt erforderlich' });

  const item = db.insert('announcements', { title, content, author_id: req.user.id, pinned: !!pinned });
  res.status(201).json(item);
});

router.delete('/:id', authenticate, requireRole('admin', 'management', 'sellsupport'), (req, res) => {
  db.delete('announcements', req.params.id);
  res.json({ success: true });
});

module.exports = router;
