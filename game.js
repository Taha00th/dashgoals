class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');

        // Fixed Resolution
        this.width = 800;
        this.height = 480;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.isHost = false;
        this.players = {}; // { id: { x, y, color, inputs, ... } }
        this.ball = { x: this.width / 2, y: this.height / 2, vx: 0, vy: 0, radius: 10 };

        // Physics Configurations
        this.friction = 0.98; // Ball friction
        this.playerFriction = 0.88; // More drag/inertia
        this.playerAccel = 0.45; // Reduced for control
        this.playerRadius = 15;

        this.scores = { red: 0, blue: 0 };

        this.sounds = {
            kick: new Audio('https://cdn.pixabay.com/audio/2022/03/15/audio_73147d3d5d.mp3'),
            goal: new Audio('https://cdn.pixabay.com/audio/2021/08/04/audio_97486e9b2b.mp3'),
            crowd: new Audio('https://cdn.pixabay.com/audio/2022/02/22/audio_d0c6ff1bab.mp3'),
            post: new Audio('https://cdn.pixabay.com/audio/2022/03/10/audio_5109b846e4.mp3'),
            voice: new Audio('https://cdn.pixabay.com/audio/2021/08/04/audio_c976fcc8c7.mp3')
        };
        this.sounds.crowd.loop = true;
        this.sounds.crowd.volume = 0.2;
        this.sounds.post.volume = 0.5;
        this.audioStarted = false;

        // Ad Boards
        this.adOffset = 0;
        this.adTexts = ["DASH GOAL", "KIRMIZI VS MAVİ", "GOAL!!!", "PLAY FOR FUN", "AGENTIC AI"];

        // Visual Juice
        this.shakeIntensity = 0;
        this.particles = [];
        this.ballTrail = []; // [{x, y}]

        // Match System
        this.matchTime = 120; // 2 minutes in seconds
        this.timerInterval = null;
        this.matchActive = false;
        this.aiActive = false;
        this.crowdExcitement = 0;
        this.isSpectator = false;
    }

    init(isHost) {
        this.isHost = isHost;
        this.keys = { w: false, a: false, s: false, d: false, space: false };
        window.addEventListener('keydown', (e) => this.handleKey(e, true));
        window.addEventListener('keyup', (e) => this.handleKey(e, false));
        this.initTouchControls();
        document.getElementById('mobile-controls').classList.remove('hidden');
    }

    initTouchControls() {
        const joystickBase = document.getElementById('joystick-base');
        const joystickKnob = document.getElementById('joystick-knob');
        const kickBtn = document.getElementById('btn-kick-mobile');
        if (!joystickBase || !kickBtn) return;

        kickBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.handleKey({ key: ' ' }, true); });
        kickBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.handleKey({ key: ' ' }, false); });

        let joystickActive = false;
        let baseRect = null;
        const handleJoystick = (e) => {
            if (!joystickActive) return;
            e.preventDefault();
            const touch = e.touches[0];
            const centerX = baseRect.left + baseRect.width / 2;
            const centerY = baseRect.top + baseRect.height / 2;
            let dx = touch.clientX - centerX;
            let dy = touch.clientY - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxRadius = baseRect.width / 2;
            if (dist > maxRadius) { dx = (dx / dist) * maxRadius; dy = (dy / dist) * maxRadius; }
            joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            const threshold = 15;
            this.keys.w = dy < -threshold;
            this.keys.s = dy > threshold;
            this.keys.a = dx < -threshold;
            this.keys.d = dx > threshold;
            if (!this.isHost) sendInput(this.keys);
        };
        joystickBase.addEventListener('touchstart', (e) => {
            joystickActive = true;
            baseRect = joystickBase.getBoundingClientRect();
            handleJoystick(e);
        });
        window.addEventListener('touchmove', handleJoystick, { passive: false });
        window.addEventListener('touchend', () => {
            if (!joystickActive) return;
            joystickActive = false;
            joystickKnob.style.transform = `translate(-50%, -50%)`;
            this.keys.w = this.keys.a = this.keys.s = this.keys.d = false;
            if (!this.isHost) sendInput(this.keys);
        });
    }

    handleKey(e, isDown) {
        const key = e.key.toLowerCase();

        // WASD Support
        if (['w', 'a', 's', 'd'].includes(key)) this.keys[key] = isDown;

        // Arrow Keys Support
        if (key === 'arrowup') this.keys['w'] = isDown;
        if (key === 'arrowdown') this.keys['s'] = isDown;
        if (key === 'arrowleft') this.keys['a'] = isDown;
        if (key === 'arrowright') this.keys['d'] = isDown;

        if (key === ' ' || key === 'spacebar') this.keys['space'] = isDown;

        // Start Audio on first interaction
        if (isDown && !this.audioStarted) {
            this.sounds.crowd.play().catch(() => { });
            this.audioStarted = true;
        }

        if (!this.isHost) {
            sendInput(this.keys);
        }
    }

    addPlayer(id, name, teamColor, kitColor = null) {
        const startX = teamColor === 'red' ? 100 : this.width - 100;
        this.players[id] = {
            id: id,
            name: name,
            x: startX,
            y: this.height / 2,
            color: teamColor,
            kitColor: kitColor || (teamColor === 'red' ? '#ff4d4d' : '#4d94ff'),
            inputs: { w: false, a: false, s: false, d: false, space: false },
            vx: 0,
            vy: 0,
            canShoot: true
        };
    }

    setPlayerName(id, name) {
        if (this.players[id]) this.players[id].name = name;
    }

    updateJuice() {
        // Particle update
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].update();
            if (this.particles[i].life <= 0) this.particles.splice(i, 1);
        }

        // Ball Trail
        this.ballTrail.push({ x: this.ball.x, y: this.ball.y });
        if (this.ballTrail.length > 10) this.ballTrail.shift();

        // Shake decay
        if (this.shakeIntensity > 0) this.shakeIntensity *= 0.9;
    }

    emitParticles(x, y, color, count = 5) {
        for (let i = 0; i < count; i++) {
            let vx = (Math.random() - 0.5) * 4;
            let vy = (Math.random() - 0.5) * 4;
            this.particles.push(new Particle(x, y, vx, vy, color, 20 + Math.random() * 20, 2 + Math.random() * 3));
        }
    }

    startMatch() {
        if (!this.isHost || this.matchActive) return;
        this.matchActive = true;
        this.matchTime = 120;
        this.scores = { red: 0, blue: 0 };
        this.matchEnded = false;

        if (this.timerInterval) clearInterval(this.timerInterval);

        // Start Crowd Sound
        if (!this.audioStarted) {
            this.sounds.crowd.play().catch(() => { });
            this.audioStarted = true;
        }

        this.timerInterval = setInterval(() => {
            if (this.matchTime > 0) {
                this.matchTime--;
                this.updateUIDom(); // Update locally for host
                this.broadcastState();
            } else {
                this.endMatch();
            }
        }, 1000);
    }

    endMatch() {
        this.matchActive = false;
        this.matchEnded = true;
        clearInterval(this.timerInterval);
        this.broadcastState();

        // Stop Crowd Sound
        this.sounds.crowd.pause();
        this.audioStarted = false;

        // Trigger Stats View on all clients
        this.triggerStatsOverlay();
    }

    triggerStatsOverlay(customTitle = "MAÇ SONUCU") {
        const modal = document.getElementById('stats-modal');
        if (!modal) return;

        // Custom Title for Disconnects/End
        const titleEl = modal.querySelector('.menu-title');
        if (titleEl) titleEl.innerText = customTitle;

        document.getElementById('final-score-red').innerText = this.scores.red;
        document.getElementById('final-score-blue').innerText = this.scores.blue;

        const winnerText = this.scores.red > this.scores.blue ? 'KIRMIZI KAZANDI!' :
            this.scores.blue > this.scores.red ? 'MAVİ KAZANDI!' : 'BERABERE!';
        document.getElementById('match-winner').innerText = winnerText;

        modal.classList.remove('hidden');
    }

    showNotification(message) {
        const modal = document.getElementById('notification-modal');
        const textElement = document.getElementById('notification-text');
        const closeBtn = document.getElementById('btn-close-notification');

        if (!modal || !textElement) return;

        textElement.innerText = message;
        modal.classList.remove('hidden');

        closeBtn.onclick = () => modal.classList.add('hidden');
        setTimeout(() => modal.classList.add('hidden'), 5000);
    }

    updateUIDom() {
        const redScoreEl = document.getElementById('score-red');
        const blueScoreEl = document.getElementById('score-blue');
        const timerEl = document.getElementById('timer-display');

        if (redScoreEl) redScoreEl.innerText = this.scores.red;
        if (blueScoreEl) blueScoreEl.innerText = this.scores.blue;

        if (timerEl) {
            const mins = Math.floor(this.matchTime / 60);
            const secs = this.matchTime % 60;
            timerEl.innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
        }
    }

    updateAI() {
        const bot = this.players['peer_blue'];
        if (!bot) return;

        const ball = this.ball;
        const dx = ball.x - bot.x;
        const dy = ball.y - bot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Reset inputs
        bot.inputs = { w: false, a: false, s: false, d: false, space: false };

        // Target position: slightly behind the ball if attacking
        let targetX = ball.x + 20; // Stay on the right of the ball
        let targetY = ball.y;

        // If the ball is too far left (opponent half), chase it aggressively
        if (ball.x < 400) {
            targetX = ball.x;
        }

        const adx = targetX - bot.x;
        const ady = targetY - bot.y;

        // Move towards target
        if (Math.abs(ady) > 10) {
            bot.inputs.w = ady < 0;
            bot.inputs.s = ady > 0;
        }
        if (Math.abs(adx) > 10) {
            bot.inputs.a = adx < 0;
            bot.inputs.d = adx > 0;
        }

        // Kick logic: Kick if ball is in front of bot (shooting left)
        if (dist < this.playerRadius + this.ball.radius + 15) {
            if (bot.x > ball.x && Math.abs(dy) < 20) {
                bot.inputs.space = true;
            }
        }

        // Simple Goal Defense: Don't go inside own goal too much
        if (bot.x > 760) bot.inputs.d = false;
    }

    // --- HOST LOGIC ---
    startHostLoop() {
        if (!this.isHost) return;
        setInterval(() => this.updatePhysics(), 1000 / 60);
        setInterval(() => this.broadcastState(), 20); // 50 Hz
        this.renderLoop();
    }

    handleInput(playerId, inputs) {
        if (this.players[playerId]) this.players[playerId].inputs = inputs;
    }

    updatePhysics() {
        if (!this.matchActive && this.isHost) return;

        // Run AI if active
        if (this.aiActive && this.isHost) {
            this.updateAI();
        }

        if (this.players['peer_host']) {
            this.players['peer_host'].inputs = this.keys;
        }

        // Move Players & Collision
        const keys = Object.keys(this.players);
        for (let i = 0; i < keys.length; i++) {
            let p = this.players[keys[i]];

            if (p.inputs.w) p.vy -= this.playerAccel;
            if (p.inputs.s) p.vy += this.playerAccel;
            if (p.inputs.a) p.vx -= this.playerAccel;
            if (p.inputs.d) p.vx += this.playerAccel;

            p.vx *= this.playerFriction;
            p.vy *= this.playerFriction;
            p.x += p.vx;
            p.y += p.vy;

            // Player-Player Collision
            for (let j = i + 1; j < keys.length; j++) {
                let p2 = this.players[keys[j]];
                let dx_pp = p2.x - p.x;
                let dy_pp = p2.y - p.y;
                let dist_pp = Math.sqrt(dx_pp * dx_pp + dy_pp * dy_pp);
                let minDist = this.playerRadius * 2;

                if (dist_pp < minDist) {
                    let angle = Math.atan2(dy_pp, dx_pp);
                    let overlap = minDist - dist_pp;

                    // Move them apart
                    p.x -= Math.cos(angle) * overlap / 2;
                    p.y -= Math.sin(angle) * overlap / 2;
                    p2.x += Math.cos(angle) * overlap / 2;
                    p2.y += Math.sin(angle) * overlap / 2;

                    // Swap velocities slightly (bounce)
                    let tempVx = p.vx;
                    let tempVy = p.vy;
                    p.vx = p2.vx * 0.5;
                    p.vy = p2.vy * 0.5;
                    p2.vx = tempVx * 0.5;
                    p2.vy = tempVy * 0.5;
                }
            }

            // Simple Screen Boundaries
            p.x = Math.max(this.playerRadius, Math.min(this.width - this.playerRadius, p.x));
            p.y = Math.max(this.playerRadius, Math.min(this.height - this.playerRadius, p.y));

            // Ball Interaction
            let dx = this.ball.x - p.x;
            let dy = this.ball.y - p.y;
            let dist = Math.sqrt(dx * dx + dy * dy);

            if (p.inputs.space && p.canShoot) {
                if (dist < this.playerRadius + this.ball.radius + 10) {
                    let angle = Math.atan2(dy, dx);
                    let force = 12;
                    this.ball.vx += Math.cos(angle) * force;
                    this.ball.vy += Math.sin(angle) * force;

                    this.sounds.kick.currentTime = 0;
                    this.sounds.kick.play().catch(() => { });

                    p.canShoot = false;
                    setTimeout(() => { p.canShoot = true; }, 300);
                }
            }

            // Normal Collision (Ball)
            if (dist < this.playerRadius + this.ball.radius) {
                let angle = Math.atan2(dy, dx);
                let force = 3.5;
                let overlap = (this.playerRadius + this.ball.radius) - dist;
                this.ball.x += Math.cos(angle) * overlap;
                this.ball.y += Math.sin(angle) * overlap;
                this.ball.vx += Math.cos(angle) * force;
                this.ball.vy += Math.sin(angle) * force;

                if (Math.random() > 0.8) {
                    this.sounds.kick.currentTime = 0;
                    this.sounds.kick.volume = 0.4;
                    this.sounds.kick.play().catch(() => { });
                }

                this.emitParticles(this.ball.x, this.ball.y, 'rgb(34, 139, 34)', 3);
            }
        }

        // Move Ball
        this.ball.x += this.ball.vx;
        this.ball.y += this.ball.vy;
        this.ball.vx *= this.friction;
        this.ball.vy *= this.friction;

        // Ball Boundaries & Goals
        if (this.ball.y < this.ball.radius + 10 || this.ball.y > this.height - this.ball.radius - 10) {
            if (Math.abs(this.ball.vy) > 0.5) {
                this.sounds.post.currentTime = 0;
                this.sounds.post.play().catch(() => { });
            }
            this.ball.vy *= -1;
            this.ball.y = Math.max(this.ball.radius + 10, Math.min(this.height - this.ball.radius - 10, this.ball.y));
        }

        if (this.ball.x < this.ball.radius + 2) {
            if (this.ball.y > 170 && this.ball.y < 310) {
                this.score('blue');
            } else {
                this.ball.vx *= -1;
                this.ball.x = this.ball.radius + 2;
            }
        } else if (this.ball.x > this.width - this.ball.radius - 2) {
            if (this.ball.y > 170 && this.ball.y < 310) {
                this.score('red');
            } else {
                this.ball.vx *= -1;
                this.ball.x = this.width - this.ball.radius - 2;
            }
        }

        // Update Juice
        this.updateJuice();
    }

    score(team) {
        this.scores[team]++;
        this.shakeIntensity = 15; // Big shake on goal

        // Update UI locally for host
        this.updateUIDom();

        // Broadcast immediately if host
        if (this.isHost) {
            this.broadcastState();
            // Leaderboard update
            const scorerId = team === 'red' ? 'peer_host' : 'peer_blue';
            const scorer = this.players[scorerId];
            if (scorer && typeof socket !== 'undefined') {
                socket.emit('goal-scored', { playerName: scorer.name });
            }
        }

        // Local Animation
        this.triggerGoalAnimation();

        // Celebration
        this.emitParticles(this.ball.x, this.ball.y, team === 'red' ? '#ff4d4d' : '#4d94ff', 20);
        this.crowdExcitement = 1.0;

        this.resetPositions();
    }

    triggerGoalAnimation() {
        this.sounds.goal.currentTime = 0;
        this.sounds.goal.play().catch(() => { });

        // Announcer Voice
        setTimeout(() => {
            this.sounds.voice.currentTime = 0;
            this.sounds.voice.play().catch(() => { });
        }, 500);

        const overlay = document.getElementById('goal-overlay');
        const subtext = document.getElementById('announcer-subtext');
        const phrases = ["MUHTEŞEM BİR VURUŞ!", "İNANILMAZ BİR GOL!", "KALECİ ÇARESİZ!", "BU ÇOCUK BİR HARİKA!", "AĞLARI DELDİ!"];

        if (overlay) {
            if (subtext) subtext.innerText = phrases[Math.floor(Math.random() * phrases.length)];
            overlay.classList.remove('hidden');
            setTimeout(() => overlay.classList.add('hidden'), 2500);
        }
    }

    resetPositions() {
        this.ball.x = this.width / 2;
        this.ball.y = this.height / 2;
        this.ball.vx = 0;
        this.ball.vy = 0;

        for (let id in this.players) {
            let p = this.players[id];
            p.x = p.color === 'red' ? 100 : this.width - 100;
            p.y = this.height / 2;
            p.vx = 0;
            p.vy = 0;
            p.canShoot = true;
        }
    }

    broadcastState() {
        sendState({
            players: this.players,
            ball: this.ball,
            scores: this.scores,
            matchTime: this.matchTime,
            matchEnded: this.matchEnded
        });
    }

    // --- CLIENT LOGIC ---
    startClientLoop() {
        this.renderLoop();
    }

    setState(state) {
        // Goal Sync
        if (state.scores.red !== this.scores.red || state.scores.blue !== this.scores.blue) {
            this.scores = { ...state.scores };
            this.triggerGoalAnimation();
        }

        // Ball Sync
        if (!this.ball.targetX) {
            this.ball.x = state.ball.x;
            this.ball.y = state.ball.y;
        }
        this.ball.targetX = state.ball.x;
        this.ball.targetY = state.ball.y;

        // Player Sync
        for (let id in state.players) {
            if (!this.players[id]) {
                this.players[id] = state.players[id];
            } else {
                let p = this.players[id];
                let s = state.players[id];
                if (Math.abs(p.x - s.x) > 100) {
                    p.x = s.x; p.y = s.y;
                }
                p.targetX = s.x;
                p.targetY = s.y;
                p.name = s.name;
                p.kitColor = s.kitColor;
                p.inputs = s.inputs;
            }
        }

        // Timer Sync
        if (state.matchTime !== undefined) {
            this.matchTime = state.matchTime;
        }

        this.updateUIDom();

        // Match End Sync
        if (state.matchEnded && !this.matchEnded) {
            this.matchEnded = true;
            this.triggerStatsOverlay();
        }
    }

    renderLoop() {
        if (!this.isHost) this.interpolateEntities();
        this.draw();
        requestAnimationFrame(() => this.renderLoop());
    }

    interpolateEntities() {
        const factor = 0.12;
        const lerp = (a, b, f) => a + (b - a) * f;

        for (let id in this.players) {
            let p = this.players[id];
            if (p.targetX !== undefined) {
                p.x = lerp(p.x, p.targetX, factor);
                p.y = lerp(p.y, p.targetY, factor);
            }
        }
        if (this.ball.targetX !== undefined) {
            this.ball.x = lerp(this.ball.x, this.ball.targetX, factor);
            this.ball.y = lerp(this.ball.y, this.ball.targetY, factor);
        }
    }

    draw() {
        this.ctx.save();

        // Apply Camera Shake
        if (this.shakeIntensity > 0.1) {
            let sx = (Math.random() - 0.5) * this.shakeIntensity;
            let sy = (Math.random() - 0.5) * this.shakeIntensity;
            this.ctx.translate(sx, sy);
        }

        // 1. Stadium Tiers (Crowd)
        this.drawCrowd();

        // Reklam Panoları
        this.drawAdBoards();

        this.drawPitch();

        // 5. Entities

        // 5. Entities
        for (let id in this.players) {
            let p = this.players[id];
            // Shadow
            this.ctx.beginPath(); this.ctx.arc(p.x, p.y + 4, 15, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(0,0,0,0.3)'; this.ctx.fill();
            // Kick Glow
            if (p.inputs.space) {
                this.ctx.beginPath(); this.ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(255,255,255,0.4)'; this.ctx.fill();
            }
            // Body & Avatar
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
            this.ctx.clip();

            this.ctx.fillStyle = p.kitColor;
            this.ctx.fill();

            if (p.avatarImg && p.avatarImg.complete) {
                this.ctx.drawImage(p.avatarImg, p.x - 15, p.y - 15, 30, 30);
            }

            this.ctx.restore();

            this.ctx.beginPath(); this.ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
            this.ctx.strokeStyle = '#fff'; this.ctx.lineWidth = 3; this.ctx.stroke();
            // Name
            this.ctx.fillStyle = '#fff'; this.ctx.font = 'bold 13px Nunito';
            this.ctx.textAlign = 'center'; this.ctx.fillText(p.name, p.x, p.y - 28);
            // Number
            this.ctx.fillStyle = '#fff'; this.ctx.font = 'bold 10px Nunito';
            this.ctx.fillText(p.id === 'peer_host' ? '1' : '10', p.x, p.y + 4);
        }

        // Ball Trail
        let ballSpeed = Math.sqrt(this.ball.vx * this.ball.vx + this.ball.vy * this.ball.vy);
        if (ballSpeed > 2) {
            for (let i = 0; i < this.ballTrail.length; i++) {
                let p = this.ballTrail[i];
                let alpha = (i / this.ballTrail.length) * 0.4;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                this.ctx.fill();
            }
        }

        // Ball
        this.ctx.beginPath(); this.ctx.arc(this.ball.x, this.ball.y, 10, 0, Math.PI * 2);
        this.ctx.fillStyle = '#fff'; this.ctx.fill();
        this.ctx.strokeStyle = '#333'; this.ctx.lineWidth = 2; this.ctx.stroke();
        this.ctx.beginPath(); this.ctx.arc(this.ball.x, this.ball.y, 4, 0, Math.PI * 2);
        this.ctx.fillStyle = '#333'; this.ctx.fill();

        // Particles
        this.particles.forEach(p => p.draw(this.ctx));

        // Match End Message
        if (this.matchEnded) {
            this.ctx.fillStyle = 'rgba(0,0,0,0.6)';
            this.ctx.fillRect(0, 200, 800, 80);
            this.ctx.fillStyle = '#fff';
            this.ctx.font = 'bold 40px Nunito';
            this.ctx.textAlign = 'center';
            this.ctx.fillText("MAÇ SONA ERDİ", 400, 255);
        }

        if (this.isSpectator) {
            this.ctx.fillStyle = 'rgba(0,0,0,0.4)';
            this.ctx.fillRect(10, 420, 160, 30);
            this.ctx.fillStyle = '#f1c40f';
            this.ctx.font = 'bold 14px Nunito';
            this.ctx.textAlign = 'left';
            this.ctx.fillText("👁 İZLEYİCİ MODU", 20, 440);
        }

        this.ctx.restore();
    }

    drawCrowd() {
        // Draw tribune backgrounds
        this.ctx.fillStyle = '#1e3818'; // Darker grass/stadium floor
        this.ctx.fillRect(0, 0, 800, 480);

        // Crowds (simple dots in rows)
        const jump = Math.abs(Math.sin(Date.now() * 0.01)) * 8 * this.crowdExcitement;

        // Top Tiers
        for (let row = 0; row < 3; row++) {
            for (let x = 8; x < 792; x += 15) {
                let y = 8 + row * 10 - (row === 0 ? jump : jump * 0.5);
                this.ctx.fillStyle = (Math.sin(x + row + Date.now() * 0.005) > 0) ? '#ff4d4d' : '#4d94ff';
                this.ctx.beginPath();
                this.ctx.arc(x, y, 4, 0, Math.PI * 2);
                this.ctx.fill();
                // Face dot
                this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
                this.ctx.fillRect(x - 1, y - 1, 2, 2);
            }
        }
        // Bottom Tiers
        for (let row = 0; row < 3; row++) {
            for (let x = 8; x < 792; x += 15) {
                let y = 472 - row * 10 + (row === 0 ? jump : jump * 0.5);
                this.ctx.fillStyle = (Math.cos(x + row + Date.now() * 0.005) > 0) ? '#4d94ff' : '#ff4d4d';
                this.ctx.beginPath();
                this.ctx.arc(x, y, 4, 0, Math.PI * 2);
                this.ctx.fill();
                // Face dot
                this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
                this.ctx.fillRect(x - 1, y - 1, 2, 2);
            }
        }

        // Decay excitement
        if (this.crowdExcitement > 0.01) this.crowdExcitement *= 0.99;
    }

    drawStadiumLights() {
        const corners = [
            { x: 30, y: 30 },
            { x: 770, y: 30 },
            { x: 30, y: 450 },
            { x: 770, y: 450 }
        ];

        corners.forEach(c => {
            // Beam Glow
            let glow = this.ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 50);
            glow.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
            glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
            this.ctx.fillStyle = glow;
            this.ctx.beginPath();
            this.ctx.arc(c.x, c.y, 50, 0, Math.PI * 2);
            this.ctx.fill();

            // Light Head
            this.ctx.fillStyle = '#fff';
            this.ctx.beginPath();
            this.ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    drawAdBoards() {
        this.adOffset += 1.5;
        this.ctx.font = 'bold 12px Nunito';
        this.ctx.textAlign = 'left';

        // Top Ad Board
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(10, 10, 780, 20);
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(10, 10, 780, 20);
        this.ctx.clip();

        this.ctx.fillStyle = '#f39c12';
        let x = 10 - (this.adOffset % 400);
        for (let i = 0; i < 5; i++) {
            this.ctx.fillText(this.adTexts.join("   •   "), x + i * 400, 24);
        }
        this.ctx.restore();

        // Bottom Ad Board
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(10, 450, 780, 20);
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(10, 450, 780, 20);
        this.ctx.clip();

        this.ctx.fillStyle = '#f39c12';
        let x2 = 10 - (this.adOffset % 400);
        for (let i = 0; i < 5; i++) {
            this.ctx.fillText(this.adTexts.reverse().join("   •   "), x2 + i * 400, 464);
        }
        this.ctx.restore();
    }





    drawPitch() {
        // 1. Professional Grass Gradient
        let grad = this.ctx.createRadialGradient(400, 240, 50, 400, 240, 600);
        grad.addColorStop(0, '#2e7d32');
        grad.addColorStop(1, '#1b5e20');
        this.ctx.fillStyle = grad;
        this.ctx.fillRect(0, 0, 800, 480);

        // 2. Mowed Grass Stripes
        this.ctx.fillStyle = 'rgba(0,0,0,0.05)';
        for (let i = 0; i < 800; i += 80) {
            if ((i / 80) % 2 === 0) this.ctx.fillRect(i, 0, 40, 480);
        }

        // 3. Pitch Marking Lines
        this.ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        this.ctx.lineWidth = 3;

        // Perimeter
        this.ctx.strokeRect(15, 15, 770, 450);

        // Center Line & Circle
        this.ctx.beginPath();
        this.ctx.moveTo(400, 15);
        this.ctx.lineTo(400, 465);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(400, 240, 60, 0, Math.PI * 2);
        this.ctx.stroke();

        // Penalty Areas
        this.ctx.strokeRect(15, 140, 80, 200); // Red Side
        this.ctx.strokeRect(705, 140, 80, 200); // Blue Side

        // Penalty Spots
        this.ctx.fillStyle = 'rgba(255,255,255,0.6)';
        this.ctx.beginPath(); this.ctx.arc(120, 240, 3, 0, Math.PI * 2); this.ctx.fill();
        this.ctx.beginPath(); this.ctx.arc(680, 240, 3, 0, Math.PI * 2); this.ctx.fill();

        // 4. Stadium Lighting (Overlay)
        this.drawStadiumLights();

        // 5. Goals & Nets
        this.ctx.lineWidth = 5;
        this.ctx.strokeStyle = '#fff';

        // Red Goal Post
        this.ctx.strokeRect(-5, 170, 20, 140);
        // Blue Goal Post
        this.ctx.strokeRect(785, 170, 20, 140);

        // Net Details
        this.ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        this.ctx.lineWidth = 1;
        for (let j = 175; j < 310; j += 10) {
            this.ctx.beginPath(); this.ctx.moveTo(-5, j); this.ctx.lineTo(15, j); this.ctx.stroke();
            this.ctx.beginPath(); this.ctx.moveTo(785, j); this.ctx.lineTo(805, j); this.ctx.stroke();
        }
        for (let k = 0; k <= 20; k += 10) {
            this.ctx.beginPath(); this.ctx.moveTo(-5 + k, 170); this.ctx.lineTo(-5 + k, 310); this.ctx.stroke();
            this.ctx.beginPath(); this.ctx.moveTo(785 + k, 170); this.ctx.lineTo(785 + k, 310); this.ctx.stroke();
        }
    }
}

const game = new Game();

class Particle {
    constructor(x, y, vx, vy, color, life, size) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.maxLife = life;
        this.life = life;
        this.size = size;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life--;
        this.vx *= 0.95;
        this.vy *= 0.95;
    }
    draw(ctx) {
        let alpha = this.life / this.maxLife;
        ctx.fillStyle = this.color.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}
