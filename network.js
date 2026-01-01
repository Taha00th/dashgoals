// --- Socket.IO Setup & State ---
const IS_FILE = window.location.protocol === 'file:';
const LOCAL_URL = 'http://localhost:3000';
const ONLINE_URL = 'https://serverdosya.onrender.com'; // Yeni Render sunucusu

let socket;
let currentServerType = 'local';
let isHost = false;
let roomCode = null;
let gameStarted = false;
let isSpectator = false;
let userAvatarBase64 = null;

// Auto-detect environment
if (!IS_FILE && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    currentServerType = 'online';
}

function initSocket(type) {
    if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
    }

    currentServerType = type;
    const url = type === 'local' ? LOCAL_URL : ONLINE_URL;
    console.log(`Initializing socket connection to ${type}: ${url}`);

    socket = io(url, {
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000
    });

    setupSocketEvents();

    // UI Feedback for connection
    const btn = document.getElementById('btn-create');
    if (btn) {
        btn.disabled = true;
        btn.innerText = "Bağlanılıyor...";
    }
}

// Initial Connection
initSocket(currentServerType);

function setupSocketEvents() {
    socket.on('connect', () => {
        console.log('Connected to server!');
        const btn = document.getElementById('btn-create');
        if (btn) {
            btn.disabled = false;
            btn.innerText = "ODA OLUŞTUR";
            btn.style.opacity = "1";
        }
    });

    socket.on('connect_error', (err) => {
        console.warn('Connection failed:', err);
        const btn = document.getElementById('btn-create');
        if (btn) {
            btn.innerText = "BAĞLANTI HATASI";
            btn.style.background = "#e74c3c";
        }
        // Detailed notification
        safeNotify("Sunucuya bağlanılamadı! Lütfen sunucu adresinin doğru olduğundan ve sunucunun çalıştığından emin olun. Hata: " + err.message);
    });

    socket.on('player-joined', (data) => {
        console.log('Join:', data.playerName, data.role);
        if (!gameStarted && data.role !== 'spectator') startGameHost();

        const pId = isHost ? 'peer_blue' : 'peer_host';
        game.setPlayerName(pId, data.playerName);
        if (game.players[pId]) {
            game.players[pId].kitColor = data.kitColor;
            if (data.avatar) {
                const img = new Image();
                img.src = data.avatar;
                game.players[pId].avatarImg = img;
            }
        }
    });

    socket.on('receive-input', ({ playerId, input }) => {
        if (isHost && gameStarted) game.handleInput('peer_blue', input);
    });

    socket.on('receive-state', (state) => {
        if (!isHost) {
            if (!gameStarted) startGameClient();
            game.setState(state);
        }
    });

    socket.on('receive-chat', ({ playerName, message, color }) => addChatMessage(playerName, message, color));
    socket.on('host-disconnected', () => game.triggerStatsOverlay('HOST AYRILDI'));
    socket.on('player-left', () => game.triggerStatsOverlay('OYUNCU AYRILDI'));
    socket.on('rooms-updated', (rooms) => updateRoomBrowser(rooms));

    socket.on('leaderboard-update', (data) => {
        const list = document.getElementById('leaderboard-list');
        if (!list) return;
        list.innerHTML = '';
        Object.entries(data).sort((a, b) => b[1] - a[1]).forEach(([name, score]) => {
            const item = document.createElement('div');
            item.className = 'leaderboard-item';
            item.style.display = 'flex'; item.style.justifyContent = 'space-between'; item.style.padding = '10px';
            item.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
            item.innerHTML = `<span>${name}</span> <span style="color:#f1c40f; font-weight:bold;">${score}</span>`;
            list.appendChild(item);
        });
    });
}

