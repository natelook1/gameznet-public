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

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY, 
    name TEXT, 
    client_ip TEXT, 
    private_key TEXT,
    redeemed INTEGER DEFAULT 0, 
    created_at TEXT, 
    redeemed_at TEXT, 
    hidden INTEGER DEFAULT 0
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
`);

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const getS = (k, d) => db.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value || d;
const setS = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

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
    publicIp: wanIp, localIp
  });
});

app.post('/api/heartbeat', (req, res) => {
  const { name, vpn_ip, disconnecting, game } = req.body;
  if (!name) return res.status(400).end();
  if (disconnecting) {
    db.prepare("DELETE FROM players WHERE name = ?").run(name);
  } else {
    const tokenRecord = db.prepare("SELECT hidden FROM tokens WHERE name = ?").get(name);
    db.prepare(`INSERT INTO players (name, vpn_ip, last_seen, game, hidden) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET vpn_ip=excluded.vpn_ip, last_seen=excluded.last_seen, game=excluded.game, hidden=excluded.hidden`)
      .run(name, vpn_ip || '', new Date().toISOString(), game || null, tokenRecord ? tokenRecord.hidden : 0);
  }
  res.json({ success: true });
});

app.get('/api/online', (req, res) => {
  const cutoff = new Date(Date.now() - 90000).toISOString();
  res.json(db.prepare("SELECT name, vpn_ip, last_seen, game FROM players WHERE last_seen > ? AND hidden = 0 ORDER BY name").all(cutoff));
});

app.post('/api/redeem', (req, res) => {
  const record = db.prepare("SELECT * FROM tokens WHERE token = ?").get(req.body.token);
  if (!record) return res.status(404).json({ error: 'Invalid token' });
  if (record.redeemed) return res.status(409).json({ error: 'Already redeemed' });
  db.prepare("UPDATE tokens SET redeemed = 1, redeemed_at = ? WHERE token = ?").run(new Date().toISOString(), req.body.token);
  res.json({ success: true, name: record.name, private_key: record.private_key, client_ip: record.client_ip });
});

app.get('/api/version', (req, res) => res.json({ min_version: getS('MIN_VERSION', "1.1.0") }));
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

app.post('/admin/token/toggle-hidden', requireAdmin, (req, res) => {
  const token = db.prepare("SELECT * FROM tokens WHERE token = ?").get(req.body.token);
  if (!token) return res.status(404).end();
  const newVal = token.hidden ? 0 : 1;
  db.prepare("UPDATE tokens SET hidden = ? WHERE token = ?").run(newVal, req.body.token);
  db.prepare("UPDATE players SET hidden = ? WHERE name = ?").run(newVal, token.name);
  res.json({ success: true, hidden: !!newVal });
});

app.post('/admin/online', requireAdmin, (req, res) => {
  const cutoff = new Date(Date.now() - 90000).toISOString();
  res.json(db.prepare("SELECT name, vpn_ip, last_seen, game, hidden FROM players WHERE last_seen > ? ORDER BY name").all(cutoff).map(p => ({...p, hidden: !!p.hidden})));
});

app.post('/admin/settings/save', requireAdmin, (req, res) => {
  const { public_key, allowed_ips, local_ip, min_version } = req.body;
  if (public_key) setS('SERVER_PUBLIC_KEY', public_key.trim());
  if (allowed_ips) setS('SERVER_ALLOWED_IPS', allowed_ips.trim());
  if (local_ip !== undefined) setS('SERVER_LOCAL_IP', local_ip.trim());
  if (min_version) setS('MIN_VERSION', min_version.trim());
  res.json({ success: true });
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
Write-Host "  ================================================================" -ForegroundColor Cyan
Write-Host "   ___  ____  _  _  ____  ____  _  _  ____  ____" -ForegroundColor Cyan
Write-Host "  / __)(  __)( \/ )(  __)(  __)( \( )(  __)(_  _)" -ForegroundColor Cyan
Write-Host " ( (_ \ ) _) / \/ \ ) _)  ) _) )  (  ) _)   )(  " -ForegroundColor Cyan
Write-Host "  \___/(____)\_)(_/(____)(____)(__)\_)(____)  (__)" -ForegroundColor Cyan
Write-Host "  ================================================================" -ForegroundColor Cyan

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
    <div class="card"><div class="card-title">Node Roster</div><div id="online-roster"></div></div>
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
    </div>
    <div class="card"><div class="card-title">Active Database</div><div id="token-list"></div></div>
    <div class="card"><div class="card-title">Compute Cluster (Pterodactyl)</div><div id="server-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;"></div></div>
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
    const [tRes, oRes, sRes, vRes, rRes, pRes] = await Promise.all([
      fetch('/admin/tokens', { method:'POST', headers:{'Content-Type':'application/json'}, body }),
      fetch('/admin/online', { method:'POST', headers:{'Content-Type':'application/json'}, body }),
      fetch('/api/server-config'),
      fetch('/api/version'),
      fetch('/admin/reports', { method:'POST', headers:{'Content-Type':'application/json'}, body }),
      fetch('/api/servers')
    ]);
    if (tRes.ok) {
      const tokens = await tRes.json(); const online = await oRes.json(); const config = await sRes.json(); const ver = await vRes.json(); const reports = await rRes.json(); const servers = await pRes.json();
      document.getElementById('stat-redeemed').textContent = tokens.filter(t => t.redeemed).length;
      document.getElementById('stat-online').textContent = online.length;
      document.getElementById('stat-pending').textContent = tokens.filter(t => !t.redeemed).length;
      document.getElementById('stat-version').textContent = 'v' + ver.min_version;
      document.getElementById('header-server-ip').textContent = 'IP: ' + config.publicIp;
      document.getElementById('set-ip').value = config.publicIp;
      document.getElementById('set-pubkey').value = config.publicKey;
      document.getElementById('set-allowed').value = config.allowedIPs;
      document.getElementById('set-local').value = config.localIp || '';
      document.getElementById('set-version').value = ver.min_version;
      renderTokens(tokens); renderOnline(online); renderReports(reports); renderServers(servers);
    }
  }

  function renderTokens(tokens) {
    document.getElementById('token-list').innerHTML = '<table class="token-table"><thead><tr><th>Identity</th><th>Key</th><th>Status</th><th>Actions</th></tr></thead><tbody>' + 
      tokens.map(t => \`<tr><td>\${t.name}</td><td><code>\${t.token}</code></td><td><span class="badge \${t.redeemed?'badge-redeemed':'badge-pending'}">\${t.redeemed?'PROVISIONED':'IDLE'}</span></td><td><button class="btn-danger" onclick="revoke('\${t.token}')">Revoke</button></td></tr>\`).join('') + '</tbody></table>';
  }

  function renderOnline(online) {
    document.getElementById('online-roster').innerHTML = online.map(p => \`
      <div class="online-tile"><div class="online-tile-dot"></div><div class="online-tile-name">\${p.name}</div><div class="online-tile-game">\${p.game||'SYSTEM IDLE'}</div><div style="font-family:monospace; color:var(--muted)">\${p.vpn_ip}</div><div style="margin-left:auto;font-size:11px;color:var(--muted)">\${timeAgo(p.last_seen)}</div></div>
    \`).join('') || '<p style="color:var(--muted)">No entities detected.</p>';
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
    document.getElementById('server-grid').innerHTML = servers.map(s => \`
      <div class="server-card">
        <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;"><strong>\${s.name}</strong> <span style="font-size:11px;color:\${s.state==='running'?'var(--success)':'var(--danger)'}">\${s.state.toUpperCase()}</span></div>
        <div style="font-size:11px;color:var(--muted);margin:8px 0; font-family:monospace">CPU: \${s.cpu}% | RAM: \${s.memory_mb} MB | UP: \${Math.floor(s.uptime/3600)}h</div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn-secondary" onclick="power('\${s.id}','start')">Boot</button>
          <button class="btn-danger" onclick="power('\${s.id}','stop')">Kill</button>
          <button class="btn-secondary" style="border-color:var(--warn); color:var(--warn)" onclick="power('\${s.id}','restart')">Reboot</button>
        </div>
      </div>
    \`).join('');
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
