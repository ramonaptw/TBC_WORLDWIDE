const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../models/database');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });

  const user = db.findOne('users', u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department, position: user.position }
  });
});

router.get('/me', authenticate, (req, res) => {
  const user = db.findOne('users', u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Nicht gefunden' });
  const { password, ...safe } = user;
  res.json(safe);
});

router.put('/profile', authenticate, (req, res) => {
  const { name, email, phone, position, password, avatar } = req.body;
  const updates = {};
  if (name) updates.name = name;
  if (email) updates.email = email;
  if (phone !== undefined) updates.phone = phone;
  if (position !== undefined) updates.position = position;
  if (avatar !== undefined) updates.avatar = avatar;
  if (password) updates.password = bcrypt.hashSync(password, 10);

  const updated = db.update('users', req.user.id, updates);
  if (!updated) return res.status(404).json({ error: 'Nicht gefunden' });

  // Issue a fresh token with updated name/email
  const token = jwt.sign(
    { id: updated.id, name: updated.name, email: updated.email, role: updated.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  const { password: _, ...safe } = updated;
  res.json({ user: safe, token });
});

router.put('/instagram-session', authenticate, (req, res) => {
  const { sessionid } = req.body;
  const updates = { instagram_session: sessionid || null };
  const updated = db.update('users', req.user.id, updates);
  if (!updated) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json({ ok: true, connected: !!sessionid });
});

module.exports = router;
