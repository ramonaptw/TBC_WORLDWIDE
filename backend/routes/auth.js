const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
const db = require('../models/database');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

const ALLOWED_DOMAIN = (process.env.ALLOWED_DOMAIN || 'thebrandingclub.com').toLowerCase();
const APP_URL = process.env.APP_URL || '';
const RESET_TOKEN_TTL_MIN = 30;
const RESEND_FROM = process.env.RESEND_FROM || 'onboarding@resend.dev';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isAllowedEmail(email) {
  const e = normalizeEmail(email);
  if (!e.includes('@')) return false;
  const domain = e.split('@')[1];
  return domain === ALLOWED_DOMAIN;
}

function issueToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function appBaseUrl(req) {
  if (APP_URL) return APP_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

router.post('/login', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });

  const user = db.findOne('users', u => normalizeEmail(u.email) === email);
  if (!user || !user.password || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  }

  // Admin-account bypasses domain restriction; everyone else must be on the allowed domain.
  if (user.role !== 'admin' && !isAllowedEmail(email)) {
    return res.status(403).json({ error: `Nur @${ALLOWED_DOMAIN}-Adressen erlaubt` });
  }

  res.json({
    token: issueToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department, position: user.position }
  });
});

// Step 1: Request a password-reset / first-time-setup link via email.
// Auto-creates the user (without password) if the email is on the allowed domain.
// Always returns 200 to avoid leaking which addresses are registered.
router.post('/password-reset/request', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!isAllowedEmail(email)) {
    return res.status(400).json({ error: `Nur @${ALLOWED_DOMAIN}-Adressen erlaubt` });
  }

  let user = db.findOne('users', u => normalizeEmail(u.email) === email);
  if (!user) {
    const name = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    user = db.insert('users', {
      name, email, password: null, role: 'employee',
      department: '', position: '', phone: '',
    });
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = Date.now() + RESET_TOKEN_TTL_MIN * 60 * 1000;

  // Invalidate previous tokens for this user
  db.find('password_reset_tokens', t => t.user_id === user.id).forEach(t => db.delete('password_reset_tokens', t.id));
  db.insert('password_reset_tokens', { user_id: user.id, token_hash: tokenHash, expires_at: expiresAt, used: false });

  const link = `${appBaseUrl(req)}/reset-password.html?token=${rawToken}`;
  if (!resend) {
    console.error('[auth] RESEND_API_KEY not configured — reset link:', link);
    return res.json({ ok: true });
  }

  try {
    const { error } = await resend.emails.send({
      from: RESEND_FROM,
      to: email,
      subject: 'Passwort setzen für dein TBC-Konto',
      text: `Hallo,\n\nklicke auf den folgenden Link, um dein Passwort zu setzen oder zurückzusetzen:\n\n${link}\n\nDer Link ist ${RESET_TOKEN_TTL_MIN} Minuten gültig.\n\nWenn du keinen Reset angefordert hast, kannst du diese Mail ignorieren.`,
      html: `<p>Hallo,</p><p>klicke auf den folgenden Link, um dein Passwort zu setzen oder zurückzusetzen:</p><p><a href="${link}">${link}</a></p><p>Der Link ist ${RESET_TOKEN_TTL_MIN} Minuten gültig.</p><p>Wenn du keinen Reset angefordert hast, kannst du diese Mail ignorieren.</p>`,
    });
    if (error) throw new Error(error.message || 'Resend error');
  } catch (err) {
    console.error('[auth] mail send failed:', err.message);
    return res.status(500).json({ error: 'E-Mail konnte nicht versendet werden' });
  }

  res.json({ ok: true });
});

// Step 2: Verify a token (used by the reset page to show the email + check validity)
router.get('/password-reset/verify', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token fehlt' });

  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const record = db.findOne('password_reset_tokens', t => t.token_hash === tokenHash);
  if (!record || record.used || record.expires_at < Date.now()) {
    return res.status(400).json({ error: 'Link ungültig oder abgelaufen' });
  }

  const user = db.findOne('users', u => u.id === record.user_id);
  if (!user) return res.status(400).json({ error: 'Link ungültig' });

  res.json({ email: user.email, isFirstTime: !user.password });
});

// Step 3: Confirm a new password with the token
router.post('/password-reset/confirm', (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token und Passwort erforderlich' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });

  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const record = db.findOne('password_reset_tokens', t => t.token_hash === tokenHash);
  if (!record || record.used || record.expires_at < Date.now()) {
    return res.status(400).json({ error: 'Link ungültig oder abgelaufen' });
  }

  const user = db.findOne('users', u => u.id === record.user_id);
  if (!user) return res.status(400).json({ error: 'Link ungültig' });

  db.update('users', user.id, { password: bcrypt.hashSync(password, 10) });
  db.update('password_reset_tokens', record.id, { used: true });

  const fresh = db.findOne('users', u => u.id === user.id);
  res.json({
    token: issueToken(fresh),
    user: { id: fresh.id, name: fresh.name, email: fresh.email, role: fresh.role, department: fresh.department, position: fresh.position }
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

  const { password: _, ...safe } = updated;
  res.json({ user: safe, token: issueToken(updated) });
});

router.put('/instagram-session', authenticate, (req, res) => {
  const { sessionid } = req.body;
  const updates = { instagram_session: sessionid || null };
  const updated = db.update('users', req.user.id, updates);
  if (!updated) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json({ ok: true, connected: !!sessionid });
});

module.exports = router;
