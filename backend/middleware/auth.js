const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'tbc-deutschland-secret-2026';

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  // Also accept token via query param (for browser download links)
  const token = (header && header.startsWith('Bearer ') ? header.slice(7) : null)
    || req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Nicht authentifiziert' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, JWT_SECRET };
