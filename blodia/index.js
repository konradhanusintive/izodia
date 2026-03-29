// server.js (Serwer Gry i Panel Statystyk)
const http = require('http');
const crypto = require('crypto');

// ==============================================================================
// 1. STAN GRY (Source of Truth)
// ==============================================================================
const gameState = {
    mapSeed: Math.floor(Math.random() * 1000000), 
    resources: { wood: 1000, stone: 1000, spice: 800 },
    players: {},
    gatheredNodes: [],
    buildings:[]
};

let nextPlayerId = 1;
const startTime = Date.now();

// ==============================================================================
// 2. SERWER HTTP (Panel Statystyk na adresie /blodia-server/)
// ==============================================================================
const server = http.createServer((req, res) => {
    // Generowanie HTML z aktualnymi statystykami
    const activePlayersCount = Object.keys(gameState.players).length;
    const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
    
    // Lista graczy w formie HTML
    let playersListHTML = '';
    for (const [id, data] of Object.entries(gameState.players)) {
        playersListHTML += `<li><strong>${id}</strong> - Pozycja: X:${data.x}, Z:${data.z} (HP: ${data.health})</li>`;
    }
    if (playersListHTML === '') playersListHTML = '<li>Brak aktywnych graczy na mapie.</li>';

    // Lista budynków
    let buildingsListHTML = '';
    gameState.buildings.forEach(b => {
        buildingsListHTML += `<li>${b.type.toUpperCase()} (X:${b.x}, Z:${b.z})</li>`;
    });
    if (buildingsListHTML === '') buildingsListHTML = '<li>Mapa jest pusta.</li>';

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
            ul { list-style: none; padding: 0; }
            ul li { background: #2a2a40; margin-bottom: 5px; padding: 8px; border-radius: 4px; }
            .refresh-btn { display: inline-block; padding: 10px 20px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px; margin-top: 20px; font-weight: bold;}
            .refresh-btn:hover { background: #45a049; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Blodia Game Server - Status Działania</h1>
            <p><strong>Status:</strong> <span style="color:#4CAF50;">ZAAKCEPTOWANO POŁĄCZENIA ✅</span></p>
            <p><strong>Czas działania (Uptime):</strong> ${uptimeMinutes} minut</p>
            <p><strong>Ziarno mapy (Seed):</strong> ${gameState.mapSeed}</p>

            <div class="stats-grid">
                <div class="card">
                    <h3>👥 Podłączeni gracze (${activePlayersCount})</h3>
                    <ul>${playersListHTML}</ul>
                </div>
                <div class="card">
                    <h3>🏦 Wspólne zasoby</h3>
                    <ul>
                        <li>🌲 Drewno: <strong>${gameState.resources.wood}</strong></li>
                        <li>⛏️ Kamień: <strong>${gameState.resources.stone}</strong></li>
                        <li>💰 Melanż: <strong>${gameState.resources.spice}</strong></li>
                    </ul>
                </div>
            </div>

            <div class="card" style="margin-top: 20px;">
                <h3>🏗️ Postawione budynki (${gameState.buildings.length})</h3>
                <ul>${buildingsListHTML}</ul>
            </div>
            
            <div class="card" style="margin-top: 20px;">
                <h3>⛏️ Wyeksploatowane złoża</h3>
                <p>${gameState.gatheredNodes.length} zniszczonych źródeł na mapie.</p>
            </div>

            <a href="#" onclick="window.location.reload()" class="refresh-btn">Odśwież dane 🔄</a>
        </div>
    </body>
    </html>
    `;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlResponse);
});

// ==============================================================================
// 3. NATYWNA OBSŁUGA WEBSOCKETÓW (Nasłuch dla gry)
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
// 4. LOGIKA WEBSOCKET
// ==============================================================================
function handleNewConnection(socket) {
    const playerId = `Gracz_${nextPlayerId++}`;
    // Pozycja początkowa w koordynatach świata (Grid 10,40 * TILE_SIZE 2)
    gameState.players[playerId] = { x: 20, z: 80, health: 100, rotation: 0 };
    socket.playerId = playerId;

    // Wysyłka całego stanu nowemu graczowi
    socket.send(JSON.stringify({
        type: 'INIT', playerId: playerId, mapSeed: gameState.mapSeed,
        resources: gameState.resources, players: gameState.players,
        gatheredNodes: gameState.gatheredNodes, buildings: gameState.buildings
    }));

    // Powiadomienie innych
    broadcast({ type: 'PLAYER_JOINED', playerId: playerId, position: gameState.players[playerId] }, socket);
}

function handleMessage(socket, message) {
    try {
        const data = JSON.parse(message);
        const playerId = socket.playerId;

        switch (data.type) {
            case 'MOVE':
                if (gameState.players[playerId]) {
                    gameState.players[playerId].x = data.x; 
                    gameState.players[playerId].z = data.z;
                    gameState.players[playerId].rotation = data.rotation || 0;
                    broadcast({ type: 'PLAYER_MOVED', playerId: playerId, x: data.x, z: data.z, rotation: data.rotation }, socket);
                }
                break;
            case 'GATHER':
                const nodeKey = `${data.gridX},${data.gridZ}`;
                if (!gameState.gatheredNodes.includes(nodeKey)) {
                    gameState.gatheredNodes.push(nodeKey);
                    gameState.resources.wood += data.amounts.wood || 0;
                    gameState.resources.stone += data.amounts.stone || 0;
                    gameState.resources.spice += data.amounts.spice || 0;
                    broadcast({ type: 'RESOURCE_GATHERED', gridX: data.gridX, gridZ: data.gridZ, resources: gameState.resources });
                }
                break;
            case 'BUILD':
                const cost = data.cost;
                if (gameState.resources.wood >= cost.wood && gameState.resources.stone >= cost.stone && gameState.resources.spice >= cost.spice) {
                    gameState.resources.wood -= cost.wood; gameState.resources.stone -= cost.stone; gameState.resources.spice -= cost.spice;
                    const building = { type: data.buildingType, x: data.gridX, z: data.gridZ };
                    gameState.buildings.push(building);
                    broadcast({ type: 'BUILDING_ADDED', building: building, resources: gameState.resources });
                }
                break;
            case 'TRAIN':
                gameState.resources.wood -= data.cost.wood; gameState.resources.stone -= data.cost.stone; gameState.resources.spice -= data.cost.spice;
                broadcast({ type: 'UNIT_TRAINED', resources: gameState.resources });
                break;
        }
    } catch (e) { console.error('Błąd:', e); }
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

// Uruchomienie portu przydzielonego przez Seohost
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serwer gry nasłuchuje na porcie: ${PORT}`);
});