const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/prospects', require('./routes/prospects'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/news', require('./routes/news'));
app.use('/api/tools', require('./routes/tools'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/onboarding-hs', require('./routes/onboarding-hs'));
app.use('/api/commitments', require('./routes/commitments'));
app.use('/api/kunden', require('./routes/kunden'));
app.use('/api/wiki', require('./routes/wiki'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/brand', require('./routes/brand'));
app.use('/api/push', require('./routes/push'));
app.use('/api/repeat-orders', require('./routes/repeat-orders'));

// Health check endpoint for Railway
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Serve app.html for /app and all /app/* routes
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/app.html'));
});
app.get('/app/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/app.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// 24h SLA monitor for CS handovers
require('./lib/sla-monitor').start();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TBC App läuft auf http://localhost:${PORT}`);
  console.log('ENV check — HUBSPOT_TOKEN:', process.env.HUBSPOT_TOKEN ? '✓ gesetzt' : '✗ fehlt');
  console.log('ENV check — JWT_SECRET:', process.env.JWT_SECRET ? '✓ gesetzt' : '✗ fehlt (nutze default)');
  console.log('ENV check — DATA_PATH:', process.env.DATA_PATH || '(nicht gesetzt, nutze lokalen Pfad)');
});
