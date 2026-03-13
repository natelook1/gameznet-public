/**
 * GameNet - Cloudflare Worker (Master Version)
 * * KV Namespace binding required: GAMENET_KV
 * * Environment Variables (set in Cloudflare dashboard):
 * ADMIN_PASSWORD          - Password for the admin panel
 * CLOUDFLARE_API_TOKEN    - Token with DNS:Edit permissions
 * CLOUDFLARE_ZONE_ID       - looknet.ca Zone ID
 * CLOUDFLARE_DNS_RECORD_ID - gaming.looknet.ca A Record ID
 * * Routes:
 * GET  /admin                     - Admin panel UI
 * POST /admin/token/create        - Generate a new invite token
 * POST /admin/token/revoke        - Revoke a token
 * POST /admin/tokens              - List all tokens (using POST for pwd auth)
 * GET  /admin/update-ip           - DDNS Endpoint (UDM Pro heartbeat)
 * GET  /api/server-config         - Dynamic config for client apps
 * POST /api/redeem                - Redeem a token (client-facing)
 * GET  /api/status                - Server status check (client-facing)
 * GET  /install                   - PowerShell one-liner install script
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let token = '';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) token += '-';
    token += chars[bytes[i] % chars.length];
  }
  return token; // Format: XXXX-XXXX-XXXX-XXXX
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

async function requireAdmin(request, env) {
  const body = await request.json().catch(() => ({}));
  if (body.password !== env.ADMIN_PASSWORD) {
    return { authed: false, body };
  }
  return { authed: true, body };
}

// ─── Admin Panel HTML (Cyberpunk UI) ─────────────────────────────────────────

function adminHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GamezNET Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #080c10;
      --surface: #0d1420;
      --border: #1a2a3a;
      --accent: #00d4ff;
      --accent2: #ff6b35;
      --success: #00ff88;
      --danger: #ff3366;
      --text: #c8d8e8;
      --muted: #4a6080;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Rajdhani', sans-serif;
      min-height: 100vh;
      padding: 0;
    }

    /* Scanline effect */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0, 212, 255, 0.015) 2px,
        rgba(0, 212, 255, 0.015) 4px
      );
      pointer-events: none;
      z-index: 1000;
    }

    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 16px 32px;
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .logo {
      font-family: 'Share Tech Mono', monospace;
      font-size: 20px;
      color: var(--accent);
      letter-spacing: 2px;
    }

    .logo span { color: var(--accent2); }

    .header-badge {
      background: rgba(255, 107, 53, 0.15);
      border: 1px solid var(--accent2);
      color: var(--accent2);
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 2px;
      font-family: 'Share Tech Mono', monospace;
      letter-spacing: 1px;
    }

    .container { max-width: 900px; margin: 0 auto; padding: 32px; }

    /* Auth Gate */
    #auth-gate {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 60vh;
      gap: 16px;
    }

    #auth-gate h2 {
      font-size: 24px;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 2px;
      text-transform: uppercase;
    }

    #auth-gate p { color: var(--muted); font-size: 14px; }

    #main-panel { display: none; }

    /* Cards */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 24px;
      margin-bottom: 24px;
    }

    .card-title {
      font-size: 13px;
      font-family: 'Share Tech Mono', monospace;
      color: var(--accent);
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .card-title::before {
      content: '';
      width: 3px;
      height: 14px;
      background: var(--accent);
      display: inline-block;
    }

    /* Form elements */
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 12px;
    }

    .form-row.single { grid-template-columns: 1fr; }

    input, select {
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px 14px;
      border-radius: 3px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 13px;
      width: 100%;
      transition: border-color 0.2s;
      outline: none;
    }

    input:focus, select:focus { border-color: var(--accent); }

    input::placeholder { color: var(--muted); }

    label {
      display: block;
      font-size: 11px;
      letter-spacing: 1px;
      color: var(--muted);
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    .field { margin-bottom: 0; }

    /* Buttons */
    button {
      font-family: 'Rajdhani', sans-serif;
      font-weight: 700;
      font-size: 14px;
      letter-spacing: 1px;
      padding: 10px 20px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.2s;
      text-transform: uppercase;
    }

    .btn-primary {
      background: var(--accent);
      color: var(--bg);
    }

    .btn-primary:hover { background: #33ddff; transform: translateY(-1px); }

    .btn-danger {
      background: transparent;
      border: 1px solid var(--danger);
      color: var(--danger);
      font-size: 12px;
      padding: 4px 10px;
    }

    .btn-danger:hover { background: var(--danger); color: white; }

    .btn-full { width: 100%; margin-top: 8px; }

    /* Token table */
    .token-table { width: 100%; border-collapse: collapse; }

    .token-table th {
      text-align: left;
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      color: var(--muted);
      letter-spacing: 1px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
    }

    .token-table td {
      padding: 12px;
      border-bottom: 1px solid rgba(26,42,58,0.5);
      font-size: 14px;
      vertical-align: middle;
    }

    .token-code {
      font-family: 'Share Tech Mono', monospace;
      color: var(--accent);
      font-size: 13px;
      letter-spacing: 1px;
    }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 2px;
      font-size: 11px;
      font-family: 'Share Tech Mono', monospace;
      letter-spacing: 1px;
    }

    .badge-pending {
      background: rgba(0, 212, 255, 0.1);
      border: 1px solid rgba(0, 212, 255, 0.3);
      color: var(--accent);
    }

    .badge-redeemed {
      background: rgba(0, 255, 136, 0.1);
      border: 1px solid rgba(0, 255, 136, 0.3);
      color: var(--success);
    }

    /* Toast */
    #toast {
      position: fixed;
      bottom: 32px;
      right: 32px;
      background: var(--surface);
      border: 1px solid var(--accent);
      color: var(--accent);
      padding: 12px 20px;
      border-radius: 3px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 13px;
      letter-spacing: 1px;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.3s;
      z-index: 9999;
    }

    #toast.show { opacity: 1; transform: translateY(0); }
    #toast.error { border-color: var(--danger); color: var(--danger); }

    .empty-state {
      text-align: center;
      padding: 32px;
      color: var(--muted);
      font-size: 14px;
    }

    .token-result {
      background: rgba(0, 212, 255, 0.05);
      border: 1px solid var(--accent);
      border-radius: 3px;
      padding: 16px;
      margin-top: 12px;
      display: none;
    }

    .token-result-label {
      font-size: 11px;
      color: var(--muted);
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    .token-result-value {
      font-family: 'Share Tech Mono', monospace;
      font-size: 20px;
      color: var(--accent);
      letter-spacing: 3px;
    }

    .token-result-meta {
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
    }
  </style>
</head>
<body>

<header>
  <div class="logo">GAMEZ<span>NET</span></div>
  <div class="header-badge">ADMIN CONSOLE</div>
</header>

<div class="container">

  <!-- Auth Gate -->
  <div id="auth-gate">
    <h2>🔒 Authentication Required</h2>
    <p>Enter your admin password to continue</p>
    <div style="width: 320px;">
      <div class="field" style="margin-bottom: 12px;">
        <label>Admin Password</label>
        <input type="password" id="admin-password" placeholder="••••••••" />
      </div>
      <button class="btn-primary btn-full" onclick="login()">Authenticate</button>
    </div>
  </div>

  <!-- Main Panel -->
  <div id="main-panel">

    <!-- Create Token -->
    <div class="card">
      <div class="card-title">Generate Invite Token</div>
      <div class="form-row">
        <div class="field">
          <label>Player Name / Label</label>
          <input type="text" id="new-name" placeholder="e.g. Dave" />
        </div>
        <div class="field">
          <label>Assigned VPN IP (e.g. 192.168.8.3/32)</label>
          <input type="text" id="new-ip" placeholder="192.168.8.x/32" />
        </div>
      </div>
      <div class="form-row single">
        <div class="field">
          <label>WireGuard Private Key</label>
          <input type="text" id="new-privkey" placeholder="Paste client private key here" />
        </div>
      </div>
      <button class="btn-primary" onclick="createToken()">Generate Token</button>

      <div class="token-result" id="token-result">
        <div class="token-result-label">Share this token with your player</div>
        <div class="token-result-value" id="token-display"></div>
        <div class="token-result-meta" id="token-meta"></div>
      </div>
    </div>

    <!-- Token List -->
    <div class="card">
      <div class="card-title">Active Tokens</div>
      <div id="token-list-container">
        <div class="empty-state">Loading...</div>
      </div>
    </div>

  </div>
</div>

<div id="toast"></div>

<script>
  let adminPassword = '';

  function toast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show' + (isError ? ' error' : '');
    setTimeout(() => el.className = '', 3000);
  }

  async function login() {
    adminPassword = document.getElementById('admin-password').value;
    const res = await fetch('/admin/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword })
    });
    if (res.ok) {
      document.getElementById('auth-gate').style.display = 'none';
      document.getElementById('main-panel').style.display = 'block';
      renderTokenList(await res.json());
    } else {
      toast('Invalid password', true);
    }
  }

  document.getElementById('admin-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') login();
  });

  async function createToken() {
    const name = document.getElementById('new-name').value.trim();
    const ip = document.getElementById('new-ip').value.trim();
    const privkey = document.getElementById('new-privkey').value.trim();

    if (!name || !ip || !privkey) { toast('All fields required', true); return; }

    const res = await fetch('/admin/token/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, name, client_ip: ip, private_key: privkey })
    });

    const data = await res.json();
    if (res.ok) {
      document.getElementById('token-display').textContent = data.token;
      document.getElementById('token-meta').textContent = \`Player: \${name} · IP: \${ip}\`;
      document.getElementById('token-result').style.display = 'block';
      document.getElementById('new-name').value = '';
      document.getElementById('new-ip').value = '';
      document.getElementById('new-privkey').value = '';
      toast('Token created!');
      loadTokens();
    } else {
      toast(data.error || 'Failed to create token', true);
    }
  }

  async function revokeToken(token) {
    if (!confirm(\`Revoke token \${token}?\`)) return;
    await fetch('/admin/token/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, token })
    });
    toast('Token revoked');
    loadTokens();
  }

  async function loadTokens() {
    const res = await fetch('/admin/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword })
    });
    if (res.ok) renderTokenList(await res.json());
  }

  function renderTokenList(tokens) {
    const container = document.getElementById('token-list-container');
    if (!tokens.length) {
      container.innerHTML = '<div class="empty-state">No tokens yet. Generate one above.</div>';
      return;
    }
    container.innerHTML = \`
      <table class="token-table">
        <thead>
          <tr>
            <th>TOKEN</th>
            <th>PLAYER</th>
            <th>VPN IP</th>
            <th>STATUS</th>
            <th>CREATED</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          \${tokens.map(t => \`
            <tr>
              <td><span class="token-code">\${t.token}</span></td>
              <td>\${t.name}</td>
              <td><span style="font-family: 'Share Tech Mono', monospace; font-size: 13px;">\${t.client_ip}</span></td>
              <td><span class="badge \${t.redeemed ? 'badge-redeemed' : 'badge-pending'}">\${t.redeemed ? 'REDEEMED' : 'PENDING'}</span></td>
              <td style="color: #4a6080; font-size: 13px;">\${new Date(t.created_at).toLocaleDateString()}</td>
              <td><button class="btn-danger" onclick="revokeToken('\${t.token}')">Revoke</button></td>
            </tr>
          \`).join('')}
        </tbody>
      </table>
    \`;
  }
</script>
</body>
</html>`;
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

async function handleAdminTokenCreate(request, env) {
  const { authed, body } = await requireAdmin(request, env);
  if (!authed) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { name, client_ip, private_key } = body;
  if (!name || !client_ip || !private_key) {
    return jsonResponse({ error: 'Missing required fields' }, 400);
  }

  const token = generateToken();
  const record = {
    token,
    name,
    client_ip,
    private_key,
    redeemed: false,
    created_at: new Date().toISOString()
  };

  await env.GAMENET_KV.put(`token:${token}`, JSON.stringify(record));

  const indexRaw = await env.GAMENET_KV.get('token_index');
  const index = indexRaw ? JSON.parse(indexRaw) : [];
  index.push(token);
  await env.GAMENET_KV.put('token_index', JSON.stringify(index));

  return jsonResponse({ token, name, client_ip });
}

async function handleAdminTokenRevoke(request, env) {
  const { authed, body } = await requireAdmin(request, env);
  if (!authed) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { token } = body;
  if (!token) return jsonResponse({ error: 'Token required' }, 400);

  await env.GAMENET_KV.delete(`token:${token}`);

  const indexRaw = await env.GAMENET_KV.get('token_index');
  if (indexRaw) {
    const index = JSON.parse(indexRaw).filter(t => t !== token);
    await env.GAMENET_KV.put('token_index', JSON.stringify(index));
  }

  return jsonResponse({ success: true });
}

async function handleAdminTokenList(request, env) {
  const { authed } = await requireAdmin(request, env);
  if (!authed) return jsonResponse({ error: 'Unauthorized' }, 401);

  const indexRaw = await env.GAMENET_KV.get('token_index');
  const index = indexRaw ? JSON.parse(indexRaw) : [];

  const tokens = await Promise.all(
    index.map(async token => {
      const raw = await env.GAMENET_KV.get(`token:${token}`);
      return raw ? JSON.parse(raw) : null;
    })
  );

  return jsonResponse(tokens.filter(Boolean));
}

// ─── DYNAMIC IP HANDLERS ───────────────────────────────────────────────────

async function handleUpdateIP(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || request.headers.get('x-admin-password');
  
  if (key !== env.ADMIN_PASSWORD) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (!clientIp) return jsonResponse({ error: 'No IP detected' }, 400);

  // 1. Update KV (Internal Reference for App)
  await env.GAMENET_KV.put('SERVER_ENDPOINT_IP', clientIp);

  // 2. Update Public Cloudflare DNS A Record for gaming.looknet.ca
  let dnsSyncResult = "Skipped (Secrets not configured)";
  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID && env.CLOUDFLARE_DNS_RECORD_ID) {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records/${env.CLOUDFLARE_DNS_RECORD_ID}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            type: 'A',
            name: 'gaming.looknet.ca',
            content: clientIp,
            ttl: 1,
            proxied: false
          })
        }
      );
      const resData = await response.json();
      dnsSyncResult = resData.success ? "Success" : "Failed: " + JSON.stringify(resData.errors);
    } catch (e) {
      dnsSyncResult = "Error: " + e.message;
    }
  }
  
  return jsonResponse({ 
    success: true, 
    ip: clientIp, 
    dns_sync: dnsSyncResult,
    message: "Endpoint synchronized." 
  });
}

