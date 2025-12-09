console.log("GAME JS LOADED (Single Player Mode FINAL FIX v25)");

//--------------------------------------
// GLOBALS
//--------------------------------------
let gameMode = null;
let startTime = 0; 
let pausedTime = 0; 
let heightTimeOffset = 0; 
let savedVelocity = BABYLON.Vector3.Zero();      
let savedAngularVelocity = BABYLON.Vector3.Zero(); 
let canvas, engine, scene, camera, playerCapsule;

// 遊戲狀態變數
let gameTime = 0; 
let gameStarted = false;
let keys = {};
let moveSpeed = 6;
let jumpForce = 6;
let playerReady = false;
let paused = false; // 暫停狀態
let maxHeight = 0; // 現在追蹤玩家達到的絕對 Y 坐標最大值
let isPlayerOnGround = false;

// AmmoJS 剛體狀態常數
const CF_KINEMATIC_OBJECT = 2; // 剛體進入靜態控制狀態 (AmmoJS 常數)
const ACTIVE_TAG = 1;

// 模式定義和起始點 (Y=1 的安全高度)
const START_POS_HEIGHT = new BABYLON.Vector3(3.8, 1, 5.23); 
const START_POS_SPEED = new BABYLON.Vector3(-8, 5, -4);    
const GOAL_POS_SPEED = new BABYLON.Vector3(-37.4, 3, 21);
const HEIGHT_LIMIT_TIME = 60; 

//--------------------------------------
// Physics Utility: Ammo 原生傳送
//--------------------------------------
function setAmmoPosition(mesh, position, rotation) {
    if (!mesh || !mesh.physicsImpostor || !window.Ammo) return;

    const body = mesh.physicsImpostor.physicsBody;
    if (!body) return;
    
    const transform = body.getWorldTransform();
    const newPos = new Ammo.btVector3(position.x, position.y, position.z);
    
    transform.setOrigin(newPos);
    
    body.setWorldTransform(transform);
    body.activate(); 
    
    mesh.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
    mesh.physicsImpostor.setAngularVelocity(BABYLON.Vector3.Zero());
    
    Ammo.destroy(newPos);
    
    mesh.position.copyFrom(position);
}


//--------------------------------------
// Init Scene
//--------------------------------------
async function createScene() {
    canvas = document.getElementById("renderCanvas");
    engine = new BABYLON.Engine(canvas, true, { antialias: true });

    await new Promise(resolve => {
        Ammo().then(instance => {
            window.Ammo = instance;
            resolve();
        });
    });

    console.log("AmmoJS Ready");

    scene = new BABYLON.Scene(engine);
    scene.collisionsEnabled = true;
    const physicsPlugin = new BABYLON.AmmoJSPlugin();
    scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), physicsPlugin); 

    await loadMap(); 
    
    camera = new BABYLON.UniversalCamera("camera", new BABYLON.Vector3(0, 2, -5), scene);
    camera.fov = 0.8;
    camera.minZ = 0.1;
    camera.attachControl(canvas, true);
    camera.angularSensibility = 1000;

    // 首次點擊畫面即可鎖定指標，與菜單切換分離
    canvas.addEventListener("click", () => {
        if (gameStarted && !paused && document.pointerLockElement !== canvas) {
            engine.enterPointerlock();
        }
    });

    new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);

    playerCapsule = BABYLON.MeshBuilder.CreateCapsule("playerCapsule", { height: 1.8, radius: 0.45 }, scene);
    playerCapsule.isVisible = false;
    playerCapsule.checkCollisions = true;
    playerCapsule.position = START_POS_HEIGHT.clone(); 
    
    playerCapsule.physicsImpostor = new BABYLON.PhysicsImpostor(
        playerCapsule,
        BABYLON.PhysicsImpostor.CapsuleImpostor,
        { mass: 80, friction: 0.5, restitution: 0, disableBidirectionalTransformation: true },
        scene
    );
    
    playerCapsule.physicsImpostor.onPhysicsBodyCreated = (impostor) => {
        const ammoBody = impostor.physicsBody;
        ammoBody.setDamping(0.9, 0); 
    };

    scene.registerBeforeRender(() => {
        if (!playerReady) return;

        let pos = playerCapsule.position.clone();
        pos.y += 0.55;
        camera.position = pos;

        playerCapsule.rotation.y = camera.rotation.y;

        const p = playerCapsule.position;
        if (document.getElementById("position_value")) {
             document.getElementById("position_value").innerText = 
                `X: ${p.x.toFixed(2)} Y: ${p.y.toFixed(2)} Z: ${p.z.toFixed(2)}`;
        }

        if (gameStarted && !paused) {
            mainLoop();
        }
    });

    playerReady = true;
    createCrosshair();
    initInput();
    initUIEvents();

    respawnPlayer("safe"); 
    await new Promise(resolve => setTimeout(resolve, 50)); 
    respawnPlayer("safe");

    return scene;
}

