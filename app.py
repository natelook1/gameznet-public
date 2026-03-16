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
from io import BytesIO
from flask import Flask, request, jsonify, render_template, send_from_directory

# ─── Logging ──────────────────────────────────────────────────────────────────

LOG_FILE = os.path.join(os.path.expanduser("~"), "gameznet.log")
logging.basicConfig(
    filename=LOG_FILE,
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
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
VERSION = "1.13.2"
CONFIG_FILE = os.path.join(os.path.expanduser("~"), ".gameznet_config.json")
SERVER_PUBLIC_KEY = "SLG8saonFoQ+B8x59SBeHCXouLTpVhyEYPqiUZoGqgI="
SERVER_ENDPOINT = "184.66.15.159:51820"
ALLOWED_IPS = "192.168.8.0/24, 192.168.30.0/24"
PORT = 7734

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
        webbrowser.open(f"http://gameznet.local:{PORT}")
        sys.exit(0)
    return mutex  # Must keep reference alive — GC releasing it would free the mutex

# ─── Utility ──────────────────────────────────────────────────────────────────

def resource_path(relative_path):
    """Works both for dev and PyInstaller."""
    try:
        base = sys._MEIPASS
    except AttributeError:
        base = os.path.abspath(".")
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

app = Flask(__name__)
_lock = threading.Lock()
_connected = False
_invisible = False
_player_status = ""
_full_route = False
_update_required = False
_steam_game_cache = None
_steam_cache_at = 0

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
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f)
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
        with open(CONFIG_FILE, "w") as f:
            json.dump({
                "private_key": data["private_key"],
                "vpn_ip":      data["vpn_ip"],
                "name":        data.get("name", "Player")
            }, f)
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
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f)
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
    if _connected:
        return jsonify({"error": "Disconnect first to change routing mode"}), 400
    data = request.get_json(silent=True) or {}
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
        with open(CONFIG_FILE, "w") as f:
            json.dump(cfg, f)
    except Exception:
        pass
    return jsonify({"success": True})

