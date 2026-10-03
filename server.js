const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const questions = require('./questions');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple API status endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    game: 'Turing Trap',
    uptime: process.uptime(),
    activeRooms: Object.keys(rooms).length
  });
});

// Rooms State Storage
const rooms = {};

const AVATARS = ['🤖', '🕵️‍♂️', '🦊', '👾', '🧙‍♂️', '🚀', '🎭', '🦄', '🐱', '🍕', '⚡', '🧠'];

const SIMULATED_PLAYERS = [
  { name: 'Alex_Dev', avatar: '⚡' },
  { name: 'Sarah_99', avatar: '🐱' },
  { name: 'Jordan_Code', avatar: '🦊' },
  { name: 'Sam_Intern', avatar: '🍕' }
];

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms[code] ? generateRoomCode() : code;
}

function getRandomBotResponse(promptObj) {
  if (promptObj.botResponses && promptObj.botResponses.length > 0) {
    const idx = Math.floor(Math.random() * promptObj.botResponses.length);
    return promptObj.botResponses[idx];
  }
  return "As an artificial intelligence, my algorithms conclude that maximum synergy requires more coffee and zero weekend deployments.";
}

function shuffleArray(arr) {
  const newArr = [...arr];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

// Timer management helper
function startRoomTimer(roomCode, durationSeconds, onTick, onComplete) {
  const room = rooms[roomCode];
  if (!room) return;
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
  }
  room.timeLeft = durationSeconds;
  onTick(room.timeLeft);

  room.timerInterval = setInterval(() => {
    if (!rooms[roomCode]) {
      clearInterval(room.timerInterval);
      return;
    }
    room.timeLeft -= 1;
    onTick(room.timeLeft);

    if (room.timeLeft <= 0) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
      onComplete();
    }
  }, 1000);
}

function stopRoomTimer(roomCode) {
  if (rooms[roomCode] && rooms[roomCode].timerInterval) {
    clearInterval(rooms[roomCode].timerInterval);
    rooms[roomCode].timerInterval = null;
  }
}

