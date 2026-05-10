const router = require('express').Router();
const db = require('../models/database');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const tools = db.find('tools').sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  res.json(tools);
});

router.post('/', authenticate, requireRole('admin'), (req, res) => {
  const { name, url, description, category, icon } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name und URL erforderlich' });

  const tool = db.insert('tools', { name, url, description: description || '', category: category || 'Allgemein', icon: icon || 'link' });
  res.status(201).json(tool);
});

router.delete('/:id', authenticate, requireRole('admin'), (req, res) => {
  db.delete('tools', req.params.id);
  res.json({ success: true });
});

module.exports = router;
