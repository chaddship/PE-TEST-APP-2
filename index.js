const http = require('http');
const fs = require('fs');
const path = require('path');
const { read, update } = require('./db');
const {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  parseCookies,
  requireAuth,
  requireAdmin
} = require('./auth');

const PORT = Number(process.env.PORT) || 3847;
const PUBLIC = path.join(__dirname, '..', 'public');
const DATA = path.join(__dirname, '..', 'data');

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json',
    ...headers
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let filePath = path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(PUBLIC)) {
    send(res, 403, { error: 'Forbidden' });
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml'
  };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // CORS for local testing
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    // ----- Auth -----
    if (pathname === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      const email = (body.email || '').trim().toLowerCase();
      const password = body.password || '';
      const db = read();
      const user = db.users.find((u) => u.email.toLowerCase() === email);
      if (!user || !verifyPassword(password, user.salt, user.hash)) {
        return send(res, 401, { error: 'Invalid email or password' });
      }
      const token = createSession(user.id);
      const secure =
        req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
      const cookie = `pe_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secure ? '; Secure' : ''}`;
      return send(
        res,
        200,
        {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            school: user.school,
            districtId: user.districtId
          }
        },
        { 'Set-Cookie': cookie }
      );
    }

    if (pathname === '/api/logout' && req.method === 'POST') {
      const cookies = parseCookies(req);
      if (cookies.pe_token) destroySession(cookies.pe_token);
      return send(res, 200, { ok: true }, {
        'Set-Cookie': 'pe_token=; Path=/; Max-Age=0'
      });
    }

    if (pathname === '/api/me' && req.method === 'GET') {
      const user = requireAuth(req, res);
      if (!user) return;
      return send(res, 200, { user });
    }

    // ----- Lessons (shared content) -----
    if (pathname === '/api/lessons' && req.method === 'GET') {
      const user = requireAuth(req, res);
      if (!user) return;
      const lessons = JSON.parse(fs.readFileSync(path.join(DATA, 'all-lessons.json'), 'utf8'));
      const units = JSON.parse(fs.readFileSync(path.join(DATA, 'units.json'), 'utf8'));
      return send(res, 200, { lessons, units });
    }

    // ----- Completions (teacher-scoped) -----
    if (pathname === '/api/completions' && req.method === 'GET') {
      const user = requireAuth(req, res);
      if (!user) return;
      const db = read();
      let rows = db.completions;
      if (user.role === 'teacher') {
        rows = rows.filter((c) => c.teacherId === user.id);
      } else {
        // admin: same district
        const teacherIds = db.users
          .filter((u) => u.districtId === user.districtId && u.role === 'teacher')
          .map((u) => u.id);
        rows = rows.filter((c) => teacherIds.includes(c.teacherId));
      }
      return send(res, 200, { completions: rows });
    }

    if (pathname === '/api/completions' && req.method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;
      if (user.role !== 'teacher' && user.role !== 'admin') {
        return send(res, 403, { error: 'Forbidden' });
      }
      const body = await readBody(req);
      const row = {
        id: 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        teacherId: user.role === 'teacher' ? user.id : body.teacherId || user.id,
        lessonId: body.lessonId,
        minutes: Number(body.minutes) || 0,
        date: body.date || new Date().toISOString().slice(0, 10),
        standards: body.standards || []
      };
      update((db) => {
        db.completions.push(row);
      });
      return send(res, 201, { completion: row });
    }

    // ----- Official PFT -----
    if (pathname === '/api/pft' && req.method === 'GET') {
      const user = requireAuth(req, res);
      if (!user) return;
      const db = read();
      let rows = db.pftOfficial;
      if (user.role === 'teacher') {
        rows = rows.filter((r) => r.teacherId === user.id);
      } else {
        const teacherIds = db.users
          .filter((u) => u.districtId === user.districtId)
          .map((u) => u.id);
        rows = rows.filter((r) => teacherIds.includes(r.teacherId));
      }
      return send(res, 200, { results: rows });
    }

    if (pathname === '/api/pft' && req.method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;
      const body = await readBody(req);
      const row = {
        id: 'p-' + Date.now(),
        teacherId: user.id,
        grade: String(body.grade || '5'),
        year: body.year || '2025-26',
        student: (body.student || '').trim(),
        date: new Date().toISOString().slice(0, 10),
        aerobicType: body.aerobicType || '',
        aerobic: body.aerobic || '',
        curl: body.curl || '',
        trunk: body.trunk || '',
        upperType: body.upperType || '',
        upper: body.upper || '',
        flexType: body.flexType || '',
        flex: body.flex || ''
      };
      if (!row.student) return send(res, 400, { error: 'Student required' });
      update((db) => {
        db.pftOfficial.push(row);
      });
      return send(res, 201, { result: row });
    }

    // ----- Admin district dashboard -----
    if (pathname === '/api/admin/overview' && req.method === 'GET') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const db = read();
      const teachers = db.users.filter(
        (u) => u.role === 'teacher' && u.districtId === user.districtId
      );
      const overview = teachers.map((t) => {
        const comps = db.completions.filter((c) => c.teacherId === t.id);
        const minutes = comps.reduce((s, c) => s + (c.minutes || 0), 0);
        const pft = db.pftOfficial.filter((p) => p.teacherId === t.id);
        return {
          id: t.id,
          name: t.name,
          email: t.email,
          school: t.school,
          lessonsCompleted: new Set(comps.map((c) => c.lessonId)).size,
          totalMinutes: minutes,
          completionCount: comps.length,
          pftStudents: new Set(pft.map((p) => p.student)).size,
          pftRows: pft.length
        };
      });
      const allComps = db.completions.filter((c) =>
        teachers.some((t) => t.id === c.teacherId)
      );
      return send(res, 200, {
        teachers: overview,
        district: {
          teacherCount: teachers.length,
          totalMinutes: allComps.reduce((s, c) => s + (c.minutes || 0), 0),
          totalCompletions: allComps.length,
          totalPftRows: db.pftOfficial.filter((p) =>
            teachers.some((t) => t.id === p.teacherId)
          ).length
        }
      });
    }

    if (pathname === '/api/admin/export-completions' && req.method === 'GET') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const db = read();
      const teachers = Object.fromEntries(
        db.users.filter((u) => u.districtId === user.districtId).map((u) => [u.id, u])
      );
      let csv =
        'teacherName,teacherEmail,school,date,lessonId,minutes,standards\n';
      db.completions
        .filter((c) => teachers[c.teacherId])
        .forEach((c) => {
          const t = teachers[c.teacherId];
          csv += `"${t.name}","${t.email}","${t.school || ''}",${c.date},${c.lessonId},${c.minutes},"${(c.standards || []).join(';')}"\n`;
        });
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="district-completions.csv"'
      });
      return res.end(csv);
    }

    if (pathname === '/api/admin/export-pft' && req.method === 'GET') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const db = read();
      const teachers = Object.fromEntries(
        db.users.filter((u) => u.districtId === user.districtId).map((u) => [u.id, u])
      );
      let csv =
        'teacherName,school,grade,year,student,date,aerobicType,aerobic,curl,trunk,upperType,upper,flexType,flex\n';
      db.pftOfficial
        .filter((p) => teachers[p.teacherId])
        .forEach((p) => {
          const t = teachers[p.teacherId];
          csv += `"${t.name}","${t.school || ''}",${p.grade},"${p.year}","${(p.student || '').replace(/"/g, '""')}",${p.date},"${p.aerobicType}","${p.aerobic}",${p.curl},${p.trunk},"${p.upperType}","${p.upper}","${p.flexType}","${p.flex}"\n`;
        });
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="district-pft.csv"'
      });
      return res.end(csv);
    }

    // Static
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Server error' });
  }
}

// Seed on first run if empty
try {
  require('./seed');
} catch (e) {
  console.warn('Seed:', e.message);
}

http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  console.log(`PE Test App listening on 0.0.0.0:${PORT}`);
  console.log('Login: admin@school.edu / admin123  OR  teacher@school.edu / teacher123');
});