// Socket.io Connection Logic
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentPlayerId = socket.id;

  // 1. Create Room
  socket.on('create_room', ({ playerName, avatar }) => {
    const roomCode = generateRoomCode();
    currentRoom = roomCode;

    rooms[roomCode] = {
      code: roomCode,
      hostId: socket.id,
      state: 'LOBBY', // LOBBY, QUESTION, VOTING, REVEAL, SUMMARY, GAMEOVER
      currentRound: 0,
      totalRounds: 3,
      questionTimerDuration: 45,
      votingTimerDuration: 30,
      usedQuestionIds: [],
      currentQuestion: null,
      submissions: {}, // playerId -> answer
      cards: [], // shuffled cards for voting
      votes: {}, // playerId -> cardIndex
      roundResults: null,
      players: {
        [socket.id]: {
          id: socket.id,
          name: playerName || 'Player 1',
          avatar: avatar || '🕵️‍♂️',
          score: 0,
          isHost: true,
          isBot: false,
          isSimulated: false,
          stats: { caughtBots: 0, trickedHumans: 0 }
        }
      },
      botScore: 0,
      timerInterval: null,
      timeLeft: 0
    };

    socket.join(roomCode);
    socket.emit('room_created', { roomCode, player: rooms[roomCode].players[socket.id] });
    io.to(roomCode).emit('room_update', getRoomPublicState(roomCode));
  });

  // 2. Join Room
  socket.on('join_room', ({ roomCode, playerName, avatar }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms[code];

    if (!room) {
      return socket.emit('error_message', 'Room not found. Check the 4-letter code.');
    }

    if (room.state !== 'LOBBY') {
      return socket.emit('error_message', 'Game is already in progress in this room.');
    }

    if (Object.keys(room.players).length >= 10) {
      return socket.emit('error_message', 'Room is currently full (max 10 players).');
    }

    currentRoom = code;
    room.players[socket.id] = {
      id: socket.id,
      name: playerName || `Player ${Object.keys(room.players).length + 1}`,
      avatar: avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)],
      score: 0,
      isHost: false,
      isBot: false,
      isSimulated: false,
      stats: { caughtBots: 0, trickedHumans: 0 }
    };

    socket.join(code);
    socket.emit('room_joined', { roomCode: code, player: room.players[socket.id] });
    io.to(code).emit('room_update', getRoomPublicState(code));
  });

  // 3. Add Simulated Player (great for testing or playing solo!)
  socket.on('add_simulated_player', () => {
    const room = rooms[currentRoom];
    if (!room || room.hostId !== socket.id || room.state !== 'LOBBY') return;

    const existingNames = Object.values(room.players).map(p => p.name);
    const availableSims = SIMULATED_PLAYERS.filter(s => !existingNames.includes(s.name));

    if (availableSims.length === 0) {
      return socket.emit('error_message', 'Maximum simulated players added.');
    }

    const sim = availableSims[0];
    const simId = 'sim_' + Math.random().toString(36).substring(2, 8);

    room.players[simId] = {
      id: simId,
      name: sim.name,
      avatar: sim.avatar,
      score: 0,
      isHost: false,
      isBot: false,
      isSimulated: true,
      stats: { caughtBots: 0, trickedHumans: 0 }
    };

    io.to(currentRoom).emit('room_update', getRoomPublicState(currentRoom));
  });

  // 4. Update Game Settings (Rounds, timer)
  socket.on('update_settings', ({ totalRounds, questionTimerDuration }) => {
    const room = rooms[currentRoom];
    if (!room || room.hostId !== socket.id || room.state !== 'LOBBY') return;

    if (totalRounds && [1, 2, 3, 5].includes(totalRounds)) {
      room.totalRounds = totalRounds;
    }
    if (questionTimerDuration && [30, 45, 60].includes(questionTimerDuration)) {
      room.questionTimerDuration = questionTimerDuration;
    }

    io.to(currentRoom).emit('room_update', getRoomPublicState(currentRoom));
  });

  // 5. Start Game
  socket.on('start_game', () => {
    const room = rooms[currentRoom];
    if (!room || room.hostId !== socket.id || room.state !== 'LOBBY') return;

    const playerCount = Object.keys(room.players).length;
    if (playerCount < 2) {
      return socket.emit('error_message', 'Need at least 2 players to start! Click "Add Bot Friend" to test solo.');
    }

    room.currentRound = 0;
    room.botScore = 0;
    room.usedQuestionIds = [];
    Object.values(room.players).forEach(p => {
      p.score = 0;
      p.stats = { caughtBots: 0, trickedHumans: 0 };
    });

    nextRound(currentRoom);
  });

  // 6. Submit Answer
  socket.on('submit_answer', ({ answer }) => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'QUESTION') return;

    const cleanAnswer = (answer || '').trim();
    if (!cleanAnswer) return;

    room.submissions[socket.id] = cleanAnswer;
    io.to(currentRoom).emit('submission_status', {
      submittedPlayerIds: Object.keys(room.submissions)
    });

    checkAllSubmissions(currentRoom);
  });

  // 7. Submit Vote
  socket.on('submit_vote', ({ cardIndex }) => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'VOTING') return;

    // Check player isn't voting for their own card
    const targetCard = room.cards[cardIndex];
    if (!targetCard) return;

    if (targetCard.authorId === socket.id) {
      return socket.emit('error_message', "You cannot vote for your own answer!");
    }

    room.votes[socket.id] = cardIndex;
    io.to(currentRoom).emit('vote_status', {
      votedPlayerIds: Object.keys(room.votes)
    });

    checkAllVotes(currentRoom);
  });

  // 8. Next Round / Proceed button from Host
  socket.on('proceed_next', () => {
    const room = rooms[currentRoom];
    if (!room || room.hostId !== socket.id) return;

    if (room.state === 'REVEAL') {
      showSummary(currentRoom);
    } else if (room.state === 'SUMMARY') {
      if (room.currentRound >= room.totalRounds) {
        showGameOver(currentRoom);
      } else {
        nextRound(currentRoom);
      }
    } else if (room.state === 'GAMEOVER') {
      // Return to lobby
      stopRoomTimer(currentRoom);
      room.state = 'LOBBY';
      io.to(currentRoom).emit('game_state_change', {
        state: 'LOBBY',
        room: getRoomPublicState(currentRoom)
      });
    }
  });

  // Disconnection
  socket.on('disconnect', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];

    delete room.players[socket.id];
    delete room.submissions[socket.id];
    delete room.votes[socket.id];

    // If room is empty, clear it
    if (Object.keys(room.players).length === 0) {
      stopRoomTimer(currentRoom);
      delete rooms[currentRoom];
      return;
    }

    // If host left, migrate host to next human player
    if (room.hostId === socket.id) {
      const remainingHuman = Object.values(room.players).find(p => !p.isSimulated);
      if (remainingHuman) {
        room.hostId = remainingHuman.id;
        remainingHuman.isHost = true;
      }
    }

    io.to(currentRoom).emit('room_update', getRoomPublicState(currentRoom));

    if (room.state === 'QUESTION') {
      checkAllSubmissions(currentRoom);
    } else if (room.state === 'VOTING') {
      checkAllVotes(currentRoom);
    }
  });
});

