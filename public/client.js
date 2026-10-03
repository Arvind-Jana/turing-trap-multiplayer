// Turing Trap Client Logic
const socket = io();
const confetti = new ConfettiEngine('confetti-canvas');

const AVATARS = ['🤖', '🕵️‍♂️', '🦊', '👾', '🧙‍♂️', '🚀', '🎭', '🦄', '🐱', '🍕', '⚡', '🧠'];

// Local state
let myPlayer = null;
let currentRoomCode = null;
let selectedAvatar = '🕵️‍♂️';
let authMode = 'join'; // 'join' or 'host'
let myVoteCardIndex = null;
let hasSubmittedAnswer = false;

// DOM Elements
const screens = {
  landing: document.getElementById('screen-landing'),
  lobby: document.getElementById('screen-lobby'),
  question: document.getElementById('screen-question'),
  voting: document.getElementById('screen-voting'),
  reveal: document.getElementById('screen-reveal'),
  summary: document.getElementById('screen-summary'),
  gameover: document.getElementById('screen-gameover')
};

function switchScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[screenName]) {
    screens[screenName].classList.add('active');
  }
}

// Toast helper
function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}

// 1. Initial Setup: Populate Avatars & Read URL Params
function initLanding() {
  const picker = document.getElementById('avatar-picker');
  picker.innerHTML = '';
  AVATARS.forEach((av, idx) => {
    const el = document.createElement('div');
    el.className = `avatar-option ${idx === 1 ? 'selected' : ''}`;
    el.textContent = av;
    el.addEventListener('click', () => {
      document.querySelectorAll('.avatar-option').forEach(a => a.classList.remove('selected'));
      el.classList.add('selected');
      selectedAvatar = av;
      sfx.playClick();
    });
    picker.appendChild(el);
  });

  // Check URL query parameters for invite link
  const urlParams = new URLSearchParams(window.location.search);
  const codeParam = urlParams.get('room');
  if (codeParam) {
    document.getElementById('input-room-code').value = codeParam.toUpperCase();
    setAuthMode('join');
  }
}

function setAuthMode(mode) {
  authMode = mode;
  const tabJoin = document.getElementById('tab-join');
  const tabHost = document.getElementById('tab-host');
  const groupCode = document.getElementById('group-room-code');
  const btnSubmit = document.getElementById('btn-action-submit');

  if (mode === 'join') {
    tabJoin.classList.add('active');
    tabHost.classList.remove('active');
    groupCode.style.display = 'block';
    btnSubmit.textContent = 'Join Room';
  } else {
    tabHost.classList.add('active');
    tabJoin.classList.remove('active');
    groupCode.style.display = 'none';
    btnSubmit.textContent = 'Create Host Room';
  }
  sfx.playClick();
}

document.getElementById('tab-join').addEventListener('click', () => setAuthMode('join'));
document.getElementById('tab-host').addEventListener('click', () => setAuthMode('host'));

// Sound toggle
document.getElementById('btn-sound-toggle').addEventListener('click', () => {
  const isMuted = sfx.toggleMute();
  document.getElementById('sound-label').textContent = isMuted ? 'Muted' : 'Sound On';
  document.getElementById('btn-sound-toggle').querySelector('span').textContent = isMuted ? '🔇' : '🔊';
});

// Join / Host action
document.getElementById('btn-action-submit').addEventListener('click', () => {
  sfx.playClick();
  const name = document.getElementById('input-nickname').value.trim() || 'Player_' + Math.floor(Math.random() * 100);

  if (authMode === 'host') {
    socket.emit('create_room', {
      playerName: name,
      avatar: selectedAvatar
    });
  } else {
    const code = document.getElementById('input-room-code').value.trim();
    if (!code) {
      showToast('⚠️ Please enter a 4-letter room code.');
      return;
    }
    socket.emit('join_room', {
      roomCode: code,
      playerName: name,
      avatar: selectedAvatar
    });
  }
});

// Socket: Room Created / Joined
socket.on('room_created', ({ roomCode, player }) => {
  myPlayer = player;
  currentRoomCode = roomCode;
  updateNavHeader();
  switchScreen('lobby');
  sfx.playJoin();
  showToast(`🎉 Room ${roomCode} created!`);
});

socket.on('room_joined', ({ roomCode, player }) => {
  myPlayer = player;
  currentRoomCode = roomCode;
  updateNavHeader();
  switchScreen('lobby');
  sfx.playJoin();
  showToast(`🎮 Joined Room ${roomCode}!`);
});

socket.on('error_message', (msg) => {
  sfx.playBuzzer();
  showToast(`❌ ${msg}`);
});

