"""
GameNet - Local Flask Backend
Manages WireGuard tunnel via WireGuard Windows CLI.
Runs as localhost:7734 — opened automatically by GameNet.bat
"""

import os
import sys
import json
import ctypes
import subprocess
import threading
import webbrowser
import time
from flask import Flask, request, jsonify, render_template, send_from_directory

# ─── Configuration ────────────────────────────────────────────────────────────

WORKER_URL = "https://gamenet.natelook.workers.dev"
TUNNEL_NAME = "GameNet"
CONFIG_FILE = os.path.join(os.path.expanduser("~"), ".gamenet_config.json")
SERVER_PUBLIC_KEY = "SLG8saonFoQ+B8x59SBeHCXouLTpVhyEYPqiUZoGqgI="
SERVER_ENDPOINT = "184.66.15.159:51820"
ALLOWED_IPS = "192.168.8.0/24, 192.168.1.0/24"
PORT = 7734

# ─── Utility ──────────────────────────────────────────────────────────────────

def resource_path(relative_path):
    """Works both for dev and PyInstaller."""
    try:
        base = sys._MEIPASS
    except AttributeError:
        base = os.path.abspath(".")
    return os.path.join(base, relative_path)

def wg_exe():
    path = resource_path("wireguard.exe")
    if not os.path.exists(path):
        # Fall back to PATH
        return "wireguard"
    return path

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_config(data):
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Warning: Could not save config: {e}")

def create_wg_conf(conf_path, private_key, client_ip):
    content = f"""[Interface]
PrivateKey = {private_key}
Address = {client_ip}

[Peer]
PublicKey = {SERVER_PUBLIC_KEY}
AllowedIPs = {ALLOWED_IPS}
Endpoint = {SERVER_ENDPOINT}
PersistentKeepalive = 25
"""
    with open(conf_path, "w") as f:
        f.write(content)

def is_tunnel_running():
    """Check if the WireGuard tunnel service is active."""
    try:
        result = subprocess.run(
            ["sc", "query", f"WireGuardTunnel${TUNNEL_NAME}"],
            capture_output=True, text=True
        )
        return "RUNNING" in result.stdout
    except Exception:
        return False

# ─── Flask App ────────────────────────────────────────────────────────────────

app = Flask(__name__, template_folder="templates", static_folder="static")
_connected = False
_lock = threading.Lock()

@app.route("/")
def index():
    return render_template("index.html", worker_url=WORKER_URL)

@app.route("/api/config", methods=["GET"])
def api_config():
    """Return saved local config (without private key for security)."""
    cfg = load_config()
    return jsonify({
        "provisioned": bool(cfg.get("private_key")),
        "name": cfg.get("name", ""),
        "client_ip": cfg.get("client_ip", "")
    })

@app.route("/api/provision", methods=["POST"])
def api_provision():
    """Save provisioned credentials from token redemption."""
    data = request.json or {}
    required = ["private_key", "client_ip", "name"]
    if not all(k in data for k in required):
        return jsonify({"error": "Missing required fields"}), 400

    save_config({
        "private_key": data["private_key"],
        "client_ip": data["client_ip"],
        "name": data["name"]
    })
    return jsonify({"success": True, "name": data["name"]})

@app.route("/api/status", methods=["GET"])
def api_status():
    """Return current connection status."""
    global _connected
    running = is_tunnel_running()
    with _lock:
        _connected = running
    return jsonify({
        "connected": running,
        "name": load_config().get("name", ""),
        "client_ip": load_config().get("client_ip", "")
    })

@app.route("/api/connect", methods=["POST"])
def api_connect():
    """Start the WireGuard tunnel."""
    global _connected

    cfg = load_config()
    if not cfg.get("private_key"):
        return jsonify({"error": "Not provisioned. Please enter your invite token."}), 400

    if is_tunnel_running():
        return jsonify({"connected": True, "message": "Already connected"})

    conf_path = os.path.join(os.path.expanduser("~"), f"{TUNNEL_NAME}.conf")
    try:
        create_wg_conf(conf_path, cfg["private_key"], cfg["client_ip"])
        result = subprocess.run(
            [wg_exe(), "/installtunnelservice", conf_path],
            capture_output=True, text=True, timeout=15
        )
        time.sleep(1)  # Give the service a moment to start
        connected = is_tunnel_running()
        with _lock:
            _connected = connected
        if connected:
            return jsonify({"success": True, "connected": True})
        else:
            return jsonify({"error": f"Tunnel failed to start. {result.stderr}"}), 500
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Connection timed out"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/disconnect", methods=["POST"])
def api_disconnect():
    """Stop the WireGuard tunnel."""
    global _connected
    try:
        subprocess.run(
            [wg_exe(), "/uninstalltunnelservice", TUNNEL_NAME],
            capture_output=True, text=True, timeout=10
        )
        conf_path = os.path.join(os.path.expanduser("~"), f"{TUNNEL_NAME}.conf")
        if os.path.exists(conf_path):
            os.remove(conf_path)
        with _lock:
            _connected = False
        return jsonify({"success": True, "connected": False})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/reset", methods=["POST"])
def api_reset():
    """Clear provisioned credentials (for re-setup)."""
    if os.path.exists(CONFIG_FILE):
        os.remove(CONFIG_FILE)
    return jsonify({"success": True})

# ─── Entry Point ──────────────────────────────────────────────────────────────

def open_browser():
    time.sleep(1.2)
    webbrowser.open(f"http://localhost:{PORT}")

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

if __name__ == "__main__":
    ensure_admin()
    print(f"""
+========================================+
|         GameNet Local Server           |
|   Running at http://localhost:{PORT}     |
+========================================+
""")
    threading.Thread(target=open_browser, daemon=True).start()
    app.run(host="127.0.0.1", port=PORT, debug=False)
