# GameNet - Setup & Deployment Guide

```
GameNet/
├── worker.js          ← Cloudflare Worker (deploy this first)
├── wrangler.toml      ← Worker config
├── app.py             ← Local Flask server (runs on user's PC)
├── templates/
│   └── index.html     ← Web UI (served by Flask)
├── setup.bat          ← One-time installer (users run this)
├── GameNet.bat        ← Daily launcher (users run this)
└── README.md
```

---

## Step 1 — Deploy the Cloudflare Worker

You need Node.js installed. Then:

```bash
npm install -g wrangler
wrangler login
```

### Create the KV namespace
```bash
wrangler kv:namespace create GAMENET_KV
```
Copy the `id` it outputs into `wrangler.toml` replacing `YOUR_KV_NAMESPACE_ID`.

### Set your admin password (stored as a secret, never in code)
```bash
wrangler secret put ADMIN_PASSWORD
# Enter your chosen password when prompted
```

### Deploy
```bash
wrangler deploy
```

Your Worker will be live at:
`https://gamenet.YOUR-SUBDOMAIN.workers.dev`

**Update `app.py`** — find this line near the top and replace it:
```python
WORKER_URL = "https://gamenet.YOUR-SUBDOMAIN.workers.dev"
```

---

## Step 2 — Configure Your Server Settings

In `app.py`, update these constants to match your UDM Pro setup:

```python
SERVER_PUBLIC_KEY = "YOUR_SERVER_PUBLIC_KEY"
SERVER_ENDPOINT   = "YOUR.PUBLIC.IP:51820"
ALLOWED_IPS       = "192.168.8.0/24, 192.168.1.0/24"
```

---

## Step 3 — Prepare the Client Package

The folder you send to users should contain:
```
GameNet/
├── app.py
├── templates/
│   └── index.html
├── setup.bat          ← They run this FIRST
└── GameNet.bat        ← They run this DAILY
```

Zip it up and share via Google Drive, Discord, etc.

**Note:** `wireguard.exe` does NOT need to be included — `setup.bat` downloads and installs WireGuard automatically if it's missing.

---

## Step 4 — Provisioning a New Player (Your Admin Workflow)

1. **Generate a WireGuard keypair for them** on your UDM Pro, or use:
   ```bash
   wg genkey | tee privkey | wg pubkey > pubkey
   ```
   Add the public key as a peer on your UDM Pro with their assigned IP.

2. **Open the Admin Panel:**
   ```
   https://gamenet.YOUR-SUBDOMAIN.workers.dev/admin
   ```

3. **Fill in:**
   - Player name (e.g. "Dave")
   - Their assigned VPN IP (e.g. `192.168.8.3/32`)
   - Their private key

4. **Copy the generated token** (format: `XXXX-XXXX-XXXX-XXXX`) and send it to them.

5. They enter it in the app on first launch — done.

---

## Step 5 — User Instructions (send this to your friends)

```
1. Download and unzip the GameNet folder
2. Run setup.bat (right-click → Run as Administrator if prompted)
   - This installs everything automatically, takes ~2 minutes
   - Creates a GameNet icon on your desktop
3. Double-click GameNet on your desktop
4. Enter the invite token I sent you
5. Click Connect — that's it!

From now on, just double-click GameNet to connect.
```

---

## Revoking Access

In the admin panel, click Revoke next to any token.
To fully remove a player, also delete their peer from your UDM Pro WireGuard config.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Python not found" | Run setup.bat again, or install Python 3.9+ from python.org |
| "WireGuard not found" | setup.bat installs it; or install manually from wireguard.com |
| "Invalid token" | Check token was copied correctly; tokens are case-insensitive |
| Can't reach game server after connecting | Check ALLOWED_IPS in app.py includes the game server subnet |
| Admin panel password not working | Re-run `wrangler secret put ADMIN_PASSWORD` |
