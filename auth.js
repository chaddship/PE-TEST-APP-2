const crypto = require('crypto');
const { read, update } = require('./db');

const SALT_LEN = 16;
const KEY_LEN = 64;

function hashPassword(password, salt = crypto.randomBytes(SALT_LEN).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const h = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  update((db) => {
    db.sessions[token] = {
      userId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
    };
  });
  return token;
}

function destroySession(token) {
  update((db) => {
    delete db.sessions[token];
  });
}

function getUserFromToken(token) {
  if (!token) return null;
  const db = read();
  const session = db.sessions[token];
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    destroySession(token);
    return null;
  }
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    school: user.school || '',
    districtId: user.districtId || 'default'
  };
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const [k, ...rest] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(rest.join('=') || '');
  });
  return out;
}

function requireAuth(req, res) {
  const cookies = parseCookies(req);
  const token = cookies.pe_token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = getUserFromToken(token);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not logged in' }));
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Admin only' }));
    return null;
  }
  return user;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getUserFromToken,
  parseCookies,
  requireAuth,
  requireAdmin
};
