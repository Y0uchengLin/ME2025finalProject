console.log("GAME JS LOADED (Single Player Mode FINAL FIX v38 - Intro Flow Check)");

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

// 射擊模式專用變數
let targets = [];
let shootingScore = 0;
const SHOOTING_TIME_LIMIT = 60;
// 射擊模式的起始點
const START_POS_SHOOTING = new BABYLON.Vector3(2, 1, -11.4);
const TARGET_SPAWN_RADIUS = 15;
const MAX_TARGETS = 10; 
const TARGET_SIZE = 0.5;

// 測試模式變數
let debugMode = false;
let teleportSpeed = 0.5; // 每秒傳送的米數 (用於 Y 軸)

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

    // 檢查 physicsBody 是否存在
    const body = mesh.physicsImpostor.physicsBody;
    if (!body) {
        console.warn("Ammo physics body not ready for teleport.");
        // 確保至少更新 Babylon 位置
        mesh.position.copyFrom(position);
        return; 
    }
    
    const transform = body.getWorldTransform();
    const newPos = new Ammo.btVector3(position.x, position.y, position.z);
    
    transform.setOrigin(newPos);
    
    body.setWorldTransform(transform);
    body.activate(); 
    
    // 清除速度，這是非物理傳送的關鍵
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
    
    // 設置角度靈敏度
    camera.angularSensibility = 1000; 

    // 確保滑鼠輸入是線性的
    if (camera.inputs.attached.mouse) {
        camera.inputs.attached.mouse.angularSensibility = 1000;
    }
    
    // 新增事件以阻止滑鼠右鍵選單
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

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
        const ammoBody = impostor.physicsImpostor.physicsBody;
        ammoBody.setDamping(0.9, 0); 
    };

    // 新增射擊事件監聽器
    window.addEventListener("mousedown", (e) => {
        if (e.button === 0 && gameStarted && !paused && gameMode === "shooting") {
            handleShooting();
        }
    });


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
        
        handleDebugMode();
    });

    playerReady = true;
    createCrosshair();
    initInput();
    // initUIEvents() 將在 createScene 外部調用

    respawnPlayer("safe"); 
    await new Promise(resolve => setTimeout(resolve, 50)); 
    respawnPlayer("safe");

    return scene;
}

// ⭐ 目標生成函數
function createTarget(position) {
    const target = BABYLON.MeshBuilder.CreateBox("target", { size: TARGET_SIZE }, scene);
    target.position = position;
    
    const material = new BABYLON.StandardMaterial("targetMat", scene);
    material.diffuseColor = new BABYLON.Color3(1, 0, 0); // 紅色
    target.material = material;
    
    // 設置為靜態物體，防止重力影響
    target.physicsImpostor = new BABYLON.PhysicsImpostor(
        target, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0 }, scene
    );
    target.isPickable = true; // 可被 Raycast 檢測
    return target;
}

// ⭐ 生成所有目標 (修正 Z 軸方向)
function generateTargets() {
    targets.forEach(t => t.dispose());
    targets = [];
    
    const spawnCenter = START_POS_SHOOTING;
    const targetsToCreate = MAX_TARGETS; 

    for (let i = 0; i < targetsToCreate; i++) {
        // X 軸偏移 +/- 5 米，Z 軸偏移 -5 到 -15 米
        const x = spawnCenter.x + (Math.random() - 0.5) * 10; 
        const y = spawnCenter.y + 3 + Math.random() * 5; // Y 軸在 4 到 9 之間 (眼睛高度以上)
        const z = spawnCenter.z - (5 + Math.random() * 10); // 集中在負 Z 軸前方 5~15 米
        
        const target = createTarget(new BABYLON.Vector3(x, y, z));
        targets.push(target);
    }
}

// ⭐ 射擊處理
function handleShooting() {
    const origin = camera.position;
    const forward = camera.getDirection(BABYLON.Vector3.Forward());
    const ray = new BABYLON.Ray(origin, forward, 100); // 射線長度 100
    
    // 篩選目標網格
    const hit = scene.pickWithRay(ray, (mesh) => mesh.name === "target");

    if (hit.hit && hit.pickedMesh) {
        // 目標被擊中
        hit.pickedMesh.dispose();
        targets = targets.filter(t => t !== hit.pickedMesh);
        
        shootingScore++;
        
        document.getElementById("height_value").innerText = shootingScore; 

        // 如果目標少於 MAX_TARGETS，重新生成一個新的目標來替換被擊中的
        if (targets.length < MAX_TARGETS) {
             generateSingleTarget();
        }
    }
}

