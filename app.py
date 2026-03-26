"""
GamezNET - Local Flask Backend
Manages WireGuard tunnel via WireGuard Windows CLI.
Runs as localhost:7734 — opened automatically by GamezNET.bat
"""

import os
import sys
import json
import ctypes
import subprocess
import threading
import webbrowser
import time
import atexit
import re
import logging
import tempfile
from logging.handlers import RotatingFileHandler
from io import BytesIO
from flask import Flask, request, jsonify, render_template, send_from_directory

# ─── Logging ──────────────────────────────────────────────────────────────────

LOG_FILE = os.path.join(os.path.expanduser("~"), "gameznet.log")
_handler = RotatingFileHandler(LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
logging.basicConfig(level=logging.DEBUG, handlers=[_handler])
log = logging.getLogger("gameznet")

# ─── Game Detection ───────────────────────────────────────────────────────────

GAME_PROCESSES = {
    'FactoryGame-Win64-Shipping.exe': 'Satisfactory',
    'FactoryGameSteam-Win64-Shipping.exe': 'Satisfactory',
    'WorldOfSeaBattleClient.exe': 'World of Sea Battle',
    'League of Legends.exe': 'League of Legends',
    'ProjectZomboid64.exe': 'Project Zomboid',
    'ProjectZomboid.exe': 'Project Zomboid',
    'ConanSandbox.exe': 'Conan Exiles',
    'Enshrouded.exe': 'Enshrouded',
    'SCUM.exe': 'SCUM',
}

_GAME_PROCESSES_LOWER = {k.lower(): v for k, v in GAME_PROCESSES.items()}

def detect_game():
    try:
        import psutil
        for proc in psutil.process_iter(['name']):
            name = proc.info.get('name', '') or ''
            match = GAME_PROCESSES.get(name) or _GAME_PROCESSES_LOWER.get(name.lower())
            if match:
                return match
    except Exception:
        pass
    return None

def detect_game_steam(steam_id):
    """Query /api/steam/game on WORKER_URL for the player's current game."""
    import urllib.request
    try:
        url = f"{WORKER_URL}/api/steam/game?steam_id={urllib.request.quote(steam_id)}"
        req = urllib.request.Request(url, headers={"User-Agent": "GamezNET"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            return data.get("game") or None
    except Exception:
        return None

# ─── Configuration ────────────────────────────────────────────────────────────

WORKER_URL = "https://gameznet.looknet.ca"
TUNNEL_NAME = "GamezNET"
VERSION = "1.1.4"
CONFIG_FILE = os.path.join(os.path.expanduser("~"), ".gameznet_config.json")

def _write_config(data):
    """Atomically write data to CONFIG_FILE via a temp file + rename."""
    dir_ = os.path.dirname(CONFIG_FILE)
    with tempfile.NamedTemporaryFile("w", dir=dir_, delete=False, suffix=".tmp") as tmp:
        json.dump(data, tmp)
        tmp_path = tmp.name
    os.replace(tmp_path, CONFIG_FILE)
SERVER_PUBLIC_KEY = "SLG8saonFoQ+B8x59SBeHCXouLTpVhyEYPqiUZoGqgI="
SERVER_ENDPOINT = "184.66.15.159:51820"
ALLOWED_IPS = "192.168.8.0/24, 192.168.30.0/24"
PORT = 7734
RUSTDESK_VERSION = "1.1.4"
RUSTDESK_URL = f"https://github.com/rustdesk/rustdesk/releases/download/{RUSTDESK_VERSION}/rustdesk-{RUSTDESK_VERSION}-x86_64.exe"

# ─── Single-Instance Protection ───────────────────────────────────────────────

def ensure_single_instance():
    """
    Use a named Windows mutex to prevent multiple instances.
    If another instance is already running, bring its browser window
    to focus and exit cleanly.
    """
    mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "Global\\GamezNET_SingleInstance")
    if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        log.info("Another instance is already running — opening browser and exiting.")
        webbrowser.open(_local_url())
        sys.exit(0)
    return mutex  # Must keep reference alive — GC releasing it would free the mutex

# ─── Utility ──────────────────────────────────────────────────────────────────

def resource_path(relative_path):
    """Works both for dev and PyInstaller."""
    try:
        base = sys._MEIPASS
    except AttributeError:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, relative_path)

def wg_exe():
    # Prefer system install first (contains required wintun.dll)
    system = r"C:\Program Files\WireGuard\wireguard.exe"
    if os.path.exists(system):
        return system
    # Fall back to local install dir only as a last resort
    local = resource_path("wireguard.exe")
    if os.path.exists(local):
        return local
    return None

def wg_cli():
    """
    Returns path to wg.exe — the WireGuard CLI utility used for 'wg show'.
    Separate from wireguard.exe (the GUI/service manager) which does NOT support /show.
    """
    system = r"C:\Program Files\WireGuard\wg.exe"
    if os.path.exists(system):
        return system
    return None

def _local_url():
    """Return gameznet.local URL if it resolves, otherwise fall back to 127.0.0.1."""
    import socket
    try:
        socket.getaddrinfo("gameznet.local", PORT)
        return f"http://gameznet.local:{PORT}"
    except Exception:
        return f"http://127.0.0.1:{PORT}"

def ensure_hosts_entry():
    """Write 127.0.0.1 gameznet.local to the Windows hosts file if missing."""
    hosts_path = r"C:\Windows\System32\drivers\etc\hosts"
    try:
        with open(hosts_path, "r") as f:
            content = f.read()
        if "gameznet.local" in content:
            return
        with open(hosts_path, "a") as f:
            f.write("\n127.0.0.1 gameznet.local\n")
        log.info("Added gameznet.local to hosts file")
    except Exception as e:
        log.warning("Could not update hosts file: %s", e)

# ─── Dynamic Server Config ───────────────────────────────────────────────────

def fetch_server_config():
    """
    Fetches live server config from the Cloudflare Worker.
    Falls back to hardcoded values if the Worker is unreachable.
    """
    import urllib.request
    try:
        req = urllib.request.Request(
            f"{WORKER_URL}/api/server-config",
            headers={"Cache-Control": "no-cache", "Pragma": "no-cache", "User-Agent": "GamezNET"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            raw = resp.read().decode()
            log.debug("fetch_server_config raw response: %s", raw)
            data = json.loads(raw)
            return {
                "endpoint":   data.get("endpoint",  SERVER_ENDPOINT),
                "public_key": data.get("publicKey", SERVER_PUBLIC_KEY),
                "allowed_ips": data.get("allowedIPs", ALLOWED_IPS)
            }
    except Exception as e:
        log.warning("fetch_server_config failed, using hardcoded fallback: %s", e)
        return {
            "endpoint":   SERVER_ENDPOINT,
            "public_key": SERVER_PUBLIC_KEY,
            "allowed_ips": ALLOWED_IPS
        }

# ─── Zombie Tunnel Prevention ─────────────────────────────────────────────────

def cleanup_tunnel():
    """
    Ensures the WireGuard tunnel drops when this Python script exits,
    even if the user forcibly closes the background command prompt window.
    """
    try:
        wg = wg_exe()
        if wg:
            CREATE_NO_WINDOW = 0x08000000
            subprocess.run(
                [wg, "/uninstalltunnelservice", TUNNEL_NAME],
                capture_output=True,
                creationflags=CREATE_NO_WINDOW
            )
    except Exception:
        pass

# Register the cleanup function to run when the script terminates
atexit.register(cleanup_tunnel)

# ─── Telemetry Engine ─────────────────────────────────────────────────────────

_telemetry = {
    "ping": "---",
    "received": "0 B",
    "sent": "0 B",
    "handshake": "Never",
    "motd": "",
    "alert": None,
    "session": None
}

def update_telemetry():
    """Background thread to poll ping and wg stats silently."""
    global _telemetry, _connected
    import urllib.request

    motd_timer = 0
    alert_timer = 0
    session_timer = 0
    last_session_id = None
    version_timer = 0

    while True:
        # 1. Update MOTD every ~30 seconds
        if motd_timer <= 0:
            try:
                req = urllib.request.Request(f"{WORKER_URL}/api/motd", headers={'User-Agent': 'GamezNET'})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode())
                    _telemetry["motd"] = data.get("message", "Connected to GamezNET")
            except Exception:
                pass
            motd_timer = 15
        motd_timer -= 1

        # 1b. Update Alert every ~10 seconds
        if alert_timer <= 0:
            try:
                req = urllib.request.Request(f"{WORKER_URL}/api/alert", headers={'User-Agent': 'GamezNET'})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode())
                    _telemetry["alert"] = data.get("alert", None)
            except Exception:
                pass
            alert_timer = 5
        alert_timer -= 1

        # 1c. Poll session every ~30 seconds
        if session_timer <= 0:
            try:
                req = urllib.request.Request(f"{WORKER_URL}/api/session", headers={'User-Agent': 'GamezNET'})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode())
                    _telemetry["session"] = data.get("session", None)
            except Exception:
                pass
            session_timer = 15
        session_timer -= 1

        # 1d. Check Version every ~60 seconds
        if version_timer <= 0:
            check_version()
            version_timer = 30
        version_timer -= 1

        if _connected:
            # 2. Ping Latency (Targeting internal VPN Gateway to prove tunnel works)
            try:
                # Ping gateway (.1 of last subnet in AllowedIPs = server-side LAN)
                matches = re.findall(r"(\d+\.\d+\.\d+)\.", ALLOWED_IPS)
                target = f"{matches[-1]}.1" if matches else SERVER_ENDPOINT.split(":")[0]

                CREATE_NO_WINDOW = 0x08000000
                output = subprocess.check_output(
                    f"ping -n 2 -w 1500 {target}",
                    shell=True,
                    creationflags=CREATE_NO_WINDOW
                ).decode()

                all_pings = [int(m) for m in re.findall(r"time[=<](\d+)ms", output)]
                _telemetry["ping"] = f"{min(all_pings)}ms" if all_pings else "Timed Out"
            except subprocess.CalledProcessError:
                _telemetry["ping"] = "Timed Out"
            except Exception:
                _telemetry["ping"] = "Error"

            # 3. WireGuard Stats (wg show via wg.exe, not wireguard.exe)
            try:
                wg = wg_cli()
                if wg:
                    CREATE_NO_WINDOW = 0x08000000
                    output = subprocess.check_output(
                        [wg, "show", TUNNEL_NAME],
                        text=True,
                        creationflags=CREATE_NO_WINDOW
                    )
                    
                    # Parse Handshake
                    h_match = re.search(r"latest handshake: (.*)", output)
                    if h_match: _telemetry["handshake"] = h_match.group(1).strip()
                    
                    # Parse Transfer
                    t_match = re.search(r"transfer: ([\d\.]+ \w+) received, ([\d\.]+ \w+) sent", output)
                    if t_match:
                        _telemetry["received"] = t_match.group(1)
                        _telemetry["sent"] = t_match.group(2)
            except Exception:
                pass
        else:
            _telemetry["ping"] = "---"
            _telemetry["handshake"] = "Never"
            _telemetry["received"] = "0 B"
            _telemetry["sent"] = "0 B"

        time.sleep(2)

