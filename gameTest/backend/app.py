import os
import uuid
import eventlet
eventlet.monkey_patch()
from datetime import datetime
from flask import Flask, request, jsonify, render_template, session, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from flask_socketio import SocketIO
from models import init_db, SessionLocal, User
from game_logic import ai_loop, enemies
init_db()
app = Flask(__name__,
    static_folder="../frontend/static",
    template_folder="../frontend/templates")
app.config.update({
    "SESSION_COOKIE_SAMESITE": "None",
    "SESSION_COOKIE_SECURE": False,  # local dev 可 False，https 要 True
})
app.secret_key = "dev"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")
# ---------------------- REST API ----------------------
@app.route("/")
def index():
    return render_template("index.html")
@app.route("/api/register", methods=["POST"])
def register():
    db = SessionLocal()
    try:
        data = request.json
        if db.query(User).filter_by(username=data["username"]).first():
            return jsonify({"error": "username exists"}), 400

        user = User(username=data["username"],
                    password_hash=generate_password_hash(data["password"]))
        db.add(user)
        db.commit()
        return jsonify({"ok": 1})
    finally:
        db.close()
@app.route("/api/login", methods=["POST"])
def login():
    db = SessionLocal()
    try:
        data = request.json
        user = db.query(User).filter_by(username=data["username"]).first()
        if not user or not check_password_hash(user.password_hash, data["password"]):
            return jsonify({"error": "invalid"}), 400

        session["user_id"] = user.id
        return jsonify({"username": user.username})
    finally:
        db.close()
@app.route("/api/leaderboard")
def leaderboard():
    db = SessionLocal()
    try:
        top = db.query(User).order_by(User.best_score.desc()).limit(20)
        return jsonify([{"name": u.username, "score": u.best_score} for u in top])
    finally:
        db.close()
# ---- FIXED: assets path ----
ASSETS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/assets"))
@app.route("/assets/<path:filename>")
def serve_assets(filename):
    return send_from_directory(ASSETS_DIR, filename)
@app.route("/api/submit_score", methods=["POST"])
def submit_score():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not login"}), 401

    score = request.json.get("score", 0)
    
    db = SessionLocal()
    try:
        user = db.query(User).get(uid)
        if score > user.best_score:
            user.best_score = score
            db.commit()
        return jsonify({"ok": 1})
    finally:
        db.close()
# ---------------------- SocketIO ----------------------
@socketio.on("connect")
def on_connect():
    print("client connected")
@socketio.on("enemy_killed")
def enemy_killed(data):
    e_id = data.get("id")
    if e_id in enemies:
        enemies[e_id]["alive"] = False
        enemies.pop(e_id, None)
player_pos = [0, 1, 0]     # 全域玩家座標（AI loop 會讀）

@socketio.on("player_state")
def update_player_state(data):
    global player_pos
    p = data.get("pos", {})
    player_pos = [p.get("x", 0), p.get("y", 1), p.get("z", 0)]
# ---------------------- Start AI Loop ----------------------
ai_loop(socketio)
# ----------------------
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)
