const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'construction.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Sxema birinchi ishga tushishda yaratiladi.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','prorab','viewer')),
  block_code TEXT CHECK(block_code IN ('A','B','C','D','E') OR block_code IS NULL),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS blocks (
  code TEXT PRIMARY KEY CHECK(code IN ('A','B','C','D','E')),
  name TEXT NOT NULL,
  floors INTEGER NOT NULL DEFAULT 16,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_code TEXT NOT NULL REFERENCES blocks(code) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Umumiy',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'jarayonda' CHECK(status IN ('rejalashtirilgan','jarayonda','bajarildi','muammo')),
  floor_no INTEGER,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS legacy_archives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'json',
  raw_text TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  imported_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sections_block ON sections(block_code);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`);

const blockNames = { A: 'A blok', B: 'B blok', C: 'C blok', D: 'D blok', E: 'E blok' };
const insertBlock = db.prepare('INSERT OR IGNORE INTO blocks(code,name,floors,description) VALUES(?,?,16,?)');
for (const code of Object.keys(blockNames)) insertBlock.run(code, blockNames[code], 'Qavatlar, xonalar, materiallar va qurilish holati');

function randomPassword() { return crypto.randomBytes(9).toString('base64url'); }
function seedUser(username, displayName, role, blockCode, envKey) {
  const existing = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (existing) return;
  const password = process.env[envKey] || randomPassword();
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users(username,display_name,role,block_code,password_hash) VALUES(?,?,?,?,?)')
    .run(username, displayName, role, blockCode, hash);
  if (!process.env[envKey]) console.log(`BIR MARTALIK LOGIN: ${username} | PAROL: ${password}`);
}
seedUser('admin', 'Bosh direktor', 'admin', null, 'ADMIN_PASSWORD');
for (const code of Object.keys(blockNames)) seedUser(`${code.toLowerCase()}_prorab`, `${code} blok prarabi`, 'prorab', code, `${code}_PRORAB_PASSWORD`);
const countSections = db.prepare('SELECT COUNT(*) AS n FROM sections').get().n;
if (!countSections) {
  const add = db.prepare('INSERT INTO sections(block_code,title,category,description,status) VALUES(?,?,?,?,?)');
  for (const code of Object.keys(blockNames)) {
    add.run(code, 'Umumiy qurilish ishlari', 'Qurilish', 'Blok bo‘yicha umumiy ishlar holati', 'jarayonda');
    add.run(code, 'Materiallar nazorati', 'Material', 'Materiallar va yetkazib berish holati', 'rejalashtirilgan');
    add.run(code, 'Xonalar va qaydlar', 'Xonalar', 'Xonalar bo‘yicha qaydlar', 'rejalashtirilgan');
  }
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret-before-deploy',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring.' } });
const getUser = req => req.session.user || null;
function auth(req, res, next) { if (!getUser(req)) return res.status(401).json({ error: 'Tizimga kiring.' }); next(); }
function adminOnly(req, res, next) { if (!getUser(req) || getUser(req).role !== 'admin') return res.status(403).json({ error: 'Bu amal uchun administrator huquqi kerak.' }); next(); }
function canAccessBlock(user, code) { return user.role === 'admin' || (user.role === 'prorab' && user.block_code === code) || user.role === 'viewer'; }
function audit(userId, action, entityType, entityId, details = {}) {
  db.prepare('INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)')
    .run(userId || null, action, entityType, String(entityId ?? ''), JSON.stringify(details));
}

app.post('/api/login', loginLimiter, (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Login yoki parol noto‘g‘ri.' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Sessiyani yaratib bo‘lmadi.' });
    req.session.user = { id: user.id, username: user.username, display_name: user.display_name, role: user.role, block_code: user.block_code };
    audit(user.id, 'login', 'user', user.id);
    res.json({ user: req.session.user });
  });
});
app.post('/api/logout', auth, (req, res) => { const id = req.session.user.id; audit(id, 'logout', 'user', id); req.session.destroy(() => res.json({ ok: true })); });
app.get('/api/me', (req, res) => res.json({ user: getUser(req) }));

app.get('/api/dashboard', auth, (req, res) => {
  const user = getUser(req);
  const codes = user.role === 'admin' || user.role === 'viewer' ? ['A','B','C','D','E'] : [user.block_code];
  const blocks = codes.map(code => {
    const block = db.prepare('SELECT * FROM blocks WHERE code=?').get(code);
    const total = db.prepare('SELECT COUNT(*) n FROM sections WHERE block_code=?').get(code).n;
    const done = db.prepare("SELECT COUNT(*) n FROM sections WHERE block_code=? AND status='bajarildi'").get(code).n;
    const issue = db.prepare("SELECT COUNT(*) n FROM sections WHERE block_code=? AND status='muammo'").get(code).n;
    const recent = db.prepare('SELECT id,title,category,status,updated_at FROM sections WHERE block_code=? ORDER BY updated_at DESC,id DESC LIMIT 4').all(code);
    return { ...block, total, done, issue, progress: total ? Math.round(done * 100 / total) : 0, recent };
  });
  res.json({ blocks, summary: { blocks: blocks.length, sections: blocks.reduce((n,b)=>n+b.total,0), done: blocks.reduce((n,b)=>n+b.done,0), issues: blocks.reduce((n,b)=>n+b.issue,0) } });
});
app.get('/api/blocks/:code', auth, (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!/^[ABCDE]$/.test(code)) return res.status(400).json({ error: 'Blok kodi noto‘g‘ri.' });
  if (!canAccessBlock(getUser(req), code)) return res.status(403).json({ error: 'Bu blokni ko‘rish huquqi yo‘q.' });
  const block = db.prepare('SELECT * FROM blocks WHERE code=?').get(code);
  const sections = db.prepare('SELECT s.*,u.display_name AS updated_by_name FROM sections s LEFT JOIN users u ON u.id=s.updated_by WHERE s.block_code=? ORDER BY s.updated_at DESC,s.id DESC').all(code);
  res.json({ block, sections });
});
app.post('/api/blocks/:code/sections', auth, (req, res) => {
  const user = getUser(req), code = String(req.params.code).toUpperCase();
  if (!/^[ABCDE]$/.test(code)) return res.status(400).json({ error: 'Blok kodi noto‘g‘ri.' });
  if (!canAccessBlock(user, code) || user.role === 'viewer') return res.status(403).json({ error: 'Bu blokka bo‘lim qo‘shish huquqi yo‘q.' });
  const title = String(req.body.title || '').trim();
  const category = String(req.body.category || 'Umumiy').trim();
  const description = String(req.body.description || '').trim();
  const floorNo = req.body.floor_no === '' || req.body.floor_no == null ? null : Number(req.body.floor_no);
  if (title.length < 2 || title.length > 120) return res.status(400).json({ error: 'Bo‘lim nomi 2–120 belgi bo‘lishi kerak.' });
  if (category.length > 60 || description.length > 2000) return res.status(400).json({ error: 'Maydon uzunligi me’yordan oshdi.' });
  if (floorNo !== null && (!Number.isInteger(floorNo) || floorNo < 1 || floorNo > 100)) return res.status(400).json({ error: 'Qavat raqami noto‘g‘ri.' });
  const result = db.prepare('INSERT INTO sections(block_code,title,category,description,floor_no,created_by,updated_by) VALUES(?,?,?,?,?,?,?)').run(code,title,category,description,floorNo,user.id,user.id);
  audit(user.id, 'create', 'section', result.lastInsertRowid, { block_code: code, title });
  res.status(201).json(db.prepare('SELECT * FROM sections WHERE id=?').get(result.lastInsertRowid));
});
app.patch('/api/sections/:id', auth, (req, res) => {
  const user = getUser(req), id = Number(req.params.id);
  const item = db.prepare('SELECT * FROM sections WHERE id=?').get(id);
  if (!item) return res.status(404).json({ error: 'Bo‘lim topilmadi.' });
  if (!canAccessBlock(user, item.block_code) || user.role === 'viewer') return res.status(403).json({ error: 'Tahrirlash huquqi yo‘q.' });
  const allowed = ['rejalashtirilgan','jarayonda','bajarildi','muammo'];
  const status = req.body.status === undefined ? item.status : String(req.body.status);
  const description = req.body.description === undefined ? item.description : String(req.body.description).trim();
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Holat qiymati noto‘g‘ri.' });
  if (description.length > 2000) return res.status(400).json({ error: 'Izoh juda uzun.' });
  db.prepare("UPDATE sections SET status=?,description=?,updated_by=?,updated_at=datetime('now') WHERE id=?").run(status,description,user.id,id);
  audit(user.id, 'update', 'section', id, { status, block_code: item.block_code });
  res.json(db.prepare('SELECT * FROM sections WHERE id=?').get(id));
});
app.get('/api/users', auth, adminOnly, (req,res) => {
  res.json(db.prepare('SELECT id,username,display_name,role,block_code,active,created_at FROM users ORDER BY role,username').all());
});
app.post('/api/users', auth, adminOnly, (req,res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const displayName = String(req.body.display_name || '').trim();
  const role = String(req.body.role || 'prorab');
  const blockCode = req.body.block_code ? String(req.body.block_code).toUpperCase() : null;
  const password = String(req.body.password || '');
  if (!/^[a-z0-9_]{3,30}$/.test(username)) return res.status(400).json({ error: 'Login 3–30 belgidan iborat bo‘lsin (a-z, 0-9, _).' });
  if (displayName.length < 2 || displayName.length > 100) return res.status(400).json({ error: 'Ism 2–100 belgi bo‘lishi kerak.' });
  if (!['admin','prorab','viewer'].includes(role)) return res.status(400).json({ error: 'Rol noto‘g‘ri.' });
  if (role === 'prorab' && !['A','B','C','D','E'].includes(blockCode)) return res.status(400).json({ error: 'Prorab uchun A–E blokni tanlang.' });
  if (role === 'admin' && blockCode !== null) return res.status(400).json({ error: 'Admin blokka biriktirilmaydi.' });
  if (password.length < 12) return res.status(400).json({ error: 'Parol kamida 12 belgidan iborat bo‘lishi kerak.' });
  try {
    const result = db.prepare('INSERT INTO users(username,display_name,role,block_code,password_hash) VALUES(?,?,?,?,?)').run(username,displayName,role,blockCode,bcrypt.hashSync(password,12));
    audit(getUser(req).id,'create','user',result.lastInsertRowid,{username,role,block_code:blockCode});
    res.status(201).json({ id: result.lastInsertRowid, username, display_name: displayName, role, block_code: blockCode });
  } catch (e) {
    if (String(e.code).includes('CONSTRAINT')) return res.status(409).json({ error: 'Bu login band.' });
    throw e;
  }
});
app.get('/api/audit', auth, adminOnly, (req,res) => {
  res.json(db.prepare('SELECT a.*,u.username,u.display_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200').all());
});

// Legacy import is an immutable archive step; it deliberately does not map data into live tables.
app.get('/api/legacy-archives', auth, adminOnly, (req,res) => {
  res.json(db.prepare('SELECT id,name,source_type,sha256,byte_length,created_at FROM legacy_archives ORDER BY id DESC').all());
});
app.post('/api/legacy-archives', auth, adminOnly, (req,res) => {
  const name = String(req.body.name || '').trim().slice(0,160);
  const sourceType = String(req.body.source_type || 'json').trim().slice(0,40);
  const rawText = req.body.raw_text;
  if (!name) return res.status(400).json({ error: 'Arxiv nomini kiriting.' });
  if (typeof rawText !== 'string' || !rawText.length) return res.status(400).json({ error: 'JSON fayl mazmuni topilmadi.' });
  if (Buffer.byteLength(rawText, 'utf8') > 10 * 1024 * 1024) return res.status(413).json({ error: 'Fayl 10 MB dan kichik bo‘lishi kerak.' });
  try { JSON.parse(rawText); } catch { return res.status(400).json({ error: 'Fayl to‘g‘ri JSON emas. Asl fayl o‘zgartirilmagan holda saqlanadi; import uchun JSON kerak.' }); }
  const sha256 = crypto.createHash('sha256').update(rawText, 'utf8').digest('hex');
  const bytes = Buffer.byteLength(rawText, 'utf8');
  const result = db.prepare('INSERT INTO legacy_archives(name,source_type,raw_text,sha256,byte_length,imported_by) VALUES(?,?,?,?,?,?)').run(name,sourceType,rawText,sha256,bytes,getUser(req).id);
  audit(getUser(req).id, 'archive', 'legacy_archive', result.lastInsertRowid, { name, sha256, bytes });
  res.status(201).json({ id: result.lastInsertRowid, name, sha256, byte_length: bytes, message: 'Arxiv saqlandi; jonli ma’lumotlar bazasiga hali ko‘chirilmagan.' });
});
app.get('/api/legacy-archives/:id/download', auth, adminOnly, (req,res) => {
  const item = db.prepare('SELECT name,raw_text,sha256 FROM legacy_archives WHERE id=?').get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Arxiv topilmadi.' });
  const safeName = item.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0,80) || 'legacy-export';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=\"${safeName}.json\"`);
  res.setHeader('X-Content-SHA256', item.sha256);
  res.send(item.raw_text);
});
app.use('/api', (req,res) => res.status(404).json({ error: 'API manzili topilmadi.' }));
app.use(express.static(path.join(ROOT, 'public')));
app.get('*', (req,res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.use((err, req, res, next) => { console.error(err); if (res.headersSent) return next(err); res.status(500).json({ error: 'Serverda kutilmagan xatolik yuz berdi.' }); });

app.listen(PORT, () => {
  console.log(`A–E blok boshqaruv ilovasi: http://localhost:${PORT}`);
  if (process.env.NODE_ENV !== 'production' && !process.env.SESSION_SECRET) console.warn('OGOHLANTIRISH: SESSION_SECRET ni production uchun albatta almashtiring.');
});