@app.route("/api/remote/start-host", methods=["POST"])
def api_remote_start_host():
    """
    Download RustDesk (if needed), set session password in config, start RustDesk,
    extract the machine ID from the get-id log, return it to the UI.
    Called after the backend has already brokered the session.
    """
    data = request.json or {}
    password = data.get("password", "")
    if not password:
        return jsonify({"error": "Missing password"}), 400

    install_dir = os.path.dirname(os.path.abspath(__file__))
    rustdesk_exe = os.path.join(install_dir, "rustdesk.exe")
    rustdesk_url = "https://github.com/rustdesk/rustdesk/releases/download/1.4.6/rustdesk-1.4.6-x86_64.exe"
    config_path = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "RustDesk", "config", "RustDesk.toml")
    id_log_path = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "RustDesk", "log", "get-id", "rustdesk_rCURRENT.log")

    try:
        # Download RustDesk if not cached
        if not os.path.exists(rustdesk_exe):
            log.info("Downloading RustDesk...")
            import urllib.request as _ur
            _ur.urlretrieve(rustdesk_url, rustdesk_exe)
            log.info("RustDesk downloaded.")

        # Write session password into config before starting
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                toml = f.read()
            import re as _re
            if _re.search(r"^password\s*=", toml, _re.MULTILINE):
                toml = _re.sub(r"^password\s*=.*$", f"password = '{password}'", toml, flags=_re.MULTILINE)
            else:
                toml += f"\npassword = '{password}'\n"
            with open(config_path, "w") as f:
                f.write(toml)
        else:
            with open(config_path, "w") as f:
                f.write(f"enc_id = ''\npassword = '{password}'\nsalt = ''\n")

        # Kill any existing RustDesk so we get a fresh ID log
        subprocess.run(["taskkill", "/F", "/IM", "rustdesk.exe"], capture_output=True)
        time.sleep(1)

        # Clear stale ID log so we know any entry we read is fresh
        if os.path.exists(id_log_path):
            try:
                os.remove(id_log_path)
            except Exception:
                pass

        # Start RustDesk minimized (hashes the password on startup — window not needed)
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = 6  # SW_MINIMIZE
        subprocess.Popen([rustdesk_exe], startupinfo=si)
        time.sleep(3)

        # Run --get-id — on some machines the ID prints directly to stdout
        get_id_result = subprocess.run([rustdesk_exe, "--get-id"], capture_output=True, text=True, errors="ignore", timeout=15)
        rustdesk_id = None
        for line in reversed((get_id_result.stdout + get_id_result.stderr).splitlines()):
            if re.match(r'^\d{6,12}$', line.strip()):
                rustdesk_id = line.strip()
                break

        # Fallback: poll for any log file in the get-id dir — up to 10s
        if not rustdesk_id:
            id_log_dir = os.path.dirname(id_log_path)
            for _ in range(20):
                time.sleep(0.5)
                if not os.path.exists(id_log_dir):
                    continue
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
                    except Exception:
                        pass
                    if rustdesk_id:
                        break
                if rustdesk_id:
                    break

        if not rustdesk_id:
            return jsonify({"error": "Could not read RustDesk ID — try again"}), 500

        # Post ID back to backend so helper can poll for it
        import urllib.request as _ur2
        import urllib.error as _ue2
        try:
            _body = json.dumps({"requester": data.get("requester", ""), "rustdesk_id": rustdesk_id}).encode()
            _req = _ur2.Request(f"{WORKER_URL}/api/remote/ready", data=_body, headers={"Content-Type": "application/json", "User-Agent": "GamezNET"})
            _ur2.urlopen(_req, timeout=5)
        except Exception as _e:
            log.warning("remote/ready post failed: %s", repr(_e))

        log.info("RustDesk host started, ID: %s", rustdesk_id)
        return jsonify({"success": True, "rustdesk_id": rustdesk_id})

    except Exception as e:
        log.error("remote start-host failed: %s", repr(e), exc_info=True)
        return jsonify({"error": str(e)}), 500


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
    try:
        import urllib.request as _ur3
        _body = json.dumps({"helper": helper}).encode()
        _req = _ur3.Request(f"{WORKER_URL}/api/remote/connected", data=_body, headers={"Content-Type": "application/json", "User-Agent": "GamezNET"})
        _ur3.urlopen(_req, timeout=5)
    except Exception as _e:
        log.warning("remote/connected notify failed: %s", repr(_e))