// Start a round
function nextRound(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  stopRoomTimer(roomCode);
  room.currentRound += 1;
  room.state = 'QUESTION';
  room.submissions = {};
  room.votes = {};
  room.cards = [];
  room.roundResults = null;

  // Pick question not yet used
  const availableQuestions = questions.filter(q => !room.usedQuestionIds.includes(q.id));
  const selectedQ = availableQuestions.length > 0 
    ? availableQuestions[Math.floor(Math.random() * availableQuestions.length)]
    : questions[Math.floor(Math.random() * questions.length)];

  room.usedQuestionIds.push(selectedQ.id);
  room.currentQuestion = selectedQ;

  // Prepare Bot submission
  const botAnswer = getRandomBotResponse(selectedQ);
  room.botAnswer = botAnswer;

  // Handle simulated players automatically
  handleSimulatedSubmissions(roomCode, selectedQ);

  io.to(roomCode).emit('game_state_change', {
    state: 'QUESTION',
    round: room.currentRound,
    totalRounds: room.totalRounds,
    question: {
      category: selectedQ.category,
      prompt: selectedQ.prompt
    },
    duration: room.questionTimerDuration
  });

  startRoomTimer(
    roomCode,
    room.questionTimerDuration,
    (timeLeft) => {
      io.to(roomCode).emit('timer_tick', { timeLeft });
    },
    () => {
      // Time's up for questions! Auto-fill missing human submissions with fun placeholder
      Object.keys(room.players).forEach(pId => {
        if (!room.submissions[pId]) {
          room.submissions[pId] = "[Panicked silence... Ran out of time!]";
        }
      });
      startVotingPhase(roomCode);
    }
  );
}

function handleSimulatedSubmissions(roomCode, questionObj) {
  const room = rooms[roomCode];
  if (!room) return;

  const simulated = Object.values(room.players).filter(p => p.isSimulated);
  simulated.forEach((sim, idx) => {
    const delay = 4000 + idx * 3000;
    setTimeout(() => {
      if (rooms[roomCode] && rooms[roomCode].state === 'QUESTION' && rooms[roomCode].players[sim.id]) {
        // Generate simulated human-like answer
        const wittyFakes = [
          "Honestly, I'd just blame it on cosmic radiation and take a nap.",
          "I will offer them my favorite mug and pretend I have everything under control.",
          "Ctrl+Z until the problem ceases to exist, then act shocked when it reoccurs.",
          "I'd send a thumbs-up emoji in Slack and hope no one looks deeper."
        ];
        rooms[roomCode].submissions[sim.id] = wittyFakes[Math.floor(Math.random() * wittyFakes.length)];
        io.to(roomCode).emit('submission_status', {
          submittedPlayerIds: Object.keys(rooms[roomCode].submissions)
        });
        checkAllSubmissions(roomCode);
      }
    }, delay);
  });
}

