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
 * POST /admin/settings/save       - Save server settings
 * GET  /api/server-config         - Dynamic config for client apps
 * POST /api/redeem                - Redeem a token (client-facing)
 * GET  /api/status                - Server status check (client-facing)
 * POST /api/heartbeat             - Player presence heartbeat
 * GET  /api/online                - Who's online list
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
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='46' fill='%2300b4dc' stroke='%2300c8ff' stroke-width='4'/><text x='50' y='66' font-family='sans-serif' font-size='42' font-weight='bold' fill='white' text-anchor='middle'>GZ</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;600;700&display=swap" rel="stylesheet">
  <!-- Added TweetNaCl for secure Curve25519 WireGuard key generation -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/tweetnacl/1.0.3/nacl-fast.min.js"></script>
  <style>
    :root {
      --bg: #080c10;
      --surface: #0d1420;
      --border: #1a2a3a;
      --accent: #00d4ff;
      --accent2: #ff6b35;
      --success: #00ff88;
      --danger: #ff3366;
      --warn: #ffaa00;
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

    .header-right {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .server-ip-chip {
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      color: var(--accent);
      letter-spacing: 1px;
      background: rgba(0,212,255,0.06);
      border: 1px solid rgba(0,212,255,0.2);
      padding: 3px 10px;
      border-radius: 2px;
    }

    .live-indicator {
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      color: var(--success);
      letter-spacing: 1px;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .live-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 6px var(--success);
      animation: blink-live 1.2s ease-in-out infinite;
    }

    @keyframes blink-live {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.2; }
    }

    .container { max-width: 1280px; margin: 0 auto; padding: 32px; }

    /* Stats row */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 16px 20px;
    }

    .stat-label {
      font-family: 'Share Tech Mono', monospace;
      font-size: 10px;
      color: var(--muted);
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .stat-value {
      font-family: 'Share Tech Mono', monospace;
      font-size: 26px;
      font-weight: 700;
      letter-spacing: 2px;
    }

    .stat-value.cyan { color: var(--accent); }
    .stat-value.green { color: var(--success); font-size: 32px; }
    .stat-value.muted { color: var(--muted); }
    .stat-value.mono { color: var(--text); font-size: 14px; margin-top: 6px; }

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

    input, select, textarea {
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

    textarea {
      resize: vertical;
      min-height: 60px;
    }

    input:focus, select:focus, textarea:focus { border-color: var(--accent); }

    input::placeholder, textarea::placeholder { color: var(--muted); }

    input[readonly], textarea[readonly] {
      color: var(--muted);
      cursor: not-allowed;
    }

    label {
      display: block;
      font-size: 11px;
      letter-spacing: 1px;
      color: var(--muted);
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    .field { margin-bottom: 0; }

    .char-counter {
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      color: var(--muted);
      text-align: right;
      margin-top: 4px;
    }

    .char-counter.warn { color: var(--accent2); }

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

    .btn-secondary {
      background: transparent;
      border: 1px solid var(--accent);
      color: var(--accent);
      font-size: 12px;
      padding: 6px 12px;
    }

    .btn-secondary:hover { background: rgba(0,212,255,0.1); }

    .btn-danger {
      background: transparent;
      border: 1px solid var(--danger);
      color: var(--danger);
      font-size: 12px;
      padding: 4px 10px;
    }

    .btn-danger:hover { background: var(--danger); color: white; }

    .btn-icon {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--muted);
      font-size: 11px;
      padding: 3px 8px;
      letter-spacing: 0;
    }

    .btn-icon:hover { border-color: var(--accent); color: var(--accent); }

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
      padding: 10px 12px;
      border-bottom: 1px solid rgba(26,42,58,0.5);
      font-size: 14px;
      vertical-align: middle;
    }

    .token-code {
      font-family: 'Share Tech Mono', monospace;
      color: var(--accent);
      font-size: 12px;
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

    .online-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(0,255,136,0.08);
      border: 1px solid rgba(0,255,136,0.3);
      color: var(--success);
      font-family: 'Share Tech Mono', monospace;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 2px;
      letter-spacing: 1px;
      margin-left: 6px;
    }

    .online-pill-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 4px var(--success);
      animation: blink-live 1.2s ease-in-out infinite;
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
    #toast.success { border-color: var(--success); color: var(--success); }

    .empty-state {
      text-align: center;
      padding: 32px;
      color: var(--muted);
      font-size: 14px;
    }

    /* Token result */
    .token-result {
      background: rgba(0, 212, 255, 0.05);
      border: 1px solid var(--accent);
      border-radius: 3px;
      padding: 16px;
      margin-top: 16px;
      display: none;
    }

    .token-result-label {
      font-size: 11px;
      color: var(--muted);
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .token-result-value {
      font-family: 'Share Tech Mono', monospace;
      font-size: 24px;
      color: var(--accent);
      letter-spacing: 4px;
      margin-bottom: 10px;
    }

    .token-result-meta {
      margin-top: 4px;
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 12px;
    }

    .token-result-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    /* Online roster */
    .online-roster {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .online-tile {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(0,255,136,0.03);
      border: 1px solid rgba(0,255,136,0.1);
      border-radius: 3px;
      padding: 10px 14px;
    }

    .online-tile-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 8px rgba(0,255,136,0.8);
      flex-shrink: 0;
      animation: blink-live 2s ease-in-out infinite;
    }

    .online-tile-name {
      font-family: 'Share Tech Mono', monospace;
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
      flex: 0 0 160px;
      letter-spacing: 1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .online-tile-hidden-badge {
      flex: 0 0 70px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 10px;
      color: var(--muted);
      letter-spacing: 1px;
    }

    .online-tile-game {
      font-family: 'Share Tech Mono', monospace;
      font-size: 10px;
      color: var(--accent);
      letter-spacing: 1px;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .online-tile-ip {
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      color: var(--muted);
      flex: 0 0 140px;
    }

    .online-tile-ago {
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      color: var(--muted);
    }

    .online-empty {
      font-family: 'Share Tech Mono', monospace;
      font-size: 13px;
      color: var(--muted);
      padding: 12px 0;
    }

    /* Settings card */
    .settings-field-row {
      margin-bottom: 16px;
    }

    /* Alert pill buttons */
    .pill-group { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .pill-btn {
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      letter-spacing: 1px;
      padding: 4px 12px;
      background: transparent;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.2s;
      border: 1px solid var(--border);
      color: var(--muted);
      text-transform: uppercase;
    }
    .pill-btn:hover { border-color: var(--accent); color: var(--accent); }
    .alert-type-btn.selected[data-type="info"] { border-color: var(--accent); color: var(--accent); background: rgba(0,212,255,0.1); }
    .alert-type-btn.selected[data-type="warning"] { border-color: var(--warn); color: var(--warn); background: rgba(255,170,0,0.1); }
    .alert-type-btn.selected[data-type="critical"] { border-color: var(--danger); color: var(--danger); background: rgba(255,51,85,0.1); }
    .alert-dur-btn.selected { border-color: var(--accent); color: var(--accent); background: rgba(0,212,255,0.1); }

    /* Hidden toggle button in token table */
    .btn-hidden-toggle {
      font-family: 'Share Tech Mono', monospace;
      font-size: 10px;
      letter-spacing: 1px;
      padding: 3px 8px;
      background: transparent;
      border-radius: 2px;
      cursor: pointer;
      transition: all 0.2s;
      border: 1px solid var(--border);
      color: var(--muted);
      text-transform: uppercase;
      margin-left: 6px;
    }
    .btn-hidden-toggle.is-hidden { border-color: var(--danger); color: var(--danger); }
    .btn-hidden-toggle:hover { border-color: var(--accent); color: var(--accent); }

    /* Report badge */
    .report-badge {
      background: rgba(255,51,85,0.15);
      border: 1px solid var(--danger);
      color: var(--danger);
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 2px;
      letter-spacing: 1px;
      animation: pulse-badge 2s ease-in-out infinite;
      cursor: pointer;
    }
    @keyframes pulse-badge {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    /* Report items */
    .report-item {
      background: rgba(255,51,85,0.04);
      border: 1px solid rgba(255,51,85,0.15);
      border-radius: 3px;
      padding: 14px 16px;
      margin-bottom: 10px;
    }
    .report-item.read { border-color: var(--border); opacity: 0.6; }
    .report-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .report-player { font-weight: 700; font-size: 15px; }
    .report-time { font-family: 'Share Tech Mono', monospace; font-size: 11px; color: var(--muted); }
    .report-error { font-family: 'Share Tech Mono', monospace; font-size: 12px; color: #ff8899; margin-bottom: 8px; }
    .report-log {
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      color: var(--muted);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 2px;
      padding: 8px;
      max-height: 160px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      display: none;
    }
    .toggle-log-btn {
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 2px 8px;
      cursor: pointer;
      letter-spacing: 0;
    }
    .toggle-log-btn:hover { border-color: var(--accent); color: var(--accent); transform: none; }

    /* Server cards */
    .server-card {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .server-card.state-running { border-color: rgba(0,255,136,0.3); }
    .server-card.state-starting, .server-card.state-stopping { border-color: rgba(255,170,0,0.3); }

    .server-card-header { display: flex; align-items: center; gap: 10px; }
    .server-state-dot {
      width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
      background: var(--muted);
    }
    .server-state-dot.running { background: var(--success); box-shadow: 0 0 6px rgba(0,255,136,0.7); animation: blink-live 2s ease-in-out infinite; }
    .server-state-dot.starting, .server-state-dot.stopping { background: var(--warn); box-shadow: 0 0 6px rgba(255,170,0,0.7); }
    .server-state-dot.offline { background: var(--danger); }

    .server-name { font-family: 'Share Tech Mono', monospace; font-size: 13px; font-weight: 700; color: var(--text); flex: 1; }
    .server-state-label { font-family: 'Share Tech Mono', monospace; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }
    .server-state-label.running { color: var(--success); }
    .server-state-label.starting, .server-state-label.stopping { color: var(--warn); }
    .server-state-label.offline, .server-state-label.unknown { color: var(--muted); }

    .server-stats { display: flex; gap: 16px; }
    .server-stat { font-family: 'Share Tech Mono', monospace; font-size: 11px; color: var(--muted); }
    .server-stat span { color: var(--text); }

    .server-connect { font-family: 'Share Tech Mono', monospace; font-size: 11px; color: var(--accent); letter-spacing: 1px; user-select: all; cursor: text; }
    .server-actions { display: flex; gap: 8px; }
    .btn-server {
      font-family: 'Share Tech Mono', monospace; font-size: 11px; letter-spacing: 1px;
      padding: 4px 12px; background: transparent; border-radius: 2px;
      cursor: pointer; text-transform: uppercase; transition: all 0.2s;
    }
    .btn-server-start { border: 1px solid var(--success); color: var(--success); }
    .btn-server-start:hover { background: rgba(0,255,136,0.1); }
    .btn-server-stop { border: 1px solid var(--danger); color: var(--danger); }
    .btn-server-stop:hover { background: rgba(255,51,102,0.1); }
    .btn-server-restart { border: 1px solid var(--warn); color: var(--warn); }
    .btn-server-restart:hover { background: rgba(255,170,0,0.1); }
  </style>
</head>
<body>

<header>
  <div class="logo">GAMEZ<span>NET</span></div>
  <div class="header-badge">ADMIN CONSOLE</div>
  <div class="report-badge" id="report-badge" style="display:none;">
    <span id="report-count">0</span> REPORT<span id="report-plural"></span>
  </div>
  <div class="header-right">
    <div class="server-ip-chip" id="header-server-ip">SERVER IP: —</div>
    <div class="live-indicator"><span class="live-dot"></span> LIVE</div>
  </div>
</header>

<div class="container">

  <!-- Auth Gate -->
  <div id="auth-gate">
    <h2>Authentication Required</h2>
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

    <!-- Stats Row -->
    <div class="stats-row" id="stats-row">
      <div class="stat-card">
        <div class="stat-label">Redeemed Players</div>
        <div class="stat-value cyan" id="stat-redeemed">—</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Online Now</div>
        <div class="stat-value green" id="stat-online">—</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pending Tokens</div>
        <div class="stat-value muted" id="stat-pending">—</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Server Endpoint</div>
        <div class="stat-value mono" id="stat-endpoint">—</div>
      </div>
    </div>

    <!-- Who's Online -->
    <div class="card">
      <div class="card-title">Who's Online</div>
      <div class="online-roster" id="online-roster">
        <div class="online-empty">Loading...</div>
      </div>
    </div>

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
          <label style="display:flex;justify-content:space-between;align-items:center;">
            WireGuard Private Key
            <button class="btn-secondary" onclick="generateWGKeys()" style="font-size:11px;padding:4px 10px;">⚡ Key</button>
          </label>
          <input type="text" id="new-privkey" placeholder="Paste or generate client private key" />
        </div>
      </div>
      <div id="pubkey-box" style="display:none;margin-bottom:14px;padding:12px;background:rgba(0,200,255,0.05);border:1px solid var(--accent);border-radius:6px;">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">⚠ Copy this public key into UDM Pro before creating the token</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <code id="pubkey-display" style="flex:1;font-size:12px;word-break:break-all;color:var(--accent);"></code>
          <button class="btn-secondary" onclick="copyPubKey()" style="font-size:11px;padding:4px 10px;flex-shrink:0;">Copy</button>
        </div>
      </div>
      <button class="btn-primary" onclick="createToken()">Generate Token</button>

      <div class="token-result" id="token-result">
        <div class="token-result-label">Share this token with your player</div>
        <div class="token-result-value" id="token-display"></div>
        <div class="token-result-meta" id="token-meta"></div>
        <div class="token-result-actions">
          <button class="btn-secondary" onclick="copyToken(document.getElementById('token-display').textContent)">Copy Token</button>
        </div>
      </div>
    </div>

    <!-- Push Alert -->
    <div class="card">
      <div class="card-title">Push Alert</div>
      <div style="margin-bottom: 12px;">
        <div style="font-size: 11px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px;">Current Alert</div>
        <div id="current-alert-status" style="font-family: 'Share Tech Mono', monospace; font-size: 13px; color: var(--muted);">No active alert</div>
      </div>
      <div class="settings-field-row">
        <label>Message</label>
        <input type="text" id="alert-message" placeholder="e.g. Server restarting in 10 minutes" />
      </div>
      <div style="margin-bottom: 12px;">
        <label>Type</label>
        <div class="pill-group">
          <button class="pill-btn alert-type-btn selected" data-type="info" onclick="selectAlertType('info')">Info</button>
          <button class="pill-btn alert-type-btn" data-type="warning" onclick="selectAlertType('warning')">Warning</button>
          <button class="pill-btn alert-type-btn" data-type="critical" onclick="selectAlertType('critical')">Critical</button>
        </div>
      </div>
      <div style="margin-bottom: 16px;">
        <label>Duration</label>
        <div class="pill-group">
          <button class="pill-btn alert-dur-btn" data-mins="5" onclick="selectAlertDuration(5)">5m</button>
          <button class="pill-btn alert-dur-btn selected" data-mins="15" onclick="selectAlertDuration(15)">15m</button>
          <button class="pill-btn alert-dur-btn" data-mins="30" onclick="selectAlertDuration(30)">30m</button>
          <button class="pill-btn alert-dur-btn" data-mins="60" onclick="selectAlertDuration(60)">1h</button>
        </div>
      </div>
      <button class="btn-primary" onclick="pushAlert()">Send Alert</button>
      <button class="btn-danger" style="margin-left: 8px; vertical-align: middle;" onclick="clearAlert()">Clear Alert</button>
    </div>

    <!-- MOTD -->
    <div class="card">
      <div class="card-title">Message of the Day</div>
      <div class="form-row single">
        <div class="field">
          <label>Displayed in the app (leave blank to disable, max 120 chars)</label>
          <input type="text" id="motd-input" placeholder="e.g. Server maintenance Friday 10pm" maxlength="120"
                 oninput="updateMotdCounter()" />
          <div class="char-counter" id="motd-counter">0 / 120</div>
        </div>
      </div>
      <button class="btn-primary" onclick="setMotd()">Update MOTD</button>
      <button class="btn-danger" style="margin-left: 8px; vertical-align: middle;" onclick="clearMotd()">Clear</button>
    </div>

    <!-- Token List -->
    <div class="card">
      <div class="card-title">Active Tokens</div>
      <div id="token-list-container">
        <div class="empty-state">Loading...</div>
      </div>
    </div>

    <!-- Server Settings -->
    <div class="card">
      <div class="card-title">Server Settings</div>
      <div class="settings-field-row">
        <label>Server Endpoint IP (read-only — update via /admin/update-ip)</label>
        <input type="text" id="settings-endpoint" readonly placeholder="Loading..." />
      </div>
      <div class="settings-field-row">
        <label>WireGuard Public Key</label>
        <input type="text" id="settings-pubkey" placeholder="Server public key..." />
      </div>
      <div class="settings-field-row">
        <label>Allowed IPs</label>
        <input type="text" id="settings-allowedips" placeholder="192.168.8.0/24, 192.168.1.0/24" />
      </div>
      <div class="settings-field-row">
        <label>Local LAN IP (split-horizon — leave blank to disable)</label>
        <input type="text" id="settings-localip" placeholder="e.g. 192.168.1.1 — served to clients on the same WAN IP" />
      </div>
      <div class="settings-field-row">
        <label>Min Client Version (bump to force update)</label>
        <input type="text" id="settings-minversion" placeholder="e.g. 1.1.0" />
      </div>
      <button class="btn-primary" onclick="saveSettings()">Save Settings</button>
    </div>

    <!-- Game Servers -->
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>Game Servers</span>
        <a href="https://gamez.looknet.ca" target="_blank" style="font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--muted);letter-spacing:1px;text-decoration:none;border:1px solid var(--border);padding:3px 10px;border-radius:2px;" onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">PTERODACTYL ↗</a>
      </div>
      <div id="server-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;">
        <div class="empty-state">Loading servers...</div>
      </div>
    </div>

    <!-- Error Reports -->
    <div class="card" id="reports-card">
      <div class="card-title">Error Reports</div>
      <div id="reports-container"><div class="empty-state">No reports yet.</div></div>
    </div>

  </div>
</div>

<div id="toast"></div>

<script>
  let adminPassword = '';
  let _refreshTimer = null;

  function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show' + (type ? ' ' + type : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.className = '', 3000);
  }

  function timeAgo(isoStr) {
    const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (diff < 60) return diff + 's ago';
    return Math.floor(diff / 60) + 'm ago';
  }

  async function login() {
    adminPassword = document.getElementById('admin-password').value;
    const [tokRes, onlineRes] = await Promise.all([
      fetch('/admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      }),
      fetch('/admin/online', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      })
    ]);

    if (tokRes.ok) {
      const authData = { password: adminPassword, timestamp: Date.now() };
      localStorage.setItem('adminAuth', JSON.stringify(authData));
      document.getElementById('auth-gate').style.display = 'none';
      document.getElementById('main-panel').style.display = 'block';

      const tokens = await tokRes.json();
      const online = onlineRes.ok ? await onlineRes.json() : [];

      updateStats(tokens, online);
      renderOnlineRoster(online);
      renderTokenList(tokens, new Set(online.map(p => p.name)));
      loadMotd();
      loadServerConfig();
      loadAlertStatus();
      loadReports();
      loadServers();

      // Auto-refresh every 15 seconds
      _refreshTimer = setInterval(() => refreshAll(), 15000);
      setInterval(() => loadServers(), 30000);
    } else {
      localStorage.removeItem('adminAuth');
      toast('Invalid password', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const authDataJSON = localStorage.getItem('adminAuth');
    if (authDataJSON) {
      try {
        const authData = JSON.parse(authDataJSON);
        const timeout = 60 * 60 * 1000; // 1 hour
        if (Date.now() - authData.timestamp < timeout) {
          document.getElementById('admin-password').value = authData.password;
          login();
        } else {
          localStorage.removeItem('adminAuth');
        }
      } catch (e) {
        localStorage.removeItem('adminAuth');
      }
    }
    // Clean up old key just in case
    localStorage.removeItem('adminPassword');
  });

  document.getElementById('admin-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') login();
  });

  async function refreshAll() {
    try {
      const [tokRes, onlineRes] = await Promise.all([
        fetch('/admin/tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: adminPassword })
        }),
        fetch('/admin/online', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: adminPassword })
        })
      ]);
      if (!tokRes.ok) return;
      const tokens = await tokRes.json();
      const online = onlineRes.ok ? await onlineRes.json() : [];
      updateStats(tokens, online);
      renderOnlineRoster(online);
      renderTokenList(tokens, new Set(online.map(p => p.name)));
      loadReports();
    } catch {}
  }

  function updateStats(tokens, online) {
    const redeemed = tokens.filter(t => t.redeemed).length;
    const pending = tokens.filter(t => !t.redeemed).length;
    document.getElementById('stat-redeemed').textContent = redeemed;
    document.getElementById('stat-online').textContent = online.length;
    document.getElementById('stat-pending').textContent = pending;
  }

  function renderOnlineRoster(online) {
    const container = document.getElementById('online-roster');
    if (!online.length) {
      container.innerHTML = '<div class="online-empty">&#9675; No players currently connected</div>';
      return;
    }
    container.innerHTML = online.map(p => \`
      <div class="online-tile\${p.hidden ? ' hidden-player' : ''}">
        <div class="online-tile-dot"></div>
        <div class="online-tile-name">\${p.name}</div>
        <div class="online-tile-hidden-badge">\${p.hidden ? '[HIDDEN]' : ''}</div>
        <div class="online-tile-game">\${p.game || ''}</div>
        <div class="online-tile-ip">\${p.vpn_ip}</div>
        <div class="online-tile-ago">\${timeAgo(p.last_seen)}</div>
      </div>
    \`).join('');
  }

  function renderTokenList(tokens, onlineSet) {
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
            <th>DATE</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          \${tokens.map(t => \`
            <tr>
              <td>
                <span class="token-code">\${t.token}</span>
                <button class="btn-icon" style="margin-left:6px;" onclick="copyToken('\${t.token}')">copy</button>
              </td>
              <td>
                \${t.name}
                \${t.redeemed && onlineSet.has(t.name) ? '<span class="online-pill"><span class="online-pill-dot"></span>ONLINE</span>' : ''}
              </td>
              <td><span style="font-family: 'Share Tech Mono', monospace; font-size: 12px;">\${t.client_ip}</span></td>
              <td><span class="badge \${t.redeemed ? 'badge-redeemed' : 'badge-pending'}">\${t.redeemed ? 'REDEEMED' : 'PENDING'}</span></td>
              <td style="color: #4a6080; font-size: 12px; font-family: 'Share Tech Mono', monospace;">
                \${t.redeemed && t.redeemed_at ? new Date(t.redeemed_at).toLocaleDateString() : new Date(t.created_at).toLocaleDateString()}
              </td>
              <td style="white-space: nowrap;">
                <button class="btn-danger" onclick="revokeToken('\${t.token}')">Revoke</button>
                <button class="btn-hidden-toggle\${t.hidden ? ' is-hidden' : ''}" onclick="toggleHidden('\${t.token}', '\${t.name}')">\${t.hidden ? 'HIDDEN' : 'VISIBLE'}</button>
              </td>
            </tr>
          \`).join('')}
        </tbody>
      </table>
    \`;
  }

  function copyToken(token) {
    navigator.clipboard.writeText(token).then(() => {
      toast('Token copied!', 'success');
    }).catch(() => {
      const inp = document.createElement('input');
      inp.value = token;
      document.body.appendChild(inp);
      inp.select();
      document.execCommand('copy');
      document.body.removeChild(inp);
      toast('Token copied!', 'success');
    });
  }

  // --- UPDATED WIREGUARD KEY GENERATOR ---
  function generateWGKeys() {
    try {
      if (typeof nacl === 'undefined') {
        throw new Error("Encryption library not loaded. Check internet connection.");
      }
      
      const keyPair = nacl.box.keyPair();
      const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
      
      const priv = toB64(keyPair.secretKey);
      const pub  = toB64(keyPair.publicKey);
      
      document.getElementById('new-privkey').value = priv;
      document.getElementById('pubkey-display').textContent = pub;
      document.getElementById('pubkey-box').style.display = 'block';
      
      toast('Keys generated — copy the public key to UDM Pro first!', 'success');
    } catch (e) {
      console.error('Key generation failed:', e);
      toast('Key generation failed: ' + e.message, 'error');
    }
  }

  function copyPubKey() {
    const key = document.getElementById('pubkey-display').textContent;
    navigator.clipboard.writeText(key).then(() => toast('Public key copied!', 'success')).catch(() => toast('Copy failed', 'error'));
  }

  async function createToken() {
    const name = document.getElementById('new-name').value.trim();
    const ip = document.getElementById('new-ip').value.trim();
    const privkey = document.getElementById('new-privkey').value.trim();

    if (!name || !ip || !privkey) { toast('All fields required', 'error'); return; }

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
      document.getElementById('pubkey-box').style.display = 'none';
      document.getElementById('pubkey-display').textContent = '';
      toast('Token created!', 'success');
      refreshAll();
    } else {
      toast(data.error || 'Failed to create token', 'error');
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
    refreshAll();
  }

  async function loadMotd() {
    try {
      const res = await fetch('/api/motd');
      const data = await res.json();
      const val = data.message || '';
      document.getElementById('motd-input').value = val;
      updateMotdCounter();
    } catch {}
  }

  function updateMotdCounter() {
    const inp = document.getElementById('motd-input');
    const counter = document.getElementById('motd-counter');
    const len = inp.value.length;
    counter.textContent = len + ' / 120';
    counter.className = 'char-counter' + (len > 100 ? ' warn' : '');
  }

  async function setMotd() {
    const message = document.getElementById('motd-input').value.trim();
    const res = await fetch('/admin/motd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, message })
    });
    const data = await res.json();
    if (res.ok) toast('MOTD updated!', 'success');
    else toast(data.error || 'Failed to update MOTD', 'error');
  }

  async function clearMotd() {
    document.getElementById('motd-input').value = '';
    updateMotdCounter();
    const res = await fetch('/admin/motd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, message: '' })
    });
    if (res.ok) toast('MOTD cleared');
  }

  async function loadServerConfig() {
    try {
      const res = await fetch('/api/server-config');
      const data = await res.json();
      // Extract just the IP from "ip:port"
      const ip = data.endpoint ? data.endpoint.split(':')[0] : '—';
      document.getElementById('header-server-ip').textContent = 'SERVER IP: ' + ip;
      document.getElementById('stat-endpoint').textContent = data.endpoint || '—';
      document.getElementById('settings-endpoint').value = ip;
      document.getElementById('settings-pubkey').value = data.publicKey || '';
      document.getElementById('settings-allowedips').value = data.allowedIPs || '';
      document.getElementById('settings-localip').value = data.localIp || '';
      try {
        const vres = await fetch('/api/version');
        const vdata = await vres.json();
        document.getElementById('settings-minversion').value = vdata.min_version || '';
      } catch {}
    } catch {}
  }

  async function saveSettings() {
    const public_key = document.getElementById('settings-pubkey').value.trim();
    const allowed_ips = document.getElementById('settings-allowedips').value.trim();
    const local_ip = document.getElementById('settings-localip').value.trim();
    const min_version = document.getElementById('settings-minversion').value.trim();
    const res = await fetch('/admin/settings/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, public_key, allowed_ips, local_ip, min_version })
    });
    const data = await res.json();
    if (res.ok) { toast('Settings saved!', 'success'); loadServerConfig(); }
    else toast(data.error || 'Failed to save settings', 'error');
  }

  // ── Hidden toggle ────────────────────────────────────────────────────────
  async function toggleHidden(token, name) {
    const res = await fetch('/admin/token/toggle-hidden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, token })
    });
    const data = await res.json();
    if (res.ok) {
      toast(\`\${name} is now \${data.hidden ? 'hidden' : 'visible'}\`);
      refreshAll();
    } else toast(data.error || 'Failed', true);
  }

  // ── Push Alert ───────────────────────────────────────────────────────────
  let alertType = 'info';
  let alertDuration = 15;

  function selectAlertType(type) {
    alertType = type;
    document.querySelectorAll('.alert-type-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector(\`.alert-type-btn[data-type="\${type}"]\`).classList.add('selected');
  }

  function selectAlertDuration(mins) {
    alertDuration = mins;
    document.querySelectorAll('.alert-dur-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector(\`.alert-dur-btn[data-mins="\${mins}"]\`).classList.add('selected');
  }

  async function pushAlert() {
    const message = document.getElementById('alert-message').value.trim();
    if (!message) { toast('Enter a message', true); return; }
    const res = await fetch('/admin/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, message, type: alertType, duration_minutes: alertDuration })
    });
    const data = await res.json();
    if (res.ok) { toast('Alert pushed!'); document.getElementById('alert-message').value = ''; loadAlertStatus(); }
    else toast(data.error || 'Failed', true);
  }

  async function clearAlert() {
    await fetch('/admin/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, message: '', duration_minutes: 0 })
    });
    toast('Alert cleared');
    loadAlertStatus();
  }

  async function loadAlertStatus() {
    const res = await fetch('/api/alert');
    const data = await res.json();
    const el = document.getElementById('current-alert-status');
    if (data.alert) {
      const exp = new Date(data.alert.expires_at);
      el.innerHTML = \`<span style="color:var(--warn)">[[\${data.alert.type.toUpperCase()}]]</span> \${data.alert.message} <span style="color:var(--muted)">· expires \${exp.toLocaleTimeString()}</span>\`;
      el.style.color = '';
    } else {
      el.textContent = 'No active alert';
      el.style.color = 'var(--muted)';
    }
  }

  // ── Error Reports ────────────────────────────────────────────────────────
  async function loadReports() {
    const res = await fetch('/admin/reports', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({password: adminPassword})
    });
    if (!res.ok) return;
    const reports = await res.json();
    renderReports(reports);
  }

  function renderReports(reports) {
    const container = document.getElementById('reports-container');
    const badge = document.getElementById('report-badge');
    const countEl = document.getElementById('report-count');
    const pluralEl = document.getElementById('report-plural');

    const unread = reports.filter(r => !r.read).length;
    if (unread > 0) {
      badge.style.display = 'inline-block';
      countEl.textContent = unread;
      pluralEl.textContent = unread === 1 ? '' : 'S';
      badge.onclick = () => document.getElementById('reports-card').scrollIntoView({behavior: 'smooth'});
    } else {
      badge.style.display = 'none';
    }

    if (!reports.length) {
      container.innerHTML = '<div class="empty-state">No reports yet.</div>';
      return;
    }

    container.innerHTML = reports.map(r => \`
      <div class="report-item \${r.read ? 'read' : ''}" id="ri-\${r.id}">
        <div class="report-header">
          <span class="report-player">\${r.player} <span style="font-size:12px;color:var(--muted);font-family:'Share Tech Mono',monospace">\${r.vpn_ip}</span></span>
          <span class="report-time">\${new Date(r.timestamp).toLocaleString()}</span>
        </div>
        <div class="report-error">\${r.error_message}</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="toggle-log-btn" onclick="toggleLog('\${r.id}')">Show Log</button>
          \${!r.read ? \`<button class="toggle-log-btn" onclick="markRead('\${r.id}')">Mark Read</button>\` : '<span style="font-size:11px;color:var(--muted);font-family:\\'Share Tech Mono\\',monospace">READ</span>'}
        </div>
        <div class="report-log" id="log-\${r.id}">\${r.log_tail || ''}</div>
      </div>
    \`).join('');
  }

  function toggleLog(id) {
    const el = document.getElementById(\`log-\${id}\`);
    const btn = el.previousElementSibling.querySelector('.toggle-log-btn');
    const visible = el.style.display === 'block';
    el.style.display = visible ? 'none' : 'block';
    btn.textContent = visible ? 'Show Log' : 'Hide Log';
  }

  async function markRead(id) {
    await fetch('/admin/report/read', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({password: adminPassword, id})
    });
    const item = document.getElementById(\`ri-\${id}\`);
    if (item) item.classList.add('read');
    loadReports();
  }

  // ── Game Servers ──────────────────────────────────────────────────────────
  function fmtMem(mb) {
    return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GiB' : mb + ' MiB';
  }
  function fmtUptime(s) {
    if (!s) return '—';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + 'h ' + m + 'm' : m + 'm';
  }

  async function loadServers() {
    const res = await fetch('/api/servers');
    if (!res.ok) return;
    const servers = await res.json();
    renderServers(servers);
  }

  function renderServers(servers) {
    const grid = document.getElementById('server-grid');
    grid.innerHTML = servers.map(s => {
      const cls = ['running','starting','stopping'].includes(s.state) ? s.state : 'offline';
      const isRunning = s.state === 'running';
      const isOff = s.state === 'offline';
      return \`
        <div class="server-card state-\${cls}">
          <div class="server-card-header">
            <div class="server-state-dot \${cls}"></div>
            <div class="server-name">\${s.name}</div>
            <div class="server-state-label \${cls}">\${s.state}</div>
          </div>
          \${isRunning ? \`
          <div class="server-stats">
            <div class="server-stat">CPU <span>\${s.cpu}%</span></div>
            <div class="server-stat">RAM <span>\${fmtMem(s.memory_mb)}</span></div>
            <div class="server-stat">UP <span>\${fmtUptime(s.uptime)}</span></div>
          </div>
          \${s.port ? \`<div class="server-connect">\${s.host}:\${s.port}</div>\` : ''}\` : ''}
          <div class="server-actions">
            \${isOff ? \`<button class="btn-server btn-server-start" onclick="serverPower('\${s.id}','start')">Start</button>\` : ''}
            \${isRunning ? \`<button class="btn-server btn-server-restart" onclick="serverPower('\${s.id}','restart')">Restart</button>\` : ''}
            \${!isOff ? \`<button class="btn-server btn-server-stop" onclick="serverPower('\${s.id}','stop')">Stop</button>\` : ''}
          </div>
        </div>
      \`;
    }).join('');
  }

  async function serverPower(server_id, signal) {
    const res = await fetch('/admin/servers/power', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ password: adminPassword, server_id, signal })
    });
    const data = await res.json();
    if (res.ok) {
      toast(\`\${signal.charAt(0).toUpperCase() + signal.slice(1)} signal sent\`, 'success');
      setTimeout(loadServers, 3000); // give Pterodactyl a moment then refresh
    } else {
      toast(data.error || 'Failed', 'error');
    }
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

async function handleVersion(_request, env) {
  const min_version = await env.GAMENET_KV.get('MIN_VERSION') || "1.0.0";
  return jsonResponse({ min_version });
}

async function handleServerConfig(request, env) {
  const wanIp    = await env.GAMENET_KV.get('SERVER_ENDPOINT_IP') || "184.66.15.159";
  const localIp  = await env.GAMENET_KV.get('SERVER_LOCAL_IP')    || "";
  const publicKey  = await env.GAMENET_KV.get('SERVER_PUBLIC_KEY')  || "SLG8saonFoQ+B8x59SBeHCXouLTpVhyEYPqiUZoGqgI=";
  const allowedIPs = await env.GAMENET_KV.get('SERVER_ALLOWED_IPS') || "192.168.8.0/24, 192.168.30.0/24";

  // Split-horizon: if the client's WAN IP matches the server's WAN IP they're
  // behind the same router. Serve the LAN IP so WireGuard doesn't hairpin.
  const clientIp = request.headers.get('CF-Connecting-IP') || '';
  const endpointIp = (localIp && clientIp === wanIp) ? localIp : wanIp;

  return jsonResponse({
    endpoint:   `${endpointIp}:51820`,
    publicKey:  publicKey,
    allowedIPs: allowedIPs,
    publicIp:   wanIp,
    localIp:    localIp
  });
}

// ─── Presence Handlers ───────────────────────────────────────────────────────

async function handleHeartbeat(request, env) {
  const body = await request.json().catch(() => ({}));
  const { name, vpn_ip, disconnecting, game } = body;

  if (!name) return jsonResponse({ error: 'name required' }, 400);

  const raw = await env.GAMENET_KV.get('ONLINE_PLAYERS');
  const players = raw ? JSON.parse(raw) : {};

  if (disconnecting) {
    delete players[name];
  } else {
    players[name] = { name, vpn_ip: vpn_ip || '', last_seen: new Date().toISOString(), game: game || null };
  }

  await env.GAMENET_KV.put('ONLINE_PLAYERS', JSON.stringify(players));
  return jsonResponse({ success: true });
}

async function handleOnline(request, env) {
  const raw = await env.GAMENET_KV.get('ONLINE_PLAYERS');
  const players = raw ? JSON.parse(raw) : {};

  const hiddenRaw = await env.GAMENET_KV.get('HIDDEN_PLAYERS');
  const hidden = new Set(hiddenRaw ? JSON.parse(hiddenRaw) : []);

  const cutoff = Date.now() - 90 * 1000;
  const online = Object.values(players)
    .filter(p => new Date(p.last_seen).getTime() > cutoff)
    .filter(p => !hidden.has(p.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => ({ name: p.name, vpn_ip: p.vpn_ip, last_seen: p.last_seen, game: p.game || null }));

  return jsonResponse(online);
}

// Admin-only view — no hidden filter, shows all players with recent heartbeats
async function handleAdminOnline(request, env) {
  const { authed } = await requireAdmin(request, env);
  if (!authed) return jsonResponse({ error: 'Unauthorized' }, 401);

  const raw = await env.GAMENET_KV.get('ONLINE_PLAYERS');
  const players = raw ? JSON.parse(raw) : {};

  const hiddenRaw = await env.GAMENET_KV.get('HIDDEN_PLAYERS');
  const hidden = new Set(hiddenRaw ? JSON.parse(hiddenRaw) : []);

  const cutoff = Date.now() - 90 * 1000;
  const online = Object.values(players)
    .filter(p => new Date(p.last_seen).getTime() > cutoff)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => ({ name: p.name, vpn_ip: p.vpn_ip, last_seen: p.last_seen, hidden: hidden.has(p.name), game: p.game || null }));

  return jsonResponse(online);
}

async function handleAdminTokenToggleHidden(request, env) {
  const { authed, body } = await requireAdmin(request, env);
  if (!authed) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { token } = body;
  if (!token) return jsonResponse({ error: 'Token required' }, 400);

  const raw = await env.GAMENET_KV.get(`token:${token}`);
  if (!raw) return jsonResponse({ error: 'Token not found' }, 404);

  const record = JSON.parse(raw);
  record.hidden = !record.hidden;
  await env.GAMENET_KV.put(`token:${token}`, JSON.stringify(record));

  // Update HIDDEN_PLAYERS array
  const hiddenRaw = await env.GAMENET_KV.get('HIDDEN_PLAYERS');
  let hiddenList = hiddenRaw ? JSON.parse(hiddenRaw) : [];
  if (record.hidden) {
    if (!hiddenList.includes(record.name)) hiddenList.push(record.name);
  } else {
    hiddenList = hiddenList.filter(n => n !== record.name);
  }
  await env.GAMENET_KV.put('HIDDEN_PLAYERS', JSON.stringify(hiddenList));

  return jsonResponse({ success: true, hidden: record.hidden, name: record.name });
}

async function handleAlert(request, env) {
  const raw = await env.GAMENET_KV.get('ACTIVE_ALERT');
  if (!raw) return jsonResponse({ alert: null });

  const alert = JSON.parse(raw);
  if (new Date(alert.expires_at).getTime() < Date.now()) {
    await env.GAMENET_KV.delete('ACTIVE_ALERT');
    return jsonResponse({ alert: null });
  }

  return jsonResponse({ alert });
}

async function handleAdminPushAlert(request, env) {
  const { authed, body } = await requireAdmin(request, env);
  if (!authed) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { message, type, duration_minutes } = body;

  if (!duration_minutes || duration_minutes === 0) {
    await env.GAMENET_KV.delete('ACTIVE_ALERT');
    return jsonResponse({ success: true, cleared: true });
  }

  const alert = {
    id: 'alert_' + Date.now(),
    message: message || '',
    type: type || 'info',
    expires_at: new Date(Date.now() + duration_minutes * 60000).toISOString()
  };

  await env.GAMENET_KV.put('ACTIVE_ALERT', JSON.stringify(alert));
  return jsonResponse({ success: true, alert });
}

// ─── Admin Settings Save ─────────────────────────────────────────────────────

async function handleAdminSettingsSave(request, env) {
  const { authed, body } = await requireAdmin(request, env);
  if (!authed) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { public_key, allowed_ips, local_ip, min_version } = body;
  
  if (public_key !== undefined && public_key.trim()) {
    await env.GAMENET_KV.put('SERVER_PUBLIC_KEY', public_key.trim());
  }
  if (allowed_ips !== undefined && allowed_ips.trim()) {
    await env.GAMENET_KV.put('SERVER_ALLOWED_IPS', allowed_ips.trim());
  }
  if (local_ip !== undefined) {
    if (local_ip.trim()) {
      await env.GAMENET_KV.put('SERVER_LOCAL_IP', local_ip.trim());
    } else {
      await env.GAMENET_KV.delete('SERVER_LOCAL_IP');
    }
  }
  if (min_version !== undefined && min_version.trim()) {
    await env.GAMENET_KV.put('MIN_VERSION', min_version.trim());
  }

  return jsonResponse({ success: true });
}

// ─── Client API Handlers ─────────────────────────────────────────────────────

async function handleRedeem(request, env) {
  const body = await request.json().catch(() => ({}));
  const { token } = body;

  if (!token) return jsonResponse({ error: 'Token required' }, 400);

  const raw = await env.GAMENET_KV.get(`token:${token}`);
  if (!raw) return jsonResponse({ error: 'Invalid or expired token' }, 404);

  const record = JSON.parse(raw);

  if (record.redeemed) {
    return jsonResponse({ error: 'Token already redeemed. Contact the admin for a new token.' }, 409);
  }

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

async function handleMotd(request, env) {
  const message = await env.GAMENET_KV.get('MOTD_MESSAGE') || '';
  return jsonResponse({ message });
}

async function handleAdminSetMotd(request, env) {
  const { authed, body } = await requireAdmin(request, env);
  if (!authed) return jsonResponse({ error: 'Unauthorized' }, 401);
  const message = (body.message || '').trim();
  if (message) {
    await env.GAMENET_KV.put('MOTD_MESSAGE', message);
  } else {
    await env.GAMENET_KV.delete('MOTD_MESSAGE');
  }
  return jsonResponse({ success: true });
}

async function handleInstall(request, env) {
  const script = `
# GamezNET Installer
$ErrorActionPreference = 'Continue'
$repo = "https://raw.githubusercontent.com/natelook1/gameznet/main"
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
Write-Host "  / ___| __ _ _ __ ___   ___   __ _| \\| | ____|_   _|" -ForegroundColor Cyan
Write-Host " | |  _ / _' | '_ ' _ \\ / _ \\ / _' |  \\| |  _|   | |  " -ForegroundColor Cyan
Write-Host " | |_| | (_| | | | | | |  __/| (_| | |\\  | |___  | |  " -ForegroundColor Cyan
Write-Host "  \\____|\\__,_|_| |_| |_|\\___| \\__,_|_| \\_|_____| |_|  " -ForegroundColor Cyan
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
New-Item -ItemType Directory -Force -Path "$installDir\\templates" | Out-Null
New-Item -ItemType Directory -Force -Path "$installDir\\static" | Out-Null
Write-OK "Install directory initialized"

Write-Step 2 5 "Downloading GamezNET"
$files = @(
    @{ url = "$repo/app.py";               dest = "$installDir\\app.py" },
    @{ url = "$repo/GamezNET.bat";         dest = "$installDir\\GamezNET.bat" },
    @{ url = "$repo/templates/index.html"; dest = "$installDir\\templates\\index.html" },
    @{ url = "$repo/static/favicon.svg";   dest = "$installDir\\static\\favicon.svg" }
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
& $pythonCmd -m pip install flask pystray pillow psutil --quiet
Write-OK "Environment configured"

Write-Step 4 5 "Validating VPN Engine"
$wgExe = "C:\\Program Files\\WireGuard\\wireguard.exe"
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
$startMenu = Join-Path ([System.Environment]::GetFolderPath("StartMenu")) "Programs"
$s2 = $ws.CreateShortcut((Join-Path $startMenu "GamezNET.lnk"))
$s2.TargetPath = Join-Path $installDir "GamezNET.bat"
$s2.WorkingDirectory = $installDir
$s2.Save()
Write-OK "Start Menu shortcut created"

Write-Host ""
Write-Host "  --------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  INSTALLATION COMPLETE" -BackgroundColor DarkGreen -ForegroundColor White
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "   1. Double-click GamezNET on your desktop" -ForegroundColor Gray
Write-Host "   2. Enter the invite token sent to you" -ForegroundColor Gray
Write-Host "   3. Click Connect - you are in!" -ForegroundColor Gray
Write-Host ""
Write-Host "  Launching GamezNET..." -ForegroundColor DarkCyan

Start-Process -FilePath (Join-Path $installDir "GamezNET.bat")
Write-Host "  Press any key to close this window." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
`;

  return new Response(script, {
    headers: {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// ─── Error Report Handlers ───────────────────────────────────────────────────

async function handleReport(request, env) {
  const body = await request.json().catch(() => ({}));
  const { player, vpn_ip, error_message, log_tail } = body;
  if (!player || !error_message) return jsonResponse({ error: 'Missing fields' }, 400);

  const id = `report_${Date.now()}`;
  const record = {
    id,
    player: player || 'Unknown',
    vpn_ip: vpn_ip || '',
    error_message,
    log_tail: (log_tail || '').slice(-8000), // cap at 8KB
    timestamp: new Date().toISOString(),
    read: false
  };

  await env.GAMENET_KV.put(`report:${id}`, JSON.stringify(record));

  const indexRaw = await env.GAMENET_KV.get('report_index');
  const index = indexRaw ? JSON.parse(indexRaw) : [];
  index.unshift(id); // newest first
  // Keep only last 50 reports
  if (index.length > 50) index.length = 50;
  await env.GAMENET_KV.put('report_index', JSON.stringify(index));

  // Optional email via Resend API (set RESEND_API_KEY secret in Cloudflare dashboard)
  if (env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'GamezNET <onboarding@resend.dev>',
          to: ['admin@looknet.ca'],
          subject: `GamezNET Error Report — ${player}`,
          text: `Player: ${player}\nVPN IP: ${vpn_ip}\nTime: ${record.timestamp}\nError: ${error_message}\n\n--- LOG TAIL ---\n${log_tail}`
        })
      });
    } catch (_) { /* email failure is non-fatal */ }
  }

  return jsonResponse({ success: true, id });
}

async function handleAdminReports(request, env) {
  const { authed } = await requireAdmin(request, env);
  if (!authed) return jsonResponse({ error: 'Unauthorized' }, 401);

  const indexRaw = await env.GAMENET_KV.get('report_index');
  const index = indexRaw ? JSON.parse(indexRaw) : [];

  const reports = await Promise.all(
    index.map(async id => {
      const raw = await env.GAMENET_KV.get(`report:${id}`);
      return raw ? JSON.parse(raw) : null;
    })
  );

  return jsonResponse(reports.filter(Boolean));
}

// ─── Pterodactyl Handlers ────────────────────────────────────────────────────

const PTERO_URL = 'https://gamez.looknet.ca';
const PTERO_SERVERS = [
  { id: '548e8790', name: 'Satisfactory' },
  { id: 'f8633b6b', name: 'SCUM' },
  { id: '3919b863', name: 'Enshrouded' },
  { id: '7540df7a', name: 'Conan Exiles' },
  { id: '80c1c084', name: 'Project Zomboid' },
];

async function fetchPteroServers(env) {
  const results = await Promise.all(PTERO_SERVERS.map(async (s) => {
    try {
      const [resourcesRes, detailsRes] = await Promise.all([
        fetch(`${PTERO_URL}/api/client/servers/${s.id}/resources`, {
          headers: { 'Authorization': `Bearer ${env.PTERODACTYL_API_KEY}`, 'Accept': 'application/json' }
        }),
        fetch(`${PTERO_URL}/api/client/servers/${s.id}`, {
          headers: { 'Authorization': `Bearer ${env.PTERODACTYL_API_KEY}`, 'Accept': 'application/json' }
        })
      ]);
      const data = await resourcesRes.json();
      const details = await detailsRes.json();
      const attrs = data.attributes || {};
      const resources = attrs.resources || {};
      const allocations = details.attributes?.relationships?.allocations?.data || [];
      const defaultAlloc = allocations.find(a => a.attributes?.is_default) || allocations[0];
      const port = defaultAlloc?.attributes?.port || null;
      return {
        id: s.id,
        name: s.name,
        state: attrs.current_state || 'unknown',
        cpu: Math.round((resources.cpu_absolute || 0) * 10) / 10,
        memory_mb: Math.round((resources.memory_bytes || 0) / 1048576),
        disk_mb: Math.round((resources.disk_bytes || 0) / 1048576),
        uptime: resources.uptime || 0,
        port: port,
        host: '192.168.30.58',
      };
    } catch (e) {
      return { id: s.id, name: s.name, state: 'unknown', cpu: 0, memory_mb: 0, disk_mb: 0, uptime: 0, port: null, host: '192.168.30.58' };
    }
  }));
  return results;
}

async function handleServers(request, env) {
  // Serve from cache if fresh
  const cached = await env.GAMENET_KV.get('PTERO_SERVER_CACHE');
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < 30000) return jsonResponse(data);
  }

  const results = await fetchPteroServers(env);
  await env.GAMENET_KV.put('PTERO_SERVER_CACHE', JSON.stringify({ data: results, timestamp: Date.now() }));
  return jsonResponse(results);
}

async function handleAdminServerPower(request, env) {
  const { authed, body } = await requireAdmin(request, env);
  if (!authed) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { server_id, signal } = body;
  if (!server_id || !signal) return jsonResponse({ error: 'server_id and signal required' }, 400);
  if (!['start', 'stop', 'restart'].includes(signal)) return jsonResponse({ error: 'Invalid signal' }, 400);

  const valid = PTERO_SERVERS.some(s => s.id === server_id);
  if (!valid) return jsonResponse({ error: 'Unknown server' }, 404);

  const res = await fetch(`${PTERO_URL}/api/client/servers/${server_id}/power`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.PTERODACTYL_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ signal })
  });

  // Bust cache so next poll reflects the new state
  await env.GAMENET_KV.delete('PTERO_SERVER_CACHE');
  return jsonResponse({ success: res.ok });
}

async function handleAdminMarkReportRead(request, env) {
  const { authed, body } = await requireAdmin(request, env);
  if (!authed) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { id } = body;
  if (!id) return jsonResponse({ error: 'id required' }, 400);

  const raw = await env.GAMENET_KV.get(`report:${id}`);
  if (!raw) return jsonResponse({ error: 'Not found' }, 404);

  const record = JSON.parse(raw);
  record.read = true;
  await env.GAMENET_KV.put(`report:${id}`, JSON.stringify(record));
  return jsonResponse({ success: true });
}

// ─── Main Router ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Normalize the path (removes trailing slashes like /admin/ -> /admin)
    const path = url.pathname.replace(/\/$/, '') || '/';
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

    // 1. Redirect root URL directly to the admin panel
    if (path === '/' && method === 'GET') {
      return Response.redirect(`${url.origin}/admin`, 302);
    }

    // 2. Suppress 404 errors for browser favicon requests
    if (path === '/favicon.ico' || path === '/static/favicon.svg') {
      return new Response(null, { status: 204 }); 
    }

    if (path === '/admin' && method === 'GET') return htmlResponse(adminHTML());
    if (path === '/admin/update-ip') return handleUpdateIP(request, env);
    if (path === '/api/server-config') return handleServerConfig(request, env);
    if (path === '/api/version' && method === 'GET') return handleVersion(request, env);
    if (path === '/admin/token/create' && method === 'POST') return handleAdminTokenCreate(request, env);
    if (path === '/admin/token/revoke' && method === 'POST') return handleAdminTokenRevoke(request, env);
    if (path === '/admin/token/toggle-hidden' && method === 'POST') return handleAdminTokenToggleHidden(request, env);
    if (path === '/admin/tokens' && method === 'POST') return handleAdminTokenList(request, env);
    if (path === '/api/redeem' && method === 'POST') return handleRedeem(request, env);
    if (path === '/api/status' && method === 'GET') return jsonResponse({ online: true });
    if (path === '/api/motd' && method === 'GET') return handleMotd(request, env);
    if (path === '/admin/motd' && method === 'POST') return handleAdminSetMotd(request, env);
    if (path === '/api/heartbeat' && method === 'POST') return handleHeartbeat(request, env);
    if (path === '/api/online' && method === 'GET') return handleOnline(request, env);
    if (path === '/admin/online' && method === 'POST') return handleAdminOnline(request, env);
    if (path === '/api/alert' && method === 'GET') return handleAlert(request, env);
    if (path === '/admin/alert' && method === 'POST') return handleAdminPushAlert(request, env);
    if (path === '/admin/settings/save' && method === 'POST') return handleAdminSettingsSave(request, env);
    if (path === '/install' && method === 'GET') return handleInstall(request, env);
    if (path === '/api/report' && method === 'POST') return handleReport(request, env);
    if (path === '/admin/reports' && method === 'POST') return handleAdminReports(request, env);
    if (path === '/admin/report/read' && method === 'POST') return handleAdminMarkReportRead(request, env);
    if (path === '/api/servers' && method === 'GET') return handleServers(request, env);
    if (path === '/admin/servers/power' && method === 'POST') return handleAdminServerPower(request, env);

    return new Response('Not found', { status: 404 });
  }
};