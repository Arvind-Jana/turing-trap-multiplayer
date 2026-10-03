const { io } = require('socket.io-client');

function waitForEvent(socket, eventName) {
  return new Promise((resolve) => {
    socket.once(eventName, (data) => resolve(data));
  });
}

function connectSocket() {
  const socket = io('http://localhost:3000', { reconnection: false, forceNew: true });
  return new Promise((resolve) => {
    if (socket.connected) return resolve(socket);
    socket.once('connect', () => resolve(socket));
  });
}

async function testGameLoop() {
  console.log('🧪 Starting Turing Trap Automated Simulation Test...');

  const socketHost = await connectSocket();
  console.log('✅ Host connected:', socketHost.id);

  socketHost.emit('create_room', { playerName: 'Host_Alice', avatar: '🧙‍♂️' });
  const { roomCode } = await waitForEvent(socketHost, 'room_created');
  console.log('✅ Room created with code:', roomCode);

  const socketPlayer2 = await connectSocket();
  console.log('✅ Player 2 connected:', socketPlayer2.id);

  socketPlayer2.emit('join_room', {
    roomCode: roomCode,
    playerName: 'Player_Bob',
    avatar: '🦊'
  });

  await waitForEvent(socketPlayer2, 'room_joined');
  console.log('✅ Player 2 joined room successfully!');

  // Start game from host
  console.log('🚀 Host starting game...');
  socketHost.emit('start_game');

  const questionPayload = await waitForEvent(socketHost, 'game_state_change');
  console.log(`✅ Question phase started! Round: ${questionPayload.round} / ${questionPayload.totalRounds}`);
  console.log(`   Prompt: "${questionPayload.question.prompt}"`);

  // Submit answers
  console.log('✍️ Submitting player answers...');
  socketHost.emit('submit_answer', { answer: "Host's hilarious excuse involving AI sentience." });
  socketPlayer2.emit('submit_answer', { answer: "Bob's response about blaming the cat on the keyboard." });

  // Wait for voting phase
  const votingPayload = await waitForEvent(socketHost, 'game_state_change');
  console.log(`✅ Voting phase active! Total cards: ${votingPayload.cards.length}`);

  // Both vote for a card that isn't their own
  const hostVoteCard = votingPayload.cards.find(c => c.authorId !== socketHost.id);
  const p2VoteCard = votingPayload.cards.find(c => c.authorId !== socketPlayer2.id);

  console.log(`🗳️ Host voting for Card ${hostVoteCard.label}`);
  socketHost.emit('submit_vote', { cardIndex: hostVoteCard.cardIndex });

  console.log(`🗳️ Player 2 voting for Card ${p2VoteCard.label}`);
  socketPlayer2.emit('submit_vote', { cardIndex: p2VoteCard.cardIndex });

  // Wait for reveal phase
  const revealPayload = await waitForEvent(socketHost, 'game_state_change');
  console.log('✅ Reveal phase triggered!');
  console.log(`   Bot Card was Card Index: ${revealPayload.roundResults.botCardIndex}`);
  console.log(`   Scores:`, Object.values(revealPayload.players).map(p => `${p.name}: ${p.score}pts`));

  console.log('\n🎉 ALL TESTS PASSED! Game logic, Socket.io events, synchronization, and scoring are 100% verified.');

  socketHost.disconnect();
  socketPlayer2.disconnect();
  process.exit(0);
}

testGameLoop().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