function updateNavHeader() {
  if (myPlayer) {
    document.getElementById('nav-player-info').style.display = 'flex';
    document.getElementById('nav-avatar').textContent = myPlayer.avatar;
    document.getElementById('nav-name').textContent = myPlayer.name;
  }
}

// 2. Lobby Management & Room Updates
socket.on('room_update', (roomState) => {
  if (!roomState) return;

  document.getElementById('lobby-code-display').textContent = roomState.code;
  document.getElementById('player-count-label').textContent = roomState.playerCount;

  // Render players grid
  const grid = document.getElementById('lobby-players-grid');
  grid.innerHTML = '';

  const isHost = socket.id === roomState.hostId;

  Object.values(roomState.players).forEach(p => {
    const chip = document.createElement('div');
    chip.className = `player-chip ${p.isHost ? 'is-host' : ''}`;
    
    let roleBadge = '<span class="p-role player">Player</span>';
    if (p.isHost) roleBadge = '<span class="p-role host">👑 Host</span>';
    if (p.isSimulated) roleBadge = '<span class="p-role bot">🤖 Simulated</span>';

    chip.innerHTML = `
      <div class="p-avatar">${p.avatar}</div>
      <div class="p-name">${escapeHTML(p.name)}</div>
      ${roleBadge}
    `;
    grid.appendChild(chip);
  });

  // Host Controls visibility
  const hostControls = document.getElementById('host-controls');
  const btnStart = document.getElementById('btn-start-game');
  const nonHostMsg = document.getElementById('non-host-msg');

  if (isHost) {
    hostControls.style.display = 'block';
    btnStart.style.display = 'block';
    nonHostMsg.style.display = 'none';

    // Enable start only when >= 2 players
    btnStart.disabled = roomState.playerCount < 2;
    btnStart.style.opacity = roomState.playerCount < 2 ? '0.5' : '1';
    btnStart.textContent = roomState.playerCount < 2 ? 'Need 2+ Players to Start' : '🚀 Start Game Now';
  } else {
    hostControls.style.display = 'none';
    btnStart.style.display = 'none';
    nonHostMsg.style.display = 'block';
  }
});

// Copy Room Link / Code
document.getElementById('btn-copy-code').addEventListener('click', () => {
  sfx.playClick();
  const shareUrl = `${window.location.origin}/?room=${currentRoomCode}`;
  navigator.clipboard.writeText(shareUrl).then(() => {
    showToast('📋 Room link copied to clipboard!');
  }).catch(() => {
    showToast(`Room Code: ${currentRoomCode}`);
  });
});

// Add Simulated Player button
document.getElementById('btn-add-bot-player').addEventListener('click', () => {
  sfx.playClick();
  socket.emit('add_simulated_player');
});

// Host settings listener
document.getElementById('select-rounds').addEventListener('change', (e) => {
  socket.emit('update_settings', { totalRounds: parseInt(e.target.value) });
});
document.getElementById('select-duration').addEventListener('change', (e) => {
  socket.emit('update_settings', { questionTimerDuration: parseInt(e.target.value) });
});

// Start Game
document.getElementById('btn-start-game').addEventListener('click', () => {
  sfx.playClick();
  socket.emit('start_game');
});

// 3. State Machine Handler
socket.on('game_state_change', (payload) => {
  const { state } = payload;

  if (state === 'LOBBY') {
    confetti.stop();
    switchScreen('lobby');
  } else if (state === 'QUESTION') {
    confetti.stop();
    handleQuestionPhase(payload);
  } else if (state === 'VOTING') {
    handleVotingPhase(payload);
  } else if (state === 'REVEAL') {
    handleRevealPhase(payload);
  } else if (state === 'SUMMARY') {
    handleSummaryPhase(payload);
  } else if (state === 'GAMEOVER') {
    handleGameOverPhase(payload);
  }
});

// Timer Sync
socket.on('timer_tick', ({ timeLeft }) => {
  const qTimer = document.getElementById('question-timer');
  const vTimer = document.getElementById('voting-timer');
  const qPill = document.getElementById('question-timer-pill');
  const vPill = document.getElementById('voting-timer-pill');

  if (qTimer) qTimer.textContent = timeLeft;
  if (vTimer) vTimer.textContent = timeLeft;

  if (timeLeft <= 5 && timeLeft > 0) {
    sfx.playTick();
    if (qPill) qPill.classList.add('urgent');
    if (vPill) vPill.classList.add('urgent');
  } else {
    if (qPill) qPill.classList.remove('urgent');
    if (vPill) vPill.classList.remove('urgent');
  }

  if (timeLeft === 0) {
    sfx.playBuzzer();
  }
});

