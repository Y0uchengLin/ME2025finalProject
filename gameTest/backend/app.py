import os
from flask import Flask, request, jsonify, render_template, session, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from models import init_db, SessionLocal, User
from datetime import datetime

init_db()

app = Flask(__name__,
    static_folder="../frontend/static",
    template_folder="../frontend/templates")

app.config.update({
    "SECRET_KEY": "dev",
    "SESSION_COOKIE_SECURE": False, 
    "SESSION_PERMANENT": True,
})
app.secret_key = "dev"

# ---------------------- REST API ----------------------

@app.route("/")
def index():
    if session.get("user_id"):
        return render_template("index.html", logged_in=True, username=session.get("username"))
    return render_template("index.html", logged_in=False)

@app.route("/api/logout", methods=["POST"])
def logout():
    session.pop("user_id", None)
    session.pop("username", None)
    return jsonify({"ok": 1}), 200 # 確保返回 200

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
        return jsonify({"ok": 1}), 200 # 確保返回 200
    finally:
        db.close()

@app.route("/api/login", methods=["POST"])
def login():
    db = SessionLocal()
    try:
        data = request.json
        if data.get("check_session"):
             if session.get("user_id"):
                return jsonify({"username": session.get("username")}), 200
             return jsonify({"error": "not logged in"}), 401

        user = db.query(User).filter_by(username=data["username"]).first()
        if not user or not check_password_hash(user.password_hash, data["password"]):
            return jsonify({"error": "invalid"}), 400

        session["user_id"] = user.id
        session["username"] = user.username
        return jsonify({"username": user.username}), 200
    finally:
        db.close()

@app.route("/api/leaderboard_height")
def leaderboard_height():
    db = SessionLocal()
    try:
        top = db.query(User).order_by(User.best_height.desc()).limit(20)
        return jsonify([{"name": u.username, "height": u.best_height} for u in top]), 200
    finally:
        db.close()


@app.route("/api/leaderboard_speed")
def leaderboard_speed():
    db = SessionLocal()
    try:
        # 注意: DB 中存儲的 best_speed 是釐秒 (*100)，這裡需要轉換回秒數 (float)
        top = db.query(User).order_by(User.best_speed.asc()).limit(20)
        # Python 3 中整數除以 100 會返回浮點數
        return jsonify([{"name": u.username, "time": u.best_speed } for u in top if u.best_speed < 99999]), 200
    finally:
        db.close()

# ---- Assets Path ----
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
        is_new_best = height > user.best_height
        if is_new_best:
            user.best_height = height
            db.commit()
        # 修正: 確保返回 200 OK 狀態碼
        return jsonify({"ok": 1, "new_best": is_new_best}), 200
    finally:
        db.close()

@app.route("/api/submit_speed", methods=["POST"])
def submit_speed():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not login"}), 401

    # 提交的成績應該是秒數 (float)，我們在 DB 中依然以釐秒存儲以避免浮點數精度問題
    time_used_seconds = request.json.get("time", 99999) 
    time_used_centi = int(time_used_seconds * 100) 
    
    db = SessionLocal()
    try:
        user = db.query(User).get(uid)
        is_new_best = time_used_centi < user.best_speed
        if is_new_best:
            user.best_speed = time_used_centi
            db.commit()
        # 修正: 確保返回 200 OK 狀態碼
        return jsonify({"ok": 1, "new_best": is_new_best}), 200
    finally:
        db.close()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)