async function loadMap() {
    const mapResult = await BABYLON.SceneLoader.ImportMeshAsync("", "/assets/", "map.glb", scene);
    let validMeshes = mapResult.meshes.filter(m => m.getTotalVertices() > 0);
    
    if (validMeshes.length > 0) {
        let mapMesh = BABYLON.Mesh.MergeMeshes(validMeshes, true, true, undefined, false, true, scene);
        mapMesh.checkCollisions = true;
        mapMesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            mapMesh,
            BABYLON.PhysicsImpostor.MeshImpostor, 
            { mass: 0, friction: 0.8, restitution: 0 },
            scene
        );
    }
}

function createCrosshair() {
    let cross = document.createElement("div");
    cross.id = "crosshair";
    cross.innerHTML = "+"; 
    document.body.appendChild(cross);
}

function initInput() {
    window.addEventListener("keydown", e => {
        if (!e.key) return;
        let k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        keys[k] = true;

        if (e.code === "Space") e.preventDefault();
        if (e.key === "Escape" && gameStarted) togglePause();
    });

    window.addEventListener("keyup", e => {
        if (!e.key) return;
        let k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        keys[k] = false;
    });
}

// 修正點：暫停邏輯
function togglePause() {
    if (!gameStarted) return;
    paused = !paused; // 暫停狀態切換
    const menu = document.getElementById("pause_menu");
    if(menu) menu.style.display = paused ? "flex" : "none";
    
    const body = playerCapsule.physicsImpostor.physicsBody;

    if (paused) {
        engine.exitPointerlock(); // 釋放滑鼠輸入
        if (playerCapsule.physicsImpostor && playerCapsule.physicsImpostor.physicsBody && window.Ammo) {
            
            // 1. 儲存當前的速度
            savedVelocity = playerCapsule.physicsImpostor.getLinearVelocity().clone();
            savedAngularVelocity = playerCapsule.physicsImpostor.getAngularVelocity().clone();
            
            // 2. 清除速度並凍結 (防止任何慣性立刻作用)
            playerCapsule.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
            playerCapsule.physicsImpostor.setAngularVelocity(BABYLON.Vector3.Zero());
            
            // 3. 核心修正: 將剛體質量設為 0，並設置為 Kinematic (完全靜態)
            playerCapsule.physicsImpostor.setMass(0);
            let flags = body.getCollisionFlags();
            body.setCollisionFlags(flags | CF_KINEMATIC_OBJECT);
            
            // 4. 強制進入非模擬狀態
            body.setActivationState(4); // DISABLE_SIMULATION
        }
        
        // 速度模式/登山模式暫停計時錨點
        if (gameMode === "speed") {
            pausedTime = gameTime; 
            startTime = 0; 
        } else if (gameMode === "height") {
            heightTimeOffset = HEIGHT_LIMIT_TIME - gameTime; 
        }

    } else {
        // 繼續時，恢復鎖定
        engine.enterPointerlock();

        if (playerCapsule.physicsImpostor && playerCapsule.physicsImpostor.physicsBody && window.Ammo) {
            
            // 1. 恢復碰撞旗標和質量 (動態剛體)
            playerCapsule.physicsImpostor.setMass(80);
            let flags = body.getCollisionFlags();
            body.setCollisionFlags(flags & ~CF_KINEMATIC_OBJECT);

            // 2. 恢復 Ammo 剛體模擬
            playerCapsule.physicsImpostor.physicsBody.setActivationState(1); // ACTIVE_TAG

            // 3. 恢復儲存的速度 (保持慣性)
            playerCapsule.physicsImpostor.setLinearVelocity(savedVelocity);
            playerCapsule.physicsImpostor.setAngularVelocity(savedAngularVelocity);
        }
        
        // 速度模式/登山模式繼續計時錨點
        if (gameMode === "speed") {
            startTime = performance.now() - (pausedTime * 1000); 
        } else if (gameMode === "height") {
            // 恢復剩餘時間
            gameTime = HEIGHT_LIMIT_TIME - heightTimeOffset;
        }
    }
}

