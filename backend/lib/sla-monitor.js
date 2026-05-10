// 24h-SLA monitor for CS handover first-contact.
// Runs on a 5-min tick after server boot. For each kunde that has been
// handed over (handover_at set) but where WhatsApp contact hasn't been
// ticked yet:
//  - delta > 23.5h and !sla_warned_at  -> push to assigned CS user
//  - delta > 24h   and !sla_escalated_at -> push to all admins
// Idempotent via the *_at timestamp flags.

const db = require('../models/database');
const { notifyUser } = require('./push-notify');

const TICK_MS = 5 * 60 * 1000;
const WARN_AT_MS  = 23.5 * 60 * 60 * 1000;
const ESCALATE_AT_MS = 24 * 60 * 60 * 1000;

let _timer = null;

async function tick() {
  try {
    const now = Date.now();
    const kunden = db.find('kunden', k =>
      k.handover_at &&
      !k.whatsapp_contact_at &&
      k.onboarding_phase !== 'fertig'
    );

    for (const k of kunden) {
      const handoverMs = new Date(k.handover_at).getTime();
      if (Number.isNaN(handoverMs)) continue;
      const delta = now - handoverMs;

      // Warning to assigned CS
      if (delta > WARN_AT_MS && !k.sla_warned_at && k.assigned_cs_user_id) {
        try {
          await notifyUser(k.assigned_cs_user_id, {
            title: '⏰ SLA bald abgelaufen',
            body: `${k.firma} — WhatsApp-Kontakt noch nicht erledigt (30 Min bis Ablauf).`,
            url: '/app/datenbank',
          });
        } catch (err) { console.error('[sla] warn push failed:', err.message); }
        db.update('kunden', k.id, { sla_warned_at: new Date().toISOString() });
      }

      // Escalation to admins
      if (delta > ESCALATE_AT_MS && !k.sla_escalated_at) {
        const admins = db.find('users', u => u.role === 'admin');
        for (const a of admins) {
          try {
            await notifyUser(a.id, {
              title: '⚠ SLA überschritten',
              body: `${k.firma} — Erstkontakt nicht innerhalb 24h erfolgt.`,
              url: '/app/datenbank',
            });
          } catch (err) { console.error('[sla] escalate push failed:', err.message); }
        }
        db.update('kunden', k.id, { sla_escalated_at: new Date().toISOString() });
      }
    }
  } catch (err) {
    console.error('[sla] tick failed:', err.message);
  }
}

function start() {
  if (_timer) return;
  tick();
  _timer = setInterval(tick, TICK_MS);
  console.log('[sla] monitor started (tick every 5min)');
}

function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = { start, stop, tick };
