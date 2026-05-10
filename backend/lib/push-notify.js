const webpush = require('web-push');
const db = require('../models/database');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noreply@thebrandingclub.com';

let configured = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  configured = true;
} else {
  console.warn('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications disabled');
}

async function notifyUser(userId, payload) {
  if (!configured) return;
  const subs = db.find('push_subscriptions', s => s.user_id === Number(userId));
  if (!subs.length) return;

  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification(s.subscription, body);
    } catch (err) {
      // 404 / 410 = subscription expired, remove it
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.delete('push_subscriptions', s.id);
      } else {
        console.error('[push] send failed:', err.message);
      }
    }
  }));
}

module.exports = { notifyUser, vapidPublicKey: VAPID_PUBLIC, configured };
