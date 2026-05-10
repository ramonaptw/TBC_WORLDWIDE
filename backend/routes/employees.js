const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../models/database');
const { authenticate, requireRole } = require('../middleware/auth');

function safeUser(u) {
  const { password, ...rest } = u;
  return rest;
}

router.get('/', authenticate, (req, res) => {
  const users = db.find('users').map(safeUser).sort((a, b) => a.name.localeCompare(b.name));
  res.json(users);
});

router.get('/:id', authenticate, (req, res) => {
  const user = db.findOne('users', u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
  res.json(safeUser(user));
});

router.post('/', authenticate, requireRole('admin', 'manager'), (req, res) => {
  const { name, email, password, role, department, position, phone, does_onboarding } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, E-Mail und Passwort erforderlich' });

  const exists = db.findOne('users', u => u.email === email);
  if (exists) return res.status(409).json({ error: 'E-Mail bereits vergeben' });

  const hash = bcrypt.hashSync(password, 10);
  const user = db.insert('users', { name, email, password: hash, role: role || 'employee', department: department || '', position: position || '', phone: phone || '', does_onboarding: does_onboarding || false });
  res.status(201).json(safeUser(user));
});

router.put('/:id', authenticate, (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.role !== 'admin' && req.user.id !== targetId) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { name, email, department, position, phone } = req.body;
  const updates = { name, department, position, phone };
  if (req.user.role === 'admin') {
    if (email) updates.email = email;
    if (req.body.role) updates.role = req.body.role;
    if (typeof req.body.does_onboarding === 'boolean') updates.does_onboarding = req.body.does_onboarding;
    if (req.body.password) {
      const bcrypt = require('bcryptjs');
      updates.password = bcrypt.hashSync(req.body.password, 10);
    }
  }
  db.update('users', targetId, updates);
  res.json({ success: true });
});

router.delete('/:id', authenticate, requireRole('admin'), (req, res) => {
  db.delete('users', req.params.id);
  res.json({ success: true });
});

module.exports = router;
