import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ref, onValue, off, update, get, remove, onDisconnect } from 'firebase/database';
import { db } from './firebase';

function GameTable() {
  const { roomId } = useParams(); 
  const [searchParams] = useSearchParams();
  const playerId = searchParams.get('player'); 
  const navigate = useNavigate();
  const [gameState, setGameState] = useState(null);

  const hostId = gameState?.players ? Object.keys(gameState.players).sort()[0] : null;
  const isHost = playerId === hostId;

  useEffect(() => {
    const roomRef = ref(db, `rooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        setGameState(snapshot.val());
      } else {
        alert("This room no longer exists. Let's get you back to the lobby.");
        navigate('/');
      }
    });

    const myPlayerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
    onDisconnect(myPlayerRef).remove();

    return () => off(roomRef, 'value', unsubscribe);
  }, [roomId, playerId, navigate]);

  useEffect(() => {
    if (isHost && gameState && gameState.status !== 'waiting') {
      const playerCount = Object.keys(gameState.players || {}).length;
      if (playerCount < 4) {
        update(ref(db, `rooms/${roomId}`), { status: 'waiting' });
        alert("A player disconnected. The game has been paused and returned to the waiting room.");
      }
    }
  }, [gameState?.players, isHost, roomId, gameState?.status]);

  useEffect(() => {
    if (!isHost || !gameState || gameState.status !== 'playing') return;
    const players = gameState.players || {};
    const playerIds = Object.keys(players);
    const allBid = playerIds.length === 4 && playerIds.every(id => players[id].bid !== undefined && players[id].bid !== null);

    if (allBid) {
      update(ref(db, `rooms/${roomId}`), { status: 'tricks', currentTrick: [] });
    }
  }, [gameState, isHost, roomId]);

  useEffect(() => {
    if (!isHost || !gameState || gameState.status !== 'tricks') return;
    const trick = gameState.currentTrick ? Object.values(gameState.currentTrick) : [];
    
    if (trick.length === 4) {
      const timer = setTimeout(async () => {
        const leadSuit = trick[0].card.suit;
        let winningMove = trick[0];

        for (let i = 1; i < 4; i++) {
          const move = trick[i];
          const winningCard = winningMove.card;
          const currentCard = move.card;

          if (currentCard.suit === '♠' && winningCard.suit !== '♠') winningMove = move;
          else if (currentCard.suit === '♠' && winningCard.suit === '♠') {
            if (currentCard.weight > winningCard.weight) winningMove = move;
          } else if (currentCard.suit === leadSuit && winningCard.suit === leadSuit) {
            if (currentCard.weight > winningCard.weight) winningMove = move;
          }
        }

        const winnerId = winningMove.playerId;
        const currentTricksTaken = gameState.players[winnerId].tricksTaken || 0;

        await update(ref(db, `rooms/${roomId}`), {
          currentTrick: null,
          currentTurn: winnerId,
          [`players/${winnerId}/tricksTaken`]: currentTricksTaken + 1
        });
      }, 3000); 
      return () => clearTimeout(timer);
    }
  }, [gameState?.currentTrick, isHost, roomId, gameState?.status]);

  // 5. Referee: Indestructible End of Hand Scoring
  useEffect(() => {
    if (!isHost || !gameState || gameState.status !== 'tricks') return;
    const players = gameState.players || {};
    const pIds = Object.keys(players);
    if (pIds.length !== 4) return;

    const totalTricks = pIds.reduce((sum, id) => sum + (players[id].tricksTaken || 0), 0);

    if (totalTricks === 13 && !gameState.currentTrick) {
      const calculateTeamScore = (teamLabel, p1Id, p2Id) => {
        const p1 = players[p1Id] || {};
        const p2 = players[p2Id] || {};
        let scoreChange = 0;
        let newBags = 0;

        const checkNil = (p) => {
          if (p.bid === 0) {
            if ((p.tricksTaken || 0) === 0) scoreChange += 50; 
            else scoreChange -= 50; 
          }
        };
        checkNil(p1);
        checkNil(p2);

        const p1Bid = p1.bid || 0;
        const p2Bid = p2.bid || 0;
        const teamBid = (p1Bid === 0 ? 0 : p1Bid) + (p2Bid === 0 ? 0 : p2Bid);
        const teamTricks = (p1.tricksTaken || 0) + (p2.tricksTaken || 0);

        if (teamTricks < teamBid) scoreChange -= (teamBid * 10); 
        else { scoreChange += (teamBid * 10); newBags = teamTricks - teamBid; }

        let currentTotal = (gameState.scores?.[teamLabel]?.total || 0) + scoreChange;
        let currentBags = (gameState.scores?.[teamLabel]?.bags || 0) + newBags;

        if (currentBags >= 5) { currentTotal -= 50; currentBags = currentBags % 5; }
        return { total: currentTotal, bags: currentBags };
      };

      const teamAIds = pIds.filter(id => players[id].team === 'A'); 
      const teamBIds = pIds.filter(id => players[id].team === 'B'); 
      const newScoreA = calculateTeamScore('A', teamAIds[0], teamAIds[1]);
      const newScoreB = calculateTeamScore('B', teamBIds[0], teamBIds[1]);

      let nextStatus = 'seated';
      if (newScoreA.total >= 300 || newScoreB.total >= 300) {
        nextStatus = 'gameOver';
        
        if (isHost && gameState.status === 'tricks') {
          const winningTeam = newScoreA.total >= 300 ? 'A' : 'B';
          const losingTeam = winningTeam === 'A' ? 'B' : 'A';
          const winners = Object.values(players).filter(p => p.team === winningTeam);
          const losers = Object.values(players).filter(p => p.team === losingTeam);

          get(ref(db, 'leaderboard')).then(snapshot => {
            const board = snapshot.exists() ? snapshot.val() : {};
            winners.forEach(w => { if (!board[w.name]) board[w.name] = { wins: 0, losses: 0 }; board[w.name].wins += 1; });
            losers.forEach(l => { if (!board[l.name]) board[l.name] = { wins: 0, losses: 0 }; board[l.name].losses += 1; });
            update(ref(db), { leaderboard: board });
          });
        }
      }

      const currentRound = (gameState.history ? gameState.history.length : 0) + 1;
      const getBidStr = (p) => p?.bid === 0 ? 'NIL' : (p?.bid || 0);
      const p1A = players[teamAIds[0]] || {}; const p2A = players[teamAIds[1]] || {};
      const p1B = players[teamBIds[0]] || {}; const p2B = players[teamBIds[1]] || {};

      const roundLog = {
        round: currentRound,
        teamA: { bids: `${getBidStr(p1A)} & ${getBidStr(p2A)}`, tricks: (p1A.tricksTaken || 0) + (p2A.tricksTaken || 0), score: newScoreA.total, bags: newScoreA.bags },
        teamB: { bids: `${getBidStr(p1B)} & ${getBidStr(p2B)}`, tricks: (p1B.tricksTaken || 0) + (p2B.tricksTaken || 0), score: newScoreB.total, bags: newScoreB.bags }
      };

      // Automatically pass the dealer to the left!
      let nextDealerId = hostId; 
      if (gameState.dealer && players[gameState.dealer]) {
        const currentDealerSeat = players[gameState.dealer].seat;
        const clockwiseOrder = ['North', 'East', 'South', 'West'];
        const nextDealerSeat = clockwiseOrder[(clockwiseOrder.indexOf(currentDealerSeat) + 1) % 4];
        nextDealerId = Object.keys(players).find(id => players[id].seat === nextDealerSeat) || hostId;
      }

      update(ref(db, `rooms/${roomId}`), {
        status: nextStatus,
        scores: { A: newScoreA, B: newScoreB },
        history: gameState.history ? [...gameState.history, roundLog] : [roundLog],
        dealer: nextDealerId
      });
    }
  }, [gameState?.players, gameState?.currentTrick, isHost, roomId, gameState?.status, gameState?.scores, gameState?.history, hostId]);

  const handleLeave = async () => {
    if (gameState?.players?.[playerId]) {
      const updatedPlayers = { ...gameState.players };
      delete updatedPlayers[playerId];

      if (Object.keys(updatedPlayers).length === 0) {
        await remove(ref(db, `rooms/${roomId}`)); 
      } else {
        await update(ref(db, `rooms/${roomId}`), { players: updatedPlayers, status: 'waiting' });
      }
    }
    navigate('/');
  };

  const getPlayerInSeat = (seatName) => {
    if (!gameState || !gameState.players) return null;
    return Object.values(gameState.players).find(p => p.seat === seatName);
  };

  const randomizeSeats = async () => {
    const seats = ['North', 'East', 'South', 'West'];
    for (let i = seats.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seats[i], seats[j]] = [seats[j], seats[i]];
    }

    const updatedPlayers = { ...gameState.players };
    Object.keys(updatedPlayers).forEach((id, index) => {
      updatedPlayers[id].seat = seats[index];
      updatedPlayers[id].team = (seats[index] === 'North' || seats[index] === 'South') ? 'A' : 'B';
    });

    await update(ref(db, `rooms/${roomId}`), {
      players: updatedPlayers, status: 'seated', dealer: hostId, 
      scores: { A: { total: 0, bags: 0 }, B: { total: 0, bags: 0 } }, history: []
    });
  };

  const playAgain = async () => {
    const updatedPlayers = { ...gameState.players };
    Object.keys(updatedPlayers).forEach(key => {
      delete updatedPlayers[key].hand;
      delete updatedPlayers[key].bid;
      updatedPlayers[key].tricksTaken = 0;
    });

    await update(ref(db, `rooms/${roomId}`), {
      status: 'seated', scores: { A: { total: 0, bags: 0 }, B: { total: 0, bags: 0 } },
      players: updatedPlayers, currentTrick: null, spadesBroken: false, history: []
    });
  };

  const dealCards = async () => {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let deck = [];
    
    for (const suit of suits) {
      for (const value of values) {
        if (value === '2' && (suit === '♥' || suit === '♣')) continue;
        let weight = parseInt(value);
        if (value === 'J') weight = 11; if (value === 'Q') weight = 12; if (value === 'K') weight = 13; if (value === 'A') weight = 14;
        let finalSuit = suit; let displaySuit = suit;

        if (value === '2' && suit === '♠') weight = 15; 
        else if (value === '2' && suit === '♦') { weight = 16; finalSuit = '♠'; displaySuit = '♦'; }
        deck.push({ suit: finalSuit, displaySuit: displaySuit, value: value, weight: weight });
      }
    }
    deck.push({ suit: '♠', displaySuit: '🃏', value: 'LJ', weight: 17 });
    deck.push({ suit: '♠', displaySuit: '🃏', value: 'BJ', weight: 18 });

    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    const updatedPlayers = { ...gameState.players };
    let cardIndex = 0;
    Object.keys(updatedPlayers).forEach(key => {
      const hand = deck.slice(cardIndex, cardIndex + 13);
      hand.sort((a, b) => {
          if (a.suit === '♠' && b.suit !== '♠') return -1;
          if (b.suit === '♠' && a.suit !== '♠') return 1;
          if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
          return b.weight - a.weight;
      });
      updatedPlayers[key].hand = hand;
      delete updatedPlayers[key].bid; updatedPlayers[key].tricksTaken = 0; 
      cardIndex += 13;
    });

    const currentDealerSeat = updatedPlayers[gameState.dealer].seat;
    const clockwiseOrder = ['North', 'East', 'South', 'West'];
    const firstPlayerSeat = clockwiseOrder[(clockwiseOrder.indexOf(currentDealerSeat) + 1) % 4]; 
    const firstPlayerId = Object.keys(updatedPlayers).find(id => updatedPlayers[id].seat === firstPlayerSeat);

    await update(ref(db, `rooms/${roomId}`), {
      status: 'playing', players: updatedPlayers, spadesBroken: false,
      currentBidder: firstPlayerId, currentTurn: firstPlayerId    
    });
  };

  const submitBid = async (bidValue) => {
    if (gameState.currentBidder !== playerId) return alert("Wait your turn to bid!");
    const currentSeat = gameState.players[playerId].seat;
    const clockwiseOrder = ['North', 'East', 'South', 'West'];
    const nextSeat = clockwiseOrder[(clockwiseOrder.indexOf(currentSeat) + 1) % 4];
    const nextPlayerId = Object.keys(gameState.players).find(id => gameState.players[id].seat === nextSeat);

    await update(ref(db, `rooms/${roomId}`), { [`players/${playerId}/bid`]: bidValue, currentBidder: nextPlayerId });
  };

  const playCard = async (card, cardIndex) => {
    if (gameState.currentTurn !== playerId) return alert("Wait your turn!");
    const currentTrickArray = gameState.currentTrick ? Object.values(gameState.currentTrick) : [];
    const myHand = gameState.players[playerId].hand;
    const isLeadCard = currentTrickArray.length === 0;

    if (isLeadCard && card.suit === '♠' && !gameState.spadesBroken) {
      if (!myHand.every(c => c.suit === '♠')) return alert("Spades have not been broken yet! You must lead with another suit.");
    }
    if (!isLeadCard) {
      const leadSuit = currentTrickArray[0].card.suit;
      if (card.suit !== leadSuit && myHand.some(c => c.suit === leadSuit)) return alert(`You must follow suit! Please play a ${leadSuit}.`);
    }

    const updatedHand = [...myHand];
    updatedHand.splice(cardIndex, 1); 
    const updatedTrick = [...currentTrickArray, { playerId: playerId, card: card, seat: gameState.players[playerId].seat }];

    const currentSeat = gameState.players[playerId].seat;
    const clockwiseOrder = ['North', 'East', 'South', 'West'];
    const nextPlayer = Object.keys(gameState.players).find(id => gameState.players[id].seat === clockwiseOrder[(clockwiseOrder.indexOf(currentSeat) + 1) % 4]);

    let updatedSpadesBroken = gameState.spadesBroken || false;
    if (card.suit === '♠' && (!isLeadCard || myHand.every(c => c.suit === '♠'))) updatedSpadesBroken = true;

    await update(ref(db, `rooms/${roomId}`), {
      [`players/${playerId}/hand`]: updatedHand, currentTrick: updatedTrick, currentTurn: nextPlayer, spadesBroken: updatedSpadesBroken
    });
  };

  if (!gameState) return <h2 style={{ textAlign: 'center', marginTop: '2rem' }}>Taking a seat...</h2>;

  const Chair = ({ seatName }) => {
    const occupant = getPlayerInSeat(seatName);
    const occupantId = Object.keys(gameState.players || {}).find(key => gameState.players[key].seat === seatName);
    return (
      <div style={{ padding: '1rem', backgroundColor: occupant ? '#4CAF50' : '#e0e0e0', color: occupant ? 'white' : '#666', borderRadius: '8px', minWidth: '100px', border: occupant ? '2px solid #2E7D32' : '2px dashed #999', position: 'relative' }}>
        {gameState.dealer === occupantId && (
          <div style={{ position: 'absolute', top: '-10px', right: '-10px', backgroundColor: '#ffc107', color: '#000', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.8rem', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>D</div>
        )}
        <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>{seatName}</div>
        <div style={{ fontWeight: 'bold' }}>{occupant ? occupant.name : 'Empty'}</div>
        {occupant && occupant.bid !== undefined && (
          <div style={{ marginTop: '0.5rem', backgroundColor: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
            <span>Bid: {occupant.bid === 0 ? 'NIL' : occupant.bid}</span>
            <span style={{ fontWeight: 'bold', color: '#ffeb3b' }}>Tricks: {occupant.tricksTaken || 0}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2>Room: <span style={{ color: '#0066cc' }}>{roomId}</span></h2>
        <button onClick={handleLeave} style={{ padding: '0.5rem 1rem', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Leave</button>
      </div>

      {gameState.scores && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginBottom: '2rem' }}>
          <div style={{ padding: '1rem 2rem', backgroundColor: '#e3f2fd', border: '2px solid #2196f3', borderRadius: '8px', minWidth: '150px' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', color: '#1565c0' }}>Team A (N/S)</h4>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{gameState.scores.A.total}</div>
            <div style={{ fontSize: '0.9rem', color: '#555' }}>Bags: {gameState.scores.A.bags} / 5</div>
          </div>
          <div style={{ padding: '1rem 2rem', backgroundColor: '#fce4ec', border: '2px solid #e91e63', borderRadius: '8px', minWidth: '150px' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', color: '#c2185b' }}>Team B (E/W)</h4>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{gameState.scores.B.total}</div>
            <div style={{ fontSize: '0.9rem', color: '#555' }}>Bags: {gameState.scores.B.bags} / 5</div>
          </div>
        </div>
      )}

      {gameState.status === 'gameOver' && (
        <div style={{ padding: '2rem', backgroundColor: '#fff3cd', border: '2px solid #ffc107', borderRadius: '8px', marginBottom: '2rem' }}>
          <h2 style={{ color: '#856404', margin: 0 }}>Game Over!</h2>
          <p style={{ fontSize: '1.2rem', marginBottom: '1.5rem' }}>
            {gameState.scores.A.total > gameState.scores.B.total ? "Team A (North/South)" : "Team B (East/West)"} Wins!
          </p>
          {isHost && (
            <button onClick={playAgain} style={{ padding: '0.75rem 1.5rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 'bold' }}>
              Play Again (Same Teams)
            </button>
          )}
        </div>
      )}

      {gameState.status === 'waiting' ? (
        <div style={{ padding: '2rem', backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #ccc', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
          <h3>Waiting Room ({Object.keys(gameState.players || {}).length}/4)</h3>
          <p>The game will begin once four players have joined.</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '2rem 0' }}>
            {Object.values(gameState.players || {}).map((p, i) => (
              <li key={i} style={{ fontSize: '1.4rem', margin: '0.75rem 0', color: '#2E7D32', fontWeight: 'bold' }}>
                ♠️ {p.name} {p.id === playerId ? "(You)" : ""} {p.id === hostId ? "⭐" : ""}
              </li>
            ))}
          </ul>
          {isHost && Object.keys(gameState.players || {}).length === 4 && (
            <button onClick={randomizeSeats} style={{ padding: '1rem 2rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '1.2rem', fontWeight: 'bold' }}>
              Randomize Seats & Start Game
            </button>
          )}
        </div>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: 'auto auto auto',
          gap: '1rem', alignItems: 'center', justifyItems: 'center', backgroundColor: '#f8f9fa', padding: '2rem', borderRadius: '16px',
          opacity: gameState.status === 'gameOver' ? 0.5 : 1, pointerEvents: gameState.status === 'gameOver' ? 'none' : 'auto'
        }}>
          <div style={{ gridColumn: '2' }}><Chair seatName="North" /></div>
          <div style={{ gridColumn: '1' }}><Chair seatName="West" /></div>
          
          <div style={{ 
            gridColumn: '2', width: '100%', height: '220px', background: 'radial-gradient(circle, #2E7D32 0%, #1b4b1e 100%)', 
            borderRadius: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', 
            border: '12px solid #3e2723', boxShadow: 'inset 0 0 20px rgba(0,0,0,0.5), 0 10px 20px rgba(0,0,0,0.3)'
          }}>
            {(gameState.currentTrick ? Object.values(gameState.currentTrick) : []).map((move, index) => (
              <div key={index} style={{
                position: 'absolute', width: '60px', height: '84px', backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '6px', display: 'flex', flexDirection: 'column', padding: '4px', boxSizing: 'border-box', fontWeight: 'bold', zIndex: 10,
                color: move.card.displaySuit === '♥' || move.card.displaySuit === '♦' ? '#d32f2f' : '#111',
                boxShadow: '2px 4px 8px rgba(0,0,0,0.4)',
                transform: move.seat === 'North' ? 'translateY(-55px)' : move.seat === 'South' ? 'translateY(55px)' : move.seat === 'East' ? 'translateX(65px)' : 'translateX(-65px)'
              }}>
                <div style={{ fontSize: '0.8rem', lineHeight: '1', textAlign: 'left', position: 'absolute', top: '4px', left: '4px' }}>
                  <div>{move.card.value === 'LJ' || move.card.value === 'BJ' ? '' : move.card.value}</div>
                  <div>{move.card.displaySuit}</div>
                </div>
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  {move.card.value === 'LJ' ? (
                    <div style={{ fontSize: '2rem', lineHeight: '1', textAlign: 'center' }}>🃏<div style={{fontSize: '0.6rem'}}>LITTLE</div></div>
                  ) : move.card.value === 'BJ' ? (
                    <div style={{ fontSize: '2rem', lineHeight: '1', textAlign: 'center' }}>🃏<div style={{fontSize: '0.6rem'}}>BIG</div></div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginTop: '4px' }}>
                      <span style={{ fontSize: '1.6rem', fontWeight: '900', lineHeight: '0.9' }}>{move.card.value}</span>
                      <span style={{ fontSize: '2rem', lineHeight: '0.9' }}>{move.card.displaySuit}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {gameState.status === 'tricks' && (gameState.currentTrick ? Object.keys(gameState.currentTrick).length : 0) < 4 && (
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '1.1rem', fontWeight: 'bold', zIndex: 0, letterSpacing: '1px' }}>
                {gameState.players[gameState.currentTurn]?.name}&apos;s Turn
              </div>
            )}
          </div>

          <div style={{ gridColumn: '3' }}><Chair seatName="East" /></div>
          <div style={{ gridColumn: '2' }}><Chair seatName="South" /></div>
        </div>
      )}

      {gameState.dealer === playerId && gameState.status === 'seated' && (
        <div style={{ marginTop: '2rem' }}>
          <button onClick={dealCards} style={{ padding: '0.75rem 1.5rem', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: 'pointer' }}>
            Deal Cards!
          </button>
        </div>
      )}

      {gameState.status === 'playing' && gameState.players?.[playerId] && (
        <div style={{ marginTop: '2rem', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '2px solid #007bff' }}>
          {gameState.currentBidder === playerId ? (
            <>
              <h3>Place Your Bid</h3>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
                {['Nil', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((val) => (
                  <button key={val} onClick={() => submitBid(val === 'Nil' ? 0 : val)} style={{ padding: '0.75rem', minWidth: '45px', cursor: 'pointer', backgroundColor: val === 'Nil' ? '#6f42c1' : '#007bff', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>
                    {val}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <h3 style={{ color: '#555' }}>Waiting for {gameState.players[gameState.currentBidder]?.name} to bid...</h3>
          )}
        </div>
      )}

      {gameState.players?.[playerId]?.hand && (
        <div style={{ marginTop: '2rem', padding: '1.5rem', backgroundColor: '#f0f2f5', borderRadius: '12px', border: '1px solid #ddd', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#333' }}>My Hand</h3>
          <div style={{ position: 'relative', height: '140px', width: '100%', display: 'flex', justifyContent: 'center' }}>
            {gameState.players[playerId].hand.map((card, idx) => {
              const totalCards = gameState.players[playerId].hand.length;
              const middleIndex = (totalCards - 1) / 2;
              const offsetFromCenter = idx - middleIndex;
              const rotation = offsetFromCenter * 4; 
              const translateY = Math.abs(offsetFromCenter) * 3; 
              const isMyTurn = gameState.currentTurn === playerId && gameState.status === 'tricks';

              return (
                <div 
                  key={idx} 
                  onClick={() => isMyTurn && playCard(card, idx)}
                  style={{ 
                    position: 'absolute', width: '65px', height: '95px', padding: '4px', boxSizing: 'border-box', borderRadius: '8px', border: isMyTurn ? '2px solid #ffc107' : '1px solid #ccc', backgroundColor: '#fff', 
                    color: card.displaySuit === '♥' || card.displaySuit === '♦' ? '#d32f2f' : '#111', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontWeight: 'bold', boxShadow: '-2px 4px 8px rgba(0,0,0,0.2)', cursor: isMyTurn ? 'pointer' : 'default', zIndex: idx,
                    transform: `translateX(${offsetFromCenter * 25}px) translateY(${translateY}px) rotate(${rotation}deg)`, transformOrigin: 'bottom center', transition: 'transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1), z-index 0.2s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = `translateX(${offsetFromCenter * 25}px) translateY(${translateY - 20}px) rotate(${rotation}deg)`; e.currentTarget.style.zIndex = '50'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = `translateX(${offsetFromCenter * 25}px) translateY(${translateY}px) rotate(${rotation}deg)`; e.currentTarget.style.zIndex = idx; }}
                >
                  <div style={{ fontSize: '0.85rem', lineHeight: '1', textAlign: 'left', position: 'absolute', top: '4px', left: '4px' }}>
                    <div>{card.value === 'LJ' || card.value === 'BJ' ? '' : card.value}</div>
                    <div>{card.displaySuit}</div>
                  </div>
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    {card.value === 'LJ' ? (
                      <div style={{ fontSize: '2rem', lineHeight: '1', textAlign: 'center' }}>🃏<div style={{fontSize: '0.6rem'}}>LITTLE</div></div>
                    ) : card.value === 'BJ' ? (
                      <div style={{ fontSize: '2rem', lineHeight: '1', textAlign: 'center' }}>🃏<div style={{fontSize: '0.6rem'}}>BIG</div></div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginTop: '4px' }}>
                        <span style={{ fontSize: '1.8rem', fontWeight: '900', lineHeight: '0.9' }}>{card.value}</span>
                        <span style={{ fontSize: '2.2rem', lineHeight: '0.9' }}>{card.displaySuit}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: '0.85rem', lineHeight: '1', textAlign: 'right', transform: 'rotate(180deg)', position: 'absolute', bottom: '4px', right: '4px' }}>
                    <div>{card.value === 'LJ' || card.value === 'BJ' ? '' : card.value}</div>
                    <div>{card.displaySuit}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {gameState.history && gameState.history.length > 0 && (
        <div style={{ marginTop: '3rem', backgroundColor: '#fff', borderRadius: '12px', padding: '1.5rem', border: '1px solid #ccc', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', overflowX: 'auto' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#333', textAlign: 'left' }}>Match Ledger</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '1.1rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '3px solid #ccc' }}>
                <th style={{ padding: '1rem' }}>Rnd</th>
                <th style={{ padding: '1rem', color: '#1565c0' }}>Team A Bids</th>
                <th style={{ padding: '1rem', color: '#1565c0' }}>Got</th>
                <th style={{ padding: '1rem', color: '#1565c0' }}>Score</th>
                <th style={{ padding: '1rem', color: '#c2185b' }}>Team B Bids</th>
                <th style={{ padding: '1rem', color: '#c2185b' }}>Got</th>
                <th style={{ padding: '1rem', color: '#c2185b' }}>Score</th>
              </tr>
            </thead>
            <tbody>
              {gameState.history.map((log, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '1rem', fontWeight: 'bold', color: '#555' }}>{log.round}</td>
                  <td style={{ padding: '1rem' }}>{log.teamA.bids}</td>
                  <td style={{ padding: '1rem' }}>{log.teamA.tricks}</td>
                  <td style={{ padding: '1rem', fontWeight: 'bold', fontSize: '1.2rem' }}>{log.teamA.score} <span style={{fontSize:'0.8rem', color:'#888', fontWeight:'normal'}}>({log.teamA.bags}b)</span></td>
                  <td style={{ padding: '1rem' }}>{log.teamB.bids}</td>
                  <td style={{ padding: '1rem' }}>{log.teamB.tricks}</td>
                  <td style={{ padding: '1rem', fontWeight: 'bold', fontSize: '1.2rem' }}>{log.teamB.score} <span style={{fontSize:'0.8rem', color:'#888', fontWeight:'normal'}}>({log.teamB.bags}b)</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default GameTable;