@app.route("/api/remote/start-helper", methods=["POST"])
def api_remote_start_helper():
    """
    Download RustDesk (if needed) and attempt to connect to the requester.
    Falls back gracefully if --connect flag is not supported.
    """
    data = request.json or {}
    target_id = data.get("rustdesk_id", "")
    password = data.get("password", "")
    helper = data.get("helper", "")
    if not target_id or not password:
        return jsonify({"error": "Missing rustdesk_id or password"}), 400

    install_dir = os.path.dirname(os.path.abspath(__file__))
    rustdesk_exe = os.path.join(install_dir, "rustdesk.exe")
    rustdesk_url = "https://github.com/rustdesk/rustdesk/releases/download/1.4.6/rustdesk-1.4.6-x86_64.exe"

    try:
        # Download RustDesk if not cached
        if not os.path.exists(rustdesk_exe):
            log.info("Downloading RustDesk...")
            import urllib.request as _ur
            _ur.urlretrieve(rustdesk_url, rustdesk_exe)
            log.info("RustDesk downloaded.")

        # Try CLI connect first — opens only the connection window, not the full UI
        proc = subprocess.Popen([rustdesk_exe, "--connect", target_id, "--password", password])
        time.sleep(5)
        if proc.poll() is not None:
            # Process exited — CLI connect not supported, fall back to minimized GUI
            log.info("RustDesk --connect exited immediately, launching GUI fallback")
            si = subprocess.STARTUPINFO()
            si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            si.wShowWindow = 6  # SW_MINIMIZE
            subprocess.Popen([rustdesk_exe], startupinfo=si, close_fds=True)
            _notify_connected(helper)
            return jsonify({"success": True, "mode": "gui", "rustdesk_id": target_id, "password": password})

        _notify_connected(helper)
        return jsonify({"success": True, "mode": "connected"})

    except Exception as e:
        log.error("remote start-helper failed: %s", repr(e), exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/remote/cleanup", methods=["POST"])
def api_remote_cleanup():
    """Kill RustDesk and clear the session password from config."""
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
    log.info("RustDesk session cleaned up.")
    return jsonify({"success": True})


@app.route("/api/update", methods=["POST"])
def api_update():
    """Download latest code from GitHub as a zip and restart the app."""
    install_dir = os.path.dirname(os.path.abspath(__file__))
    try:
        import urllib.request
        import zipfile
        import io

        # Standard GitHub repo zip download link
        zip_url = "https://github.com/natelook1/gameznet-public/archive/refs/heads/main.zip"
        log.info("Downloading update from %s", zip_url)
        
        req = urllib.request.Request(zip_url, headers={'User-Agent': 'GamezNET'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            with zipfile.ZipFile(io.BytesIO(resp.read())) as z:
                for member in z.namelist():
                    # GitHub zips put everything inside a root folder named "gameznet-main/"
                    # We strip that prefix so files extract directly into the install_dir
                    if not member.startswith("gameznet-public-main/"):
                        continue

                    relative_path = member.replace("gameznet-public-main/", "", 1)
                    if not relative_path:  # Skip the root folder itself
                        continue
                        
                    target_path = os.path.join(install_dir, relative_path)
                    
                    # If it's a directory, create it
                    if member.endswith('/'):
                        os.makedirs(target_path, exist_ok=True)
                        continue
                        
                    # Write the file, ensuring parent directories exist
                    os.makedirs(os.path.dirname(target_path), exist_ok=True)
                    with open(target_path, "wb") as f:
                        f.write(z.read(member))
                        
        log.info("Update downloaded and extracted successfully.")
    except Exception as e:
        log.error("Update failed: %r", e, exc_info=True)
        return jsonify({"error": f"Failed to download update: {repr(e)}"}), 500

    # Restart: release mutex first so new instance can acquire it, then launch and exit
    def _restart():
        time.sleep(0.8)
        script = os.path.join(install_dir, "app.py")
        # Release the single-instance mutex before spawning so the new process isn't blocked
        try:
            ctypes.windll.kernel32.ReleaseMutex(_instance_mutex)
            ctypes.windll.kernel32.CloseHandle(_instance_mutex)
        except Exception:
            pass
        subprocess.Popen([sys.executable, script, "--no-browser"], cwd=install_dir, creationflags=0x08000000)
        os._exit(0)
    threading.Thread(target=_restart, daemon=True).start()
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
        req = _ur.Request(url, data=body, headers={"User-Agent": "GamezNET", "Content-Type": ct})
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
    while True:
        time.sleep(3)
        if _connected and os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r") as f:
                    cfg = json.load(f)
                # Game detection: try Steam every 30s (10 heartbeat ticks), fall back to process scan
                steam_id = cfg.get("steam_id")
                game = None
                if steam_id:
                    _steam_counter += 1
                    if _steam_counter >= 10:
                        _steam_counter = 0
                        game = detect_game_steam(steam_id)
                if game is None:
                    game = detect_game()
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
    webbrowser.open(f"http://gameznet.local:{PORT}")

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
    """Draw a simple GZ icon — cyan when connected, dark when not."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None

    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background circle
    bg_color = (0, 180, 220, 255) if connected else (30, 48, 70, 255)
    border_color = (0, 200, 255, 255) if connected else (80, 120, 160, 255)
    draw.ellipse([2, 2, size-2, size-2], fill=bg_color, outline=border_color, width=3)

    # "GZ" text
    text_color = (255, 255, 255, 255) if connected else (120, 160, 200, 255)
    try:
        font = ImageFont.truetype("arialbd.ttf", 22)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), "GZ", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) / 2, (size - th) / 2 - 2), "GZ", fill=text_color, font=font)

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
        webbrowser.open(f"http://gameznet.local:{PORT}")

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
    _instance_mutex = ensure_single_instance()   # ← single-instance guard (must be first)
    ensure_admin()
    hide_console()

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

    # Open browser after Flask is up (skip if restarting after update)
    if "--no-browser" not in sys.argv:
        threading.Thread(target=open_browser, daemon=True).start()

    # Run tray icon on main thread (blocks until Exit clicked)
    run_tray(flask_thread)