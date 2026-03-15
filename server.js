const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// â”€â”€â”€ Database Initialization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'gameznet.db'));
db.pragma('journal_mode = WAL');

// Schema migrations for columns added after initial deploy
try { db.exec("ALTER TABLE tokens ADD COLUMN active INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE token_requests ADD COLUMN status TEXT DEFAULT 'pending'"); } catch {}
try { db.exec("ALTER TABLE players ADD COLUMN ping TEXT"); } catch {}
try { db.exec("ALTER TABLE players ADD COLUMN connected_at TEXT"); } catch {}
try { db.exec(`CREATE TABLE IF NOT EXISTS peer_stats (
  vpn_ip TEXT PRIMARY KEY,
  pubkey TEXT,
  rx_bytes INTEGER DEFAULT 0,
  tx_bytes INTEGER DEFAULT 0,
  rx_total INTEGER DEFAULT 0,
  tx_total INTEGER DEFAULT 0,
  last_handshake_ts INTEGER DEFAULT 0,
  last_seen TEXT
)`); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY, 
    name TEXT, 
    client_ip TEXT, 
    private_key TEXT,
    redeemed INTEGER DEFAULT 0,
    created_at TEXT,
    redeemed_at TEXT,
    hidden INTEGER DEFAULT 0,
    active INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS players (
    name TEXT PRIMARY KEY, 
    vpn_ip TEXT, 
    last_seen TEXT, 
    game TEXT, 
    hidden INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY, 
    message TEXT, 
    type TEXT, 
    expires_at TEXT
  );
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY, 
    player TEXT, 
    vpn_ip TEXT, 
    error_message TEXT, 
    log_tail TEXT, 
    timestamp TEXT, 
    read INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_name TEXT,
    body TEXT,
    sent_at TEXT
  );
  CREATE TABLE IF NOT EXISTS token_requests (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    requested_at TEXT,
    status TEXT DEFAULT 'pending'
  );
`);

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const getS = (k, d) => db.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value || d;
const setS = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

// ─── WireGuard keypair generation ────────────────────────────────────────────
function generateWGKeypair() {
  const nacl = require('tweetnacl');
  const keys = nacl.box.keyPair();
  const toB64 = b => Buffer.from(b).toString('base64');
  return { privateKey: toB64(keys.secretKey), publicKey: toB64(keys.publicKey) };
}

// ─── SSH helper — run a command on UDM ───────────────────────────────────────
function sshExec(command) {
  return new Promise((resolve, reject) => {
    const { Client } = require('ssh2');
    const conn = new Client();
    const host = getS('UDM_SSH_HOST', '192.168.30.1');
    const user = getS('UDM_SSH_USER', 'root');
    const privateKey = getS('UDM_SSH_KEY', null);
    const password = getS('UDM_SSH_PASS', null);
    if (!privateKey && !password) return reject(new Error('No SSH credentials configured in settings'));
    const authOpts = privateKey ? { privateKey } : { password, tryKeyboard: true };
    conn.on('keyboard-interactive', (name, instr, lang, prompts, finish) => finish([password || '']))
      .on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) { conn.end(); return reject(err); }
          let out = '', errOut = '';
          stream.on('data', d => out += d);
          stream.stderr.on('data', d => errOut += d);
          stream.on('close', (code) => { conn.end(); code === 0 ? resolve(out.trim()) : reject(new Error(errOut.trim() || `Exit ${code}`)); });
        });
      }).on('error', reject).connect({ host, port: 22, username: user, ...authOpts });
  });
}

function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let token = '';
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) token += '-';
    token += chars[bytes[i] % chars.length];
  }
  return token;
}

const requireAdmin = (req, res, next) => {
  const pwd = req.body.password || req.headers['x-admin-password'] || req.query.password;
  if (pwd === process.env.ADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// ─── WireGuard peer stats polling ────────────────────────────────────────────
async function pollWgStats() {
  try {
    const iface = getS('UDM_WG_INTERFACE', 'wg0');
    const raw = await sshExec(`wg show ${iface} dump`);
    const lines = raw.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 8) continue; // interface line has 4 fields, peer lines have 8
      const [pubkey, , , allowed_ips, last_hs_ts, rx_str, tx_str] = parts;
      if (!pubkey || pubkey.length < 10) continue;
      const vpn_ip = (allowed_ips || '').split('/')[0] || '';
      if (!vpn_ip) continue;
      const rx = parseInt(rx_str) || 0;
      const tx = parseInt(tx_str) || 0;
      const hs = parseInt(last_hs_ts) || 0;
      const existing = db.prepare("SELECT rx_bytes, tx_bytes, rx_total, tx_total FROM peer_stats WHERE vpn_ip = ?").get(vpn_ip);
      let rx_total = rx, tx_total = tx;
      if (existing) {
        const rdelta = rx >= existing.rx_bytes ? rx - existing.rx_bytes : rx;
        const tdelta = tx >= existing.tx_bytes ? tx - existing.tx_bytes : tx;
        rx_total = existing.rx_total + rdelta;
        tx_total = existing.tx_total + tdelta;
      }
      db.prepare(`INSERT INTO peer_stats (vpn_ip, pubkey, rx_bytes, tx_bytes, rx_total, tx_total, last_handshake_ts, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(vpn_ip) DO UPDATE SET pubkey=excluded.pubkey, rx_bytes=excluded.rx_bytes, tx_bytes=excluded.tx_bytes,
          rx_total=excluded.rx_total, tx_total=excluded.tx_total, last_handshake_ts=excluded.last_handshake_ts, last_seen=excluded.last_seen`)
        .run(vpn_ip, pubkey, rx, tx, rx_total, tx_total, hs, new Date().toISOString());
    }
  } catch (e) { /* SSH unavailable — silent */ }
}
setInterval(pollWgStats, 60000);

// â”€â”€â”€ Client API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/server-config', (req, res) => {
  const wanIp = getS('SERVER_ENDPOINT_IP', "184.66.15.159");
  const localIp = getS('SERVER_LOCAL_IP', "");
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const endpointIp = (localIp && clientIp === wanIp) ? localIp : wanIp;
  res.json({
    endpoint: `${endpointIp}:51820`,
    publicKey: getS('SERVER_PUBLIC_KEY', "SLG8saonFoQ+B8x59SBeHCXouLTpVhyEYPqiUZoGqgI="),
    allowedIPs: getS('SERVER_ALLOWED_IPS', "192.168.8.0/24, 192.168.30.0/24"),
    publicIp: wanIp, localIp,
    udmHost: getS('UDM_SSH_HOST', '192.168.30.1'),
    udmUser: getS('UDM_SSH_USER', 'root'),
    udmInterface: getS('UDM_WG_INTERFACE', 'wg0')
  });
});

app.post('/api/heartbeat', (req, res) => {
  const { name, vpn_ip, disconnecting, game, hidden, ping } = req.body;
  if (!name) return res.status(400).end();
  if (disconnecting) {
    db.prepare("DELETE FROM players WHERE name = ?").run(name);
    db.prepare("UPDATE tokens SET active = 0 WHERE name = ?").run(name);
  } else {
    db.prepare("UPDATE tokens SET active = 1 WHERE name = ?").run(name);
    const hiddenVal = hidden !== undefined ? (hidden ? 1 : 0) : (db.prepare("SELECT hidden FROM tokens WHERE name = ?").get(name)?.hidden || 0);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO players (name, vpn_ip, last_seen, game, hidden, ping, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET vpn_ip=excluded.vpn_ip, last_seen=excluded.last_seen, game=excluded.game, hidden=excluded.hidden, ping=excluded.ping`)
      .run(name, vpn_ip || '', now, game || null, hiddenVal, ping || null, now);
  }
  res.json({ success: true });
});