function generateSingleTarget() {
    const spawnCenter = START_POS_SHOOTING;

    const x = spawnCenter.x + (Math.random() - 0.5) * 10; 
    const y = spawnCenter.y + 3 + Math.random() * 5;
    const z = spawnCenter.z - (5 + Math.random() * 10); 
    
    const target = createTarget(new BABYLON.Vector3(x, y, z));
    targets.push(target);
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

        // 監聽 T 鍵切換除錯模式
        if (e.key === "t" || e.key === "T") {
            debugMode = !debugMode;
            console.log(`Debug Mode: ${debugMode ? 'ON' : 'OFF'}`);
            // 測試模式開啟時，確保解除暫停，如果暫停了
            if (debugMode && paused) {
                 togglePause(); 
            }
        }
    });

    window.addEventListener("keyup", e => {
        if (!e.key) return;
        let k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        keys[k] = false;
    });
}

// 處理除錯模式下的 Y 軸和 WSAD 軸傳送
function handleDebugMode() {
    if (!debugMode || !playerCapsule || !playerCapsule.physicsImpostor) return;

    const deltaTime = engine.getDeltaTime() / 1000.0;
    const currentPos = playerCapsule.position.clone();
    
    let deltaY = 0;
    
    const body = playerCapsule.physicsImpostor.physicsBody;
    if (window.Ammo) {
        // 確保剛體進入 Kinematic 狀態，以便我們直接控制位置
        let flags = body.getCollisionFlags();
        body.setCollisionFlags(flags | CF_KINEMATIC_OBJECT);
        playerCapsule.physicsImpostor.setMass(0);
        playerCapsule.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
        playerCapsule.physicsImpostor.setAngularVelocity(BABYLON.Vector3.Zero());
    }
    
    // Y 軸控制 (Space/Shift)
    // 速度調整為更平滑的每幀傳送
    const actualTeleportSpeed = teleportSpeed * 60 * deltaTime; 
    
    if (keys[' ']) {
        deltaY = actualTeleportSpeed;
    }
    if (keys['shift']) {
        deltaY = -actualTeleportSpeed;
    }

    // X/Z 軸控制 (WSAD - 模擬飛行)
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
    
    moveVector.scaleInPlace(moveSpeed * deltaTime); 
    
    // 構建新的位置
    // 我們需要將水平移動向量乘以 60 來匹配速度單位
    const newPos = currentPos.add(new BABYLON.Vector3(moveVector.x * 60, deltaY, moveVector.z * 60)); 
    
    // 傳送玩家
    setAmmoPosition(playerCapsule, newPos, playerCapsule.rotation);
        
    // 確保 maxHeight 也被更新
    if (newPos.y > maxHeight) {
         maxHeight = newPos.y;
    }
    
    // 更新 HUD 顯示 (只適用於高度模式，但仍需要更新數值)
    const recordedHeight = Math.max(0, maxHeight - 1.0); 
    document.getElementById("height_value").innerText = Math.max(0, recordedHeight).toFixed(2);
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
        } else if (gameMode === "height" || gameMode === "shooting") {
            heightTimeOffset = gameTime; 
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
        } else if (gameMode === "height" || gameMode === "shooting") {
            // 恢復剩餘時間
            gameTime = heightTimeOffset;
        }
    }
}

