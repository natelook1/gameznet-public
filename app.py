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
from flask import Flask, request, jsonify, render_template, send_from_directory

# ─── Configuration ────────────────────────────────────────────────────────────

WORKER_URL = "https://gamenet.natelook.workers.dev"
TUNNEL_NAME = "GamezNET"
CONFIG_FILE = os.path.join(os.path.expanduser("~"), ".gameznet_config.json")
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
        # Fall back to Program Files if local exe is missing
        path = r"C:\Program Files\WireGuard\wireguard.exe"
    return path

# ─── Zombie Tunnel Prevention ─────────────────────────────────────────────────

def cleanup_tunnel():
    """
    Ensures the WireGuard tunnel drops when this Python script exits,
    even if the user forcibly closes the background command prompt window.
    """
    try:
        # Hide the command window during cleanup
        CREATE_NO_WINDOW = 0x08000000
        subprocess.run(
            [wg_exe(), "/uninstalltunnelservice", TUNNEL_NAME], 
            capture_output=True, 
            creationflags=CREATE_NO_WINDOW
        )
    except Exception:
        pass

# Register the cleanup function to run when the script terminates
atexit.register(cleanup_tunnel)

# ─── Flask App ────────────────────────────────────────────────────────────────

app = Flask(__name__)
_lock = threading.Lock()
_connected = False

@app.route("/")
def index():
    return render_template("index.html", connected=_connected)

@app.route("/api/status", methods=["GET"])
def api_status():
    return jsonify({"connected": _connected})

@app.route("/api/connect", methods=["POST"])
def api_connect():
    global _connected
    if not os.path.exists(CONFIG_FILE):
        return jsonify({"error": "No configuration found. Please redeem a token first."}), 400
        
    try:
        with open(CONFIG_FILE, "r") as f:
            config_data = json.load(f)
            
        # Build the WireGuard config file
        conf_content = f"""[Interface]
PrivateKey = {config_data['private_key']}
Address = {config_data['vpn_ip']}

[Peer]
PublicKey = {SERVER_PUBLIC_KEY}
Endpoint = {SERVER_ENDPOINT}
AllowedIPs = {ALLOWED_IPS}
PersistentKeepalive = 25
"""
        conf_path = os.path.join(os.path.expanduser("~"), f"{TUNNEL_NAME}.conf")
        with open(conf_path, "w") as f:
            f.write(conf_content)
            
        # Install and start tunnel service
        CREATE_NO_WINDOW = 0x08000000
        subprocess.run(
            [wg_exe(), "/installtunnelservice", conf_path], 
            capture_output=True, text=True, timeout=10,
            creationflags=CREATE_NO_WINDOW
        )
        
        with _lock:
            _connected = True
        return jsonify({"success": True, "connected": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/disconnect", methods=["POST"])
def api_disconnect():
    global _connected
    try:
        CREATE_NO_WINDOW = 0x08000000
        subprocess.run(
            [wg_exe(), "/uninstalltunnelservice", TUNNEL_NAME], 
            capture_output=True, text=True, timeout=10,
            creationflags=CREATE_NO_WINDOW
        )
        conf_path = os.path.join(os.path.expanduser("~"), f"{TUNNEL_NAME}.conf")
        if os.path.exists(conf_path):
            os.remove(conf_path)
            
        with _lock:
            _connected = False
        return jsonify({"success": True, "connected": False})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/save_config", methods=["POST"])
def api_save_config():
    """Saves the provisioned credentials after a successful token redemption."""
    data = request.json
    if not data or 'private_key' not in data or 'vpn_ip' not in data:
        return jsonify({"error": "Invalid payload"}), 400
        
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump({
                "private_key": data["private_key"],
                "vpn_ip": data["vpn_ip"]
            }, f)
        return jsonify({"success": True})
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
|         GamezNET Local Server          |
|   Running on http://localhost:{PORT}     |
|   Do not close this window while       |
|   playing. Close to disconnect.        |
+========================================+
""")
    # Open browser automatically when script starts
    threading.Thread(target=open_browser, daemon=True).start()
    
    # Run the server (Waitress is recommended for production, but Flask dev server is fine for local-only)
    app.run(host="127.0.0.1", port=PORT, debug=False)