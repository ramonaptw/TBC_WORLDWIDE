const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DATA_PATH
  ? path.join(process.env.DATA_PATH, 'tbc-data.json')
  : path.join(__dirname, '../tbc-data.json');

// Ensure the data directory exists before any read/write
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const EMPTY = {
  users: [], announcements: [], onboarding_steps: [],
  onboarding_progress: [], prospects: [], tasks: [], tools: [], commitments: [], kunden: [], wiki_articles: [], feedback: [],
  _counters: {}
};

function load() {
  if (fs.existsSync(DB_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      // ensure all tables exist (migration for new tables added after initial seed)
      let dirty = false;
      for (const key of Object.keys(EMPTY)) {
        if (data[key] === undefined) { data[key] = JSON.parse(JSON.stringify(EMPTY[key])); dirty = true; }
      }
      // remove deprecated tools
      const removedTools = ['Slack', 'Zoom', 'Notion', 'Google Drive'];
      const before = (data.tools || []).length;
      data.tools = (data.tools || []).filter(t => !removedTools.includes(t.name));
      if (data.tools.length !== before) dirty = true;
      if (dirty) fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
      return data;
    } catch {}
  }
  return JSON.parse(JSON.stringify(EMPTY));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function nextId(data, table) {
  data._counters[table] = (data._counters[table] || 0) + 1;
  return data._counters[table];
}

const db = {
  find(table, predicate) {
    const rows = load()[table] || [];
    return predicate ? rows.filter(predicate) : rows;
  },

  findOne(table, predicate) {
    return (load()[table] || []).find(predicate) || null;
  },

  insert(table, record) {
    const data = load();
    const id = nextId(data, table);
    const row = { id, ...record, created_at: new Date().toISOString() };
    data[table].push(row);
    save(data);
    return row;
  },

  update(table, id, updates) {
    const data = load();
    const idx = data[table].findIndex(r => r.id === id);
    if (idx === -1) return false;
    data[table][idx] = { ...data[table][idx], ...updates, updated_at: new Date().toISOString() };
    save(data);
    return data[table][idx];
  },

  upsert(table, predicate, record) {
    const data = load();
    const idx = data[table].findIndex(predicate);
    if (idx >= 0) {
      data[table][idx] = { ...data[table][idx], ...record };
      save(data);
      return data[table][idx];
    }
    const id = nextId(data, table);
    const row = { id, ...record, created_at: new Date().toISOString() };
    data[table].push(row);
    save(data);
    return row;
  },

  delete(table, id) {
    const data = load();
    const idx = data[table].findIndex(r => r.id === Number(id));
    if (idx === -1) return false;
    data[table].splice(idx, 1);
    save(data);
    return true;
  },

  count(table, predicate) {
    return this.find(table, predicate).length;
  }
};

// Capture before any inserts (admin insert would create the file)
const isFirstRun = !fs.existsSync(DB_PATH);

// Always ensure the admin account exists — survives every redeploy / data loss
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@tbc-deutschland.de';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_NAME     = process.env.ADMIN_NAME     || 'Admin';

if (!db.findOne('users', u => u.email === ADMIN_EMAIL)) {
  db.insert('users', {
    name: ADMIN_NAME, email: ADMIN_EMAIL,
    password: bcrypt.hashSync(ADMIN_PASSWORD, 10),
    role: 'admin', department: 'Management', position: 'Administrator', phone: '',
  });
  console.log(`[DB] Admin-Account angelegt: ${ADMIN_EMAIL}`);
}

// Seed tools + onboarding steps only on first-ever run
if (isFirstRun) {
  const steps = [
    { title: 'Willkommen bei TBC Deutschland', description: 'Lies die Unternehmensgeschichte und lerne unser Team kennen.', order_index: 1 },
    { title: 'IT-Zugänge einrichten', description: 'Richte deinen E-Mail-Account, VPN und Slack ein.', order_index: 2 },
    { title: 'Arbeitsvertrag & Dokumente', description: 'Unterzeichne alle notwendigen Dokumente und gib sie bei HR ab.', order_index: 3 },
    { title: 'Onboarding-Gespräch mit HR', description: 'Führe ein Einführungsgespräch mit deinem HR-Ansprechpartner.', order_index: 4 },
    { title: 'Produkt- & Prozessschulung', description: 'Absolviere die Einführungsschulung zu unseren Produkten und Prozessen.', order_index: 5 },
    { title: 'Team-Vorstellungsrunde', description: 'Stelle dich deinem Team vor und lerne die Kollegen kennen.', order_index: 6 },
  ];
  steps.forEach(s => db.insert('onboarding_steps', s));

  const tools = [
    { name: 'Google Drive', url: 'https://drive.google.com', description: 'Dateiablage, Mockups & Dokumente', category: 'Dokumente', icon: 'folder' },
    { name: 'HubSpot', url: 'https://hubspot.com', description: 'CRM System', category: 'Sales', icon: 'users' },
    { name: 'Personio', url: 'https://personio.de', description: 'HR-Portal', category: 'HR', icon: 'user' },
  ];
  tools.forEach(t => db.insert('tools', t));
}

module.exports = db;
