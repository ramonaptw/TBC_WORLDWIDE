const router = require('express').Router();
const db = require('../models/database');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/steps', authenticate, (req, res) => {
  const steps = db.find('onboarding_steps').sort((a, b) => a.order_index - b.order_index);
  res.json(steps);
});

router.get('/progress/:userId', authenticate, (req, res) => {
  const userId = Number(req.params.userId);
  if (req.user.role === 'employee' && req.user.id !== userId) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }

  const steps = db.find('onboarding_steps').sort((a, b) => a.order_index - b.order_index);
  const progress = db.find('onboarding_progress', p => p.user_id === userId);
  const progressMap = {};
  progress.forEach(p => { progressMap[p.step_id] = p; });

  const result = steps.map(s => ({
    ...s,
    completed: progressMap[s.id]?.completed === true,
    completed_at: progressMap[s.id]?.completed_at || null
  }));
  res.json(result);
});

router.post('/progress/:userId/:stepId', authenticate, (req, res) => {
  const userId = Number(req.params.userId);
  const stepId = Number(req.params.stepId);
  if (req.user.role === 'employee' && req.user.id !== userId) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { completed } = req.body;
  const completedAt = completed ? new Date().toISOString() : null;

  db.upsert(
    'onboarding_progress',
    p => p.user_id === userId && p.step_id === stepId,
    { user_id: userId, step_id: stepId, completed: !!completed, completed_at: completedAt }
  );
  res.json({ success: true });
});

router.get('/overview', authenticate, requireRole('admin', 'management'), (req, res) => {
  const users = db.find('users', u => u.role === 'employee');
  const totalSteps = db.count('onboarding_steps');

  const result = users.map(u => {
    const done = db.count('onboarding_progress', p => p.user_id === u.id && p.completed === true);
    return {
      id: u.id, name: u.name, email: u.email, department: u.department, avatar: u.avatar || null,
      completed: done, total: totalSteps,
      percent: totalSteps > 0 ? Math.round((done / totalSteps) * 100) : 0
    };
  });
  res.json(result);
});

router.post('/steps', authenticate, requireRole('admin'), (req, res) => {
  const { title, description, document_url, order_index } = req.body;
  const step = db.insert('onboarding_steps', { title, description, document_url, order_index });
  res.status(201).json(step);
});

module.exports = router;
