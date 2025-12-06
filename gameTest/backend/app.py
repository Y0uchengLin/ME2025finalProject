import os
import uuid
import eventlet
eventlet.monkey_patch()
from datetime import datetime
from flask import Flask, request, jsonify, render_template, session, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from flask_socketio import SocketIO
from models import init_db, SessionLocal, User
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
@app.route("/api/leaderboard_height")
def leaderboard_height():
    db = SessionLocal()
    try:
        top = db.query(User).order_by(User.best_height.desc()).limit(20)
        return jsonify([{"name": u.username, "height": u.best_height} for u in top])
    finally:
        db.close()


@app.route("/api/leaderboard_speed")
def leaderboard_speed():
    db = SessionLocal()
    try:
        top = db.query(User).order_by(User.best_speed.asc()).limit(20)  # 越小越好
        return jsonify([{"name": u.username, "time": u.best_speed} for u in top])
    finally:
        db.close()
# ---- FIXED: assets path ----
ASSETS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/assets"))
@app.route("/assets/<path:filename>")
def serve_assets(filename):
    return send_from_directory(ASSETS_DIR, filename)
@app.route("/api/submit_height", methods=["POST"])
def submit_height():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not login"}), 401

    height = request.json.get("height", 0)
    db = SessionLocal()
    try:
        user = db.query(User).get(uid)
        if height > user.best_height:
            user.best_height = height
            db.commit()
        return jsonify({"ok": 1})
    finally:
        db.close()


@app.route("/api/submit_speed", methods=["POST"])
def submit_speed():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not login"}), 401

    time_used = request.json.get("time", 99999)
    db = SessionLocal()
    try:
        user = db.query(User).get(uid)
        # 越快越好
        if time_used < user.best_speed:
            user.best_speed = time_used
            db.commit()
        return jsonify({"ok": 1})
    finally:
        db.close()


@socketio.on("player_state")
def update_player_state(data):
    global player_pos
    p = data.get("pos", {})
    player_pos = [p.get("x", 0), p.get("y", 1), p.get("z", 0)]

# ----------------------
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)
