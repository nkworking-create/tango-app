const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = process.cwd();
const PORT = process.env.PORT || 3333;
const COMMUNITY_FILE = path.join(BASE, 'community.json');
const LISTS_FILE = path.join(BASE, 'community-lists.json');
const CACHE_FILE = path.join(BASE, 'word-cache.json');
const CONFIG_FILE = path.join(BASE, 'config.json');
const USERS_FILE = path.join(BASE, 'users.json');
const USER_DATA_DIR = path.join(BASE, 'user-data');

if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR);

function readConfig() {
  try {
    const file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      geminiApiKey: process.env.GEMINI_API_KEY || file.geminiApiKey || '',
      adminPassword: process.env.ADMIN_PASSWORD || file.adminPassword || 'admin1234',
      communityEnabled: file.communityEnabled !== false,
    };
  } catch {
    return {
      geminiApiKey: process.env.GEMINI_API_KEY || '',
      adminPassword: process.env.ADMIN_PASSWORD || 'admin1234',
      communityEnabled: true,
    };
  }
}
function writeConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function readCommunity() {
  try { return JSON.parse(fs.readFileSync(COMMUNITY_FILE, 'utf8')); }
  catch { return []; }
}

function writeCommunity(data) {
  fs.writeFileSync(COMMUNITY_FILE, JSON.stringify(data, null, 2));
}

function readLists() {
  try { return JSON.parse(fs.readFileSync(LISTS_FILE, 'utf8')); }
  catch { return []; }
}

function writeLists(data) {
  fs.writeFileSync(LISTS_FILE, JSON.stringify(data, null, 2));
}

function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); }
  catch { return {}; }
}
function writeCache(data) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
}

function parseBody(req, cb) {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => { try { cb(null, JSON.parse(body)); } catch(e) { cb(e); } });
}

// ── ユーザー認証 ──
function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}
function writeUsers(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2)); }

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + 'tango-salt-2024').digest('hex');
}