// 鎖定鍵盤移動
function handlePlayerMovement(deltaTime) {
    if (paused) return; // 如果暫停，立即退出函數，不接受任何輸入

    const origin = playerCapsule.position.clone();
    origin.y -= 0; 
    const direction = new BABYLON.Vector3(0, -1, 0);
    // 應用射線長度 0.5
    const ray = new BABYLON.Ray(origin, direction, 0.6); 
    const hit = scene.pickWithRay(ray, (mesh) => mesh.name !== "playerCapsule" && mesh.isPickable);

    isPlayerOnGround = hit && hit.hit;

    const velocity = playerCapsule.physicsImpostor.getLinearVelocity();
    let moveVector = BABYLON.Vector3.Zero();

    const forward = camera.getDirection(BABYLON.Vector3.Forward());
    forward.y = 0;
    forward.normalize();
    const right = camera.getDirection(BABYLON.Vector3.Right());
    right.y = 0;
    right.normalize();

    if (keys['w']) moveVector.addInPlace(forward);
    if (keys['s']) moveVector.subtractInPlace(forward);
    if (keys['a']) moveVector.subtractInPlace(right);
    if (keys['d']) moveVector.addInPlace(right);

    if (moveVector.length() > 0) {
        moveVector.normalize();
        moveVector.scaleInPlace(moveSpeed * deltaTime * 60); 
    }

    let newVelocity = new BABYLON.Vector3(moveVector.x, velocity.y, moveVector.z);

    if (keys[' '] && isPlayerOnGround) {
        newVelocity.y = jumpForce;
        keys[' '] = false;
    }
    
    playerCapsule.physicsImpostor.setLinearVelocity(newVelocity);
}

function mainLoop() {
    // 掉落偵測：Y < -10 就重生 (不重設計時)
    if (playerCapsule.position.y < -10) {
        if (gameMode) {
             respawnPlayer(gameMode);
        } else {
             respawnPlayer("safe"); 
        }
        return;
    }

    handlePlayerMovement(engine.getDeltaTime() / 1000.0);
    updateModeLogic();
    updateTimer();
}

function updateModeLogic() {
    if (!gameMode) return;
    const isHeightMode = gameMode === "height";

    if (isHeightMode) {
        
        const playerY = playerCapsule.position.y;
        
        // 1. 更新歷史最大 Y 坐標
        if (playerY > maxHeight) {
            maxHeight = playerY;
        }

        // 2. 應用分數計算規則：H = Y_max - 1
        let recordScore = 0;
        
        // 只有當最大 Y 坐標超過 Y=1 (基準點) 時，才計算分數
        if (maxHeight > 1.0) {
            // 成績 = 歷史最大 Y 坐標 - 1
            recordScore = maxHeight - 1.0; 
        } 
        
        // 顯示分數，確保不為負
        document.getElementById("height_value").innerText = Math.max(0, recordScore).toFixed(2);
    } 

    if (gameMode === "speed") {
        let p = playerCapsule.position;
        if (BABYLON.Vector3.Distance(p, GOAL_POS_SPEED) < 5.0) {
            endGame(true); 
        }
    }
}

// 修正點：鎖定 DOM 更新，避免視覺倒數
function updateTimer() {
    if (!gameStarted) return;
    const isHeightMode = gameMode === "height";
    const deltaTime = engine.getDeltaTime() / 1000.0;

    if (isHeightMode) {
        // 登山模式：基於 deltaTime 倒數計時
        gameTime -= deltaTime; 
        const timeLeft = Math.max(0, gameTime);
        
        // 鎖定 DOM 更新: 只有在非暫停狀態下才改變 HUD 數字
        if (!paused) { 
            document.getElementById("time_value").innerText = timeLeft.toFixed(0);
        }
        
        if (gameTime <= 0) endGame(false); 
    } else { 
        // 競速模式：基於時間戳累計
        if (startTime > 0) {
            gameTime = (performance.now() - startTime) / 1000;
        } else {
            // 暫停時，顯示儲存的暫停時間
            gameTime = pausedTime;
        }
        
        // 鎖定 DOM 更新
        if (!paused) {
            document.getElementById("time_value").innerText = gameTime.toFixed(2);
        }
    }
}

function endGame(completed) {
    gameStarted = false;
    paused = false; 
    engine.exitPointerlock();
    
    const isHeightMode = gameMode === "height";
    let finalResult = "";
    let score = 0;

    if (isHeightMode) {
        // 提交時使用 Y_max - 1 的整數值
        let finalRecordedHeight = Math.max(0, maxHeight - 1.0);
        score = Math.floor(finalRecordedHeight); 
        finalResult = `時間到! 最終高度: ${finalRecordedHeight.toFixed(2)}m (記錄 ${score}m)`;
    } else {
        finalResult = completed ? `恭喜完成! 耗時: ${gameTime.toFixed(2)}s` : "未完成。";
        score = completed ? gameTime : 99999;
    }

    submitScore(isHeightMode, score);
    
    document.getElementById("hud").style.display = "none";
    document.getElementById("pause_menu").style.display = "none";
    document.getElementById("game_over_menu").style.display = "flex";
    document.getElementById("final_result_text").innerText = finalResult;
    document.getElementById("crosshair").style.display = "none";
}

