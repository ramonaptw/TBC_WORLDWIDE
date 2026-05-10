const router = require('express').Router();
const db = require('../models/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { notifyUser } = require('../lib/push-notify');

const PRIORITY_ORDER = { high: 1, medium: 2, low: 3 };

router.get('/', authenticate, (req, res) => {
  const { status, priority, project } = req.query;
  const users = db.find('users');
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.name; });

  let tasks = db.find('tasks');
  // Everyone only sees their own tasks; admins use /api/admin for full overview
  tasks = tasks.filter(t => t.assigned_to === req.user.id || t.created_by === req.user.id);
  if (status) tasks = tasks.filter(t => t.status === status);
  if (priority) tasks = tasks.filter(t => t.priority === priority);
  if (project) tasks = tasks.filter(t => (t.project || '').toLowerCase().includes(project.toLowerCase()));

  tasks.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] || 9;
    const pb = PRIORITY_ORDER[b.priority] || 9;
    if (pa !== pb) return pa - pb;
    return (a.due_date || '').localeCompare(b.due_date || '');
  });

  const result = tasks.map(t => ({
    ...t,
    assigned_name: userMap[t.assigned_to] || null,
    created_name: userMap[t.created_by] || null
  }));

  res.json(result);
});

router.post('/', authenticate, (req, res) => {
  const { title, description, priority, assigned_to, due_date, project, checklist, sourcing } = req.body;
  if (!title) return res.status(400).json({ error: 'Titel erforderlich' });

  const task = db.insert('tasks', {
    title, description: description || '', status: 'open',
    priority: priority || 'medium',
    assigned_to: assigned_to ? Number(assigned_to) : null,
    created_by: req.user.id,
    due_date: due_date || null,
    project: project || '',
    checklist: Array.isArray(checklist) ? checklist : [],
    kunde_id: req.body.kunde_id ? Number(req.body.kunde_id) : null,
    sourcing: sourcing && typeof sourcing === 'object' ? sourcing : null,
  });

  // Push notify the assignee (don't await; don't block the response)
  if (task.assigned_to && task.assigned_to !== req.user.id) {
    notifyUser(task.assigned_to, {
      title: 'Neue Aufgabe für dich',
      body: task.title,
      url: '/app/tasks',
      taskId: task.id,
    }).catch(err => console.error('[tasks] push notify failed:', err.message));
  }

  res.status(201).json(task);
});

router.put('/:id', authenticate, (req, res) => {
  const { title, description, status, priority, assigned_to, due_date, project, sourcing } = req.body;
  const taskId = Number(req.params.id);
  const before = db.findOne('tasks', t => t.id === taskId);
  const updates = {
    title, description, status, priority,
    assigned_to: assigned_to ? Number(assigned_to) : null,
    due_date, project
  };
  if (sourcing !== undefined) updates.sourcing = sourcing && typeof sourcing === 'object' ? sourcing : null;
  db.update('tasks', taskId, updates);

  // Notify if assignment changed to a new user (and that user isn't the actor)
  if (updates.assigned_to && updates.assigned_to !== before?.assigned_to && updates.assigned_to !== req.user.id) {
    notifyUser(updates.assigned_to, {
      title: 'Aufgabe dir zugewiesen',
      body: title || before?.title || 'Neue Aufgabe',
      url: '/app/tasks',
      taskId,
    }).catch(err => console.error('[tasks] push notify failed:', err.message));
  }

  res.json({ success: true });
});

router.delete('/:id', authenticate, (req, res) => {
  const id = Number(req.params.id);
  const task = db.findOne('tasks', t => t.id === id);
  if (!task) return res.status(404).json({ error: 'Nicht gefunden' });
  const role = req.user.role;
  const isOwner = task.created_by === req.user.id || task.assigned_to === req.user.id;
  if (role !== 'admin' && role !== 'management' && !isOwner) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  db.delete('tasks', id);
  res.json({ success: true });
});

router.get('/:id', authenticate, (req, res) => {
  const users = db.find('users');
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.name; });
  const task = db.findOne('tasks', t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json({ ...task, assigned_name: userMap[task.assigned_to] || null });
});

// Toggle checklist item
router.patch('/:id/checklist', authenticate, (req, res) => {
  const task = db.findOne('tasks', t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Nicht gefunden' });
  const { index, done } = req.body;
  const checklist = Array.isArray(task.checklist) ? [...task.checklist] : [];
  if (checklist[index]) checklist[index] = { ...checklist[index], done: Boolean(done) };
  db.update('tasks', Number(req.params.id), { checklist });

  // SLA hook: when the 'WhatsApp kontaktiert' item is ticked done, stamp the kunde.
  if (task.kunde_id && checklist[index] && /whatsapp.*kontaktiert/i.test(checklist[index].label) && checklist[index].done) {
    const k = db.findOne('kunden', x => x.id === task.kunde_id);
    if (k && !k.whatsapp_contact_at) {
      db.update('kunden', k.id, { whatsapp_contact_at: new Date().toISOString() });
    }
  }

  res.json({ success: true, checklist });
});

router.post('/:id/feedback', authenticate, (req, res) => {
  const task = db.findOne('tasks', t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Nicht gefunden' });
  const { rating, pros, cons } = req.body;
  const feedback = Array.isArray(task.feedback) ? [...task.feedback] : [];
  const idx = feedback.findIndex(f => f.user_id === req.user.id);
  const entry = { user_id: req.user.id, user_name: req.user.name, rating: Number(rating) || 0, pros: pros || '', cons: cons || '', created_at: new Date().toISOString() };
  if (idx >= 0) feedback[idx] = entry; else feedback.push(entry);
  db.update('tasks', Number(req.params.id), { feedback });
  res.json({ success: true });
});

module.exports = router;