const sessions = {}; // token -> {userId, expiresAt}
function createToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions[token] = { userId, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 };
  return token;
}
function verifyToken(token) {
  const s = sessions[token];
  if (!s) return null;
  if (s.expiresAt < Date.now()) { delete sessions[token]; return null; }
  return s.userId;
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── 管理者ログイン ──
  if (req.url === '/api/admin/login' && req.method === 'POST') {
    parseBody(req, (err, body) => {
      if (err) { res.writeHead(400); res.end(); return; }
      const config = readConfig();
      if (body.password !== config.adminPassword) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'パスワードが違います' }));
        return;
      }
      const token = crypto.randomBytes(24).toString('hex');
      sessions[token] = { userId: '__admin__', expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, token }));
    });
    return;
  }

  // 管理者認証ミドルウェア
  function requireAdmin(fn) {
    const token = (req.headers['x-admin-token'] || '');
    const s = sessions[token];
    if (!s || s.userId !== '__admin__' || s.expiresAt < Date.now()) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '認証が必要です' }));
      return;
    }
    fn();
  }

  // ── 管理者: 統計 ──
  if (req.url === '/api/admin/stats' && req.method === 'GET') {
    requireAdmin(() => {
      const users = readUsers();
      const community = readCommunity();
      const lists = readLists();
      const config = readConfig();
      const userDataFiles = fs.readdirSync(USER_DATA_DIR).filter(f => f.endsWith('.json'));
      let totalWords = 0;
      userDataFiles.forEach(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(USER_DATA_DIR, f), 'utf8'));
          totalWords += (d.words || []).length;
        } catch {}
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        userCount: users.length,
        communityWordCount: community.length,
        communityListCount: lists.length,
        totalWords,
        communityEnabled: config.communityEnabled !== false,
        apiConfigured: !!config.geminiApiKey,
      }));
    });
    return;
  }

  // ── 管理者: ユーザー一覧 ──
  if (req.url === '/api/admin/users' && req.method === 'GET') {
    requireAdmin(() => {
      const users = readUsers().map(u => ({
        id: u.id, name: u.name, email: u.email, createdAt: u.createdAt,
        hasData: fs.existsSync(path.join(USER_DATA_DIR, u.id + '.json'))
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(users));
    });
    return;
  }

  // ── 管理者: ユーザー削除 ──
  if (req.url.startsWith('/api/admin/users/') && req.method === 'DELETE') {
    requireAdmin(() => {
      const userId = req.url.slice('/api/admin/users/'.length);
      let users = readUsers();
      users = users.filter(u => u.id !== userId);
      writeUsers(users);
      const dataFile = path.join(USER_DATA_DIR, userId + '.json');
      if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── 管理者: コミュニティ機能 ON/OFF ──
  if (req.url === '/api/admin/community/toggle' && req.method === 'POST') {
    requireAdmin(() => {
      parseBody(req, (err, body) => {
        if (err) { res.writeHead(400); res.end(); return; }
        const config = readConfig();
        config.communityEnabled = !!body.enabled;
        writeConfig(config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, communityEnabled: config.communityEnabled }));
      });
    });
    return;
  }

  // ── 管理者: コミュニティ単語削除 ──
  if (req.url.startsWith('/api/admin/community/word/') && req.method === 'DELETE') {
    requireAdmin(() => {
      const en = decodeURIComponent(req.url.slice('/api/admin/community/word/'.length));
      let data = readCommunity();
      data = data.filter(w => w.en.toLowerCase() !== en.toLowerCase());
      writeCommunity(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── 管理者: コミュニティリスト削除 ──
  if (req.url.startsWith('/api/admin/community/list/') && req.method === 'DELETE') {
    requireAdmin(() => {
      const id = req.url.slice('/api/admin/community/list/'.length);
      let data = readLists();
      data = data.filter(l => l.id !== id);
      writeLists(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── 管理者: コミュニティ単語一覧 ──
  if (req.url === '/api/admin/community-words' && req.method === 'GET') {
    requireAdmin(() => {
      const data = readCommunity().sort((a, b) => b.count - a.count);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    });
    return;
  }

  // ── 管理者: パスワード変更 ──
  if (req.url === '/api/admin/password' && req.method === 'POST') {
    requireAdmin(() => {
      parseBody(req, (err, body) => {
        if (err || !body.password || body.password.length < 6) { res.writeHead(400); res.end(); return; }
        const config = readConfig();
        config.adminPassword = body.password;
        writeConfig(config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    return;
  }

  // ── 管理者: APIキー設定（管理者トークン版）──
  if (req.url === '/api/admin/key-auth' && req.method === 'POST') {
    requireAdmin(() => {
      parseBody(req, (err, body) => {
        if (err) { res.writeHead(400); res.end(); return; }
        const config = readConfig();
        config.geminiApiKey = body.key || '';
        writeConfig(config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    return;
  }

  // ── 管理者: APIキー設定 ──
  if (req.url === '/api/admin/key' && req.method === 'POST') {
    parseBody(req, (err, body) => {
      if (err) { res.writeHead(400); res.end(); return; }
      const config = readConfig();
      if (body.password !== config.adminPassword) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'パスワードが違います' }));
        return;
      }
      config.geminiApiKey = body.key || '';
      writeConfig(config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── API設定状態確認 (キーは返さない) ──
  if (req.url === '/api/admin/status' && req.method === 'GET') {
    const config = readConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ configured: !!config.geminiApiKey }));
    return;
  }

  // ── Geminiプロキシ ──
  if (req.url === '/api/search' && req.method === 'POST') {
    parseBody(req, async (err, body) => {
      if (err || !body.prompt) { res.writeHead(400); res.end(); return; }
      const config = readConfig();
      if (!config.geminiApiKey) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'APIキーが設定されていません' }));
        return;
      }
      try {
        const result = await httpsPost(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${config.geminiApiKey}`,
          { contents: [{ parts: [{ text: body.prompt }] }], generationConfig: { temperature: 0.3 } }
        );
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(result.body);
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── 単語キャッシュAPI ──
  if (req.url.startsWith('/api/word-cache') && req.method === 'GET') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const q = params.get('q');
    const ja2en = params.get('ja2en') === 'true';
    if (!q) { res.writeHead(400); res.end(); return; }
    const key = (ja2en ? 'ja:' : 'en:') + q.toLowerCase().trim();
    const cache = readCache();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cache[key] ? { hit: true, data: cache[key] } : { hit: false }));
    return;
  }

  if (req.url === '/api/word-cache' && req.method === 'POST') {
    parseBody(req, (err, body) => {
      if (err || !body.q || !body.data) { res.writeHead(400); res.end(); return; }
      const key = (body.ja2en ? 'ja:' : 'en:') + body.q.toLowerCase().trim();
      const cache = readCache();
      cache[key] = { ...body.data, cachedAt: Date.now() };
      writeCache(cache);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── 単語ランキングAPI ──
  if (req.url === '/api/community' && req.method === 'GET') {
    const data = readCommunity().sort((a, b) => b.count - a.count).slice(0, 50);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  if (req.url === '/api/community' && req.method === 'POST') {
    parseBody(req, (err, body) => {
      if (err) { res.writeHead(400); res.end('Bad request'); return; }
      const { en, ja } = body;
      if (!en || !ja) { res.writeHead(400); res.end('Bad request'); return; }
      const data = readCommunity();
      const key = en.toLowerCase().trim();
      const idx = data.findIndex(w => w.en.toLowerCase() === key);
      if (idx >= 0) {
        data[idx].count++;
        if (!data[idx].translations) data[idx].translations = {};
        data[idx].translations[ja] = (data[idx].translations[ja] || 0) + 1;
        const top = Object.entries(data[idx].translations).sort((a,b)=>b[1]-a[1])[0];
        data[idx].ja = top[0];
      } else {
        data.push({ en: en.trim(), ja: ja.trim(), count: 1, translations: { [ja]: 1 } });
      }
      writeCommunity(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── みんなのリストAPI ──
  if (req.url === '/api/lists' && req.method === 'GET') {
    const data = readLists().sort((a, b) => b.count - a.count).slice(0, 30);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  if (req.url === '/api/lists' && req.method === 'POST') {
    parseBody(req, (err, body) => {
      if (err) { res.writeHead(400); res.end('Bad request'); return; }
      const { userId, name, words, icon, color } = body;
      if (!userId || !name || !Array.isArray(words) || words.length === 0) {
        res.writeHead(400); res.end('Bad request'); return;
      }
      const data = readLists();
      const idx = data.findIndex(l => l.userId === userId && l.name === name.trim());
      if (idx >= 0) {
        data[idx].words = words;
        if (icon) data[idx].icon = icon;
        if (color) data[idx].color = color;
        data[idx].updatedAt = Date.now();
      } else {
        data.push({
          id: 'cl-' + Date.now(),
          userId,
          name: name.trim(),
          words,
          icon: icon || 'book-open',
          color: color || '#7c3aed',
          count: 0,
          updatedAt: Date.now()
        });
      }
      writeLists(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // リスト利用カウント
  if (req.url === '/api/lists/use' && req.method === 'POST') {
    parseBody(req, (err, body) => {
      if (err) { res.writeHead(400); res.end('Bad request'); return; }
      const { id } = body;
      if (!id) { res.writeHead(400); res.end('Bad request'); return; }
      const data = readLists();
      const idx = data.findIndex(l => l.id === id);
      if (idx >= 0) { data[idx].count++; writeLists(data); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── アカウント登録 ──
  if (req.url === '/api/register' && req.method === 'POST') {
    parseBody(req, (err, body) => {
      if (err) { res.writeHead(400); res.end(); return; }
      const { name, email, password } = body;
      if (!name || !email || !password || password.length < 6) {
        res.writeHead(400, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: '名前・メールアドレス・パスワード（6文字以上）が必要です' }));
        return;
      }
      const users = readUsers();
      if (users.find(u => u.email === email.toLowerCase())) {
        res.writeHead(409, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: 'このメールアドレスはすでに登録されています' }));
        return;
      }
      const userId = 'u-' + crypto.randomBytes(8).toString('hex');
      users.push({ id: userId, name: name.trim(), email: email.toLowerCase(), passwordHash: hashPassword(password), createdAt: Date.now() });
      writeUsers(users);
      const token = createToken(userId);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ ok: true, userId, name: name.trim(), email: email.toLowerCase(), token }));
    });
    return;
  }

  // ── ログイン ──
  if (req.url === '/api/login' && req.method === 'POST') {
    parseBody(req, (err, body) => {
      if (err) { res.writeHead(400); res.end(); return; }
      const { email, password } = body;
      const users = readUsers();
      const user = users.find(u => u.email === (email || '').toLowerCase());
      if (!user || user.passwordHash !== hashPassword(password)) {
        res.writeHead(401, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: 'メールアドレスまたはパスワードが正しくありません' }));
        return;
      }
      const token = createToken(user.id);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ ok: true, userId: user.id, name: user.name, email: user.email, token }));
    });
    return;
  }

  // ── アカウント削除 ──
  if (req.url === '/api/delete-account' && req.method === 'POST') {
    parseBody(req, (err, body) => {
      if (err) { res.writeHead(400); res.end(); return; }
      const userId = verifyToken(body.token);
      if (!userId) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'認証が必要です'})); return; }
      const users = readUsers();
      const filtered = users.filter(u => u.id !== userId);
      writeUsers(filtered);
      const dataFile = path.join(USER_DATA_DIR, userId + '.json');
      if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── データ保存（クラウド同期）──
  if (req.url === '/api/sync/save' && req.method === 'POST') {
    parseBody(req, (err, body) => {
      if (err) { res.writeHead(400); res.end(); return; }
      const { token, words, lists } = body;
      const userId = verifyToken(token);
      if (!userId) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'認証が必要です'})); return; }
      fs.writeFileSync(path.join(USER_DATA_DIR, userId + '.json'), JSON.stringify({ words: words||[], lists: lists||[], savedAt: Date.now() }));
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── データ読み込み（クラウド同期）──
  if (req.url.startsWith('/api/sync/load') && req.method === 'GET') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const userId = verifyToken(params.get('token'));
    if (!userId) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'認証が必要です'})); return; }
    try {
      const data = JSON.parse(fs.readFileSync(path.join(USER_DATA_DIR, userId + '.json'), 'utf8'));
      res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ words:[], lists:[] }));
    }
    return;
  }

  // ── 静的ファイル ──
  const pathname = req.url.split('?')[0];
  const url = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(BASE, url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(file).slice(1);
    const mime = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', webmanifest: 'application/manifest+json', png: 'image/png', svg: 'image/svg+xml' };
    // sw.js と index.html は常に最新を返す（ブラウザキャッシュ禁止）
    const noCache = url.endsWith('sw.js') || url.endsWith('index.html');
    const headers = {
      'Content-Type': mime[ext] || 'text/plain',
      'Cache-Control': noCache ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600',
    };
    res.writeHead(200, headers);
    res.end(data);
  });
}).listen(PORT);