// 4. Phase: Question
function handleQuestionPhase(data) {
  hasSubmittedAnswer = false;
  switchScreen('question');
  sfx.playJoin();

  document.getElementById('question-round-pill').textContent = `Round ${data.round} of ${data.totalRounds}`;
  document.getElementById('question-category-pill').textContent = data.question.category;
  document.getElementById('question-prompt-text').textContent = data.question.prompt;

  document.getElementById('submission-active-box').style.display = 'block';
  document.getElementById('submission-waiting-box').style.display = 'none';
  document.getElementById('prompt-answer-input').value = '';
  document.getElementById('submission-status-bar').innerHTML = '<span>0 players submitted</span>';
}

document.getElementById('btn-submit-answer').addEventListener('click', () => {
  if (hasSubmittedAnswer) return;
  const input = document.getElementById('prompt-answer-input');
  const answer = input.value.trim();

  if (!answer) {
    showToast('⚠️ Please write an answer first!');
    return;
  }

  hasSubmittedAnswer = true;
  sfx.playClick();
  socket.emit('submit_answer', { answer });

  document.getElementById('submission-active-box').style.display = 'none';
  document.getElementById('submission-waiting-box').style.display = 'block';
});

socket.on('submission_status', ({ submittedPlayerIds }) => {
  const bar = document.getElementById('submission-status-bar');
  if (bar) {
    bar.innerHTML = `<span>⏳ ${submittedPlayerIds.length} players have submitted</span>`;
  }
});

// 5. Phase: Voting
function handleVotingPhase(data) {
  myVoteCardIndex = null;
  switchScreen('voting');
  sfx.playJoin();

  const grid = document.getElementById('voting-grid');
  grid.innerHTML = '';

  data.cards.forEach(card => {
    const cardEl = document.createElement('div');
    const isMyCard = card.authorId === socket.id;

    cardEl.className = `vote-card ${isMyCard ? 'disabled' : ''}`;
    cardEl.innerHTML = `
      <div class="card-header">
        <span class="card-badge">Card ${card.label}</span>
        ${isMyCard ? '<span style="font-size: 0.8rem; color: var(--accent-gold);">Your Answer</span>' : ''}
      </div>
      <div class="card-body">"${escapeHTML(card.text)}"</div>
    `;

    if (!isMyCard) {
      cardEl.addEventListener('click', () => {
        document.querySelectorAll('.vote-card').forEach(c => c.classList.remove('selected'));
        cardEl.classList.add('selected');
        myVoteCardIndex = card.cardIndex;
        sfx.playClick();
        socket.emit('submit_vote', { cardIndex: card.cardIndex });
        showToast(`Voted for Card ${card.label}!`);
      });
    }

    grid.appendChild(cardEl);
  });
}

socket.on('vote_status', ({ votedPlayerIds }) => {
  const bar = document.getElementById('voting-status-bar');
  if (bar) {
    bar.innerHTML = `<span>🗳️ ${votedPlayerIds.length} votes recorded...</span>`;
  }
});

// 6. Phase: Reveal
function handleRevealPhase(data) {
  switchScreen('reveal');
  sfx.playReveal();

  const results = data.roundResults;
  const container = document.getElementById('reveal-cards-container');
  container.innerHTML = '';

  results.cardDetails.forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = `reveal-card ${card.isBot ? 'is-bot-card' : ''}`;

    let votersHTML = '';
    if (card.voters && card.voters.length > 0) {
      votersHTML = card.voters.map(v => `
        <span class="voter-tag">${v.avatar} ${escapeHTML(v.name)}</span>
      `).join('');
    } else {
      votersHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">No votes</span>';
    }

    const botNotice = card.isBot 
      ? '<span style="color: var(--accent-pink); font-weight: 800; margin-left: 8px;">[THE UNDERCOVER BOT! 🤖]</span>'
      : '';

    cardEl.innerHTML = `
      <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 700; margin-bottom: 6px;">
        Card ${card.label}
      </div>
      <div style="font-size: 1.1rem; font-style: italic; margin-bottom: 12px;">"${escapeHTML(card.text)}"</div>
      <div class="author-tag">
        <span>Written by:</span>
        <span style="font-size: 1.2rem;">${card.authorAvatar}</span>
        <span>${escapeHTML(card.authorName)}</span>
        ${botNotice}
      </div>
      <div class="voters-container">
        <span style="font-size: 0.8rem; color: var(--text-muted); margin-right: 6px;">Voted by:</span>
        ${votersHTML}
      </div>
    `;

    container.appendChild(cardEl);
  });

  // Host button to proceed to summary
  const btnSummary = document.getElementById('btn-proceed-summary');
  const isHost = myPlayer && data.players[socket.id] && data.players[socket.id].isHost;

  if (isHost) {
    btnSummary.style.display = 'block';
    btnSummary.onclick = () => {
      sfx.playClick();
      socket.emit('proceed_next');
    };
  } else {
    btnSummary.style.display = 'none';
  }
}