async function submitScore(isHeightMode, score) {
    const endpoint = isHeightMode ? "/api/submit_height" : "/api/submit_speed";
    const body = isHeightMode ? { height: score } : { time: score };

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include", 
            body: JSON.stringify(body)
        });

        const res = await response.json();

        if (response.status === 401) {
            document.getElementById("new_best_text").innerText = `分數提交失敗: 未登入`;
        } else if (res.ok) {
            const message = res.new_best ? "恭喜! 創下新的最佳紀錄!" : "紀錄已提交。";
            document.getElementById("new_best_text").innerText = message;
        } else {
            document.getElementById("new_best_text").innerText = `分數提交失敗: ${res.error || '未知錯誤'}`;
        }
    } catch (e) {
        document.getElementById("new_best_text").innerText = "網路錯誤，無法提交分數。";
        console.error("Score submission error:", e);
    }
}

// 數據重設邏輯
function _resetGameData(mode) {
    if (mode === "height") {
        gameTime = HEIGHT_LIMIT_TIME;
        heightTimeOffset = 0; 
        
        // ⭐ 修正點 7: 初始 maxHeight 設為 1.0 (Y=1是基準點)
        maxHeight = 1.0; 
        
        document.getElementById("time_value").innerText = gameTime.toFixed(0);
        document.getElementById("height_value").innerText = 0.00.toFixed(2); // 顯示 0.00
    } else if (mode === "speed") {
        gameTime = 0; 
        pausedTime = 0;
        startTime = performance.now(); 
        document.getElementById("time_value").innerText = gameTime.toFixed(2);
    }
}

//--------------------------------------
// 重生邏輯 (只處理傳送和 HUD 更新)
//--------------------------------------
function respawnPlayer(mode) {
    const startPos = 
        mode === "height" ? START_POS_HEIGHT : 
        mode === "speed" ? START_POS_SPEED : 
        new BABYLON.Vector3(0, 5, 0); 

    setAmmoPosition(playerCapsule, startPos, playerCapsule.rotation);
    
    // 確保解除物理凍結，否則無法移動
    if (playerCapsule.physicsImpostor && playerCapsule.physicsImpostor.physicsBody && window.Ammo) {
        playerCapsule.physicsImpostor.physicsBody.setActivationState(1); // ACTIVE_TAG
    }

    gameMode = mode !== "safe" ? mode : null; 
    
    if (mode === "safe") {
        gameStarted = false;
    } else if (gameMode === "height" || gameMode === "speed") {
        gameStarted = true;
        
        // 掉落重生時，更新顯示 (不重設計時)
        if (gameMode === "height") {
            const recordedHeight = Math.max(0, maxHeight - 1.0); // 使用 Y_max - 1 邏輯
            document.getElementById("time_value").innerText = Math.max(0, gameTime).toFixed(0);
            document.getElementById("height_value").innerText = Math.max(0, recordedHeight).toFixed(2);
        } else if (gameMode === "speed") {
            document.getElementById("time_value").innerText = gameTime.toFixed(2);
            // 掉落重生時，重新錨定 startTime
            if (startTime > 0) {
                startTime = performance.now() - (gameTime * 1000);
            }
        }
    }
}


//--------------------------------------
// UI Events
//--------------------------------------
function initUIEvents() {
    document.getElementById("btn_login").onclick = login;
    document.getElementById("btn_register").onclick = register;
    document.getElementById("btn_logout").onclick = logout;

    document.getElementById("mode_height").onclick = () => { startMode("height"); };
    document.getElementById("mode_speed").onclick = () => { startMode("speed"); };
    document.getElementById("btn_show_leaderboard").onclick = showLeaderboard;
    document.getElementById("btn_back_from_leaderboard").onclick = hideLeaderboard;

    document.getElementById("btn_resume").onclick = togglePause;
    
    // 修正點 1: 重新開始 (先繼續遊戲，再傳送)
    document.getElementById("btn_restart").onclick = () => {
        // 1. 強制解除暫停狀態 (這會執行 togglePause 內部的 enterPointerlock)
        if (paused) togglePause();
        
        // 2. 執行快速傳送 (只傳送，不重設數據)
        respawnPlayer(gameMode);
    };
    
    // 修正點 2: 返回主選單 (強制解除暫停，並立即切換)
    document.getElementById("btn_exit").onclick = () => {
        // 1. 強制解除暫停狀態
        if (paused) togglePause();
        
        // 2. 立即返回主菜單
        backToMainMenu();
    };
    document.getElementById("btn_back_to_menu_from_gameover").onclick = backToMainMenu;

    checkLoginStatus();
}

