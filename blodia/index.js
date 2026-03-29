const http = require('http');
const crypto = require('crypto');

// ==============================================================================
// 1. GENERATOR LOSOWOŚCI (Seeded PRNG)
// ==============================================================================
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

// ==============================================================================
// 2. STAN GRY
// ==============================================================================
let gameState = {};
let prng;
let nextPlayerId = 1;
let nextItemId = 1;
let startTime = Date.now();

const ITEM_TEMPLATES =[
    { type: 'sword', name: 'Zardzewiały Miecz', color: 0x888888, dmg: 15, range: 2.5, isRanged: false },
    { type: 'sword', name: 'Stalowy Miecz', color: 0xdddddd, dmg: 25, range: 2.5, isRanged: false },
    { type: 'bow', name: 'Krótki Łuk', color: 0x8B4513, dmg: 10, range: 15.0, isRanged: true },
    { type: 'shield', name: 'Drewniana Tarcza', color: 0x5c4033, def: 5 },
    { type: 'shield', name: 'Żelazna Tarcza', color: 0x666677, def: 12 }
];

function initGame() {
    const seed = Math.floor(Math.random() * 1000000);
    prng = mulberry32(seed);
    
    gameState = {
        mapSeed: seed,
        players: {},
        itemsOnGround: {},
        projectiles:[]
    };

    for(let i=0; i<30; i++) {
        let x, z;
        do {
            x = Math.floor(prng() * 90) + 5; 
            z = Math.floor(prng() * 90) + 5;
        } while (Math.hypot(x - 50, z - 50) < 18); 

        const template = ITEM_TEMPLATES[Math.floor(prng() * ITEM_TEMPLATES.length)];
        const item = { id: `item_${nextItemId++}`, x: x, z: z, ...template };
        gameState.itemsOnGround[item.id] = item;
    }
}
initGame(); 

function isInSafeZone(x, z) {
    return Math.hypot(x - 50, z - 50) < 16; 
}

// ==============================================================================
// 3. SERWER HTTP (Panel Statystyk + Przycisk Resetu)
// ==============================================================================
const server = http.createServer((req, res) => {
    if (req.url === '/reset-server' && req.method === 'POST') {
        initGame();
        broadcast({ type: 'SERVER_RESET', mapSeed: gameState.mapSeed });
        res.writeHead(200);
        return res.end('OK');
    }

    const activePlayersCount = Object.keys(gameState.players).length;
    const itemsCount = Object.keys(gameState.itemsOnGround).length;
    const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
    
    let playersListHTML = '';
    for (const[id, data] of Object.entries(gameState.players)) {
        playersListHTML += `<li><strong>${data.nickname}</strong> (${id}) - HP: ${data.health}/100 | X:${Math.round(data.x)}, Z:${Math.round(data.z)} ${isInSafeZone(data.x, data.z) ? '🛡️ (Miasto)' : '⚔️'}</li>`;
    }
    if (playersListHTML === '') playersListHTML = '<li>Brak aktywnych graczy na mapie.</li>';

    const htmlResponse = `
    <!DOCTYPE html>
    <html lang="pl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Blodia Server - Status</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #1e1e2f; color: #cfcfd8; margin: 0; padding: 20px; }
            .container { max-width: 800px; margin: 0 auto; background: #2a2a40; padding: 20px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
            h1 { color: #4CAF50; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
            .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
            .card { background: #353550; padding: 15px; border-radius: 8px; border-left: 4px solid #4CAF50; }
            .card.danger { border-left-color: #f44336; }
            ul { list-style: none; padding: 0; }
            ul li { background: #2a2a40; margin-bottom: 5px; padding: 8px; border-radius: 4px; }
            .btn { display: inline-block; padding: 10px 20px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px; margin-top: 20px; font-weight: bold; cursor: pointer; border: none;}
            .btn:hover { background: #45a049; }
            .btn-danger { background: #f44336; }
            .btn-danger:hover { background: #d32f2f; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Blodia Game Server - Action RPG</h1>
            <p><strong>Status:</strong> <span style="color:#4CAF50;">ZAAKCEPTOWANO POŁĄCZENIA ✅</span></p>
            <p><strong>Czas działania:</strong> ${uptimeMinutes} minut</p>
            <p><strong>Ziarno mapy (Seed):</strong> ${gameState.mapSeed}</p>

            <div class="stats-grid">
                <div class="card">
                    <h3>👥 Podłączeni gracze (${activePlayersCount})</h3>
                    <ul>${playersListHTML}</ul>
                </div>
                <div class="card">
                    <h3>🗡️ Świat</h3>
                    <ul>
                        <li>Przedmioty leżące na ziemi: <strong>${itemsCount}</strong></li>
                    </ul>
                </div>
            </div>

            <div class="card danger" style="margin-top: 20px;">
                <h3>⚠️ Panel Administracyjny</h3>
                <p>Użyj tego przycisku, aby wygenerować nową mapę, wyczyścić przedmioty i zresetować wszystkich graczy.</p>
                <button onclick="resetServer()" class="btn btn-danger">TWARDY RESET SERWERA 💥</button>
            </div>
            <br>
            <a href="#" onclick="window.location.reload()" class="btn">Odśwież dane statystyk 🔄</a>
        </div>
        <script>
            function resetServer() {
                if(confirm("Czy na pewno chcesz zresetować serwer? Wszyscy gracze zostaną rozłączeni, a mapa wygeneruje się na nowo!")) {
                    fetch('/reset-server', { method: 'POST' }).then(() => window.location.reload());
                }
            }
        </script>
    </body>
    </html>
    `;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlResponse);
});

