console.log("GAME JS LOADED");
//--------------------------------------
// GLOBALS
//--------------------------------------
let canvas = document.getElementById("renderCanvas");
let engine = new BABYLON.Engine(canvas, true, { antialias: true });
let scene;
let camera;
let playerCapsule;
let hp = 100;
let kills = 0;
let gameTime = 120;
let gameStarted = false;
let keys = {};
let moveSpeed = 6;
let jumpForce = 6;
let playerReady = false;
let socket = io({
    withCredentials: true
});
// Enemy pool
let enemyMeshes = {};
let enemyTemplate = null;
//--------------------------------------
// Init Scene
//--------------------------------------
async function createScene() {
    await new Promise(resolve => {
        Ammo().then(instance => {
            window.Ammo = instance;
            resolve();
        });
    });

    console.log("AmmoJS Ready");

    //--------------------------------------
    // Create Scene FIRST
    //--------------------------------------
    scene = new BABYLON.Scene(engine);
    scene.collisionsEnabled = true;
    //--------------------------------------
    // Physics
    //--------------------------------------
    scene.enablePhysics(
        new BABYLON.Vector3(0, -9.81, 0),
        new BABYLON.AmmoJSPlugin()
    );
    //--------------------------------------
    // Debug text (MOVE HERE!!!)
    //--------------------------------------
    let debugDiv = document.createElement("div");
    debugDiv.style.position = "absolute";
    debugDiv.style.top = "10px";
    debugDiv.style.right = "10px";
    debugDiv.style.zIndex = "50";
    debugDiv.style.color = "white";
    debugDiv.style.fontSize = "14px";
    document.body.appendChild(debugDiv);

    scene.onBeforeRenderObservable.add(() => {
        if (!playerCapsule) return;
        
        let p = playerCapsule.position;
        let txt = `Player = (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})<br><br>`;
        
        for (let id in enemyMeshes) {
            let e = enemyMeshes[id].position;
            let dist = BABYLON.Vector3.Distance(p, e).toFixed(2);
            txt += `Enemy ${id}: (${e.x.toFixed(2)}, ${e.y.toFixed(2)}, ${e.z.toFixed(2)}) d=${dist}<br>`;
        }

        debugDiv.innerHTML = txt;
    });

    console.log("AmmoJS Ready");
     //--------------------------------------
    // Camera (FPS)
    //--------------------------------------
    camera = new BABYLON.UniversalCamera("camera", new BABYLON.Vector3(0, 2, -5), scene);
    camera.fov = 0.8;
    camera.minZ = 0.1;
    camera.attachControl(canvas, true);
    //--------------------------------------
    // Light
    //--------------------------------------
    new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
    //--------------------------------------
    // Player Capsule
    //--------------------------------------
    playerCapsule = BABYLON.MeshBuilder.CreateCapsule("playerCapsule",
        { height: 1.8, radius: 0.45 }, scene);
    playerCapsule.isVisible = false;
    playerCapsule.position = new BABYLON.Vector3(0, 3, 0);
    playerCapsule.physicsImpostor = new BABYLON.PhysicsImpostor(
        playerCapsule,
        BABYLON.PhysicsImpostor.CapsuleImpostor,
        {
            mass: 1,
            friction: 0.5,
            restitution: 0
        },
        scene
    );
    // Key improvements
    //playerCapsule.physicsImpostor.setLinearDamping(0.15);
    //playerCapsule.physicsImpostor.setAngularDamping(1.0);
 
//--------------------------------------
// Load Map (only once)
//--------------------------------------
const mapResult = await BABYLON.SceneLoader.ImportMeshAsync("", "/assets/", "map.glb", scene);
console.log("Loaded map meshes:");
mapResult.meshes.forEach((m, i) => {
    console.log(i, m.name, m.getTotalVertices());
});
// 找出所有真正有 geometry 的 mesh（>0 vertices）
let validMeshes = mapResult.meshes.filter(m => m.getTotalVertices() > 0);
validMeshes.forEach(m => {
    m.checkCollisions = true;
    m.physicsImpostor = new BABYLON.PhysicsImpostor(
        m,
        BABYLON.PhysicsImpostor.ConvexHullImpostor,
        { mass: 0, friction: 0.8, restitution: 0 },
        scene
    );
});
  if (validMeshes.length > 0) {
    let box = validMeshes[0].getBoundingInfo().boundingBox;
    let center = box.centerWorld;
    playerCapsule.position = center.add(new BABYLON.Vector3(0, 3, 0));
    camera.position = center.add(new BABYLON.Vector3(0, 3, -10));
    let mapMesh = BABYLON.Mesh.MergeMeshes(validMeshes, true, true, undefined, false, true, scene);
mapMesh.checkCollisions = true;
mapMesh.physicsImpostor = new BABYLON.PhysicsImpostor(
    mapMesh,
    BABYLON.PhysicsImpostor.MeshImpostor,
    { mass: 0, friction: 0.8, restitution: 0 },
    scene
);
// debug map bounding box
validMeshes.forEach(m => {
    console.log(m.name, m.getBoundingInfo().boundingBox);
});
}
     //--------------------------------------
    // Attach camera to capsule
    //--------------------------------------
    scene.registerBeforeRender(() => {
        if (!playerReady) return;
        let pos = playerCapsule.position.clone();
        pos.y += 0.55;
        camera.position = pos;
    });
//--------------------------------------
// Preload enemy.glb (pooling)
//--------------------------------------
BABYLON.SceneLoader.ImportMesh("", "/assets/", "enemy.glb", scene, (meshes) => {

    let valid = meshes.filter(m => m.getTotalVertices() > 0);

    if (valid.length === 0) {
        console.error("❌ enemy.glb has no valid mesh!");
        return;
    }

    enemyTemplate = BABYLON.Mesh.MergeMeshes(valid, true, true, undefined, false, true, scene);
    enemyTemplate.isPickable = true;
    enemyTemplate.setEnabled(false);

    console.log("Enemy template loaded");

    // 敵人模型確定載入後，再啟動 socket
    initSockets();

    playerReady = true;
});
    //--------------------------------------
    // Crosshair
    //--------------------------------------
    createCrosshair();
    //--------------------------------------
    // Input
    //--------------------------------------
    initInput();
    //--------------------------------------
    // Sockets
    //--------------------------------------
    return scene;
}
//--------------------------------------
// Movement (FPS physics-based)
//--------------------------------------
function updateMovement() {
    if (!playerReady) return;
    let physics = playerCapsule.physicsImpostor;
    let vel = physics.getLinearVelocity();
    let forward = camera.getForwardRay().direction;
    forward.y = 0;
    forward.normalize();
    let right = BABYLON.Vector3.Cross(forward, BABYLON.Vector3.Up()).normalize();
    let move = BABYLON.Vector3.Zero();
    if (keys["w"]) move = move.add(forward);
    if (keys["s"]) move = move.subtract(forward);
    if (keys["d"]) move = move.subtract(right);
    if (keys["a"]) move = move.add(right);
    if (move.length() > 0) move = move.normalize().scale(moveSpeed);
    physics.setLinearVelocity(new BABYLON.Vector3(
        move.x,
        vel.y,
        move.z
    ));
    // Jump
    if (keys[" "] && Math.abs(vel.y) < 0.05) {
        physics.setLinearVelocity(new BABYLON.Vector3(vel.x, jumpForce, vel.z));
    }
}
//--------------------------------------
// Crosshair
//--------------------------------------
function createCrosshair() {
    let cross = document.createElement("div");
    cross.id = "crosshair";
    cross.innerHTML = "+";
    document.body.appendChild(cross);
}
//--------------------------------------
// Input
//--------------------------------------
function initInput() {
    window.addEventListener("keydown", e => {
        if (!e.key) return;                // ← 修正點
        let k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        keys[k] = true;

        // 防止空白鍵捲動
        if (e.code === "Space") e.preventDefault();
    });

    window.addEventListener("keyup", e => {
        if (!e.key) return;
        let k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        keys[k] = false;
    });
}
//--------------------------------------
// Shoot
//--------------------------------------
function shoot() {
    let ray = camera.getForwardRay(100);
    let hit = scene.pickWithRay(ray);
    if (!hit.hit) return;
    let mesh = hit.pickedMesh;
    if (!mesh || !mesh.metadata || !mesh.metadata.enemyId) return;
    let id = mesh.metadata.enemyId;
    socket.emit("enemy_killed", { id });
    kills++;
    document.getElementById("kills").innerText = kills;
    mesh.dispose();
    delete enemyMeshes[id];
}
window.addEventListener("mousedown", shoot);
//--------------------------------------
// Enemy pooling
//--------------------------------------
function spawnEnemyMesh(id, pos) {
    let clone = enemyTemplate.clone("enemy_" + id);
    clone.setEnabled(true);

    clone.metadata = { enemyId: id };
    clone.checkCollisions = true;

    clone.position.set(pos[0], pos[1], pos[2]);
    enemyMeshes[id] = clone;
}
//--------------------------------------
// Enemy State Sync
//--------------------------------------
function initSockets() {

    // 敵人出生
    socket.on("enemy_spawn", data => {
        spawnEnemyMesh(data.id, data.pos);
    });

    // 敵人位置同步（AI loop 傳來）
    socket.on("enemy_state", data => {
        let mesh = enemyMeshes[data.id];
        if (!mesh) return;

        mesh.position.x = data.pos[0];
        mesh.position.y = 0;
        mesh.position.z = data.pos[2];
    });
}
//--------------------------------------
// Collision (player hit by enemy)
//--------------------------------------
function checkEnemyCollision() {
    for (let id in enemyMeshes) {
        let e = enemyMeshes[id];
        if (!e) continue;
        if (BABYLON.Vector3.Distance(e.position, playerCapsule.position) < 1.1) {
            hp -= 1;
            document.getElementById("hp").innerText = hp;
            if (hp <= 0) respawnPlayer();
        }
    }
}
//--------------------------------------
// Respawn
//--------------------------------------
function respawnPlayer() {
    hp = 100;
    document.getElementById("hp").innerText = hp;
    playerCapsule.position.copyFromFloats(0, 3, 0);
    playerCapsule.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
}
//--------------------------------------
// Timer
//--------------------------------------
function updateTimer() {
    if (!gameStarted) return;
    gameTime -= engine.getDeltaTime() / 1000;
    document.getElementById("time").innerText = Math.floor(gameTime);
    if (gameTime <= 0) endGame();
}
//--------------------------------------
// End Game
//--------------------------------------
function endGame() {
    gameStarted = false;
    fetch("/api/submit_score", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        credentials: "include",
        body: JSON.stringify({ score: kills })
    }).then(() => {
        alert("Time's up! Score: " + kills);
    });
}
//--------------------------------------
// Game Loop
//--------------------------------------
function mainLoop() {
    updateMovement();
    checkEnemyCollision();
    updateTimer();

    // ---- FIX: Player fell below map ----
    if (playerCapsule.position.y < -10) {
        respawnPlayer();
    }

    socket.emit("player_state", {
        pos: {
            x: playerCapsule.position.x,
            y: playerCapsule.position.y,
            z: playerCapsule.position.z
        }
    });
}
//--------------------------------------
// Start Loop
//--------------------------------------
function startLoop() {
    scene.registerBeforeRender(mainLoop);
}
//--------------------------------------
// UI + Start game
//--------------------------------------
function startGame() {
    let username = document.getElementById("username").value;
    let password = document.getElementById("password").value;
    fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password })
    }).then(r => r.json()).then(res => {
        if (res.error) return alert(res.error);
        document.getElementById("login_panel").style.display = "none";
        document.getElementById("hud").style.display = "block";
        gameStarted = true;
        startLoop();
    });
}
function register() {
    let username = document.getElementById("username").value;
    let password = document.getElementById("password").value;
    fetch("/api/register", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password })
    }).then(r => r.json()).then(res => {
        if (res.error) return alert(res.error);
        alert("Registered!");
    });
}
//--------------------------------------
// Boot
//--------------------------------------
createScene().then(() => {
    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
    document.getElementById("btn_login").onclick = startGame;
    document.getElementById("btn_register").onclick = register;
});
