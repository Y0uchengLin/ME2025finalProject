import random
import time
import threading
# enemies: enemy_id → {pos, alive}
enemies = {}
def spawn_enemy():
    enemy_id = str(random.randint(100000, 999999))
    enemies[enemy_id] = {
        "pos": [random.uniform(-10, 10), 0, random.uniform(-10, 10)],
        "alive": True
    }
    return enemy_id
def random_move(socketio):
    """敵人亂走：每 0.5 秒移動一點點並通知前端"""
    for e_id, e in list(enemies.items()):
        if not e["alive"]:
            continue
        e["pos"][0] += random.uniform(-0.3, 0.3)
        e["pos"][2] += random.uniform(-0.3, 0.3)
        socketio.emit("enemy_state", {"id": e_id, "pos": e["pos"]})
def move_toward_player(socketio, player_pos):
    """讓所有敵人朝玩家前進"""
    px, py, pz = player_pos

    for e_id, e in list(enemies.items()):
        if not e["alive"]:
            continue

        ex, ey, ez = e["pos"]

        # direction to player
        dx = px - ex
        dz = pz - ez

        dist = (dx*dx + dz*dz) ** 0.5
        if dist < 0.001:
            continue

        # normalize (speed = 0.05)
        dx /= dist
        dz /= dist

        e["pos"][0] += dx * 0.05
        e["pos"][2] += dz * 0.05

        socketio.emit("enemy_state", {
            "id": e_id,
            "pos": e["pos"]
        })
def ai_loop(socketio):
    def loop():
        while True:

           
            if len(enemies) < 5:
                e_id = spawn_enemy()
                socketio.emit("enemy_spawn", {
                    "id": e_id,
                    "pos": enemies[e_id]["pos"]
                })
            from app import player_pos
            move_toward_player(socketio, player_pos)

            time.sleep(0.1)

    threading.Thread(target=loop, daemon=True).start()