// 鎖定鍵盤移動 (現在只處理物理模式下的速度計算)
function handlePlayerMovement(deltaTime) {
    if (paused) return; 
    
    // 測試模式下不執行物理速度計算，由 handleDebugMode 處理傳送
    if (debugMode) {
        // 確保物理剛體恢復動態
        if (playerCapsule.physicsImpostor && playerCapsule.physicsImpostor.physicsBody && window.Ammo) {
            const body = playerCapsule.physicsImpostor.physicsBody;
            let flags = body.getCollisionFlags();
            // 如果還處於 Kinematic 狀態，將其恢復為動態
            if (flags & CF_KINEMATIC_OBJECT) {
                 body.setCollisionFlags(flags & ~CF_KINEMATIC_OBJECT); 
                 playerCapsule.physicsImpostor.setMass(80);
                 // 傳送一次當前位置，確保物理引擎正確接管
                 setAmmoPosition(playerCapsule, playerCapsule.position.clone(), playerCapsule.rotation);
            }
        }
        return;
    } 

    const origin = playerCapsule.position.clone();
    origin.y -= 0.95; 
    const direction = new BABYLON.Vector3(0, -1, 0);
    // 應用射線長度 0.5
    const ray = new BABYLON.Ray(origin, direction, 0.5); 
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
        // 執行歸一化，確保斜向移動速度與單軸移動速度一致
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
    const isShootingMode = gameMode === "shooting";

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
    
    // ⭐ 射擊模式邏輯
    if (isShootingMode) {
        // 確保目標數量
        if (targets.length === 0) {
            // 遊戲開始時生成初始目標
            generateTargets();
        }
        // 分數在 handleShooting 中更新
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
    const isShootingMode = gameMode === "shooting";
    const deltaTime = engine.getDeltaTime() / 1000.0;

    if (isHeightMode) {
        // 登山模式：基於 deltaTime 倒數計時
        
        if (!paused) { // 僅在非暫停狀態下才倒數計時
            gameTime -= deltaTime; 
        }
        
        const timeLeft = Math.max(0, gameTime);
        
        // 鎖定 DOM 更新: 只有在非暫停狀態下才改變 HUD 數字
        if (!paused) { 
            document.getElementById("time_value").innerText = timeLeft.toFixed(0);
        }
        
        if (gameTime <= 0) endGame(false); 
    } else if (isShootingMode) {
        // 射擊模式倒數計時
        
        if (!paused) { // 僅在非暫停狀態下才倒數計時
            gameTime -= deltaTime; 
        }
        
        const timeLeft = Math.max(0, gameTime);
        
        if (!paused) { 
            document.getElementById("time_value").innerText = timeLeft.toFixed(2);
        }
        
        if (gameTime <= 0) endGame(true); // 射擊模式時間到即完成
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
    const isShootingMode = gameMode === "shooting";
    let finalResult = "";
    let score = 0;

    if (isHeightMode) {
        // 提交時使用 Y_max - 1 的整數值
        let finalRecordedHeight = Math.max(0, maxHeight - 1.0);
        score = Math.floor(finalRecordedHeight); 
        finalResult = `時間到! 最終高度: ${finalRecordedHeight.toFixed(2)}m (記錄 ${score}m)`;
    } else if (isShootingMode) {
        // 射擊模式結束邏輯
        score = shootingScore;
        finalResult = `時間到! 最終得分: ${score} 分`;
        targets.forEach(t => t.dispose());
        targets = [];
    } else {
        finalResult = completed ? `恭喜完成! 耗時: ${gameTime.toFixed(2)}s` : "未完成。";
        score = completed ? gameTime : 99999;
    }

    submitScore(isHeightMode, isShootingMode ? score : score);
    
    document.getElementById("hud").style.display = "none";
    document.getElementById("pause_menu").style.display = "none";
    document.getElementById("game_over_menu").style.display = "flex";
    document.getElementById("final_result_text").innerText = finalResult;
    document.getElementById("crosshair").style.display = "none";
}

async function submitScore(isHeightMode, score) {
    const isShootingMode = gameMode === "shooting";
    
    let endpoint;
    let body;

    if (isHeightMode) {
        endpoint = "/api/submit_height";
        body = { height: score };
    } else if (isShootingMode) {
        // 提交射擊模式分數
        endpoint = "/api/submit_shooting";
        body = { score: score };
    } else {
        endpoint = "/api/submit_speed";
        body = { time: score };
    }

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
    // 獲取單位元素
    const scoreUnitElement = document.getElementById("score_unit");
    
    if (mode === "height") {
        gameTime = HEIGHT_LIMIT_TIME;
        heightTimeOffset = 0; 
        
        // 初始 maxHeight 設為 1.0 (Y=1是基準點)
        maxHeight = 1.0; 
        
        document.getElementById("time_value").innerText = gameTime.toFixed(0);
        document.getElementById("height_value").innerText = 0.00.toFixed(2); 
        document.getElementById("score_label").innerText = "高度"; 
        scoreUnitElement.innerText = "m"; // 顯示米單位
    } else if (mode === "speed") {
        gameTime = 0; 
        pausedTime = 0;
        startTime = performance.now(); 
        document.getElementById("time_value").innerText = gameTime.toFixed(2);
        document.getElementById("score_label").innerText = "高度";
        document.getElementById("height_value").innerText = 0.00.toFixed(2);
        scoreUnitElement.innerText = "m"; // 顯示米單位
    } else if (mode === "shooting") {
        // 射擊模式數據重設
        gameTime = SHOOTING_TIME_LIMIT;
        shootingScore = 0;
        heightTimeOffset = SHOOTING_TIME_LIMIT;
        
        document.getElementById("time_value").innerText = gameTime.toFixed(2);
        
        // 設置為 "得分"，並將單位設置為 "分"
        document.getElementById("score_label").innerText = "得分"; 
        document.getElementById("height_value").innerText = shootingScore; // 數值部分
        scoreUnitElement.innerText = "分"; // 單位部分
    }
}

//--------------------------------------
// 重生邏輯 (只處理傳送和 HUD 更新)
//--------------------------------------
function respawnPlayer(mode) {
    const startPos = 
        mode === "height" ? START_POS_HEIGHT : 
        mode === "speed" ? START_POS_SPEED : 
        mode === "shooting" ? START_POS_SHOOTING : // 射擊模式傳送
        new BABYLON.Vector3(0, 5, 0); 

    setAmmoPosition(playerCapsule, startPos, playerCapsule.rotation);
    
    // 確保解除物理凍結，否則無法移動
    if (playerCapsule.physicsImpostor && playerCapsule.physicsImpostor.physicsBody && window.Ammo) {
        playerCapsule.physicsImpostor.physicsBody.setActivationState(1); // ACTIVE_TAG
        // 恢復質量，防止 Kinematic 標誌殘留
        playerCapsule.physicsImpostor.setMass(80); 
    }

    gameMode = mode !== "safe" ? mode : null; 
    
    if (mode === "safe") {
        gameStarted = false;
    } else if (gameMode === "height" || gameMode === "speed" || gameMode === "shooting") {
        gameStarted = true;
        
        // 獲取單位元素
        const scoreUnitElement = document.getElementById("score_unit");

        // 掉落重生時，更新顯示 (不重設計時)
        if (gameMode === "height") {
            const recordedHeight = Math.max(0, maxHeight - 1.0); // 使用 Y_max - 1 邏輯
            document.getElementById("time_value").innerText = Math.max(0, gameTime).toFixed(0);
            document.getElementById("height_value").innerText = Math.max(0, recordedHeight).toFixed(2);
            document.getElementById("score_label").innerText = "高度";
            scoreUnitElement.innerText = "m";
        } else if (gameMode === "speed") {
            document.getElementById("time_value").innerText = gameTime.toFixed(2);
            if (startTime > 0) {
                startTime = performance.now() - (gameTime * 1000);
            }
             document.getElementById("score_label").innerText = "高度";
             scoreUnitElement.innerText = "m";
        } else if (gameMode === "shooting") {
             document.getElementById("time_value").innerText = gameTime.toFixed(2);
             // 設置射擊模式單位
             document.getElementById("height_value").innerText = shootingScore;
             document.getElementById("score_label").innerText = "得分";
             scoreUnitElement.innerText = "分";
             // 確保目標生成
             generateTargets();
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
    document.getElementById("mode_shooting").onclick = () => { startMode("shooting"); }; 
    
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

    // 啟動登入狀態檢查
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
        document.getElementById("auth_panel").style.display = 'none';
        document.getElementById("mode_panel").style.display = 'flex';
    });
}

function logout() {
     fetch("/api/logout", { method: "POST" }).then(() => {
        backToMainMenu(true);
    });
}

function checkLoginStatus() {
    // 確保在檢查登入狀態後，UI 會正確顯示登入面板或模式選擇面板
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
    // 確保切換回主菜單時，顯示登入面板或模式選擇面板
    if (!forceLogout) { 
        checkLoginStatus(); 
    } else {
        document.getElementById("auth_panel").style.display = 'flex';
        document.getElementById("mode_panel").style.display = 'none';
    }
    document.getElementById("leaderboard_panel").style.display = 'none';
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
    let endpoint;
    let title;
    let scoreKey;

    if (mode === 'height') {
        endpoint = "/api/leaderboard_height";
        title = '最高高度 (m)';
        scoreKey = 'height';
    } else if (mode === 'shooting') {
        // 射擊模式排行榜
        endpoint = "/api/leaderboard_shooting";
        title = '最高得分';
        scoreKey = 'score';
    } else {
        endpoint = "/api/leaderboard_speed";
        title = '最快時間 (s)';
        scoreKey = 'time';
    }
    
    content.innerHTML = `<table><tr><th>#</th><th>玩家</th><th>${title}</th></tr></table>`;
    document.getElementById("btn_toggle_leaderboard_mode").onclick = () => {
        // 在三種模式間循環
        let nextMode = 'height';
        if (mode === 'height') nextMode = 'speed';
        else if (mode === 'speed') nextMode = 'shooting';

        fetchLeaderboard(nextMode);
    };

    fetch(endpoint).then(r => r.json()).then(data => {
        let html = `<table><tr><th>#</th><th>玩家</th><th>${title}</th></tr>`;
        data.forEach((item, index) => {
            let score;
            if (scoreKey === 'time') {
                score = parseFloat(item.time).toFixed(2);
            } else {
                score = item[scoreKey];
            }
            
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
    // ⭐ 啟動 UI 事件綁定和狀態檢查
    initUIEvents(); 
    
    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
});