function checkAllSubmissions(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.state !== 'QUESTION') return;

  const totalPlayers = Object.keys(room.players).length;
  const submittedCount = Object.keys(room.submissions).length;

  if (submittedCount >= totalPlayers) {
    stopRoomTimer(roomCode);
    startVotingPhase(roomCode);
  }
}

function startVotingPhase(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  stopRoomTimer(roomCode);
  room.state = 'VOTING';
  room.votes = {};

  // Build cards deck: human submissions + bot submission
  const cardsRaw = [];

  // Add human player submissions
  Object.entries(room.submissions).forEach(([pId, answer]) => {
    const player = room.players[pId];
    cardsRaw.push({
      text: answer,
      authorId: pId,
      authorName: player ? player.name : 'Unknown',
      authorAvatar: player ? player.avatar : '👤',
      isBot: false
    });
  });

  // Add the AI Bot submission
  cardsRaw.push({
    text: room.botAnswer,
    authorId: 'AI_BOT_SECRET',
    authorName: 'AI Overlord 3000',
    authorAvatar: '🤖',
    isBot: true
  });

  // Shuffle cards so their origin cannot be deduced by index
  const shuffledCards = shuffleArray(cardsRaw).map((card, idx) => ({
    ...card,
    cardIndex: idx,
    label: String.fromCharCode(65 + idx) // A, B, C, D...
  }));

  room.cards = shuffledCards;

  // Send anonymized cards to all clients (hide author and isBot flag)
  const publicCards = shuffledCards.map(c => ({
    cardIndex: c.cardIndex,
    label: c.label,
    text: c.text,
    authorId: c.authorId // used client-side ONLY to disable voting on own card
  }));

  io.to(roomCode).emit('game_state_change', {
    state: 'VOTING',
    cards: publicCards,
    duration: room.votingTimerDuration
  });

  // Trigger simulated player votes
  handleSimulatedVotes(roomCode);

  startRoomTimer(
    roomCode,
    room.votingTimerDuration,
    (timeLeft) => {
      io.to(roomCode).emit('timer_tick', { timeLeft });
    },
    () => {
      // Time's up for voting! Transition to reveal
      startRevealPhase(roomCode);
    }
  );
}

function handleSimulatedVotes(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const simulated = Object.values(room.players).filter(p => p.isSimulated);
  simulated.forEach((sim, idx) => {
    const delay = 5000 + idx * 3000;
    setTimeout(() => {
      if (rooms[roomCode] && rooms[roomCode].state === 'VOTING' && rooms[roomCode].players[sim.id]) {
        // Pick a card that isn't their own
        const validCards = rooms[roomCode].cards.filter(c => c.authorId !== sim.id);
        if (validCards.length > 0) {
          const chosen = validCards[Math.floor(Math.random() * validCards.length)];
          rooms[roomCode].votes[sim.id] = chosen.cardIndex;
          io.to(roomCode).emit('vote_status', {
            votedPlayerIds: Object.keys(rooms[roomCode].votes)
          });
          checkAllVotes(roomCode);
        }
      }
    }, delay);
  });
}

function checkAllVotes(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.state !== 'VOTING') return;

  const totalPlayers = Object.keys(room.players).length;
  const votedCount = Object.keys(room.votes).length;

  if (votedCount >= totalPlayers) {
    stopRoomTimer(roomCode);
    startRevealPhase(roomCode);
  }
}