# ─── Flask App ────────────────────────────────────────────────────────────────

app = Flask(__name__,
            template_folder=resource_path("templates"),
            static_folder=resource_path("static"))
_lock = threading.Lock()
_connected = False
_invisible = False
_player_status = ""
_full_route = False
_update_required = False

def _version_tuple(v):
    try:
        return tuple(int(x) for x in v.split('.'))
    except Exception:
        return (0,)

def check_version():
    global _update_required
    import urllib.request
    try:
        req = urllib.request.Request(f"{WORKER_URL}/api/version", headers={'User-Agent': 'GamezNET'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            min_ver = data.get("min_version", "1.0.0")
            _update_required = _version_tuple(VERSION) < _version_tuple(min_ver)
            if _update_required:
                log.warning("Update required: client=%s min=%s", VERSION, min_ver)
    except Exception as e:
        log.debug("Version check failed: %s", e)

@app.route("/")
def index():
    return render_template("index.html", connected=_connected, worker_url=WORKER_URL)

@app.route("/api/status", methods=["GET"])
def api_status():
    return jsonify({
        "connected": _connected,
        "telemetry": _telemetry,
        "update_required": _update_required,
        "version": VERSION,
        "full_route": _full_route,
        "player_status": _player_status
    })

@app.route("/api/connect", methods=["POST"])
def api_connect():
    global _connected
    log.info("Connect requested")
    if not os.path.exists(CONFIG_FILE):
        log.error("No config file found at %s", CONFIG_FILE)
        return jsonify({"error": "No configuration found. Please redeem a token first."}), 400

    try:
        with open(CONFIG_FILE, "r") as f:
            config_data = json.load(f)
        log.info("Config loaded — player=%s vpn_ip=%s", config_data.get("name"), config_data.get("vpn_ip"))

        # Fetch live server config (falls back to hardcoded if Worker unreachable)
        srv = fetch_server_config()
        log.info("Server config — endpoint=%s public_key=%s allowed_ips=%s",
                 srv["endpoint"], srv["public_key"], srv["allowed_ips"])

        # Build the WireGuard config file
        allowed_ips = "0.0.0.0/0, ::/0" if _full_route else srv['allowed_ips']
        dns_line = "DNS = 1.1.1.1, 1.0.0.1\n" if _full_route else ""
        conf_content = f"""[Interface]
PrivateKey = {config_data['private_key']}
Address = {config_data['vpn_ip']}
{dns_line}
[Peer]
PublicKey = {srv['public_key']}
Endpoint = {srv['endpoint']}
AllowedIPs = {allowed_ips}
PersistentKeepalive = 25
"""
        conf_path = os.path.join(os.path.expanduser("~"), f"{TUNNEL_NAME}.conf")
        with open(conf_path, "w") as f:
            f.write(conf_content)
        log.info("WireGuard config written to %s", conf_path)

        # Install and start tunnel service
        wg = wg_exe()
        if not wg:
            log.error("wireguard.exe not found")
            return jsonify({"error": "WireGuard not found. Please run the installer again from https://gameznet.looknet.ca/install"}), 500
        log.info("Using wireguard.exe at %s", wg)
        CREATE_NO_WINDOW = 0x08000000

        # Clean up any leftover service from a previous failed attempt
        uninstall_pre = subprocess.run(
            [wg, "/uninstalltunnelservice", TUNNEL_NAME],
            capture_output=True, text=True,
            creationflags=CREATE_NO_WINDOW
        )
        log.debug("pre-connect uninstall: stdout=%r stderr=%r returncode=%s",
                  uninstall_pre.stdout, uninstall_pre.stderr, uninstall_pre.returncode)
        time.sleep(1)  # give SCM a moment to clean up

        install_result = subprocess.run(
            [wg, "/installtunnelservice", conf_path],
            capture_output=True, text=True, timeout=10,
            creationflags=CREATE_NO_WINDOW
        )
        log.info("installtunnelservice stdout=%r stderr=%r returncode=%s",
                 install_result.stdout, install_result.stderr, install_result.returncode)
        if install_result.returncode != 0:
            log.error("installtunnelservice FAILED — stdout=%r stderr=%r",
                      install_result.stdout, install_result.stderr)
            return jsonify({"error": f"WireGuard failed to install tunnel service (code {install_result.returncode}). Try running the GamezNET installer again."}), 503

        # Verify the tunnel interface actually came up (wg show returns valid output).
        # We do NOT require a handshake here — that needs the server to respond,
        # which is a server-side concern. The telemetry will show if traffic flows.
        wg_show = wg_cli()
        log.info("wg.exe path: %s", wg_show)
        tunnel_up = False
        for i in range(10):
            time.sleep(1)
            if wg_show:
                result = subprocess.run(
                    [wg_show, "show", TUNNEL_NAME],
                    capture_output=True, text=True,
                    creationflags=CREATE_NO_WINDOW
                )
                log.debug("wg show [%d] stdout=%r stderr=%r", i, result.stdout, result.stderr)
                if f"interface: {TUNNEL_NAME.lower()}" in result.stdout.lower():
                    tunnel_up = True
                    log.info("Tunnel interface confirmed on attempt %d", i + 1)
                    break
            else:
                # wg.exe not found — check Windows service state
                svc = subprocess.run(
                    ["sc", "query", f"WireGuardTunnel${TUNNEL_NAME}"],
                    capture_output=True, text=True,
                    creationflags=CREATE_NO_WINDOW
                )
                log.debug("sc query [%d]: %r", i, svc.stdout)
                if "RUNNING" in svc.stdout:
                    tunnel_up = True
                    log.info("Service RUNNING confirmed on attempt %d (no wg.exe)", i + 1)
                    break

        if not tunnel_up:
            log.warning("Tunnel interface did not appear after 10s — tearing down")
            subprocess.run(
                [wg, "/uninstalltunnelservice", TUNNEL_NAME],
                capture_output=True, creationflags=CREATE_NO_WINDOW
            )
            return jsonify({"error": "WireGuard tunnel failed to start. Try running the installer again."}), 503

        with _lock:
            _connected = True
        log.info("Connected successfully")
        return jsonify({"success": True, "connected": True})
    except Exception as e:
        log.exception("Unhandled error in api_connect")
        return jsonify({"error": str(e)}), 500

@app.route("/api/disconnect", methods=["POST"])
def api_disconnect():
    global _connected
    try:
        wg = wg_exe()
        CREATE_NO_WINDOW = 0x08000000
        if wg:
            subprocess.run(
                [wg, "/uninstalltunnelservice", TUNNEL_NAME],
                capture_output=True, text=True, timeout=10,
                creationflags=CREATE_NO_WINDOW
            )
        conf_path = os.path.join(os.path.expanduser("~"), f"{TUNNEL_NAME}.conf")
        if os.path.exists(conf_path):
            os.remove(conf_path)

        # Send disconnecting heartbeat before clearing state
        try:
            import urllib.request
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, "r") as f:
                    cfg = json.load(f)
                payload = json.dumps({
                    "name": cfg.get("name", ""),
                    "vpn_ip": cfg.get("vpn_ip", ""),
                    "disconnecting": True
                }).encode()
                req = urllib.request.Request(
                    f"{WORKER_URL}/api/heartbeat",
                    data=payload,
                    headers={"Content-Type": "application/json", "User-Agent": "GamezNET"},
                    method="POST"
                )
                urllib.request.urlopen(req, timeout=5)
                log.debug("Disconnect heartbeat sent")
        except Exception as hb_err:
            log.debug("Disconnect heartbeat failed: %s", hb_err)

        with _lock:
            _connected = False
        return jsonify({"success": True, "connected": False})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/launch_game", methods=["POST"])
def api_launch_game():
    """Launch a Steam game directly via executable to bypass the steam:// arguments warning."""
    data = request.json or {}
    appid = data.get("appid")
    ip = data.get("ip")
    port = data.get("port")
    if not appid or not ip or not port:
        return jsonify({"error": "Missing parameters"}), 400

    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
            steam_exe = winreg.QueryValueEx(key, "SteamExe")[0]
    except Exception:
        steam_exe = r"C:\Program Files (x86)\Steam\steam.exe"

    args = [steam_exe, "-applaunch", str(appid)]
    
    if str(appid) == "526870":  # Satisfactory
        args.extend(["+open", f"{ip}:{port}"])
    else:
        args.extend(["+connect", f"{ip}:{port}"])

    try:
        # CREATE_NO_WINDOW to prevent a brief command prompt flash
        subprocess.Popen(args, creationflags=0x08000000)
        return jsonify({"success": True})
    except Exception as e:
        log.error("Game launch failed: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/config", methods=["GET"])
def api_config():
    """Returns current provisioning state to the UI on load."""
    if not os.path.exists(CONFIG_FILE):
        return jsonify({"provisioned": False, "name": "", "client_ip": ""})
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
        return jsonify({
            "provisioned": True,
            "name":      data.get("name", "Player"),
            "client_ip": data.get("vpn_ip", "")
        })
    except Exception as e:
        return jsonify({"provisioned": False, "name": "", "client_ip": ""}), 500

@app.route("/api/mobile-token", methods=["GET"])
def api_mobile_token():
    """Returns the player's token for mobile QR generation."""
    if not os.path.exists(CONFIG_FILE):
        return jsonify({"error": "Not provisioned"}), 404
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
        token = data.get("token")
        if not token:
            # Auto-migrate: look up token from backend using stored private key
            private_key = data.get("private_key")
            if not private_key:
                return jsonify({"error": "Not provisioned"}), 404
            try:
                import urllib.request as _ur
                req_obj = _ur.Request(
                    f"{WORKER_URL}/api/token-migrate",
                    data=json.dumps({"private_key": private_key}).encode(),
                    headers={"Content-Type": "application/json", "User-Agent": "GamezNET"}
                )
                with _ur.urlopen(req_obj, timeout=5) as resp:
                    result = json.loads(resp.read().decode())
                token = result.get("token")
                if token:
                    data["token"] = token
                    _write_config(data)
            except Exception as e:
                log.warning("token-migrate failed: %s", e)
                return jsonify({"error": "Could not retrieve token automatically. Re-provision to enable mobile QR."}), 404
        return jsonify({"token": token})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/provision", methods=["POST"])
def api_provision():
    """Saves provisioned credentials after a successful token redemption."""
    data = request.json
    if not data or 'private_key' not in data or 'client_ip' not in data:
        return jsonify({"error": "Invalid payload"}), 400
    try:
        config = {
            "private_key": data["private_key"],
            "vpn_ip":      data["client_ip"],
            "name":        data.get("name", "Player")
        }
        if data.get("steam_id"):
            config["steam_id"] = data["steam_id"]
        if data.get("token"):
            config["token"] = data["token"]
        _write_config(config)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/save_config", methods=["POST"])
def api_save_config():
    """Legacy alias for /api/provision — kept for backwards compatibility."""
    data = request.json
    if not data or 'private_key' not in data or 'vpn_ip' not in data:
        return jsonify({"error": "Invalid payload"}), 400
    try:
        _write_config({
            "private_key": data["private_key"],
            "vpn_ip":      data["vpn_ip"],
            "name":        data.get("name", "Player")
        })
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/rename", methods=["POST"])
def api_rename():
    """Change display name — validated server-side by vpn_ip + old_name."""
    data = request.json or {}
    new_name = (data.get("new_name") or "").strip()
    if not new_name:
        return jsonify({"error": "Name is required"}), 400
    try:
        with open(CONFIG_FILE) as f:
            config = json.load(f)
    except Exception:
        return jsonify({"error": "Not provisioned"}), 400
    old_name = config.get("name", "")
    vpn_ip   = config.get("vpn_ip", "")
    import urllib.request as _ur2
    body = json.dumps({"old_name": old_name, "new_name": new_name, "vpn_ip": vpn_ip}).encode()
    req = _ur2.Request(f"{WORKER_URL}/api/rename", data=body, headers={"Content-Type": "application/json", "User-Agent": "GamezNET"})
    try:
        with _ur2.urlopen(req, timeout=5) as r:
            resp = json.loads(r.read().decode())
    except _ur2.HTTPError as e:
        try:
            resp = json.loads(e.read().decode())
        except Exception:
            resp = {"error": f"Backend error {e.code}"}
        return jsonify(resp), e.code
    except Exception as e:
        return jsonify({"error": str(e)}), 502
    if not resp.get("success"):
        return jsonify(resp), 400
    config["name"] = resp["name"]
    _write_config(config)
    return jsonify({"success": True, "name": resp["name"]})

@app.route("/api/reset", methods=["POST"])
def api_reset():
    """Clear provisioned credentials (for re-setup)."""
    if os.path.exists(CONFIG_FILE):
        os.remove(CONFIG_FILE)
    return jsonify({"success": True})

@app.route("/api/logs", methods=["GET"])
def api_logs():
    """Return the last 100 lines of the log file for debugging."""
    try:
        if not os.path.exists(LOG_FILE):
            return jsonify({"log": "No log file yet."})
        with open(LOG_FILE, "r") as f:
            lines = f.readlines()
        return jsonify({"log": "".join(lines[-100:])})
    except Exception as e:
        return jsonify({"log": f"Error reading log: {e}"})

@app.route("/api/report", methods=["POST"])
def api_report():
    """Collect log tail and send an error report to the Worker."""
    import urllib.request
    data = request.json or {}
    error_message = data.get("error_message", "") or "No error message provided"

    # Collect the last 150 lines of the log file
    log_tail = ""
    try:
        if os.path.exists(LOG_FILE):
            with open(LOG_FILE, "r") as f:
                lines = f.readlines()
            log_tail = "".join(lines[-150:])
    except Exception as e:
        log_tail = f"Could not read log: {e}"

    # Read player config for identification
    player_name = "Unknown"
    vpn_ip = ""
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, "r") as f:
                cfg = json.load(f)
            player_name = cfg.get("name", "") or "Unknown"
            vpn_ip = cfg.get("vpn_ip", "")
    except Exception:
        pass

    # POST to Worker
    try:
        payload = json.dumps({
            "player": player_name,
            "vpn_ip": vpn_ip,
            "error_message": error_message,
            "log_tail": log_tail
        }).encode()
        req = urllib.request.Request(
            f"{WORKER_URL}/api/report",
            data=payload,
            headers={"Content-Type": "application/json", "User-Agent": "GamezNET"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
        log.info("Error report sent for player=%s error=%s", player_name, error_message)
        return jsonify({"success": True})
    except Exception as e:
        log.error("Failed to send error report: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/online", methods=["GET"])
def api_online():
    """Proxy to Worker /api/online so the client UI can call it locally."""
    import urllib.request
    try:
        req = urllib.request.Request(f"{WORKER_URL}/api/online", headers={'User-Agent': 'GamezNET'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.read(), resp.status, {'Content-Type': 'application/json'}
    except Exception as e:
        log.debug("api_online proxy failed: %s", e)
        return jsonify([])

@app.route("/api/fullroute", methods=["GET", "POST"])
def api_fullroute():
    global _full_route
    data = request.get_json(silent=True) or {}
    if "enabled" in data and _connected:
        return jsonify({"error": "Disconnect first to change routing mode"}), 400
    if "enabled" in data:
        _full_route = bool(data["enabled"])
    return jsonify({"full_route": _full_route})

@app.route("/api/chat", methods=["GET"])
def api_chat():
    """Proxy GET /api/chat?since= to backend."""
    import urllib.request
    since = request.args.get("since", "")
    try:
        url = f"{WORKER_URL}/api/chat?since={urllib.request.quote(since)}"
        req = urllib.request.Request(url, headers={"User-Agent": "GamezNET"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.read(), resp.status, {"Content-Type": "application/json"}
    except Exception as e:
        log.debug("api_chat proxy failed: %s", e)
        return jsonify([])

@app.route("/api/chat/send", methods=["POST"])
def api_chat_send():
    """Proxy POST /api/chat/send to backend."""
    import urllib.request
    try:
        data = request.get_json(silent=True) or {}
        payload = json.dumps(data).encode()
        req = urllib.request.Request(
            f"{WORKER_URL}/api/chat/send",
            data=payload,
            headers={"Content-Type": "application/json", "User-Agent": "GamezNET"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.read(), resp.status, {"Content-Type": "application/json"}
    except Exception as e:
        log.debug("api_chat_send proxy failed: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/invisible", methods=["GET", "POST"])
def api_invisible():
    global _invisible
    if request.method == "POST":
        data = request.json or {}
        new_val = bool(data.get("invisible", False))
        _invisible = new_val
        log.info("Invisible mode set to: %s", _invisible)
        return jsonify({"invisible": _invisible})
    return jsonify({"invisible": _invisible})

@app.route("/api/status/set", methods=["POST"])
def api_status_set():
    global _player_status
    data = request.json or {}
    new_status = str(data.get("status", ""))
    if len(new_status) > 40:
        return jsonify({"error": "Status too long (max 40 characters)"}), 400
    _player_status = new_status
    log.info("Player status set to: %r", _player_status)
    try:
        with open(CONFIG_FILE) as f:
            cfg = json.load(f)
        cfg["status"] = new_status
        _write_config(cfg)
    except Exception:
        pass
    return jsonify({"success": True})

@app.route("/minecraft")
def play_minecraft():
    """Serve Eaglercraft, downloading it on-demand first if missing."""
    install_dir = os.path.dirname(os.path.abspath(__file__))
    template_dir = os.path.join(install_dir, "templates")
    static_dir = os.path.join(install_dir, "static")
    os.makedirs(static_dir, exist_ok=True)
    mc_file = os.path.join(static_dir, "eaglercraft.html")

    # Check templates folder first (where you placed it!)
    if os.path.exists(os.path.join(template_dir, "eaglercraft.html")):
        return send_from_directory(template_dir, "eaglercraft.html")

    if not os.path.exists(mc_file):
        try:
            import urllib.request
            import shutil
            
            # Try central server first, fallback to raw GitHub repo
            urls = [
                f"{WORKER_URL}/public/eaglercraft.html",
                "https://raw.githubusercontent.com/natelook1/gameznet-public/main/static/eaglercraft.html"
            ]
            
            for url in urls:
                try:
                    log.info("Downloading Eaglercraft from %s", url)
                    req = urllib.request.Request(url, headers={'User-Agent': 'GamezNET'})
                    with urllib.request.urlopen(req, timeout=60) as resp, open(mc_file, 'wb') as out_file:
                        shutil.copyfileobj(resp, out_file)
                    log.info("Eaglercraft downloaded successfully.")
                    return send_from_directory(static_dir, "eaglercraft.html")
                except Exception as e:
                    log.warning("Failed to download from %s: %s", url, e)
            raise Exception("Could not find eaglercraft.html on central server or GitHub fallback.")
        except Exception as e:
            log.error("Failed to download Eaglercraft: %s", e)
            if os.path.exists(mc_file): os.remove(mc_file)
            return f"<h2 style='font-family:sans-serif;color:#ff3366;'>Download Failed</h2><p style='font-family:sans-serif;'>Could not fetch Minecraft client from the central server. Ensure eaglercraft.html is placed in the backend data/public folder! Error: {e}</p>", 500

    return send_from_directory(static_dir, "eaglercraft.html")

@app.route("/api/minecraft/prepare", methods=["POST"])
def api_minecraft_prepare():
    """Pre-downloads Eaglercraft so the UI can show a loading state."""
    install_dir = os.path.dirname(os.path.abspath(__file__))
    template_dir = os.path.join(install_dir, "templates")
    static_dir = os.path.join(install_dir, "static")
    os.makedirs(static_dir, exist_ok=True)
    mc_file = os.path.join(static_dir, "eaglercraft.html")

    if os.path.exists(mc_file) or os.path.exists(os.path.join(template_dir, "eaglercraft.html")):
        return jsonify({"success": True})

    try:
        import urllib.request
        import shutil
        urls = [
            f"{WORKER_URL}/public/eaglercraft.html",
            "https://raw.githubusercontent.com/natelook1/gameznet-public/main/static/eaglercraft.html"
        ]
        
        for url in urls:
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'GamezNET'})
                with urllib.request.urlopen(req, timeout=60) as resp, open(mc_file, 'wb') as out_file:
                    shutil.copyfileobj(resp, out_file)
                return jsonify({"success": True})
            except Exception as e:
                pass
        raise Exception("File not found on central server or GitHub.")
    except Exception as e:
        if os.path.exists(mc_file): os.remove(mc_file)
        return jsonify({"error": f"Failed to download client: {e}"}), 500

def _watch_rustdesk_process(name_to_end):
    """Background thread that tracks RustDesk by executable name instead of a volatile PID."""
    def watcher():
        import psutil
        import urllib.request
        import json
        try:
            # Give RustDesk time to fully launch and spawn its child processes
            time.sleep(5)

            # Poll for ANY running rustdesk.exe process
            while True:
                is_running = False
                for proc in psutil.process_iter(['name']):
                    if (proc.info.get('name') or '').lower() == 'rustdesk.exe':
                        is_running = True
                        break
                
                if not is_running:
                    break  # RustDesk has been completely closed
                
                time.sleep(3)
            
            log.info(f"[RUSTDESK TRACKER] RustDesk completely exited. Ending session for '{name_to_end}'...")
            _body = json.dumps({"name": name_to_end}).encode()
            _req = urllib.request.Request(f"{WORKER_URL}/api/remote/end", data=_body, headers={"Content-Type": "application/json", "User-Agent": "GamezNET"})
            urllib.request.urlopen(_req, timeout=5)
        except Exception as e:
            log.debug(f"[RUSTDESK TRACKER] Watcher finished or failed: {e}")

    threading.Thread(target=watcher, daemon=True).start()


_remote_action_lock = threading.Lock()

@app.route("/api/remote/start-host", methods=["POST"])
def api_remote_start_host():
    """
    Download RustDesk (if needed), set session password securely via CLI, start RustDesk,
    extract the machine ID from the get-id log, return it to the UI.
    """
    # Prevent frontend polling from spawning multiple concurrent start instances
    if not _remote_action_lock.acquire(blocking=False):
        log.info("[RUSTDESK TRACKER] Ignoring duplicate start-host request (already running)")
        return jsonify({"success": True, "ignored": True}), 200

    try:
        data = request.json or {}
        password = data.get("password", "")
        
        log.info(f"[RUSTDESK TRACKER] Local start-host triggered by: {data.get('requester')}")
        
        if not password:
            log.warning("[RUSTDESK TRACKER] Local start-host missing password")
            return jsonify({"error": "Missing password"}), 400

        install_dir = os.path.dirname(os.path.abspath(__file__))
        rustdesk_exe = os.path.join(install_dir, "rustdesk.exe")
        id_log_path = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "RustDesk", "log", "get-id", "rustdesk_rCURRENT.log")

        # Download RustDesk if not cached
        if not os.path.exists(rustdesk_exe):
            log.info("[RUSTDESK TRACKER] Downloading RustDesk...")
            import urllib.request as _ur
            _ur.urlretrieve(RUSTDESK_URL, rustdesk_exe)
            log.info("[RUSTDESK TRACKER] RustDesk downloaded.")

        # Kill any existing RustDesk so we get a fresh launch
        subprocess.run(["taskkill", "/F", "/IM", "rustdesk.exe"], capture_output=True, creationflags=0x08000000)
        time.sleep(1)

        # 0. Force RustDesk to accept permanent passwords
        log.info("[RUSTDESK TRACKER] Ensuring approve_mode is set to password in config...")
        config_path = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "RustDesk", "config", "RustDesk.toml")
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        toml_content = ""
        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    toml_content = f.read()
            except Exception:
                pass
        
        # Strip old passwords/salts/modes to prevent conflicts
        toml_content = re.sub(r"^password\s*=.*$", "", toml_content, flags=re.MULTILINE)
        toml_content = re.sub(r"^salt\s*=.*$", "", toml_content, flags=re.MULTILINE)
        toml_content = re.sub(r"^approve_mode\s*=.*$", "", toml_content, flags=re.MULTILINE)
        
        # Clean empty lines and append our mode
        toml_content = "\n".join([line for line in toml_content.splitlines() if line.strip()])
        toml_content += "\napprove_mode = 'password'\n"
        
        with open(config_path, "w", encoding="utf-8") as f:
            f.write(toml_content)

        # 1. Start RustDesk minimized
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = 6  # SW_MINIMIZE
        log.info("[RUSTDESK TRACKER] Launching rustdesk.exe minimized...")
        host_proc = subprocess.Popen([rustdesk_exe], startupinfo=si)
        time.sleep(5)  # Give daemon time to start before sending IPC password
        
        # 2. Set permanent password via CLI (natively hashes and stores it properly)
        log.info("[RUSTDESK TRACKER] Injecting password securely via CLI...")
        subprocess.run([rustdesk_exe, "--password", password], capture_output=True, creationflags=0x08000000)
        time.sleep(1)

        # Clear stale ID log so we know any entry we read is fresh
        os.makedirs(os.path.dirname(id_log_path), exist_ok=True)
        if os.path.exists(id_log_path):
            try:
                os.remove(id_log_path)
            except Exception:
                pass

        # 3. Extract ID via --get-id
        log.info("[RUSTDESK TRACKER] Extracting ID via --get-id")
        get_id_result = subprocess.run([rustdesk_exe, "--get-id"], capture_output=True, text=True, errors="ignore", timeout=15, creationflags=0x08000000)
        rustdesk_id = None
        for line in reversed((get_id_result.stdout + get_id_result.stderr).splitlines()):
            if re.match(r'^\d{6,12}$', line.strip()):
                rustdesk_id = line.strip()
                break

        # Fallback log polling
        if not rustdesk_id:
            log.info("[RUSTDESK TRACKER] --get-id failed, polling log files instead...")
            id_log_dir = os.path.dirname(id_log_path)
            for _ in range(20):
                time.sleep(0.5)
                if not os.path.exists(id_log_dir): continue
                log_files = sorted(
                    [os.path.join(id_log_dir, f) for f in os.listdir(id_log_dir) if f.endswith(".log")],
                    key=os.path.getmtime, reverse=True
                )
                for lf in log_files:
                    try:
                        with open(lf, "r", errors="ignore") as f:
                            for line in reversed(f.readlines()):
                                m = re.search(r"Generated id (\d+)", line)
                                if m:
                                    rustdesk_id = m.group(1)
                                    break
                    except Exception: pass
                    if rustdesk_id: break
                if rustdesk_id: break

        if not rustdesk_id:
            log.error("[RUSTDESK TRACKER] Could not read RustDesk ID.")
            return jsonify({"error": "Could not read RustDesk ID — try again"}), 500

        log.info(f"[RUSTDESK TRACKER] RustDesk ID acquired: {rustdesk_id}. Posting /api/remote/ready to server...")

        import urllib.request as _ur2
        try:
            _body = json.dumps({
                "requester": data.get("requester", ""), 
                "rustdesk_id": rustdesk_id,
                "password": password
            }).encode()
            _req = _ur2.Request(f"{WORKER_URL}/api/remote/ready", data=_body, headers={"Content-Type": "application/json", "User-Agent": "GamezNET"})
            with _ur2.urlopen(_req, timeout=5) as resp:
                log.info(f"[RUSTDESK TRACKER] /api/remote/ready post success: {resp.status}")
        except Exception as _e:
            log.error("[RUSTDESK TRACKER] /api/remote/ready post FAILED: %s", repr(_e))
            return jsonify({"error": f"Failed to notify backend: {repr(_e)}"}), 500

        _watch_rustdesk_process(data.get("requester", ""))
        
        log.info("[RUSTDESK TRACKER] RustDesk host started successfully.")
        return jsonify({"success": True, "rustdesk_id": rustdesk_id})

    except Exception as e:
        log.error("[RUSTDESK TRACKER] remote start-host failed: %s", repr(e), exc_info=True)
        return jsonify({"error": str(e)}), 500
    finally:
        _remote_action_lock.release()


@app.route("/api/steam/link", methods=["POST"])
def api_steam_link():
    """Open Steam OpenID login in the default browser to link the player's Steam account."""
    data = request.json or {}
    name = data.get("name", "")
    if not name:
        return jsonify({"error": "Missing name"}), 400
    import webbrowser
    webbrowser.open(f"{WORKER_URL}/auth/steam?token={name}")
    return jsonify({"success": True})


def _notify_connected(helper):
    """Tell the backend the helper has launched RustDesk so the host modal can advance."""
    if not helper:
        return
    log.info(f"[RUSTDESK TRACKER] Notifying server that helper '{helper}' connected...")
    try:
        import urllib.request as _ur3
        _body = json.dumps({"helper": helper}).encode()
        _req = _ur3.Request(f"{WORKER_URL}/api/remote/connected", data=_body, headers={"Content-Type": "application/json", "User-Agent": "GamezNET"})
        with _ur3.urlopen(_req, timeout=5) as resp:
            log.info(f"[RUSTDESK TRACKER] /api/remote/connected post success: {resp.status}")
    except Exception as _e:
        log.warning("[RUSTDESK TRACKER] remote/connected notify failed: %s", repr(_e))


@app.route("/api/remote/start-helper", methods=["POST"])
def api_remote_start_helper():
    """
    Download RustDesk (if needed) and attempt to connect to the requester.
    """
    # Prevent frontend polling from spawning multiple concurrent helper instances
    if not _remote_action_lock.acquire(blocking=False):
        log.info("[RUSTDESK TRACKER] Ignoring duplicate start-helper request")
        return jsonify({"success": True, "ignored": True}), 200

    try:
        data = request.json or {}
        target_id = data.get("rustdesk_id", "")
        password = data.get("password", "")
        helper = data.get("helper", "")
        
        log.info(f"[RUSTDESK TRACKER] Local start-helper triggered. Helper: {helper}, Target ID: {target_id}")
        
        if not target_id or not password:
            log.warning("[RUSTDESK TRACKER] Local start-helper missing rustdesk_id or password")
            return jsonify({"error": "Missing rustdesk_id or password"}), 400

        install_dir = os.path.dirname(os.path.abspath(__file__))
        rustdesk_exe = os.path.join(install_dir, "rustdesk.exe")
        if not os.path.exists(rustdesk_exe):
            log.info("[RUSTDESK TRACKER] Downloading RustDesk...")
            import urllib.request as _ur
            _ur.urlretrieve(RUSTDESK_URL, rustdesk_exe)
            log.info("[RUSTDESK TRACKER] RustDesk downloaded.")

        log.info(f"[RUSTDESK TRACKER] Attempting CLI connect to {target_id}")
        
        # Failsafe: Copy password to clipboard
        try:
            subprocess.run(['clip'], input=password, text=True, creationflags=0x08000000)
            log.info("[RUSTDESK TRACKER] Session password copied to Windows clipboard.")
        except Exception:
            pass

        # Kill any existing RustDesk instances to clear memory cache
        subprocess.run(["taskkill", "/F", "/IM", "rustdesk.exe"], capture_output=True, creationflags=0x08000000)
        time.sleep(1)
        
        # Wipe stale peer config so RustDesk doesn't auto-try an old invalid password
        peer_path = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "RustDesk", "config", "peers", f"{target_id}.toml")
        if os.path.exists(peer_path):
            try:
                os.remove(peer_path)
            except Exception:
                pass

        # Launch connection WITHOUT --password (since it only sets local passwords, not remote)
        subprocess.Popen([rustdesk_exe, "--connect", target_id])

        log.info("[RUSTDESK TRACKER] CLI Connect successfully initiated connection window.")
        _notify_connected(helper)
        
        _watch_rustdesk_process(helper)
        return jsonify({"success": True, "mode": "connected"})

    except Exception as e:
        log.error("[RUSTDESK TRACKER] remote start-helper failed: %s", repr(e), exc_info=True)
        return jsonify({"error": str(e)}), 500
    finally:
        _remote_action_lock.release()


@app.route("/api/remote/cleanup", methods=["POST"])
def api_remote_cleanup():
    """Kill RustDesk and clear the session password from config."""
    log.info("[RUSTDESK TRACKER] Local cleanup triggered. Killing processes...")
    config_path = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "RustDesk", "config", "RustDesk.toml")
    try:
        import psutil
        for proc in psutil.process_iter(['name']):
            if (proc.info.get('name') or '').lower() == 'rustdesk.exe':
                proc.kill()
    except Exception:
        pass
    # Clear password from config
    try:
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                toml = f.read()
            toml = re.sub(r"^password\s*=.*$", "password = ''", toml, flags=re.MULTILINE)
            with open(config_path, "w") as f:
                f.write(toml)
    except Exception:
        pass
    log.info("[RUSTDESK TRACKER] RustDesk session cleaned up.")
    return jsonify({"success": True})


@app.route("/api/remote/<path:endpoint>", methods=["GET", "POST"])
def proxy_remote_api(endpoint):
    """
    Proxy missing remote endpoints (status, pending, request, end) to the central server.
    Specific routes like start-host and start-helper are matched first by Flask.
    """
    import urllib.request
    import urllib.error
    url = f"{WORKER_URL}/api/remote/{endpoint}"
    
    # Forward query parameters (e.g., ?name=User)
    if request.query_string:
        url += "?" + request.query_string.decode('utf-8')
        
    log.info(f"[RUSTDESK TRACKER] Proxying request to: {url} [{request.method}]")
        
    try:
        req = urllib.request.Request(url, method=request.method)
        req.add_header("User-Agent", "GamezNET-Proxy")
        
        if request.method == "POST":
            req.add_header("Content-Type", "application/json")
            if request.data:
                req.data = request.data
                log.info(f"[RUSTDESK TRACKER] Outgoing payload: {request.get_data(as_text=True)}")
                
        with urllib.request.urlopen(req, timeout=5) as response:
            content_type = response.headers.get('Content-Type', 'application/json')
            body = response.read()
            # Log a small snippet of the response body to avoid spamming the log if it's huge
            log.info(f"[RUSTDESK TRACKER] Response from server ({response.status}): {body.decode()[:150]}")
            return body, response.status, {'Content-Type': content_type}
            
    except urllib.error.HTTPError as e:
        content_type = e.headers.get('Content-Type', 'application/json')
        body = e.read()
        log.warning(f"[RUSTDESK TRACKER] Server returned HTTP Error ({e.code}): {body.decode()[:150]}")
        return body, e.code, {'Content-Type': content_type}
    except Exception as e:
        log.error("[RUSTDESK TRACKER] Proxy error to %s: %s", url, repr(e))
        return jsonify({"error": str(e)}), 500

INSTALLER_URL = "https://github.com/natelook1/gameznet-public/releases/latest/download/GamezNET-Setup.exe"

@app.route("/api/update", methods=["POST"])
def api_update():
    """Update GamezNET. Exe builds download the installer directly; bat/dev builds
    pull the latest source zip first so the new bat can bootstrap the installer."""
    import urllib.request
    import ssl
    import tempfile

    # Prefer Windows cert store; fall back to certifi; last resort skip verify
    try:
        ctx = ssl.create_default_context()
        ctx.load_default_certs()
    except Exception:
        try:
            import certifi
            ctx = ssl.create_default_context(cafile=certifi.where())
        except Exception:
            ctx = ssl._create_unverified_context()

    # ── Path A: running as compiled exe ───────────────────────────────────────
    if getattr(sys, "frozen", False):
        try:
            tmp = os.path.join(tempfile.gettempdir(), "GamezNET-Setup.exe")
            log.info("Downloading installer from %s", INSTALLER_URL)
            req = urllib.request.Request(INSTALLER_URL, headers={"User-Agent": "GamezNET"})
            with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
                with open(tmp, "wb") as f:
                    f.write(resp.read())
            log.info("Launching installer silently")
            subprocess.Popen([tmp, "/VERYSILENT", "/NORESTART"],
                             creationflags=subprocess.CREATE_NO_WINDOW)
        except Exception as e:
            log.error("Installer download failed: %r", e, exc_info=True)
            return jsonify({"error": f"Failed to download installer: {repr(e)}"}), 500
        return jsonify({"success": True})

    # ── Path B: running as python/bat — pull source zip then relaunch via bat ─
    install_dir = os.path.dirname(os.path.abspath(__file__))
    try:
        import zipfile
        import io
        zip_url = "https://github.com/natelook1/gameznet-public/archive/refs/heads/main.zip"
        log.info("Downloading source update from %s", zip_url)
        req = urllib.request.Request(zip_url, headers={"User-Agent": "GamezNET"})
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            with zipfile.ZipFile(io.BytesIO(resp.read())) as z:
                for member in z.namelist():
                    if not member.startswith("gameznet-public-main/"):
                        continue
                    relative_path = member.replace("gameznet-public-main/", "", 1)
                    if not relative_path:
                        continue
                    if relative_path.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico')):
                        continue
                    target_path = os.path.join(install_dir, relative_path)
                    if member.endswith('/'):
                        os.makedirs(target_path, exist_ok=True)
                        continue
                    os.makedirs(os.path.dirname(target_path), exist_ok=True)
                    with open(target_path, "wb") as f:
                        f.write(z.read(member))
        log.info("Source update extracted. Relaunching via Python.")
    except Exception as e:
        log.error("Source update failed: %r", e, exc_info=True)
        return jsonify({"error": f"Failed to download update: {repr(e)}"}), 500

    def _relaunch():
        time.sleep(0.8)
        try:
            ctypes.windll.kernel32.ReleaseMutex(_instance_mutex)
            ctypes.windll.kernel32.CloseHandle(_instance_mutex)
        except Exception:
            pass
        args = [sys.executable] + sys.argv
        if "--no-browser" not in args:
            args.append("--no-browser")
        subprocess.Popen(args, cwd=install_dir,
                         creationflags=subprocess.CREATE_NO_WINDOW)
        os._exit(0)
    threading.Thread(target=_relaunch, daemon=True).start()
    return jsonify({"success": True})


@app.route("/api/alert", methods=["GET"])
def api_alert():
    """Proxy GET to Worker /api/alert and return the JSON."""
    import urllib.request as _urllib_request
    try:
        req = _urllib_request.Request(f"{WORKER_URL}/api/alert", headers={'User-Agent': 'GamezNET'})
        with _urllib_request.urlopen(req, timeout=5) as resp:
            return resp.read(), resp.status, {'Content-Type': 'application/json'}
    except Exception as e:
        log.debug("api_alert proxy failed: %s", e)
        return jsonify({"alert": None})


@app.route("/api/<path:subpath>", methods=["GET", "POST"])
def api_proxy(subpath):
    """Catch-all proxy for unhandled /api/* routes — forwards to backend."""
    import urllib.request as _ur
    import urllib.error as _ue
    try:
        qs = request.query_string.decode()
        url = f"{WORKER_URL}/api/{subpath}" + (f"?{qs}" if qs else "")
        body = request.get_data() or None
        ct = request.content_type or "application/json"
        req = _ur.Request(url, data=body, headers={"User-Agent": "GamezNET", "Content-Type": ct}, method=request.method)
        with _ur.urlopen(req, timeout=10) as resp:
            return resp.read(), resp.status, {"Content-Type": resp.headers.get("Content-Type", "application/json")}
    except _ue.HTTPError as e:
        body = e.read()
        log.error("api proxy HTTP %s for %s: %s", e.code, subpath, body)
        return body, e.code, {"Content-Type": e.headers.get("Content-Type", "application/json")}
    except Exception as e:
        log.error("api proxy failed for %s: %s", subpath, e)
        return jsonify({"error": str(e)}), 502

@app.route("/auth/<path:subpath>", methods=["GET", "POST"])
def auth_proxy(subpath):
    """Proxy /auth/* routes to backend (YouTube OAuth)."""
    import urllib.request as _ur
    qs = request.query_string.decode()
    url = f"{WORKER_URL}/auth/{subpath}" + (f"?{qs}" if qs else "")
    from flask import redirect
    return redirect(url)

# ─── Heartbeat Thread ─────────────────────────────────────────────────────────

def heartbeat_loop():
    """Send presence heartbeat to the Worker every 3 seconds while connected."""
    import urllib.request
    _steam_counter = 0
    _last_steam_game = None  # cache last Steam result between poll intervals
    while True:
        time.sleep(3)
        if _connected and os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r") as f:
                    cfg = json.load(f)
                # Game detection: Steam is authoritative when linked.
                # Poll Steam every 30s and cache the result — process scan is
                # only used as a fallback when no Steam account is linked.
                steam_id = cfg.get("steam_id")
                game = None
                if steam_id:
                    _steam_counter += 1
                    if _steam_counter >= 10:
                        _steam_counter = 0
                        _last_steam_game = detect_game_steam(steam_id)
                    game = _last_steam_game  # use cached result between polls
                if game is None:
                    game = detect_game()  # only runs when no steam_id, or Steam says nothing
                payload = json.dumps({
                    "name": cfg.get("name", ""),
                    "vpn_ip": cfg.get("vpn_ip", ""),
                    "game": game,
                    "hidden": _invisible,
                    "ping": _telemetry.get("ping", None),
                    "version": VERSION,
                    "status": _player_status
                }).encode()
                req = urllib.request.Request(
                    f"{WORKER_URL}/api/heartbeat",
                    data=payload,
                    headers={"Content-Type": "application/json", "User-Agent": "GamezNET"},
                    method="POST"
                )
                urllib.request.urlopen(req, timeout=5)
            except Exception as e:
                log.warning("Heartbeat failed: %s", e)

# ─── Entry Point ──────────────────────────────────────────────────────────────

def open_browser():
    time.sleep(1.2)
    webbrowser.open(_local_url())

def ensure_admin():
    """Re-launch with admin rights if needed."""
    try:
        is_admin = ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        is_admin = False
    if not is_admin:
        ctypes.windll.shell32.ShellExecuteW(
            None, "runas", sys.executable, " ".join(sys.argv), None, 1
        )
        sys.exit()

def hide_console():
    """Hide the console window completely."""
    try:
        import win32console, win32gui
        win32gui.ShowWindow(win32console.GetConsoleWindow(), 0)
    except Exception:
        # Fallback using ctypes if pywin32 not available
        try:
            hwnd = ctypes.windll.kernel32.GetConsoleWindow()
            if hwnd:
                ctypes.windll.user32.ShowWindow(hwnd, 0)
        except Exception:
            pass

def make_tray_icon(connected=False):
    """
    Tray icon using the real gameznet.png:
      - Disconnected: desaturated + dimmed
      - Connected:    full colour + small green dot in the bottom-right corner
    """
    try:
        from PIL import Image, ImageDraw, ImageEnhance
    except ImportError:
        return None

    size = 64
    icon_path = resource_path(os.path.join("static", "gameznet.png"))
    try:
        img = Image.open(icon_path).convert("RGBA").resize((size, size), Image.LANCZOS)
    except Exception:
        # Fallback: plain coloured circle so the tray still works
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        color = (0, 180, 220, 255) if connected else (30, 48, 70, 255)
        ImageDraw.Draw(img).ellipse([2, 2, size - 2, size - 2], fill=color)
        return img

    if not connected:
        # Desaturate then dim while preserving the alpha channel
        r, g, b, a = img.split()
        rgb = Image.merge("RGB", (r, g, b))
        rgb = ImageEnhance.Color(rgb).enhance(0.2)
        rgb = ImageEnhance.Brightness(rgb).enhance(0.5)
        r2, g2, b2 = rgb.split()
        img = Image.merge("RGBA", (r2, g2, b2, a))
    else:
        # Green connected dot — dark border ring for contrast against any background
        draw = ImageDraw.Draw(img)
        dr = 10
        cx, cy = size - dr - 2, size - dr - 2
        draw.ellipse([cx - dr - 2, cy - dr - 2, cx + dr + 2, cy + dr + 2],
                     fill=(7, 9, 15, 210))
        draw.ellipse([cx - dr, cy - dr, cx + dr, cy + dr],
                     fill=(0, 232, 122, 255))

    return img

def run_tray(flask_thread):
    """Run the system tray icon. Blocking — runs on main thread."""
    try:
        import pystray
        from PIL import Image
    except ImportError:
        # pystray/Pillow not available — fall back to visible console
        flask_thread.join()
        return

    icon_holder = {"icon": None}

    def refresh_icon():
        img = make_tray_icon(_connected)
        if img and icon_holder["icon"]:
            icon_holder["icon"].icon = img

    def on_open(icon, item):
        webbrowser.open(_local_url())

    def on_disconnect(icon, item):
        if _connected:
            try:
                import urllib.request
                urllib.request.urlopen(
                    urllib.request.Request(
                        f"http://127.0.0.1:{PORT}/api/disconnect",
                        method="POST"
                    ), timeout=5
                )
            except Exception:
                pass
            refresh_icon()

    def on_exit(icon, item):
        cleanup_tunnel()
        icon.stop()
        os._exit(0)

    def build_menu():
        status = "● Connected" if _connected else "○ Disconnected"
        return pystray.Menu(
            pystray.MenuItem(status, None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open GamezNET", on_open, default=True),
            pystray.MenuItem("Disconnect", on_disconnect),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Exit", on_exit),
        )

    img = make_tray_icon(_connected)
    if not img:
        flask_thread.join()
        return

    tray = pystray.Icon(
        "GamezNET",
        img,
        "GamezNET",
        menu=build_menu()
    )
    icon_holder["icon"] = tray

    # Poll connection state and update icon
    def state_watcher():
        last = None
        while True:
            time.sleep(2)
            if _connected != last:
                last = _connected
                tray.icon = make_tray_icon(_connected)
                tray.title = "GamezNET — Connected" if _connected else "GamezNET"
                tray.menu = build_menu()
    threading.Thread(target=state_watcher, daemon=True).start()

    # Notify when friends come online
    def presence_watcher():
        import urllib.request as _ur
        known = None  # None = first poll, don't notify yet
        my_name = None
        while True:
            time.sleep(5)
            if not _connected:
                known = None
                continue
            try:
                if my_name is None and os.path.exists(CONFIG_FILE):
                    with open(CONFIG_FILE) as f:
                        my_name = json.load(f).get("name", "")
                req = _ur.Request(f"{WORKER_URL}/api/online", headers={"User-Agent": "GamezNET"})
                with _ur.urlopen(req, timeout=5) as resp:
                    online = {p["name"] for p in json.loads(resp.read()) if p.get("name") != my_name}
                if known is None:
                    known = online
                else:
                    for name in online - known:
                        try:
                            tray.notify(f"{name} joined GamezNET", "GamezNET")
                        except Exception:
                            pass
                    for name in known - online:
                        try:
                            tray.notify(f"{name} left GamezNET", "GamezNET")
                        except Exception:
                            pass
                    known = online
            except Exception:
                pass
    threading.Thread(target=presence_watcher, daemon=True).start()

    # Notify when admin broadcasts an alert
    def alert_watcher():
        import urllib.request as _ur
        last_alert_id = None
        while True:
            time.sleep(15)
            if not _connected:
                continue
            try:
                req = _ur.Request(f"{WORKER_URL}/api/alert", headers={"User-Agent": "GamezNET"})
                with _ur.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode())
                alert = data.get("alert")
                if alert and alert.get("id") != last_alert_id:
                    last_alert_id = alert["id"]
                    try:
                        tray.notify(alert.get("message", "Admin alert"), "GamezNET")
                    except Exception:
                        pass
                elif not alert:
                    last_alert_id = None
            except Exception:
                pass
    threading.Thread(target=alert_watcher, daemon=True).start()

    # Notify when a session is scheduled
    def session_watcher():
        import urllib.request as _ur
        last_id = None
        while True:
            time.sleep(20)
            try:
                req = _ur.Request(f"{WORKER_URL}/api/session", headers={"User-Agent": "GamezNET"})
                with _ur.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode())
                session = data.get("session")
                if session and session.get("id") != last_id:
                    last_id = session["id"]
                    t = session.get("scheduled_time", "")
                    try:
                        import datetime as _dt, re as _re
                        t_clean = _re.sub(r'\.\d+', '', t.replace("Z", "+00:00"))
                        dt = _dt.datetime.fromisoformat(t_clean)
                        dt = dt.astimezone()  # convert UTC → local
                        time_str = dt.strftime("%b %d at %I:%M %p")
                    except Exception:
                        time_str = t
                    try:
                        tray.notify(f"{session.get('host','Someone')} scheduled {session.get('game','')} · {time_str}", "GamezNET Session")
                    except Exception:
                        pass
                elif not session:
                    last_id = None
            except Exception:
                pass
    threading.Thread(target=session_watcher, daemon=True).start()

    tray.run()

if __name__ == "__main__":
    # Tell Windows this is a distinct app, not just "Python", so notifications are branded correctly
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("GamezNET")
    except Exception:
        pass

    _instance_mutex = ensure_single_instance()   # ← single-instance guard (must be first)
    ensure_admin()
    hide_console()
    ensure_hosts_entry()                          # ← repair hosts entry if missing

    # Restore persisted status from config
    try:
        with open(CONFIG_FILE) as f:
            _player_status = json.load(f).get("status", "")
    except Exception:
        pass

    # Auto-reconnect: if the tunnel is already up (e.g. after an in-place update), resume connected state
    try:
        wg = wg_cli()
        if wg:
            result = subprocess.run([wg, "show", TUNNEL_NAME], capture_output=True, creationflags=0x08000000, timeout=3)
            if result.returncode == 0 and result.stdout.strip():
                _connected = True
    except Exception:
        pass

    # Auto-migrate: if running as python and exe not installed, silently install it
    if not getattr(sys, "frozen", False):
        def _auto_migrate():
            exe_path = os.path.join(os.environ.get("LOCALAPPDATA", ""), "GamezNET", "GamezNET.exe")
            if os.path.exists(exe_path):
                return
            time.sleep(8)
            log.info("Running as python without native install — auto-migrating to exe")
            try:
                import urllib.request, ssl, certifi, tempfile
                ctx = ssl.create_default_context(cafile=certifi.where())
                tmp = os.path.join(tempfile.gettempdir(), "GamezNET-Setup.exe")
                req = urllib.request.Request(INSTALLER_URL, headers={"User-Agent": "GamezNET"})
                with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
                    with open(tmp, "wb") as f:
                        f.write(resp.read())
                subprocess.run([tmp, "/VERYSILENT", "/NORESTART"],
                               creationflags=subprocess.CREATE_NO_WINDOW)
                os._exit(0)
            except Exception as e:
                log.error("Auto-migration failed: %s", e)
        threading.Thread(target=_auto_migrate, daemon=True).start()

    # Version check (non-blocking)
    threading.Thread(target=check_version, daemon=True).start()

    # Start Telemetry Thread
    threading.Thread(target=update_telemetry, daemon=True).start()

    # Start Heartbeat Thread
    threading.Thread(target=heartbeat_loop, daemon=True).start()

    # Start Flask in background thread
    flask_thread = threading.Thread(
        target=lambda: app.run(host="127.0.0.1", port=PORT, debug=False, use_reloader=False),
        daemon=True
    )
    flask_thread.start()

    # Open browser after Flask is up (skip on silent update — existing tab reloads itself)
    if "--no-browser" not in sys.argv:
        threading.Thread(target=open_browser, daemon=True).start()

    # Run tray icon on main thread (blocks until Exit clicked)
    run_tray(flask_thread)