// ==============================================================================
// 4. NATYWNA OBSŁUGA WEBSOCKETÓW
// ==============================================================================
const clients = new Set();

server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    const magicString = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    const hash = crypto.createHash('sha1').update(key + magicString).digest('base64');

    const headers =[
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${hash}`
    ];
    socket.write(headers.join('\r\n') + '\r\n\r\n');

    socket.send = (data) => {
        try {
            if (socket.destroyed) return;
            const payload = Buffer.from(data);
            const length = payload.length;
            let header;

            if (length <= 125) {
                header = Buffer.alloc(2);
                header[0] = 0x81; 
                header[1] = length;
            } else if (length <= 65535) {
                header = Buffer.alloc(4);
                header[0] = 0x81;
                header[1] = 126;
                header.writeUInt16BE(length, 2);
            } else { return; }
            socket.write(Buffer.concat([header, payload]));
        } catch (e) { console.error('Błąd wysyłania:', e); }
    };

    clients.add(socket);
    handleNewConnection(socket);

    socket.buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
        socket.buffer = Buffer.concat([socket.buffer, chunk]);
        
        while (socket.buffer.length >= 2) {
            const secondByte = socket.buffer[1];
            let payloadLength = secondByte & 0x7f;
            let headerLength = 2;
            
            if (payloadLength === 126) {
                headerLength += 2;
                if (socket.buffer.length < headerLength) return; 
                payloadLength = socket.buffer.readUInt16BE(2);
            } else if (payloadLength === 127) {
                socket.end(); return;
            }
            
            const isMasked = (secondByte & 0x80) !== 0;
            if (isMasked) headerLength += 4;
            
            if (socket.buffer.length < headerLength + payloadLength) return; 
            
            const firstByte = socket.buffer[0];
            const opcode = firstByte & 0x0f;
            let payload = socket.buffer.slice(headerLength, headerLength + payloadLength);
            
            if (isMasked) {
                const maskKey = socket.buffer.slice(headerLength - 4, headerLength);
                for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4]; 
            }
            
            if (opcode === 0x8) socket.end(); 
            else if (opcode === 0x1) handleMessage(socket, payload.toString('utf8'));
            
            socket.buffer = socket.buffer.slice(headerLength + payloadLength);
        }
    });

    socket.on('close', () => { clients.delete(socket); handleDisconnect(socket); });
    socket.on('error', () => { clients.delete(socket); handleDisconnect(socket); });
});

// ==============================================================================
// 5. LOGIKA GRY (WebSockets)
// ==============================================================================
function handleNewConnection(socket) {
    const playerId = `Gracz_${nextPlayerId++}`;
    
    gameState.players[playerId] = { 
        x: 50, z: 50, 
        health: 100, maxHealth: 100,
        rotation: 0, 
        nickname: 'Anonim',
        inventory:[], 
        equipment: { left: null, right: null }
    };
    socket.playerId = playerId;

    socket.send(JSON.stringify({
        type: 'INIT', 
        playerId: playerId, 
        mapSeed: gameState.mapSeed,
        players: gameState.players,
        itemsOnGround: gameState.itemsOnGround
    }));
}

function handleMessage(socket, message) {
    try {
        const data = JSON.parse(message);
        const playerId = socket.playerId;
        const player = gameState.players[playerId];
        if (!player) return;

        switch (data.type) {
            case 'SET_NICKNAME':
                player.nickname = data.nickname || 'Anonim';
                broadcast({ type: 'PLAYER_JOINED', playerId: playerId, player: player });
                break;
                
            case 'MOVE':
                player.x = data.x; 
                player.z = data.z;
                player.rotation = data.rotation || 0;
                broadcast({ type: 'PLAYER_MOVED', playerId: playerId, x: data.x, z: data.z, rotation: data.rotation }, socket);
                break;

            case 'ATTACK':
                if (isInSafeZone(player.x, player.z)) return; 
                
                const target = gameState.players[data.targetId];
                if (!target) return;
                
                if (isInSafeZone(target.x, target.z)) return;

                let weapon = data.hand === 'left' ? player.equipment.left : player.equipment.right;
                let isRanged = weapon && weapon.isRanged;
                let damage = weapon && weapon.dmg ? weapon.dmg : 5; 
                let range = weapon && weapon.range ? weapon.range : 2.5;

                const dist = Math.hypot(player.x - target.x, player.z - target.z);
                
                if (dist <= range) {
                    broadcast({ type: 'ACTION_ANIMATION', playerId: playerId, action: isRanged ? 'shoot' : 'swing', targetId: data.targetId });

                    let targetDef = 0;
                    if (target.equipment.left && target.equipment.left.def) targetDef += target.equipment.left.def;
                    if (target.equipment.right && target.equipment.right.def) targetDef += target.equipment.right.def;
                    
                    let finalDmg = Math.max(1, damage - targetDef);
                    
                    setTimeout(() => {
                        if(gameState.players[data.targetId]) {
                            target.health -= finalDmg;
                            if(target.health <= 0) {
                                target.health = target.maxHealth;
                                target.x = 50; target.z = 50; 
                                broadcast({ type: 'PLAYER_DIED', playerId: data.targetId });
                            }
                            broadcast({ type: 'UPDATE_HEALTH', playerId: data.targetId, health: target.health });
                        }
                    }, isRanged ? 400 : 0);
                }
                break;

            case 'PICKUP_ITEM':
                const itemToPick = gameState.itemsOnGround[data.itemId];
                if (itemToPick && player.inventory.length < 10) {
                    const distToItem = Math.hypot(player.x - itemToPick.x, player.z - itemToPick.z);
                    if (distToItem < 4.0) {
                        delete gameState.itemsOnGround[data.itemId];
                        player.inventory.push(itemToPick);
                        
                        socket.send(JSON.stringify({ type: 'INVENTORY_UPDATED', inventory: player.inventory, equipment: player.equipment }));
                        broadcast({ type: 'ITEM_REMOVED', itemId: data.itemId });
                    }
                }
                break;

            case 'DROP_ITEM':
                let droppedItem = null;
                if (data.from === 'inventory') {
                    droppedItem = player.inventory.splice(data.index, 1)[0];
                } else if (data.from === 'left' || data.from === 'right') {
                    droppedItem = player.equipment[data.from];
                    player.equipment[data.from] = null;
                    broadcast({ type: 'EQUIPMENT_UPDATED', playerId: playerId, equipment: player.equipment });
                }

                if (droppedItem) {
                    droppedItem.x = player.x + (Math.random() * 2 - 1);
                    droppedItem.z = player.z + (Math.random() * 2 - 1);
                    gameState.itemsOnGround[droppedItem.id] = droppedItem;
                    
                    socket.send(JSON.stringify({ type: 'INVENTORY_UPDATED', inventory: player.inventory, equipment: player.equipment }));
                    broadcast({ type: 'ITEM_SPAWNED', item: droppedItem });
                }
                break;

            case 'EQUIP_ITEM':
                if (data.index >= 0 && data.index < player.inventory.length) {
                    const item = player.inventory[data.index];
                    const previousEquipped = player.equipment[data.slot];
                    player.equipment[data.slot] = item;
                    player.inventory.splice(data.index, 1);
                    if (previousEquipped) player.inventory.push(previousEquipped);
                    
                    socket.send(JSON.stringify({ type: 'INVENTORY_UPDATED', inventory: player.inventory, equipment: player.equipment }));
                    broadcast({ type: 'EQUIPMENT_UPDATED', playerId: playerId, equipment: player.equipment });
                }
                break;

            case 'UNEQUIP_ITEM':
                if (player.equipment[data.slot] && player.inventory.length < 10) {
                    player.inventory.push(player.equipment[data.slot]);
                    player.equipment[data.slot] = null;
                    
                    socket.send(JSON.stringify({ type: 'INVENTORY_UPDATED', inventory: player.inventory, equipment: player.equipment }));
                    broadcast({ type: 'EQUIPMENT_UPDATED', playerId: playerId, equipment: player.equipment });
                }
                break;
        }
    } catch (e) { console.error('Błąd logiczny serwera:', e); }
}

function handleDisconnect(socket) {
    if (socket.playerId) {
        delete gameState.players[socket.playerId];
        broadcast({ type: 'PLAYER_LEFT', playerId: socket.playerId });
    }
}

function broadcast(data, excludeWs = null) {
    const message = JSON.stringify(data);
    clients.forEach(client => { if (client !== excludeWs && !client.destroyed) client.send(message); });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Blodia Server (ARPG) nasłuchuje na porcie: ${PORT}`);
});