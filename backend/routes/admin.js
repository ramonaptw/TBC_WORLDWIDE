const router = require('express').Router();
const db = require('../models/database');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate, requireRole('admin', 'manager'));

// Full task list with feedback, all users
router.get('/tasks', (req, res) => {
  const users = db.find('users');
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.name; });

  const tasks = db.find('tasks').map(t => ({
    ...t,
    assigned_name: userMap[t.assigned_to] || null,
    created_name: userMap[t.created_by] || null,
  }));

  tasks.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  res.json(tasks);
});

// All feedback across all tasks
router.get('/feedback', (req, res) => {
  const tasks = db.find('tasks');
  const result = [];
  tasks.forEach(t => {
    (t.feedback || []).forEach(f => {
      result.push({
        task_id: t.id,
        task_title: t.title,
        task_project: t.project || '',
        ...f,
      });
    });
  });
  result.sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(result);
});

// Quick stats snapshot + revenue breakdown
router.get('/stats', (req, res) => {
  const users = db.find('users');
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.name; });
  const tasks = db.find('tasks');
  const kunden = db.find('kunden');

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const today = now.toISOString().slice(0, 10);

  const totalFeedback = tasks.reduce((n, t) => n + (t.feedback || []).length, 0);
  const avgRating = (() => {
    const all = tasks.flatMap(t => (t.feedback || []).map(f => f.rating)).filter(Boolean);
    return all.length ? (all.reduce((s, r) => s + r, 0) / all.length).toFixed(1) : null;
  })();

  const totalUmsatz = kunden.reduce((s, k) => s + (Number(k.umsatz) || 0), 0);
  const totalMarge  = kunden.reduce((s, k) => s + (Number(k.marge)  || 0), 0);

  // Monthly revenue — last 6 months
  const monthlyRevenue = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const mk = kunden.filter(k => (k.abschlussdatum || '').startsWith(m));
    monthlyRevenue.push({ month: m, count: mk.length, umsatz: mk.reduce((s, k) => s + (Number(k.umsatz) || 0), 0), marge: mk.reduce((s, k) => s + (Number(k.marge) || 0), 0) });
  }

  // Channel breakdown
  const channelMap = {};
  kunden.forEach(k => {
    const c = k.kanal || '–';
    if (!channelMap[c]) channelMap[c] = { count: 0, umsatz: 0 };
    channelMap[c].count++;
    channelMap[c].umsatz += Number(k.umsatz) || 0;
  });
  const channels = Object.entries(channelMap).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.count - a.count);

  // Top performers
  const perfMap = {};
  kunden.forEach(k => {
    const name = userMap[k.created_by] || '–';
    if (!perfMap[name]) perfMap[name] = { kunden: 0, umsatz: 0, marge: 0 };
    perfMap[name].kunden++;
    perfMap[name].umsatz += Number(k.umsatz) || 0;
    perfMap[name].marge  += Number(k.marge)  || 0;
  });
  const topPerformers = Object.entries(perfMap).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.umsatz - a.umsatz);

  res.json({
    totalUsers: users.length,
    totalKunden: kunden.length,
    kundenThisMonth: kunden.filter(k => (k.abschlussdatum || '').startsWith(thisMonth)).length,
    openTasks: tasks.filter(t => t.status !== 'done').length,
    overdueTasks: tasks.filter(t => t.status !== 'done' && t.due_date && t.due_date < today).length,
    totalFeedback, avgRating,
    totalUmsatz, totalMarge,
    monthlyRevenue, channels, topPerformers,
  });
});

// CSV export: all users with their stats
router.get('/export/users', (req, res) => {
  const users = db.find('users').filter(u => u.role !== 'admin');
  const kunden = db.find('kunden');
  const tasks = db.find('tasks');
  const commitments = db.find('commitments');

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const rows = users.map(u => {
    const uKunden = kunden.filter(k => k.created_by === u.id);
    const uKundenMonth = uKunden.filter(k => (k.abschlussdatum || '').startsWith(thisMonth));
    const uUmsatz = uKunden.reduce((s, k) => s + (Number(k.umsatz) || 0), 0);
    const uMarge  = uKunden.reduce((s, k) => s + (Number(k.marge)  || 0), 0);
    const uTasks  = tasks.filter(t => t.assigned_to === u.id || t.created_by === u.id);
    const uOpenTasks = uTasks.filter(t => t.status !== 'done').length;
    const uDoneTasks = uTasks.filter(t => t.status === 'done').length;
    const uFeedback  = uTasks.flatMap(t => t.feedback || []);
    const avgRating  = uFeedback.length
      ? (uFeedback.reduce((s, f) => s + (f.rating || 0), 0) / uFeedback.length).toFixed(1)
      : '';
    const comm = commitments.find(c => c.user_id === u.id) || {};

    return [
      u.name,
      u.email,
      u.role,
      u.department || '',
      u.position || '',
      comm.kunden_target || '',
      comm.umsatz_target || '',
      uKunden.length,
      uKundenMonth.length,
      uUmsatz,
      uMarge,
      uOpenTasks,
      uDoneTasks,
      uFeedback.length,
      avgRating,
    ];
  });

  const header = [
    'Name', 'E-Mail', 'Rolle', 'Abteilung', 'Position',
    'Commitment Kunden (Ziel)', 'Commitment Umsatz (Ziel)',
    'Kunden gesamt', 'Kunden diesen Monat',
    'Umsatz (€)', 'Marge (€)',
    'Offene Aufgaben', 'Erledigte Aufgaben',
    'Feedbacks abgegeben', 'Ø Bewertung',
  ];

  const csv = [header, ...rows]
    .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  const bom = '﻿'; // UTF-8 BOM so Excel opens correctly
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tbc-export-${thisMonth}.csv"`);
  res.send(bom + csv);
});

module.exports = router;