app.get('/api/online', (req, res) => {
  const cutoff = new Date(Date.now() - 8000).toISOString();
  res.json(db.prepare("SELECT name, vpn_ip, last_seen, game FROM players WHERE last_seen > ? AND hidden = 0 ORDER BY name").all(cutoff));
});

app.post('/api/redeem', (req, res) => {
  const record = db.prepare("SELECT * FROM tokens WHERE token = ?").get(req.body.token);
  if (!record) return res.status(404).json({ error: 'Invalid token' });
  if (record.active) return res.status(409).json({ error: 'This token is already in use on another device' });
  if (!record.redeemed) {
    db.prepare("UPDATE tokens SET redeemed = 1, redeemed_at = ? WHERE token = ?").run(new Date().toISOString(), req.body.token);
  }
  res.json({ success: true, name: record.name, private_key: record.private_key, client_ip: record.client_ip });
});

app.get('/api/chat', (req, res) => {
  const since = req.query.since || new Date(0).toISOString();
  res.json(db.prepare("SELECT id, from_name, body, sent_at FROM messages WHERE sent_at > ? ORDER BY sent_at ASC LIMIT 100").all(since));
});

app.post('/api/chat/send', (req, res) => {
  const { name, body } = req.body;
  if (!name || !body || !body.trim()) return res.status(400).json({ error: 'Missing name or body' });
  if (body.trim().length > 500) return res.status(400).json({ error: 'Message too long' });
  const player = db.prepare("SELECT name FROM players WHERE name = ?").get(name);
  if (!player) return res.status(403).json({ error: 'Not a recognized player' });
  const sent_at = new Date().toISOString();
  db.prepare("INSERT INTO messages (from_name, body, sent_at) VALUES (?, ?, ?)").run(name, body.trim(), sent_at);
  // Keep last 500 messages
  db.prepare("DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT 500)").run();
  res.json({ success: true, sent_at });
});

app.get('/api/version', (req, res) => res.json({ min_version: getS('MIN_VERSION', "1.3.0") }));

app.post('/api/request-token', (req, res) => {
  const { name, email } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email is required' });
  const existing = db.prepare("SELECT id FROM token_requests WHERE email = ? AND status = 'pending'").get(email.trim().toLowerCase());
  if (existing) return res.status(409).json({ error: 'A request with this email is already pending' });
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  db.prepare("INSERT INTO token_requests (id, name, email, requested_at, status) VALUES (?, ?, ?, ?, 'pending')").run(id, name.trim(), email.trim().toLowerCase(), new Date().toISOString());
  res.json({ success: true });
});

app.post('/admin/requests', requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT * FROM token_requests ORDER BY requested_at DESC").all());
});

app.post('/admin/request/dismiss', requireAdmin, (req, res) => {
  const { id } = req.body;
  db.prepare("UPDATE token_requests SET status = 'dismissed' WHERE id = ?").run(id);
  res.json({ success: true });
});