// --- UI Logic & Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    // Landing Page
    document.getElementById('btn-play-game').addEventListener('click', () => {
        document.getElementById('landing-page').classList.add('hidden');
        document.getElementById('menu-container').classList.remove('hidden');
        // Refresh rooms when entering menu
        if (socket.connected) socket.emit('get-rooms', (rooms) => updateRoomBrowser(rooms));
    });

    // Chat
    document.getElementById('btn-send-chat').onclick = sendChat;
    document.getElementById('chat-input').onkeydown = (e) => {
        if (e.key === 'Enter') sendChat();
        e.stopPropagation();
    };

    // Server Selector
    const serverSelect = document.getElementById('server-select');
    if (serverSelect) {
        serverSelect.value = currentServerType;
        serverSelect.addEventListener('change', (e) => {
            serverSelect.style.color = e.target.value === 'online' ? '#f39c12' : '#2ecc71';
            initSocket(e.target.value);
        });
    }

    // AI Match
    document.getElementById('btn-play-ai').addEventListener('click', () => startAIMatch());

    // Create Room
    document.getElementById('btn-create').addEventListener('click', () => {
        if (!socket.connected) return safeNotify("Sunucuya bağlanılamadı!");
        isHost = true;
        const myName = document.getElementById('username-input').value || "Host";
        const duration = parseInt(document.getElementById('match-duration-select').value) || 120;
        const password = document.getElementById('room-password-input').value;

        socket.emit('create-room', { playerName: myName, duration, password }, (response) => {
            if (response.success) {
                roomCode = response.roomCode;
                showLobby();
                document.getElementById('display-room-id').innerText = roomCode;
                if (typeof game !== 'undefined') game.matchTime = duration;
            } else {
                safeNotify('Oda oluşturulamadı!');
            }
        });
    });

    // Join Room
    document.getElementById('btn-join').addEventListener('click', () => {
        const joinCode = document.getElementById('room-id-input').value;
        const password = document.getElementById('join-password-input').value;
        if (!joinCode || joinCode.length < 5) return safeNotify("Geçerli bir kod girin!");
        if (!socket.connected) return safeNotify("Sunucuya bağlanılamadı!");

        isHost = false;
        const myName = document.getElementById('username-input').value || "Oyuncu";
        const myKit = document.getElementById('kit-color-input').value;

        socket.emit('join-room', { roomCode: joinCode, playerName: myName, kitColor: myKit, password, avatar: userAvatarBase64 }, (response) => {
            if (response.success) {
                roomCode = joinCode;
                isSpectator = (response.role === 'spectator');
                showLobby();
                if (isSpectator) safeNotify("İzleyici olarak katıldınız.");
                if (response.duration) game.matchTime = response.duration;
            } else {
                safeNotify('Katılamadı: ' + response.error);
            }
        });
    });

    // Close Lobby
    document.getElementById('btn-close-lobby').addEventListener('click', () => {
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
        gameStarted = false;
    });

    // Color/Avatar Preview
    document.getElementById('kit-color-input').addEventListener('input', (e) => {
        document.getElementById('kit-preview').style.background = e.target.value;
    });
    document.getElementById('avatar-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 100000) return safeNotify("Resim 100KB'dan küçük olmalı!");
        const reader = new FileReader();
        reader.onload = (ev) => {
            userAvatarBase64 = ev.target.result;
            const preview = document.getElementById('avatar-preview');
            preview.src = userAvatarBase64;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    });

    // Poll rooms
    setInterval(() => {
        if (!gameStarted && socket && socket.connected) {
            socket.emit('get-rooms', (rooms) => updateRoomBrowser(rooms));
        }
    }, 5000);
});

// --- Helpers & Game Functions ---
function showLobby() {
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
}

function safeNotify(msg) {
    if (typeof game !== 'undefined' && game.showNotification) {
        game.showNotification(msg);
    } else {
        alert(msg);
    }
}

function addChatMessage(name, msg, color = '#fff') {
    const chatMsgs = document.getElementById('chat-messages');
    if (!chatMsgs) return;
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="name" style="color:${color}">${name}:</span><span class="text">${msg}</span>`;
    chatMsgs.appendChild(div);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

function sendChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg || !socket.connected) return;
    const myName = document.getElementById('username-input').value || (isHost ? "Host" : "Misafir");
    const myColor = isHost ? '#ff4d4d' : '#4d94ff';
    socket.emit('send-chat', { message: msg, playerName: myName, color: myColor });
    addChatMessage(myName, msg, myColor);
    input.value = '';
}

function updateRoomBrowser(rooms) {
    const browser = document.getElementById('room-browser');
    if (!browser) return;
    if (rooms.length === 0) {
        browser.innerHTML = '<div style="padding: 10px; opacity: 0.4;">Aktif oda yok...</div>';
        return;
    }
    browser.innerHTML = '';
    rooms.forEach(room => {
        const div = document.createElement('div');
        div.className = 'room-item';
        div.style.padding = '10px'; div.style.borderBottom = '1px solid rgba(255,255,255,0.1)'; div.style.cursor = 'pointer';
        div.onclick = () => {
            document.getElementById('room-id-input').value = room.code;
            if (room.isLocked) document.getElementById('join-password-input').focus();
        };
        div.innerHTML = `<b>${room.host}'un Odası</b> (${room.playerCount}/2 Oyuncu) ${room.isLocked ? '🔒' : ''}`;
        browser.appendChild(div);
    });
}

function startGameHost() {
    if (gameStarted) return;
    gameStarted = true;
    document.getElementById('menu-container').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');
    game.init(true);
    let myName = document.getElementById('username-input').value || "Host";
    let myKit = document.getElementById('kit-color-input').value;
    game.addPlayer('peer_host', myName, 'red', myKit);
    game.addPlayer('peer_blue', "Bağlanıyor...", 'blue');
    game.startHostLoop();
    game.startMatch();
}

function startGameClient() {
    if (gameStarted) return;
    gameStarted = true;
    document.getElementById('menu-container').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');
    game.init(false);
    let myName = document.getElementById('username-input').value || "Misafir";
    let myKit = document.getElementById('kit-color-input').value;
    game.addPlayer('peer_blue', myName, 'blue', myKit);
    game.addPlayer('peer_host', "Host", 'red');
    game.startClientLoop();
}

function startAIMatch() {
    if (gameStarted) return;
    gameStarted = true;
    isHost = true;
    document.getElementById('menu-container').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');
    game.init(true);
    game.aiActive = true;
    let myName = document.getElementById('username-input').value || "Oyuncu";
    let myKit = document.getElementById('kit-color-input').value;
    game.addPlayer('peer_host', myName, 'red', myKit);
    game.addPlayer('peer_blue', "BOT 9000", 'blue');
    game.startHostLoop();
    game.startMatch();
}

// Network Export for game.js
function sendInput(inputData) {
    if (socket && socket.connected && !isHost && !isSpectator) socket.emit('send-input', inputData);
}

function sendState(stateData) {
    if (socket && socket.connected && isHost) socket.emit('send-state', stateData);
}