function register() { 
    let username = document.getElementById("username").value;
    let password = document.getElementById("password").value;
    fetch("/api/register", {
        method:"POST", headers:{ "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ username, password })
    }).then(r => r.json()).then(res => {
        if (res.error) return alert(res.error);
        alert("註冊成功，請登入！");
    });
}

function login() { 
    let username = document.getElementById("username").value;
    let password = document.getElementById("password").value;
    fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ username, password })
    }).then(r => r.json()).then(res => {
        if (res.error) return alert(res.error);
        document.getElementById("welcome_msg").innerText = `歡迎, ${res.username}!`;
        document.getElementById("auth_panel").style.display = "none";
        document.getElementById("mode_panel").style.display = "flex";
    });
}

function logout() {
     fetch("/api/logout", { method: "POST" }).then(() => {
        backToMainMenu(true);
    });
}

function checkLoginStatus() {
    fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ "check_session": true })
    }).then(r => {
        if (r.ok) return r.json();
        throw new Error('Not logged in');
    }).then(res => {
        if (res.username) {
            document.getElementById("welcome_msg").innerText = `歡迎, ${res.username}!`;
            document.getElementById("auth_panel").style.display = 'none';
            document.getElementById("mode_panel").style.display = 'flex';
        }
    }).catch(e => {
        document.getElementById("auth_panel").style.display = 'flex';
        document.getElementById("mode_panel").style.display = 'none';
    });
}

function startMode(mode) {
    gameMode = mode; 
    gameStarted = true;
    paused = false; 
    
    document.getElementById("main_menu_panel").style.display = "none"; 
    document.getElementById("game_over_menu").style.display = "none";
    document.getElementById("hud").style.display = "flex";
    document.getElementById("crosshair").style.display = "block";

    _resetGameData(mode);
    respawnPlayer(mode); 
    
    if (!startMode.loopStarted) {
        scene.registerBeforeRender(mainLoop);
        startMode.loopStarted = true;
    }
}

function backToMainMenu(forceLogout = false) {
    gameStarted = false;
    paused = false;
    gameMode = null; 

    document.getElementById("hud").style.display = "none";
    document.getElementById("pause_menu").style.display = "none";
    document.getElementById("game_over_menu").style.display = "none";
    document.getElementById("crosshair").style.display = "none";
    
    respawnPlayer("safe"); 

    document.getElementById("main_menu_panel").style.display = "flex";
    document.getElementById("mode_panel").style.display = 'flex';
    document.getElementById("leaderboard_panel").style.display = 'none';

    if (forceLogout) {
        document.getElementById("auth_panel").style.display = 'flex';
        document.getElementById("mode_panel").style.display = 'none';
    }
}

function showLeaderboard() {
    document.getElementById("mode_panel").style.display = 'none';
    document.getElementById("leaderboard_panel").style.display = 'flex';
    fetchLeaderboard('height'); 
}
function hideLeaderboard() {
    document.getElementById("leaderboard_panel").style.display = 'none';
    document.getElementById("mode_panel").style.display = 'flex';
}
function fetchLeaderboard(mode) {
    const content = document.getElementById("leaderboard_content");
    const endpoint = mode === 'height' ? "/api/leaderboard_height" : "/api/leaderboard_speed";
    const title = mode === 'height' ? '最高高度 (m)' : '最快時間 (s)';

    content.innerHTML = '<table><tr><th>#</th><th>玩家</th><th>' + title + '</th></tr></table>';
    document.getElementById("btn_toggle_leaderboard_mode").onclick = () => {
        fetchLeaderboard(mode === 'height' ? 'speed' : 'height');
    };

    fetch(endpoint).then(r => r.json()).then(data => {
        let html = `<table><tr><th>#</th><th>玩家</th><th>${title}</th></tr>`;
        data.forEach((item, index) => {
            const score = mode === 'height' ? item.height : (item.time / 100).toFixed(2);
            if(score < 99999) html += `<tr><td>${index + 1}</td><td>${item.name}</td><td>${score}</td></tr>`;
        });
        html += '</table>';
        content.innerHTML = html;
    });
}

//--------------------------------------
// Boot
//--------------------------------------
createScene().then(() => {
    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
});