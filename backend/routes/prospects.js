const router = require('express').Router();
const db = require('../models/database');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const { status, search } = req.query;
  const users = db.find('users');
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.name; });

  let prospects = db.find('prospects');

  if (req.user.role === 'employee') {
    prospects = prospects.filter(p => p.assigned_to === req.user.id || p.created_by === req.user.id);
  }
  if (status) prospects = prospects.filter(p => p.status === status);
  if (search) {
    const q = search.toLowerCase();
    prospects = prospects.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.company || '').toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q)
    );
  }

  const result = prospects
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(p => ({ ...p, assigned_name: userMap[p.assigned_to] || null, created_name: userMap[p.created_by] || null }));

  res.json(result);
});

router.post('/', authenticate, (req, res) => {
  const { name, email, phone, company, status, notes, source, assigned_to } = req.body;
  if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });

  const prospect = db.insert('prospects', {
    name, email: email || '', phone: phone || '', company: company || '',
    status: status || 'new', notes: notes || '', source: source || '',
    assigned_to: assigned_to ? Number(assigned_to) : null,
    created_by: req.user.id
  });
  res.status(201).json(prospect);
});

router.put('/:id', authenticate, (req, res) => {
  const { name, email, phone, company, status, notes, source, assigned_to } = req.body;
  db.update('prospects', Number(req.params.id), {
    name, email, phone, company, status, notes, source,
    assigned_to: assigned_to ? Number(assigned_to) : null
  });
  res.json({ success: true });
});

router.delete('/:id', authenticate, requireRole('admin', 'management'), (req, res) => {
  db.delete('prospects', req.params.id);
  res.json({ success: true });
});

module.exports = router;
