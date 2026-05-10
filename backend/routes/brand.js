const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { authenticate, requireRole } = require('../middleware/auth');

const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, '../..');
const LOGO_FILE = path.join(DATA_DIR, 'brand-logo');

// GET /api/brand/logo – serve uploaded logo or fallback to built-in SVG
router.get('/logo', (req, res) => {
  for (const ext of ['.png', '.jpg', '.jpeg', '.svg', '.webp']) {
    const p = LOGO_FILE + ext;
    if (fs.existsSync(p)) {
      const mime = ext === '.svg' ? 'image/svg+xml'
                 : ext === '.webp' ? 'image/webp'
                 : ext === '.png' ? 'image/png' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-cache');
      return fs.createReadStream(p).pipe(res);
    }
  }
  // fallback to static SVG
  res.redirect('/images/logo.svg');
});

// POST /api/brand/logo – upload new logo (admin only)
router.post('/logo', authenticate, requireRole('admin', 'management'), (req, res) => {
  const { imageBase64, imageMime } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Kein Bild übermittelt' });

  const ext = imageMime === 'image/svg+xml' ? '.svg'
            : imageMime === 'image/webp'    ? '.webp'
            : imageMime === 'image/jpeg'    ? '.jpg'
            : '.png';

  // Remove any previous logo files
  for (const e of ['.png', '.jpg', '.jpeg', '.svg', '.webp']) {
    try { fs.unlinkSync(LOGO_FILE + e); } catch {}
  }

  const buffer = Buffer.from(imageBase64, 'base64');
  fs.writeFileSync(LOGO_FILE + ext, buffer);
  res.json({ ok: true, ext });
});

const NAME_FILE = path.join(DATA_DIR, 'brand-name.txt');

// GET /api/brand/name
router.get('/name', (req, res) => {
  try {
    if (fs.existsSync(NAME_FILE)) {
      return res.json({ name: fs.readFileSync(NAME_FILE, 'utf8').trim() });
    }
  } catch {}
  res.json({ name: 'B Mobile' });
});

// POST /api/brand/name (admin only)
router.post('/name', authenticate, requireRole('admin', 'management'), (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name darf nicht leer sein' });
  fs.writeFileSync(NAME_FILE, name.trim());
  res.json({ ok: true, name: name.trim() });
});

module.exports = router;