// 7. Phase: Round Summary
function handleSummaryPhase(data) {
  switchScreen('summary');
  sfx.playJoin();

  document.getElementById('summary-round-label').textContent = `Standings after Round ${data.currentRound} of ${data.totalRounds}`;

  const container = document.getElementById('summary-leaderboard');
  container.innerHTML = '';

  data.leaderboard.forEach((p, idx) => {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-glass);
      padding: 12px 18px;
      border-radius: 12px;
      margin-bottom: 8px;
    `;
    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-weight: 900; color: var(--accent-cyan); width: 20px;">#${idx + 1}</span>
        <span style="font-size: 1.5rem;">${p.avatar}</span>
        <span style="font-weight: 700;">${escapeHTML(p.name)}</span>
        ${p.id === socket.id ? '<span style="font-size: 0.75rem; background: var(--accent-cyan); color: #000; padding: 2px 6px; border-radius: 4px; font-weight: 800;">YOU</span>' : ''}
      </div>
      <div style="font-weight: 800; font-size: 1.2rem; color: var(--accent-gold);">
        ${p.score} pts
      </div>
    `;
    container.appendChild(row);
  });

  const btnNext = document.getElementById('btn-proceed-next');
  const isHost = myPlayer && myPlayer.isHost;

  if (isHost) {
    btnNext.style.display = 'block';
    btnNext.textContent = data.isLastRound ? 'See Final Champions 🏆' : 'Next Question 🚀';
    btnNext.onclick = () => {
      sfx.playClick();
      socket.emit('proceed_next');
    };
  } else {
    btnNext.style.display = 'none';
  }
}

// 8. Phase: Game Over & Podium
function handleGameOverPhase(data) {
  switchScreen('gameover');
  sfx.playFanfare();
  confetti.start(160);

  const podium = document.getElementById('podium-display');
  podium.innerHTML = '';

  const ranked = data.podium || [];
  const first = ranked[0];
  const second = ranked[1];
  const third = ranked[2];

  // Silver (2nd)
  if (second) {
    podium.appendChild(createPodiumNode(second, '2nd', 'second-place', '🥈'));
  }
  // Gold (1st)
  if (first) {
    podium.appendChild(createPodiumNode(first, '1st', 'first-place', '👑'));
  }
  // Bronze (3rd)
  if (third) {
    podium.appendChild(createPodiumNode(third, '3rd', 'third-place', '🥉'));
  }

  // Awards Box
  const awardsBox = document.getElementById('awards-display');
  awardsBox.innerHTML = '';

  if (data.awards.topDetective) {
    awardsBox.innerHTML += `
      <div class="award-card">
        <div class="award-icon">🕵️</div>
        <div>
          <div style="font-weight: 800; font-size: 0.95rem; color: var(--accent-cyan);">Silicon Detective</div>
          <div style="color: var(--text-muted); font-size: 0.85rem;">${escapeHTML(data.awards.topDetective.name)} (${data.awards.topDetective.count} bots unmasked)</div>
        </div>
      </div>
    `;
  }

  if (data.awards.topImpostor) {
    awardsBox.innerHTML += `
      <div class="award-card">
        <div class="award-icon">🎭</div>
        <div>
          <div style="font-weight: 800; font-size: 0.95rem; color: var(--accent-pink);">Secret Cyborg</div>
          <div style="color: var(--text-muted); font-size: 0.85rem;">${escapeHTML(data.awards.topImpostor.name)} (fooled ${data.awards.topImpostor.count} humans)</div>
        </div>
      </div>
    `;
  }

  document.getElementById('btn-play-again').onclick = () => {
    sfx.playClick();
    socket.emit('proceed_next');
  };
}

function createPodiumNode(player, rankLabel, rankClass, icon) {
  const node = document.createElement('div');
  node.className = `podium-place ${rankClass}`;
  node.innerHTML = `
    <div class="podium-avatar">${player.avatar}</div>
    <div class="podium-name">${escapeHTML(player.name)}</div>
    <div class="podium-score">${player.score} pts</div>
    <div class="podium-pillar">${icon}</div>
  `;
  return node;
}

// Utility: escape HTML
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initialize on page load
initLanding();
