import os
from flask import Flask, request, jsonify, render_template, session, send_from_directory, redirect, url_for
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

# ⭐ 新增：Session 清除路由
@app.route("/reset_session")
def reset_session():
    # 銷毀所有 Session 數據，包括登入狀態和 intro_done 標記
    session.clear()
    return redirect(url_for('root')) # 重定向回根路由

# ---------------------- 步驟一：引導頁面路由 ----------------------

@app.route("/")
def root():
    # 檢查 Session 中是否有 'intro_done' 標記
    if not session.get('intro_done'):
        # 如果沒有，則從第一頁引導開始
        return redirect(url_for('intro_page'))
    
    # 否則進入遊戲主頁面 (index)
    return index()

@app.route("/intro_page")
def intro_page():
    # 確保不會無限重定向
    return render_template("intro.html")

@app.route("/rules_page")
def rules_page():
    return render_template("rule.html")

@app.route("/controls_page")
def controls_page():
    # 在最後一頁設置 Session 標記為 True，表示引導流程已完成
    session['intro_done'] = True
    return render_template("control.html")

# ---------------------- 步驟二：主遊戲與 API 路由 ----------------------

@app.route("/index") # 這是實際的遊戲主頁面
def index():
    # 檢查是否已登入，以決定渲染主菜單的初始狀態
    if session.get("user_id"):
        return render_template("index.html", logged_in=True, username=session.get("username"))
    return render_template("index.html", logged_in=False)

@app.route("/api/logout", methods=["POST"])
def logout():
    session.pop("user_id", None)
    session.pop("username", None)
    # 登出時也清除 intro_done 標記，以確保下次啟動流程完整
    session.pop('intro_done', None)
    return jsonify({"ok": 1}), 200

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
        return jsonify({"ok": 1}), 200
    except Exception as e:
        print(f"Registration error: {e}")
        return jsonify({"error": "server registration failed"}), 500
    finally:
        db.close()

@app.route("/api/login", methods=["POST"])
def login():
    db = SessionLocal()
    try:
        data = request.json
        
        # 處理前端 Session 檢查請求
        if data.get("check_session"):
             if session.get("user_id"):
                return jsonify({"username": session.get("username")}), 200
             return jsonify({"error": "not logged in"}), 401
        
        # 處理實際登入請求
        user = db.query(User).filter_by(username=data["username"]).first()
        if not user or not check_password_hash(user.password_hash, data["password"]):
            return jsonify({"error": "invalid"}), 400

        session["user_id"] = user.id
        session["username"] = user.username
        return jsonify({"username": user.username}), 200
        
    except Exception as e:
        print(f"Login processing error: {e}")
        return jsonify({"error": "server login failed"}), 500
    finally:
        db.close()

@app.route("/api/leaderboard_height")
def leaderboard_height():
    db = SessionLocal()
    try:
        top = db.query(User).order_by(User.best_height.desc()).limit(20)
        return jsonify([{"name": u.username, "height": u.best_height} for u in top]), 200
    except Exception as e:
        print(f"Leaderboard error: {e}")
        return jsonify({"error": "server error fetching data"}), 500
    finally:
        db.close()


@app.route("/api/leaderboard_speed")
def leaderboard_speed():
    db = SessionLocal()
    try:
        top = db.query(User).order_by(User.best_speed.asc()).limit(20)
        return jsonify([{"name": u.username, "time": u.best_speed / 100} for u in top if u.best_speed < 99999]), 200
    except Exception as e:
        print(f"Leaderboard error: {e}")
        return jsonify({"error": "server error fetching data"}), 500
    finally:
        db.close()
        
@app.route("/api/leaderboard_shooting")
def leaderboard_shooting():
    db = SessionLocal()
    try:
        top = db.query(User).order_by(User.best_shooting_score.desc()).limit(20)
        return jsonify([{"name": u.username, "score": u.best_shooting_score} for u in top]), 200
    except Exception as e:
        print(f"Leaderboard error: {e}")
        return jsonify({"error": "server error fetching data"}), 500
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
        return jsonify({"ok": 1, "new_best": is_new_best}), 200
    except Exception as e:
        print(f"Submission error: {e}")
        return jsonify({"error": "server submission failed"}), 500
    finally:
        db.close()

@app.route("/api/submit_speed", methods=["POST"])
def submit_speed():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not login"}), 401

    time_used_seconds = request.json.get("time", 99999) 
    time_used_centi = int(time_used_seconds * 100) 
    
    db = SessionLocal()
    try:
        user = db.query(User).get(uid)
        is_new_best = time_used_centi < user.best_speed
        if is_new_best:
            user.best_speed = time_used_centi
            db.commit()
        return jsonify({"ok": 1, "new_best": is_new_best}), 200
    except Exception as e:
        print(f"Submission error: {e}")
        return jsonify({"error": "server submission failed"}), 500
    finally:
        db.close()

@app.route("/api/submit_shooting", methods=["POST"])
def submit_shooting():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"error": "not login"}), 401

    score = request.json.get("score", 0)
    
    db = SessionLocal()
    try:
        user = db.query(User).get(uid)
        is_new_best = score > user.best_shooting_score
        if is_new_best:
            user.best_shooting_score = score
            db.commit()
        return jsonify({"ok": 1, "new_best": is_new_best}), 200
    except Exception as e:
        print(f"Submission error: {e}")
        return jsonify({"error": "server submission failed"}), 500
    finally:
        db.close()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)