app.post('/admin/request/approve', requireAdmin, async (req, res) => {
  const { id, vpn_ip } = req.body;
  if (!vpn_ip || !vpn_ip.trim()) return res.status(400).json({ error: 'VPN IP required' });
  const request = db.prepare("SELECT * FROM token_requests WHERE id = ?").get(id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  // Generate WireGuard keypair
  const { privateKey, publicKey } = generateWGKeypair();
  const ip = vpn_ip.trim();
  const wgInterface = getS('UDM_WG_INTERFACE', 'wg0');

  // Try to add peer to UDM via SSH — non-fatal if it fails
  let sshWarning = null;
  try {
    await sshExec(`wg set ${wgInterface} peer ${publicKey} allowed-ips ${ip}/32`);
  } catch (e) {
    sshWarning = `SSH unavailable — add peer manually in UniFi UI. Public key: ${publicKey}`;
  }

  // Create token regardless of SSH result
  const token = generateToken();
  const clientIp = ip.includes('/') ? ip.split('/')[0] : ip;
  db.prepare("INSERT INTO tokens (token, name, client_ip, private_key, redeemed, created_at, hidden) VALUES (?, ?, ?, ?, 0, ?, 0)")
    .run(token, request.name, `${clientIp}/32`, privateKey, new Date().toISOString());
  db.prepare("UPDATE token_requests SET status = 'approved' WHERE id = ?").run(id);

  res.json({ success: true, token, name: request.name, vpn_ip: `${clientIp}/32`, public_key: publicKey, warning: sshWarning });
});
app.get('/api/motd', (req, res) => res.json({ message: getS('MOTD_MESSAGE', '') }));
app.get('/api/alert', (req, res) => {
  const alert = db.prepare("SELECT * FROM alerts LIMIT 1").get();
  if (alert && new Date(alert.expires_at) < new Date()) { 
    db.prepare("DELETE FROM alerts").run(); 
    return res.json({ alert: null }); 
  }
  res.json({ alert: alert || null });
});

app.post('/api/report', (req, res) => {
  const { player, vpn_ip, error_message, log_tail } = req.body;
  if (!player || !error_message) return res.status(400).json({ error: 'Missing fields' });
  const id = `report_${Date.now()}`;
  db.prepare(`INSERT INTO reports (id, player, vpn_ip, error_message, log_tail, timestamp) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id, player, vpn_ip || '', error_message, (log_tail || '').slice(-8000), new Date().toISOString()
  );
  db.prepare("DELETE FROM reports WHERE id NOT IN (SELECT id FROM reports ORDER BY timestamp DESC LIMIT 100)").run();
  res.json({ success: true, id });
});

// â”€â”€â”€ Admin API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/admin', (req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.send(adminHTML()); });

app.post('/admin/tokens', requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT * FROM tokens ORDER BY created_at DESC").all().map(t => ({...t, redeemed: !!t.redeemed, hidden: !!t.hidden})));
});

app.post('/admin/token/create', requireAdmin, (req, res) => {
  const { name, client_ip, private_key } = req.body;
  const token = generateToken();
  db.prepare("INSERT INTO tokens (token, name, client_ip, private_key, created_at) VALUES (?, ?, ?, ?, ?)").run(token, name, client_ip, private_key, new Date().toISOString());
  res.json({ token, name, client_ip });
});

app.post('/admin/token/revoke', requireAdmin, (req, res) => {
  db.prepare("DELETE FROM tokens WHERE token = ?").run(req.body.token);
  res.json({ success: true });
});

app.post('/admin/player/toggle-hidden', requireAdmin, (req, res) => {
  const { name } = req.body;
  const player = db.prepare("SELECT hidden FROM players WHERE name = ?").get(name);
  if (!player) return res.status(404).end();
  const newVal = player.hidden ? 0 : 1;
  db.prepare("UPDATE players SET hidden = ? WHERE name = ?").run(newVal, name);
  db.prepare("UPDATE tokens SET hidden = ? WHERE name = ?").run(newVal, name);
  res.json({ success: true, hidden: !!newVal });
});

app.post('/admin/token/toggle-hidden', requireAdmin, (req, res) => {
  const token = db.prepare("SELECT * FROM tokens WHERE token = ?").get(req.body.token);
  if (!token) return res.status(404).end();
  const newVal = token.hidden ? 0 : 1;
  db.prepare("UPDATE tokens SET hidden = ? WHERE token = ?").run(newVal, req.body.token);
  db.prepare("UPDATE players SET hidden = ? WHERE name = ?").run(newVal, token.name);
  res.json({ success: true, hidden: !!newVal });
});

app.post('/admin/online', requireAdmin, (req, res) => {
  const cutoff = new Date(Date.now() - 7200000).toISOString();
  const activeCutoff = new Date(Date.now() - 8000).toISOString();
  res.json(db.prepare("SELECT name, vpn_ip, last_seen, game, hidden, ping, connected_at FROM players WHERE last_seen > ? ORDER BY name").all(cutoff).map(p => ({...p, hidden: !!p.hidden, active: p.last_seen > activeCutoff})));
});

app.post('/admin/settings/save', requireAdmin, (req, res) => {
  const { public_key, allowed_ips, local_ip, min_version } = req.body;
  if (public_key) setS('SERVER_PUBLIC_KEY', public_key.trim());
  if (allowed_ips) setS('SERVER_ALLOWED_IPS', allowed_ips.trim());
  if (local_ip !== undefined) setS('SERVER_LOCAL_IP', local_ip.trim());
  if (min_version) setS('MIN_VERSION', min_version.trim());
  res.json({ success: true });
});

app.post('/admin/ssh/save', requireAdmin, (req, res) => {
  const { host, user, key, password_ssh, wg_interface } = req.body;
  if (host) setS('UDM_SSH_HOST', host.trim());
  if (user) setS('UDM_SSH_USER', user.trim());
  if (key) setS('UDM_SSH_KEY', key.trim());
  if (password_ssh !== undefined) setS('UDM_SSH_PASS', password_ssh.trim());
  if (wg_interface) setS('UDM_WG_INTERFACE', wg_interface.trim());
  res.json({ success: true });
});

app.post('/admin/ssh/test', requireAdmin, async (req, res) => {
  try {
    const out = await sshExec('echo ok');
    res.json({ success: true, output: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/admin/wg/peers', requireAdmin, async (req, res) => {
  try {
    const iface = getS('UDM_WG_INTERFACE', 'wg0');
    const raw = await sshExec(`wg show ${iface} dump`);
    const now = Math.floor(Date.now() / 1000);
    const lines = raw.split('\n').filter(l => l.trim());
    const peers = [];
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 8) continue;
      const [pubkey, , endpoint, allowed_ips, last_hs_ts, rx_str, tx_str] = parts;
      if (!pubkey || pubkey.length < 10) continue;
      const vpn_ip = (allowed_ips || '').split('/')[0] || '';
      const rx_bytes = parseInt(rx_str) || 0;
      const tx_bytes = parseInt(tx_str) || 0;
      const last_hs = parseInt(last_hs_ts) || 0;
      const handshake_age = last_hs > 0 ? now - last_hs : null;
      const stats = db.prepare("SELECT rx_total, tx_total FROM peer_stats WHERE vpn_ip = ?").get(vpn_ip);
      const token = db.prepare("SELECT name FROM tokens WHERE client_ip = ? OR client_ip = ?").get(vpn_ip, vpn_ip + '/32');
      peers.push({ pubkey, endpoint, vpn_ip, handshake_age, rx_bytes, tx_bytes,
        rx_total: stats?.rx_total ?? rx_bytes, tx_total: stats?.tx_total ?? tx_bytes,
        name: token?.name || null });
    }
    res.json(peers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/admin/update-ip', requireAdmin, (req, res) => {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  setS('SERVER_ENDPOINT_IP', clientIp);
  res.json({ success: true, ip: clientIp });
});

app.post('/admin/reports', requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT * FROM reports ORDER BY timestamp DESC LIMIT 50").all().map(r => ({...r, read: !!r.read})));
});

app.post('/admin/report/read', requireAdmin, (req, res) => {
  db.prepare("UPDATE reports SET read = 1 WHERE id = ?").run(req.body.id);
  res.json({ success: true });
});

app.post('/admin/alert', requireAdmin, (req, res) => {
  db.prepare("DELETE FROM alerts").run();
  if (req.body.duration_minutes > 0) {
    const exp = new Date(Date.now() + req.body.duration_minutes * 60000).toISOString();
    db.prepare("INSERT INTO alerts (id, message, type, expires_at) VALUES (?, ?, ?, ?)").run('alt_'+Date.now(), req.body.message, req.body.type, exp);
  }
  res.json({ success: true });
});

app.post('/admin/motd', requireAdmin, (req, res) => {
  setS('MOTD_MESSAGE', (req.body.message || '').trim());
  res.json({ success: true });
});

// â”€â”€â”€ Pterodactyl Proxy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/servers', async (req, res) => {
  const PTERO_URL = 'https://gamez.looknet.ca';
  const PTERO_KEY = process.env.PTERODACTYL_API_KEY;
  const servers = [{ id: '548e8790', name: 'Satisfactory' }, { id: 'f8633b6b', name: 'SCUM' }, { id: '3919b863', name: 'Enshrouded' }, { id: '7540df7a', name: 'Conan Exiles' }, { id: '80c1c084', name: 'Project Zomboid' }];
  try {
    const results = await Promise.all(servers.map(async s => {
      try {
        const headers = { 'Authorization': `Bearer ${PTERO_KEY}`, 'Accept': 'application/json' };
        const [resResp, allocResp] = await Promise.all([
          fetch(`${PTERO_URL}/api/client/servers/${s.id}/resources`, { headers }),
          fetch(`${PTERO_URL}/api/client/servers/${s.id}?include=allocations`, { headers })
        ]);
        const [d, allocData] = await Promise.all([resResp.json(), allocResp.json()]);
        const attrs = d.attributes || {};
        const allocations = allocData.attributes?.relationships?.allocations?.data || [];
        const primary = allocations.find(a => a.attributes?.is_default) || allocations[0];
        const host = getS('SERVER_LOCAL_IP', null) || null;
        const port = primary?.attributes?.port || null;
        return { id: s.id, name: s.name, state: attrs.current_state || 'offline', cpu: Math.round(attrs.resources?.cpu_absolute || 0), memory_mb: Math.round((attrs.resources?.memory_bytes || 0) / 1048576), uptime: attrs.resources?.uptime || 0, host, port };
      } catch (e) { return { id: s.id, name: s.name, state: 'unknown' }; }
    }));
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/servers/power', requireAdmin, async (req, res) => {
  const { server_id, signal } = req.body;
  try {
    const response = await fetch(`https://gamez.looknet.ca/api/client/servers/${server_id}/power`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.PTERODACTYL_API_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ signal })
    });
    res.json({ success: response.ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ PowerShell Installer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/install', (req, res) => {
  const script = `
# GamezNET Installer - Swarm Edition
$ErrorActionPreference = 'Continue'
$repo = "https://raw.githubusercontent.com/natelook1/gameznet-public/main"
$installDir = "$env:LOCALAPPDATA\\GamezNET"

function Write-Step {
    param($num, $total, $text)
    Write-Host ""
    Write-Host "  " -NoNewline
    Write-Host " STEP $num/$total " -BackgroundColor DarkCyan -ForegroundColor Black -NoNewline
    Write-Host " $text" -ForegroundColor Cyan
}

function Write-OK   { param($t) Write-Host "          [" -NoNewline -ForegroundColor DarkGray; Write-Host " OK " -NoNewline -ForegroundColor Green;  Write-Host "] $t" -ForegroundColor Gray }
function Write-WARN { param($t) Write-Host "          [" -NoNewline -ForegroundColor DarkGray; Write-Host " !! " -NoNewline -ForegroundColor Yellow; Write-Host "] $t" -ForegroundColor Gray }

Clear-Host
Write-Host "  ==========================================================================================" -ForegroundColor Cyan
Write-Host " ░██████                             ░██████████ ░█████████                          ░██    " -ForegroundColor Cyan
Write-Host "  ░██   ░██                            ░██               ░██                           ░██    " -ForegroundColor Cyan
Write-Host " ░██         ░██████   ░█████████████  ░██              ░██   ░████████   ░███████  ░████████ " -ForegroundColor Cyan
Write-Host " ░██  █████       ░██  ░██   ░██   ░██ ░█████████     ░███    ░██    ░██ ░██    ░██    ░██    " -ForegroundColor Cyan
Write-Host " ░██     ██  ░███████  ░██   ░██   ░██ ░██           ░██      ░██    ░██ ░█████████    ░██    " -ForegroundColor Cyan
Write-Host "  ░██  ░███ ░██   ░██  ░██   ░██   ░██ ░██          ░██       ░██    ░██ ░██           ░██    " -ForegroundColor Cyan
Write-Host "   ░█████░█  ░█████░██ ░██   ░██   ░██ ░██████████ ░█████████ ░██    ░██  ░███████      ░████ " -ForegroundColor Cyan
Write-Host "  ==========================================================================================" -ForegroundColor Cyan

Write-Step 1 5 "Preparing install directory"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
New-Item -ItemType Directory -Force -Path "$installDir\\templates" | Out-Null
New-Item -ItemType Directory -Force -Path "$installDir\\static" | Out-Null
Write-OK "Install directory initialized"

Write-Step 2 5 "Downloading Components"
$files = @(
    @{ url = "$repo/app.py";               dest = "$installDir\\app.py" },
    @{ url = "$repo/GamezNET.bat";         dest = "$installDir\\GamezNET.bat" },
    @{ url = "$repo/templates/index.html"; dest = "$installDir\\templates\\index.html" },
    @{ url = "$repo/static/favicon.svg";   dest = "$installDir\\static\\favicon.svg" }
)
foreach ($file in $files) {
    $name = Split-Path $file.url -Leaf
    Invoke-WebRequest -Uri $file.url -OutFile $file.dest -UseBasicParsing
}
Write-OK "All components downloaded"
(Get-Content "$installDir\\app.py") -replace 'https://YOUR_BACKEND_URL', 'https://gameznet.looknet.ca' | Set-Content "$installDir\\app.py"

Write-Step 3 5 "Validating Python Environment"
& python -m pip install flask pystray pillow psutil --quiet
Write-OK "Python dependencies configured"

Write-Step 4 5 "Validating VPN Engine"
$wgExe = "C:\\Program Files\\WireGuard\\wireguard.exe"
if (Test-Path $wgExe) { Write-OK "Found WireGuard engine" }
else {
    Write-WARN "Installing WireGuard..."
    $wgInst = Join-Path $env:TEMP "wg-inst.exe"
    Invoke-WebRequest -Uri "https://download.wireguard.com/windows-client/wireguard-installer.exe" -OutFile $wgInst -UseBasicParsing
    Start-Process $wgInst -ArgumentList "/quiet" -Wait
    Write-OK "WireGuard deployed"
}

Write-Step 5 5 "Deploying Shortcuts"
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut((Join-Path ([System.Environment]::GetFolderPath("Desktop")) "GamezNET.lnk"))
$s.TargetPath = Join-Path $installDir "GamezNET.bat"
$s.WorkingDirectory = $installDir
$s.Save()
Write-OK "Installation Complete"

Start-Process -FilePath (Join-Path $installDir "GamezNET.bat")
`;
  res.setHeader('Content-Type', 'text/plain');
  res.send(script);
});
// â”€â”€â”€ Admin UI Rendering (Cyberpunk Master) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function adminHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GamezNET Admin</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='46' fill='%2300b4dc' stroke='%2300c8ff' stroke-width='4'/><text x='50' y='66' font-family='sans-serif' font-size='42' font-weight='bold' fill='white' text-anchor='middle'>GZ</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;600;700&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/tweetnacl/1.0.3/nacl-fast.min.js"></script>
  <style>
    :root {
      --bg: #080c10; --surface: #0d1420; --border: #1a2a3a; --accent: #00d4ff; --accent2: #ff6b35;
      --success: #00ff88; --danger: #ff3366; --warn: #ffaa00; --text: #c8d8e8; --muted: #4a6080;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: 'Rajdhani', sans-serif; min-height: 100vh; overflow-x: hidden; position: relative; }
    
    /* Scanline effect */
    body::before {
      content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 1000;
      background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 212, 255, 0.015) 2px, rgba(0, 212, 255, 0.015) 4px);
    }
    
    header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 16px 32px; display: flex; align-items: center; gap: 16px; position: sticky; top: 0; z-index: 100; }
    .logo { font-family: 'Share Tech Mono', monospace; font-size: 20px; color: var(--accent); letter-spacing: 2px; }
    .logo span { color: var(--accent2); }
    .header-badge { background: rgba(255, 107, 53, 0.15); border: 1px solid var(--accent2); color: var(--accent2); font-size: 11px; padding: 2px 8px; border-radius: 2px; font-family: 'Share Tech Mono', monospace; letter-spacing: 1px; }
    .header-right { margin-left: auto; display: flex; align-items: center; gap: 16px; }
    .server-ip-chip { font-family: 'Share Tech Mono', monospace; font-size: 11px; color: var(--accent); letter-spacing: 1px; background: rgba(0,212,255,0.06); border: 1px solid rgba(0,212,255,0.2); padding: 3px 10px; border-radius: 2px; }
    
    .live-indicator { font-family: 'Share Tech Mono', monospace; font-size: 11px; color: var(--success); letter-spacing: 1px; display: flex; align-items: center; gap: 5px; }
    .live-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--success); box-shadow: 0 0 6px var(--success); animation: blink-live 1.2s ease-in-out infinite; }
    @keyframes blink-live { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }

    .container { max-width: 1280px; margin: 0 auto; padding: 32px; }
    .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 16px 20px; box-shadow: inset 0 0 20px rgba(0,0,0,0.4); }
    .stat-label { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
    .stat-value { font-family: 'Share Tech Mono', monospace; font-size: 26px; font-weight: 700; letter-spacing: 2px; }
    .stat-value.cyan { color: var(--accent); }
    .stat-value.green { color: var(--success); font-size: 32px; text-shadow: 0 0 10px var(--success); }
    .stat-value.muted { color: var(--muted); }
    .stat-value.mono { color: var(--text); font-size: 14px; margin-top: 6px; word-break: break-all; }

    #auth-gate { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; gap: 16px; }
    #auth-gate h2 { font-size: 24px; font-weight: 700; color: var(--accent); letter-spacing: 2px; text-transform: uppercase; }
    #auth-gate p { color: var(--muted); font-size: 14px; }
    #main-panel { display: none; }

    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 24px; margin-bottom: 24px; }
    .card-title { font-size: 13px; font-family: 'Share Tech Mono', monospace; color: var(--accent); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; }
    .card-title::before { content: ''; width: 3px; height: 14px; background: var(--accent); display: inline-block; }

    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    input, select, textarea { background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 10px 14px; border-radius: 3px; font-family: 'Share Tech Mono', monospace; font-size: 13px; width: 100%; outline: none; transition: all 0.2s; }
    input:focus { border-color: var(--accent); box-shadow: 0 0 8px rgba(0,212,255,0.2); }
    label { display: block; font-size: 11px; letter-spacing: 1px; color: var(--muted); text-transform: uppercase; margin-bottom: 6px; }

    button { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 14px; letter-spacing: 1px; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; transition: all 0.2s; text-transform: uppercase; }
    .btn-primary { background: var(--accent); color: var(--bg); }
    .btn-primary:hover { background: #33ddff; transform: translateY(-1px); }
    .btn-secondary { background: transparent; border: 1px solid var(--accent); color: var(--accent); font-size: 11px; padding: 4px 10px; }
    .btn-danger { background: transparent; border: 1px solid var(--danger); color: var(--danger); font-size: 11px; padding: 4px 10px; }
    .btn-danger:hover { background: var(--danger); color: #fff; }

    .token-table { width: 100%; border-collapse: collapse; }
    .token-table th { text-align: left; font-family: 'Share Tech Mono', monospace; font-size: 11px; color: var(--muted); padding: 12px; border-bottom: 1px solid var(--border); }
    .token-table td { padding: 12px; border-bottom: 1px solid rgba(26,42,58,0.5); font-size: 14px; }
    
    .badge { display: inline-block; padding: 2px 8px; border-radius: 2px; font-size: 11px; font-family: 'Share Tech Mono', monospace; }
    .badge-pending { border: 1px solid rgba(0, 212, 255, 0.3); color: var(--accent); background: rgba(0,212,255,0.05); }
    .badge-redeemed { border: 1px solid rgba(0, 255, 136, 0.3); color: var(--success); background: rgba(0,255,136,0.05); }

    #toast { position: fixed; bottom: 32px; right: 32px; background: var(--surface); border: 1px solid var(--accent); color: var(--accent); padding: 12px 24px; border-radius: 3px; font-family: 'Share Tech Mono', monospace; opacity: 0; transition: all 0.4s; z-index: 9999; transform: translateY(20px); }
    #toast.show { opacity: 1; transform: translateY(0); }

    .online-tile { display: flex; align-items: center; gap: 12px; background: rgba(0,255,136,0.03); border: 1px solid rgba(0,255,136,0.1); border-radius: 3px; padding: 12px 16px; margin-bottom: 8px; transition: border-color 0.2s; }
    .online-tile:hover { border-color: rgba(0,255,136,0.3); }
    .online-tile-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); box-shadow: 0 0 8px var(--success); animation: blink-live 2s infinite; }
    .online-tile-name { font-family: 'Share Tech Mono', monospace; font-size: 13px; font-weight: 700; flex: 0 0 160px; color: var(--text); }
    .online-tile-game { font-family: 'Share Tech Mono', monospace; font-size: 11px; color: var(--accent); flex: 1; letter-spacing: 1px; }

    .server-card { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 16px; margin-bottom: 12px; transition: border-color 0.3s; }
    .server-card:hover { border-color: var(--accent); }

    .report-badge { background: rgba(255,51,85,0.15); border: 1px solid var(--danger); color: var(--danger); font-family: 'Share Tech Mono', monospace; font-size: 11px; padding: 3px 10px; border-radius: 2px; cursor: pointer; animation: pulse 2s infinite; }
    @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
    
    .report-item { background: rgba(255,51,85,0.04); border: 1px solid rgba(255,51,85,0.15); border-radius: 3px; padding: 14px 16px; margin-bottom: 10px; }
    .report-item.read { opacity: 0.5; border-color: var(--border); }
    .report-log { font-family: 'Share Tech Mono', monospace; font-size: 11px; color: var(--muted); background: #05080c; border: 1px solid var(--border); padding: 12px; max-height: 200px; overflow-y: auto; white-space: pre-wrap; display: none; margin-top: 10px; }

    .peer-table { width: 100%; border-collapse: collapse; }
    .peer-table th { text-align: left; font-family: 'Share Tech Mono', monospace; font-size: 10px; color: var(--muted); padding: 10px 12px; border-bottom: 1px solid var(--border); letter-spacing: 1px; text-transform: uppercase; }
    .peer-table td { padding: 10px 12px; border-bottom: 1px solid rgba(26,42,58,0.4); font-size: 13px; font-family: 'Share Tech Mono', monospace; }
    .peer-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; vertical-align: middle; }
    .peer-dot.active { background: var(--success); box-shadow: 0 0 6px var(--success); }
    .peer-dot.recent { background: var(--warn); box-shadow: 0 0 6px var(--warn); }
    .peer-dot.stale { background: var(--muted); }
    .peer-error { color: var(--danger); font-family: 'Share Tech Mono', monospace; font-size: 12px; padding: 12px 0; }
  </style>
