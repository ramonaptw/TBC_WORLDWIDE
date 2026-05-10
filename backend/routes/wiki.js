const router = require('express').Router();
const db = require('../models/database');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const { search, category } = req.query;
  const users = db.find('users');
  let articles = db.find('wiki_articles').map(a => ({
    ...a,
    author_name: users.find(u => u.id === a.author_id)?.name || '–',
  }));
  if (category) articles = articles.filter(a => a.category === category);
  if (search) {
    const q = search.toLowerCase();
    articles = articles.filter(a =>
      a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q) || (a.category || '').toLowerCase().includes(q)
    );
  }
  articles.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  res.json(articles);
});

router.post('/', authenticate, (req, res) => {
  const { title, content, category } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Titel und Inhalt erforderlich' });
  const row = db.insert('wiki_articles', { title, content, category: category || 'Allgemein', author_id: req.user.id });
  res.status(201).json(row);
});

router.put('/:id', authenticate, (req, res) => {
  const { title, content, category } = req.body;
  const updated = db.update('wiki_articles', Number(req.params.id), { title, content, category: category || 'Allgemein' });
  if (!updated) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(updated);
});

router.delete('/:id', authenticate, (req, res) => {
  db.delete('wiki_articles', Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
