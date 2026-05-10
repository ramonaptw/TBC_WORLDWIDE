const router = require('express').Router();
const db = require('../models/database');
const { authenticate } = require('../middleware/auth');
const { vapidPublicKey, configured } = require('../lib/push-notify');

router.get('/vapid-public-key', (req, res) => {
  res.json({ key: vapidPublicKey, enabled: configured });
});

router.post('/subscribe', authenticate, (req, res) => {
  const sub = req.body && req.body.subscription;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'subscription fehlt' });

  // Idempotent — don't store duplicates per user+endpoint
  const existing = db.findOne('push_subscriptions', s => s.user_id === req.user.id && s.subscription?.endpoint === sub.endpoint);
  if (existing) {
    db.update('push_subscriptions', existing.id, { subscription: sub });
    return res.json({ ok: true, id: existing.id });
  }
  const row = db.insert('push_subscriptions', { user_id: req.user.id, subscription: sub });
  res.json({ ok: true, id: row.id });
});

router.post('/unsubscribe', authenticate, (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'endpoint fehlt' });
  const subs = db.find('push_subscriptions', s => s.user_id === req.user.id && s.subscription?.endpoint === endpoint);
  subs.forEach(s => db.delete('push_subscriptions', s.id));
  res.json({ ok: true, removed: subs.length });
});

module.exports = router;