async function handleServerConfig(request, env) {
  const currentIp = await env.GAMENET_KV.get('SERVER_ENDPOINT_IP') || "184.66.15.159";
  
  return jsonResponse({
    endpoint: `${currentIp}:51820`,
    publicKey: "SLG8saonFoQ+B8x59SBeHCXouLTpVhyEYPqiUZoGqgI="
  });
}

// ─── Client API Handlers ─────────────────────────────────────────────────────

async function handleRedeem(request, env) {
  const body = await request.json().catch(() => ({}));
  const { token } = body;

  if (!token) return jsonResponse({ error: 'Token required' }, 400);

  const raw = await env.GAMENET_KV.get(`token:${token}`);
  if (!raw) return jsonResponse({ error: 'Invalid or expired token' }, 404);

  const record = JSON.parse(raw);

  record.redeemed = true;
  record.redeemed_at = new Date().toISOString();
  await env.GAMENET_KV.put(`token:${token}`, JSON.stringify(record));

  return jsonResponse({
    success: true,
    name: record.name,
    private_key: record.private_key,
    client_ip: record.client_ip
  });
}

async function handleStatus(request, env) {
  return jsonResponse({
    online: true,
    service: 'GamezNET',
    timestamp: new Date().toISOString()
  });
}

async function handleInstall(request, env) {
  const script = `
# GamezNET Installer
$ErrorActionPreference = 'Continue'
$repo = "https://raw.githubusercontent.com/natelook1/gamenet-client/main"
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
function Write-ERR  { param($t) Write-Host "          [" -NoNewline -ForegroundColor DarkGray; Write-Host "FAIL" -NoNewline -ForegroundColor Red;    Write-Host "] $t" -ForegroundColor Gray }
function Write-INFO { param($t) Write-Host "               $t" -ForegroundColor DarkGray }

Clear-Host
Write-Host ""
Write-Host "  ========================================================" -ForegroundColor Cyan
Write-Host "   ____                             _   _ _____ _____ " -ForegroundColor Cyan
Write-Host "  / ___| __ _ _ __ ___   ___   __ _| \\\\ | | ____|_   _|" -ForegroundColor Cyan
Write-Host " | |  _ / _' | '_ ' _ \\\\ / _ \\\\ / _' |  \\\\| |  _|   | |  " -ForegroundColor Cyan
Write-Host " | |_| | (_| | | | | | |  __/| (_| | |\\\\  | |___  | |  " -ForegroundColor Cyan
Write-Host "  \\\\____|\\\\__,_|_| |_| |_|\\\\___| \\\\__,_|_| \\\\_|_____| |_|  " -ForegroundColor Cyan
Write-Host "  ========================================================" -ForegroundColor Cyan
Write-Host "           Private Game Server Network Installer" -ForegroundColor DarkGray
Write-Host "  ========================================================" -ForegroundColor Cyan
Write-Host ""

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-WARN "Relaunching as Administrator..."
    Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command "irm https://gamenet.natelook.workers.dev/install | iex"' -Verb RunAs
    exit
}

Write-Step 1 5 "Preparing install directory"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
New-Item -ItemType Directory -Force -Path "$installDir\\\\templates" | Out-Null
New-Item -ItemType Directory -Force -Path "$installDir\\\\static" | Out-Null
Write-OK "Install directory initialized"

Write-Step 2 5 "Downloading GamezNET"
$files = @(
    @{ url = "$repo/app.py";               dest = "$installDir\\\\app.py" },
    @{ url = "$repo/GamezNET.bat";         dest = "$installDir\\\\GamezNET.bat" },
    @{ url = "$repo/templates/index.html"; dest = "$installDir\\\\templates\\\\index.html" },
    @{ url = "$repo/static/favicon.svg";   dest = "$installDir\\\\static\\\\favicon.svg" }
)
foreach ($file in $files) {
    $name = Split-Path $file.url -Leaf
    Write-INFO "Fetching $name..."
    Invoke-WebRequest -Uri $file.url -OutFile $file.dest -UseBasicParsing
}
Write-OK "All components downloaded"

Write-Step 3 5 "Validating Python Environment"

$machinePath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
$userPath    = [System.Environment]::GetEnvironmentVariable("PATH", "User")
$env:PATH    = "$userPath;$machinePath"

$pythonOk = $false
foreach ($cmd in @("py -3", "python", "python3")) {
    try { $v = & $cmd --version 2>&1; if ($v -match "Python") { $pythonOk = $true; $pythonCmd = $cmd; Write-OK "Detected $v"; break } } catch {}
}

if (-not $pythonOk) {
    Write-WARN "Python missing — bootstrapping installer..."
    $pyInstaller = Join-Path $env:TEMP "python-installer.exe"
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.3/python-3.12.3-amd64.exe" -OutFile $pyInstaller -UseBasicParsing
    Write-INFO "Installing Python (this may take a minute)..."
    Start-Process $pyInstaller -ArgumentList "/quiet InstallAllUsers=0 PrependPath=1" -Wait
    Start-Sleep -Seconds 3
    $pythonCmd = "py -3"
    Write-OK "Python 3.12 ready"
}
Write-INFO "Configuring local dependencies..."
& $pythonCmd -m pip install flask requests --quiet
Write-OK "Environment configured"

Write-Step 4 5 "Validating VPN Engine"
$wgExe = "C:\\\\Program Files\\\\WireGuard\\\\wireguard.exe"
$wgDest = Join-Path $installDir "wireguard.exe"
if (Test-Path $wgExe) { Copy-Item $wgExe $wgDest -Force; Write-OK "Found existing WireGuard engine" }
else {
    Write-WARN "VPN Engine missing — installing..."
    $wgInst = Join-Path $env:TEMP "wg-inst.exe"
    Invoke-WebRequest -Uri "https://download.wireguard.com/windows-client/wireguard-installer.exe" -OutFile $wgInst -UseBasicParsing
    Start-Process $wgInst -ArgumentList "/quiet" -Wait
    Start-Sleep -Seconds 5
    if (Test-Path $wgExe) {
        Copy-Item $wgExe $wgDest -Force
        Write-OK "VPN Engine successfully deployed"
    } else {
        Write-ERR "VPN Engine install failed"
    }
}

Write-Step 5 5 "Deploying Shortcuts"
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut((Join-Path ([System.Environment]::GetFolderPath("Desktop")) "GamezNET.lnk"))
$s.TargetPath = Join-Path $installDir "GamezNET.bat"
$s.WorkingDirectory = $installDir
$s.Save()
Write-OK "Desktop shortcut created"

Write-Host ""
Write-Host "  --------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  INSTALLATION COMPLETE" -BackgroundColor DarkGreen -ForegroundColor White
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "   1. Double-click GamezNET on your desktop" -ForegroundColor Gray
Write-Host "   2. Enter the invite token sent to you" -ForegroundColor Gray
Write-Host "   3. Click Connect - you are in!" -ForegroundColor Gray
Write-Host ""
Write-Host "  Opening GamezNET local directory..." -ForegroundColor DarkCyan

Start-Process "explorer.exe" -ArgumentList $installDir
Write-Host "  Press any key to close this installer." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
`;

  return new Response(script, {
    headers: {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// ─── Main Router ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    if (path === '/admin' && method === 'GET') return htmlResponse(adminHTML());
    if (path === '/admin/update-ip') return handleUpdateIP(request, env);
    if (path === '/api/server-config') return handleServerConfig(request, env);
    if (path === '/admin/token/create' && method === 'POST') return handleAdminTokenCreate(request, env);
    if (path === '/admin/token/revoke' && method === 'POST') return handleAdminTokenRevoke(request, env);
    if (path === '/admin/tokens' && method === 'POST') return handleAdminTokenList(request, env);
    if (path === '/api/redeem' && method === 'POST') return handleRedeem(request, env);
    if (path === '/api/status' && method === 'GET') return jsonResponse({ online: true });
    if (path === '/install' && method === 'GET') return handleInstall(request, env);

    return new Response('Not found', { status: 404 });
  }
};