function startRevealPhase(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  stopRoomTimer(roomCode);
  room.state = 'REVEAL';

  const botCard = room.cards.find(c => c.isBot);
  const botCardIndex = botCard ? botCard.cardIndex : -1;

  // Calculate scores
  const scoreDeltas = {};
  Object.keys(room.players).forEach(pId => {
    scoreDeltas[pId] = 0;
  });

  let botPoints = 0;
  let correctGuessers = 0;

  // Process votes
  Object.entries(room.votes).forEach(([voterId, chosenIndex]) => {
    const chosenCard = room.cards[chosenIndex];
    if (!chosenCard) return;

    if (chosenCard.isBot) {
      // Correct! Caught the Bot
      scoreDeltas[voterId] = (scoreDeltas[voterId] || 0) + 100;
      if (room.players[voterId]) {
        room.players[voterId].stats.caughtBots += 1;
      }
      correctGuessers += 1;
    } else {
      // Voted for a human! That human gets deception bonus
      const authorId = chosenCard.authorId;
      if (authorId && room.players[authorId]) {
        scoreDeltas[authorId] = (scoreDeltas[authorId] || 0) + 50;
        room.players[authorId].stats.trickedHumans += 1;
      }
    }
  });

  // If bot tricked more than half the players, bot gets bonus
  const totalVoters = Object.keys(room.votes).length;
  if (totalVoters > 0 && correctGuessers <= totalVoters / 2) {
    botPoints = 150;
    room.botScore += 150;
  }

  // Apply deltas to cumulative player scores
  Object.entries(scoreDeltas).forEach(([pId, pts]) => {
    if (room.players[pId]) {
      room.players[pId].score += pts;
    }
  });

  // Map votes per card for display
  const cardDetails = room.cards.map(c => {
    const voters = Object.entries(room.votes)
      .filter(([_, votedIdx]) => votedIdx === c.cardIndex)
      .map(([vId]) => {
        const p = room.players[vId];
        return p ? { name: p.name, avatar: p.avatar } : { name: 'Player', avatar: '👤' };
      });

    return {
      cardIndex: c.cardIndex,
      label: c.label,
      text: c.text,
      isBot: c.isBot,
      authorName: c.isBot ? '🤖 AI Bot' : c.authorName,
      authorAvatar: c.isBot ? '🤖' : c.authorAvatar,
      voters
    };
  });

  room.roundResults = {
    botCardIndex,
    cardDetails,
    scoreDeltas,
    botPoints,
    correctGuessers
  };

  io.to(roomCode).emit('game_state_change', {
    state: 'REVEAL',
    roundResults: room.roundResults,
    players: room.players,
    botScore: room.botScore
  });
}

function showSummary(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  room.state = 'SUMMARY';

  // Sort players for leaderboard
  const leaderboard = Object.values(room.players).sort((a, b) => b.score - a.score);

  io.to(roomCode).emit('game_state_change', {
    state: 'SUMMARY',
    leaderboard,
    botScore: room.botScore,
    currentRound: room.currentRound,
    totalRounds: room.totalRounds,
    isLastRound: room.currentRound >= room.totalRounds
  });
}

function showGameOver(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  room.state = 'GAMEOVER';

  const ranked = Object.values(room.players).sort((a, b) => b.score - a.score);

  // Determine special awards
  const topDetective = [...ranked].sort((a, b) => b.stats.caughtBots - a.stats.caughtBots)[0];
  const topImpostor = [...ranked].sort((a, b) => b.stats.trickedHumans - a.stats.trickedHumans)[0];

  io.to(roomCode).emit('game_state_change', {
    state: 'GAMEOVER',
    podium: ranked,
    botScore: room.botScore,
    awards: {
      topDetective: topDetective ? { name: topDetective.name, count: topDetective.stats.caughtBots } : null,
      topImpostor: topImpostor ? { name: topImpostor.name, count: topImpostor.stats.trickedHumans } : null
    }
  });
}

function getRoomPublicState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return null;

  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    currentRound: room.currentRound,
    totalRounds: room.totalRounds,
    questionTimerDuration: room.questionTimerDuration,
    players: room.players,
    playerCount: Object.keys(room.players).length
  };
}

server.listen(PORT, () => {
  console.log(`🎮 Turing Trap Server running at http://localhost:${PORT}`);
});