</head>
<body>
<header>
  <div class="logo">GAMEZ<span>NET</span></div>
  <div class="header-badge">ADMIN CONSOLE</div>
  <div class="report-badge" id="report-badge" style="display:none;"><span id="report-count">0</span> REPORTS</div>
  <div class="header-right">
    <div class=”server-ip-chip” id=”header-server-ip”>SERVER IP: —</div>
    <div class="live-indicator"><span class="live-dot"></span> LIVE</div>
  </div>
</header>
<div class="container">
  <div id="auth-gate">
    <h2>Access Restricted</h2>
    <div style="width: 320px;">
      <input type="password" id="admin-password" placeholder="System Password..." />
      <button class="btn-primary" style="width:100%;margin-top:12px;" onclick="login()">Authenticate</button>
    </div>
  </div>
  <div id="main-panel">
    <div class="stats-row">
      <div class="stat-card"><div class="stat-label">Provisioned</div><div class="stat-value cyan" id="stat-redeemed">—</div></div>
      <div class="stat-card"><div class="stat-label">Active Nodes</div><div class="stat-value green" id="stat-online">—</div></div>
      <div class="stat-card"><div class="stat-label">Pending Intake</div><div class="stat-value muted" id="stat-pending">—</div></div>
      <div class="stat-card"><div class="stat-label">Core Protocol</div><div class="stat-value mono" id="stat-version">—</div></div>
    </div>
    <div class="card">
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;">
        Network Roster
        <button class="btn-secondary" style="font-size:10px;padding:2px 10px;" onclick="refreshPeers()">⟳ REFRESH</button>
      </div>
      <div id="network-roster"><p style="color:var(--muted);font-size:12px;font-family:monospace;">Loading...</p></div>
    </div>
    <div class="card"><div class="card-title">Generate Access Token</div>
      <div class="form-row"><input type="text" id="new-name" placeholder="Entity Name" /><input type="text" id="new-ip" placeholder="Internal IP (e.g. 192.168.8.x/32)" /></div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="text" id="new-privkey" placeholder="WireGuard Private Key String" style="flex:1;" />
        <button class="btn-secondary" onclick="generateWGKeys()" style="font-size:11px;white-space:nowrap;">âš¡ Gen Key</button>
      </div>
      <div id="pubkey-box" style="display:none;margin-top:10px;padding:10px;background:rgba(0,212,255,0.05);border:1px solid var(--accent);border-radius:4px;">
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">PUBLIC KEY (PASTE INTO UDM)</div>
        <div style="display:flex;gap:8px;align-items:center;"><code id="pubkey-display" style="font-size:11px;color:var(--accent);word-break:break-all;flex:1;"></code></div>
      </div>
      <button class="btn-primary" style="margin-top:12px;" onclick="createToken()">Generate Cipher</button>
    </div>
    <div class="card"><div class="card-title">System Settings</div>
      <div class="form-row">
        <div><label>Public Endpoint</label><input type="text" id="set-ip" readonly /></div>
        <div><label>WG Public Key</label><input type="text" id="set-pubkey" /></div>
      </div>
      <label>Access Control (Allowed IPs)</label><input type="text" id="set-allowed" />
      <div class="form-row" style="margin-top:12px;">
        <div><label>Local Gateway</label><input type="text" id="set-local" /></div>
        <div><label>Minimum Version</label><input type="text" id="set-version" /></div>
      </div>
      <button class="btn-primary" style="margin-top:12px;" onclick="saveSettings()">Apply Global Config</button>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="font-size:11px;font-family:'Share Tech Mono',monospace;color:var(--muted);letter-spacing:1px;">UDM SSH (for auto peer provisioning)</div>
          <span style="font-size:10px;color:var(--accent);cursor:pointer;font-family:'Share Tech Mono',monospace;" onclick="document.getElementById('ssh-advanced').style.display=document.getElementById('ssh-advanced').style.display==='none'?'block':'none'">ADVANCED ▾</span>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end;">
          <div style="flex:1;"><label>SSH Password</label><input type="password" id="set-udm-pass" placeholder="UDM root password" /></div>
          <button class="btn-secondary" style="height:40px;" onclick="saveSSHSettings()">Save</button>
          <button class="btn-secondary" style="height:40px;" onclick="testSSH()">Test</button>
        </div>
        <div id="ssh-advanced" style="display:none;margin-top:12px;">
          <div class="form-row">
            <div><label>UDM SSH Host</label><input type="text" id="set-udm-host" placeholder="192.168.30.1" /></div>
            <div><label>SSH User</label><input type="text" id="set-udm-user" placeholder="root" /></div>
          </div>
          <div style="margin-top:8px;"><label>WG Interface</label><input type="text" id="set-udm-iface" placeholder="wgsrv1" style="max-width:240px;" /></div>
          <div style="margin-top:8px;"><label>SSH Private Key (PEM — optional)</label><textarea id="set-udm-key" rows="4" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px;font-family:monospace;font-size:11px;border-radius:3px;resize:vertical;" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"></textarea></div>
        </div>
      </div>
    </div>
    <div class="card"><div class="card-title">Active Database</div><div id="token-list"></div></div>
    <div class="card"><div class="card-title">Compute Cluster (Pterodactyl)</div><div id="server-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;"></div></div>
    <div class="card"><div class="card-title" style="display:flex;align-items:center;gap:10px;">Access Requests <span id="request-badge" style="display:none;background:rgba(255,170,0,0.15);border:1px solid var(--warn);color:var(--warn);font-family:'Share Tech Mono',monospace;font-size:11px;padding:2px 8px;border-radius:2px;"></span></div><div id="requests-list"></div></div>
    <div class="card" id="reports-card"><div class="card-title">Incident Reports</div><div id="reports-container"></div></div>
  </div>
</div>
<div id="toast"></div>
<script>
  let adminPassword = '';
  function toast(msg) { const el = document.getElementById('toast'); el.textContent = msg; el.className = 'show'; setTimeout(() => el.className = '', 3000); }
  function timeAgo(isoStr) { const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000); if (diff < 60) return diff + 's ago'; return Math.floor(diff / 60) + 'm ago'; }

  async function login() {
    adminPassword = document.getElementById('admin-password').value;
    const res = await fetch('/admin/tokens', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ password: adminPassword }) });
    if (res.ok) { 
        document.getElementById('auth-gate').style.display='none'; 
        document.getElementById('main-panel').style.display='block'; 
        localStorage.setItem('adminAuth', JSON.stringify({ password: adminPassword, timestamp: Date.now() }));
        refresh(); setInterval(refresh, 15000); 
    }
    else toast('Invalid Security Key');
  }

  function generateWGKeys() {
    try {
      const keys = nacl.box.keyPair();
      const toB64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
      document.getElementById('new-privkey').value = toB64(keys.secretKey);
      document.getElementById('pubkey-display').textContent = toB64(keys.publicKey);
      document.getElementById('pubkey-box').style.display = 'block';
      toast('Keys generated - Copy Public Key to UDM!');
    } catch (e) { toast('Key Gen Failed'); }
  }

  async function refresh() {
    const body = JSON.stringify({ password: adminPassword });
    const [tRes, oRes, sRes, vRes, rRes, pRes, reqRes] = await Promise.all([
      fetch('/admin/tokens', { method:'POST', headers:{'Content-Type':'application/json'}, body }),
      fetch('/admin/online', { method:'POST', headers:{'Content-Type':'application/json'}, body }),
      fetch('/api/server-config'),
      fetch('/api/version'),
      fetch('/admin/reports', { method:'POST', headers:{'Content-Type':'application/json'}, body }),
      fetch('/api/servers'),
      fetch('/admin/requests', { method:'POST', headers:{'Content-Type':'application/json'}, body })
    ]);
    if (tRes.ok) {
      const tokens = await tRes.json(); const online = await oRes.json(); const config = await sRes.json(); const ver = await vRes.json(); const reports = await rRes.json(); const servers = await pRes.json(); const requests = reqRes.ok ? await reqRes.json() : [];
      document.getElementById('stat-redeemed').textContent = tokens.filter(t => t.redeemed).length;
      document.getElementById('stat-online').textContent = online.length;
      document.getElementById('stat-pending').textContent = tokens.filter(t => !t.redeemed).length;
      document.getElementById('stat-version').textContent = 'v' + ver.min_version;
      const headerIp = document.getElementById('header-server-ip'); if (headerIp) headerIp.textContent = 'IP: ' + config.publicIp;
      document.getElementById('set-ip').value = config.publicIp;
      document.getElementById('set-pubkey').value = config.publicKey;
      document.getElementById('set-allowed').value = config.allowedIPs;
      document.getElementById('set-local').value = config.localIp || '';
      document.getElementById('set-version').value = ver.min_version;
      renderTokens(tokens); renderReports(reports); renderServers(servers); renderRequests(requests);
      refreshPeers(online);
      document.getElementById('set-udm-host').value = config.udmHost || '';
      document.getElementById('set-udm-user').value = config.udmUser || '';
      document.getElementById('set-udm-iface').value = config.udmInterface || '';
    }
  }

  function derivePublicKey(privKeyB64) {
    try {
      var secretKey = Uint8Array.from(atob(privKeyB64), function(c) { return c.charCodeAt(0); });
      var keys = nacl.box.keyPair.fromSecretKey(secretKey);
      return btoa(String.fromCharCode.apply(null, new Uint8Array(keys.publicKey)));
    } catch(e) { return null; }
  }

  function copyPubkey(btn) {
    navigator.clipboard.writeText(btn.getAttribute('data-cmd')).then(function() { toast('Public key copied!'); });
  }

  function renderTokens(tokens) {
    document.getElementById('token-list').innerHTML = '<table class="token-table"><thead><tr><th>Identity</th><th>Token</th><th>VPN IP</th><th>Public Key</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
      tokens.map(t => {
        const pubkey = t.private_key ? derivePublicKey(t.private_key) : null;
        const pubkeyHtml = pubkey
          ? \`<code style="font-size:10px;color:var(--muted);word-break:break-all;">\${pubkey}</code> <button class="btn-secondary" style="font-size:9px;padding:2px 6px;margin-top:4px;" data-cmd="\${pubkey}" onclick="copyPubkey(this)">COPY KEY</button>\`
          : 'N/A';
        return \`<tr>
          <td>\${t.name}</td>
          <td><code>\${t.token}</code></td>
          <td><code style="color:var(--accent)">\${t.client_ip || 'N/A'}</code></td>
          <td style="max-width:220px;">\${pubkeyHtml}</td>
          <td><span class="badge \${t.redeemed?'badge-redeemed':'badge-pending'}">\${t.redeemed?'PROVISIONED':'IDLE'}</span></td>
          <td><button class="btn-danger" onclick="revoke('\${t.token}')">Revoke</button></td>
        </tr>\`;
      }).join('') + '</tbody></table>';
  }

  let _lastOnline = [];

  async function togglePlayerHidden(name) {
    await fetch('/admin/player/toggle-hidden', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: adminPassword, name }) });
    refresh();
  }

  function renderRequests(requests) {
    const pending = requests.filter(r => r.status === 'pending');
    const badge = document.getElementById('request-badge');
    badge.style.display = pending.length > 0 ? 'inline-block' : 'none';
    badge.textContent = pending.length + ' PENDING';
    document.getElementById('requests-list').innerHTML = requests.length === 0
      ? '<p style="color:var(--muted)">No access requests.</p>'
      : requests.map(r => \`
        <div class="report-item" style="\${r.status!=='pending'?'opacity:0.45':''}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
            <div>
              <strong style="font-size:13px;">\${r.name}</strong>
              <span style="font-size:11px;color:var(--muted);margin-left:8px;">\${r.email}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
              <span style="font-size:10px;color:var(--muted)">\${new Date(r.requested_at).toLocaleString()}</span>
              <span style="font-size:10px;font-family:monospace;padding:1px 6px;border-radius:2px;border:1px solid \${r.status==='pending'?'var(--warn)':'var(--muted)'};color:\${r.status==='pending'?'var(--warn)':'var(--muted)'};">\${r.status.toUpperCase()}</span>
              \${r.status === 'pending' ? \`<button class="btn-primary" data-approve="\${r.id}" onclick="approveRequest('\${r.id}')" style="font-size:10px;padding:2px 10px;">APPROVE</button><button class="btn-danger" onclick="dismissRequest('\${r.id}')" style="font-size:10px;padding:2px 8px;">DISMISS</button>\` : ''}
            </div>
          </div>
        </div>
      \`).join('');
  }

  async function dismissRequest(id) {
    await fetch('/admin/request/dismiss', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: adminPassword, id }) });
    toast('Request dismissed');
    refresh();
  }

  function renderReports(reports) {
    const unread = reports.filter(r => !r.read).length;
    document.getElementById('report-badge').style.display = unread > 0 ? 'inline-block' : 'none';
    document.getElementById('report-count').textContent = unread;
    document.getElementById('reports-container').innerHTML = reports.map(r => \`
      <div class="report-item \${r.read?'read':''}">
        <div style="display:flex;justify-content:space-between;align-items:center;"><strong>\${r.player}</strong><span style="font-size:10px;color:var(--muted)">\${new Date(r.timestamp).toLocaleString()}</span></div>
        <div style="color:var(--accent2);font-size:12px;margin:8px 0;font-family:monospace;">\${r.error_message}</div>
        <div style="display:flex;gap:8px;">
          <button class="btn-secondary" onclick="document.getElementById('log-\${r.id}').style.display='block'">View Log</button>
          <button class="btn-danger" onclick="markRead('\${r.id}')">Dismiss</button>
        </div>
        <div class="report-log" id="log-\${r.id}">\${r.log_tail}</div>
      </div>
    \`).join('') || '<p style="color:var(--muted)">No incidents reported.</p>';
  }

  function renderServers(servers) {
    document.getElementById('server-grid').innerHTML = servers.map(s => {
      const running = s.state === 'running';
      const stateColor = running ? 'var(--success)' : s.state === 'starting' ? 'var(--warn)' : 'var(--muted)';
      return \`
      <div class="server-card" style="\${!running ? 'opacity:0.45;filter:saturate(0.3)' : ''}">
        <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;"><strong style="color:\${running?'var(--text)':'var(--muted)'}">\${s.name}</strong> <span style="font-size:11px;color:\${stateColor}">\${s.state.toUpperCase()}</span></div>
        <div style="font-size:11px;color:var(--muted);margin:8px 0; font-family:monospace">CPU: \${s.cpu}% | RAM: \${s.memory_mb} MB | UP: \${Math.floor(s.uptime/3600)}h</div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn-secondary" onclick="power('\${s.id}','start')">Boot</button>
          <button class="btn-danger" onclick="power('\${s.id}','stop')">Kill</button>
          <button class="btn-secondary" style="border-color:var(--warn); color:var(--warn)" onclick="power('\${s.id}','restart')">Reboot</button>
        </div>
      </div>\`;
    }).join('');
  }

  function fmtBytes(b) {
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KiB';
    if (b < 1073741824) return (b/1048576).toFixed(1) + ' MiB';
    return (b/1073741824).toFixed(2) + ' GiB';
  }

  function fmtDuration(isoStr) {
    if (!isoStr) return '—';
    const s = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return m > 0 ? h + 'h ' + m + 'm' : h + 'h';
  }

  function fmtHandshake(secs) {
    if (secs === null) return { label: 'Never', cls: 'stale' };
    if (secs < 180) return { label: secs + 's ago', cls: 'active' };
    if (secs < 900) return { label: Math.floor(secs/60) + 'm ago', cls: 'recent' };
    if (secs < 3600) return { label: Math.floor(secs/60) + 'm ago', cls: 'stale' };
    return { label: Math.floor(secs/3600) + 'h ago', cls: 'stale' };
  }

  function renderRoster(peers, online) {
    const el = document.getElementById('network-roster');
    // Build lookup: vpn_ip → player data
    const byIp = {};
    for (const p of online) byIp[p.vpn_ip.split('/')[0]] = p;

    if (!peers || peers.length === 0) {
      // No wg data — fall back to heartbeat-only list
      if (!online.length) { el.innerHTML = '<p style="color:var(--muted);font-size:12px;font-family:monospace;">No nodes detected.</p>'; return; }
      peers = online.map(p => ({ vpn_ip: p.vpn_ip.split('/')[0], name: p.name, handshake_age: null, rx_bytes: 0, tx_bytes: 0, rx_total: 0, tx_total: 0, pubkey: '' }));
    }

    el.innerHTML = '<table class="peer-table"><thead><tr><th>Status</th><th>Identity</th><th>VPN IP</th><th>Ping</th><th>Connected</th><th>Handshake</th><th>Game</th><th>RX / TX</th><th>Actions</th></tr></thead><tbody>' +
      peers.map(p => {
        const player = byIp[p.vpn_ip] || null;
        const hs = fmtHandshake(p.handshake_age);
        const isOrphan = !p.name && !player; // WG entry with no matching token/player
        const dotCls = (player && player.active) ? 'active' : hs.cls;
        const hsColor = hs.cls === 'active' ? 'var(--success)' : hs.cls === 'recent' ? 'var(--warn)' : 'var(--muted)';
        const name = p.name || player?.name || (p.pubkey ? p.pubkey.slice(0,12)+'...' : '—');
        const rawPing = player?.ping;
        const ping = !rawPing ? 'no data' : (rawPing === '---' ? 'init' : rawPing);
        const pingColor = (!rawPing || rawPing === '---') ? 'var(--muted)' : (ping === 'Timed Out' || ping === 'Error' ? 'var(--danger)' : 'var(--success)');
        const game = player?.game || '—';
        const hiddenName = player?.hidden ? \` <span style="font-size:9px;color:var(--muted);border:1px solid var(--muted);padding:0 4px;border-radius:2px;">INVIS</span>\` : '';
        const orphanBadge = isOrphan ? \` <span style="font-size:9px;color:var(--warn);border:1px solid var(--warn);padding:0 4px;border-radius:2px;letter-spacing:1px;">ORPHAN</span>\` : '';
        const hideBtn = player ? \`<button class="btn-secondary" style="font-size:10px;padding:2px 8px;" onclick="togglePlayerHidden('\${player.name}')">\${player.hidden?'UNHIDE':'HIDE'}</button>\` : '';
        const rowStyle = isOrphan
          ? 'background:rgba(255,170,0,0.04);border-left:2px solid rgba(255,170,0,0.3);'
          : (!player && hs.cls === 'stale' ? 'opacity:0.4;' : '');
        return \`<tr style="\${rowStyle}">
          <td><span class="peer-dot \${dotCls}"></span></td>
          <td style="color:\${isOrphan?'var(--warn)':'var(--text)'}">\${name}\${hiddenName}\${orphanBadge}\${p.pubkey ? \`<br><span style="font-size:9px;color:var(--muted)">\${p.pubkey.slice(0,16)}...</span>\` : ''}</td>
          <td style="color:var(--accent);font-family:monospace">\${p.vpn_ip || '—'}</td>
          <td style="color:\${pingColor};font-family:monospace">\${ping}</td>
          <td style="color:var(--muted);font-family:monospace">\${player?.active ? fmtDuration(player.connected_at) : '—'}</td>
          <td style="color:\${hsColor}">\${hs.label}</td>
          <td style="color:var(--muted);font-size:12px">\${game}</td>
          <td style="font-family:monospace;font-size:12px">\${fmtBytes(p.rx_bytes)} / \${fmtBytes(p.tx_bytes)}</td>
          <td>\${hideBtn}</td>
        </tr>\`;
      }).join('') + '</tbody></table>';
  }

  async function refreshPeers(online) {
    if (online) _lastOnline = online;
    try {
      const res = await fetch('/admin/wg/peers', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: adminPassword }) });
      if (res.ok) {
        renderRoster(await res.json(), _lastOnline);
      } else {
        const d = await res.json();
        // Fall back to heartbeat-only roster if SSH fails
        renderRoster(null, _lastOnline);
        document.getElementById('network-roster').insertAdjacentHTML('beforeend', \`<p class="peer-error" style="margin-top:8px;">VPN data unavailable: \${d.error}</p>\`);
      }
    } catch {
      renderRoster(null, _lastOnline);
    }
  }

  async function createToken() {
    const name = document.getElementById('new-name').value;
    const client_ip = document.getElementById('new-ip').value;
    const private_key = document.getElementById('new-privkey').value;
    const res = await fetch('/admin/token/create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: adminPassword, name, client_ip, private_key }) });
    if(res.ok) { toast('Token Generated'); refresh(); } else toast('Failed');
  }

  async function revoke(token) { if(confirm('Revoke access?')) { await fetch('/admin/token/revoke', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: adminPassword, token }) }); toast('Access Revoked'); refresh(); } }
  async function markRead(id) { await fetch('/admin/report/read', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: adminPassword, id }) }); refresh(); }
  async function power(server_id, signal) { await fetch('/admin/servers/power', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: adminPassword, server_id, signal }) }); toast('Signal Dispatched'); }
  async function saveSettings() {
    await fetch('/admin/settings/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
      password: adminPassword, public_key: document.getElementById('set-pubkey').value, allowed_ips: document.getElementById('set-allowed').value, local_ip: document.getElementById('set-local').value, min_version: document.getElementById('set-version').value
    }) });
    toast('Global Settings Updated'); refresh();
  }

  async function saveSSHSettings() {
    const body = JSON.stringify({
      password: adminPassword,
      host: document.getElementById('set-udm-host').value,
      user: document.getElementById('set-udm-user').value,
      key: document.getElementById('set-udm-key').value,
      password_ssh: document.getElementById('set-udm-pass').value,
      wg_interface: document.getElementById('set-udm-iface').value
    });
    await fetch('/admin/ssh/save', { method:'POST', headers:{'Content-Type':'application/json'}, body });
    toast('SSH Config Saved');
  }

  async function testSSH() {
    const btn = event.target; btn.textContent = 'Testing...'; btn.disabled = true;
    try {
      const res = await fetch('/admin/ssh/test', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: adminPassword }) });
      const d = await res.json();
      if (res.ok) toast('SSH OK — UDM reachable', 'success');
      else toast('SSH Failed: ' + d.error, 'error');
    } catch { toast('SSH Test Failed', 'error'); }
    btn.textContent = 'Test Connection'; btn.disabled = false;
  }

  async function approveRequest(id) {
    const vpn_ip = prompt('Assign VPN IP for this player (e.g. 192.168.8.10):');
    if (!vpn_ip) return;
    const btn = document.querySelector(\`[data-approve="\${id}"]\`);
    if (btn) { btn.textContent = 'Provisioning...'; btn.disabled = true; }
    try {
      const res = await fetch('/admin/request/approve', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: adminPassword, id, vpn_ip }) });
      const d = await res.json();
      if (res.ok) {
        const msg = d.warning ? \`Token created — NOTE: \${d.warning}\` : \`Token created for \${d.name}\`;
        alert(msg);
        prompt(\`Send this token to \${d.name}:\`, d.token);
        refresh();
      } else {
        toast('Approve failed: ' + d.error, 'error');
        if (btn) { btn.textContent = 'APPROVE'; btn.disabled = false; }
      }
    } catch { toast('Network error', 'error'); if (btn) { btn.textContent = 'APPROVE'; btn.disabled = false; } }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const authData = localStorage.getItem('adminAuth');
    if (authData) {
        const data = JSON.parse(authData);
        if (Date.now() - data.timestamp < 3600000) {
            document.getElementById('admin-password').value = data.password;
            login();
        }
    }
  });
</script>
</body>
</html>`;
}

async function refreshPublicIP() {
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const { ip } = await r.json();
    if (ip) setS('SERVER_ENDPOINT_IP', ip);
  } catch (e) {}
}
refreshPublicIP();
setInterval(refreshPublicIP, 3600000);

app.listen(PORT, () => console.log(`GamezNET Swarm Backend active on port ${PORT}`));
