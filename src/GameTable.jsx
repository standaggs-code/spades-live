import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ref, onValue, off, update } from 'firebase/database';
import { db } from './firebase';

function GameTable() {
  const { roomId } = useParams(); 
  const [searchParams] = useSearchParams();
  const playerId = searchParams.get('player'); 
  const navigate = useNavigate();
  const [gameState, setGameState] = useState(null);

  const isHost = playerId === 'player1';

  // 1. Core Database Listener
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
    return () => off(roomRef, 'value', unsubscribe);
  }, [roomId, navigate]);

  // 2. Referee: Detect when all bids are in
  useEffect(() => {
    if (!isHost || !gameState || gameState.status !== 'playing') return;

    const players = gameState.players || {};
    const playerIds = Object.keys(players);

    const allBid = playerIds.length === 4 && playerIds.every(id => 
      players[id].bid !== undefined && players[id].bid !== null
    );

    if (allBid) {
      update(ref(db, `rooms/${roomId}`), { 
        status: 'tricks',
        currentTrick: [] 
        // We DO NOT set currentTurn here anymore! dealCards already set it to the person left of the dealer.
      });
    }
  }, [gameState, isHost, roomId]);

  // 3. Referee: Evaluate Trick after 4 cards are played
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

          if (currentCard.suit === '♠' && winningCard.suit !== '♠') {
            winningMove = move;
          } else if (currentCard.suit === '♠' && winningCard.suit === '♠') {
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

  // 4. Referee: End of Hand Scoring (Your House Rules)
  useEffect(() => {
    if (!isHost || !gameState || gameState.status !== 'tricks') return;

    const players = gameState.players || {};
    const pIds = Object.keys(players);
    if (pIds.length !== 4) return;

    const totalTricks = pIds.reduce((sum, id) => sum + (players[id].tricksTaken || 0), 0);

    if (totalTricks === 13 && !gameState.currentTrick) {
      const calculateTeamScore = (teamLabel, p1Id, p2Id) => {
        const p1 = players[p1Id];
        const p2 = players[p2Id];
        let scoreChange = 0;
        let newBags = 0;

        const checkNil = (p) => {
          if (p.bid === 0) {
            if (p.tricksTaken === 0) scoreChange += 50; 
            else scoreChange -= 50; 
          }
        };
        checkNil(p1);
        checkNil(p2);

        const teamBid = (p1.bid === 0 ? 0 : p1.bid) + (p2.bid === 0 ? 0 : p2.bid);
        const teamTricks = p1.tricksTaken + p2.tricksTaken;

        if (teamTricks < teamBid) {
          scoreChange -= (teamBid * 10); 
        } else {
          scoreChange += (teamBid * 10); 
          newBags = teamTricks - teamBid;
        }

        let currentTotal = gameState.scores[teamLabel].total + scoreChange;
        let currentBags = gameState.scores[teamLabel].bags + newBags;

        if (currentBags >= 5) {
          currentTotal -= 50;
          currentBags = currentBags % 5;
        }

        return { total: currentTotal, bags: currentBags };
      };

      const teamAIds = pIds.filter(id => players[id].team === 'A'); 
      const teamBIds = pIds.filter(id => players[id].team === 'B'); 

      const newScoreA = calculateTeamScore('A', teamAIds[0], teamAIds[1]);
      const newScoreB = calculateTeamScore('B', teamBIds[0], teamBIds[1]);

      let nextStatus = 'seated';
      if (newScoreA.total >= 300 || newScoreB.total >= 300) {
        nextStatus = 'gameOver';
      }

      update(ref(db, `rooms/${roomId}`), {
        status: nextStatus,
        scores: { A: newScoreA, B: newScoreB },
      });
    }
  }, [gameState?.players, gameState?.currentTrick, isHost, roomId, gameState?.status, gameState?.scores]);


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
      players: updatedPlayers,
      status: 'seated',
      dealer: 'player4', // Arbitrary start so player1 becomes the first real dealer
      scores: { A: { total: 0, bags: 0 }, B: { total: 0, bags: 0 } }
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
      status: 'seated',
      scores: { A: { total: 0, bags: 0 }, B: { total: 0, bags: 0 } },
      players: updatedPlayers,
      currentTrick: null,
      spadesBroken: false
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
        if (value === 'J') weight = 11;
        if (value === 'Q') weight = 12;
        if (value === 'K') weight = 13;
        if (value === 'A') weight = 14;

        let finalSuit = suit;
        let displaySuit = suit;

        if (value === '2' && suit === '♠') {
          weight = 15; 
        } else if (value === '2' && suit === '♦') {
          weight = 16; 
          finalSuit = '♠'; 
          displaySuit = '♦'; 
        }

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
      delete updatedPlayers[key].bid; 
      updatedPlayers[key].tricksTaken = 0; 
      cardIndex += 13;
    });

    // Determine Dealer & Next Turn Clockwise
    const currentDealerId = gameState.dealer || 'player4';
    const currentDealerSeat = updatedPlayers[currentDealerId].seat;
    const clockwiseOrder = ['North', 'East', 'South', 'West'];
    
    const currentDealerIndex = clockwiseOrder.indexOf(currentDealerSeat);
    const newDealerSeat = clockwiseOrder[(currentDealerIndex + 1) % 4];
    const newDealerId = Object.keys(updatedPlayers).find(id => updatedPlayers[id].seat === newDealerSeat);
    
    const firstPlayerSeat = clockwiseOrder[(currentDealerIndex + 2) % 4]; 
    const firstPlayerId = Object.keys(updatedPlayers).find(id => updatedPlayers[id].seat === firstPlayerSeat);

    await update(ref(db, `rooms/${roomId}`), {
      status: 'playing',
      players: updatedPlayers,
      spadesBroken: false,
      dealer: newDealerId,
      currentBidder: firstPlayerId, // Left of dealer bids first
      currentTurn: firstPlayerId    // Left of dealer plays first
    });
  };

  const submitBid = async (bidValue) => {
    if (gameState.currentBidder !== playerId) return alert("Wait your turn to bid!");

    // Advance the bidder clockwise
    const currentSeat = gameState.players[playerId].seat;
    const clockwiseOrder = ['North', 'East', 'South', 'West'];
    const currentSeatIndex = clockwiseOrder.indexOf(currentSeat);
    const nextSeat = clockwiseOrder[(currentSeatIndex + 1) % 4];
    const nextPlayerId = Object.keys(gameState.players).find(id => gameState.players[id].seat === nextSeat);

    await update(ref(db, `rooms/${roomId}`), {
      [`players/${playerId}/bid`]: bidValue,
      currentBidder: nextPlayerId
    });
  };

  const playCard = async (card, cardIndex) => {
    if (gameState.currentTurn !== playerId) return alert("Wait your turn!");

    const currentTrickArray = gameState.currentTrick ? Object.values(gameState.currentTrick) : [];
    const myHand = gameState.players[playerId].hand;
    const isLeadCard = currentTrickArray.length === 0;

    if (isLeadCard && card.suit === '♠' && !gameState.spadesBroken) {
      const onlyHasSpades = myHand.every(c => c.suit === '♠');
      if (!onlyHasSpades) {
        return alert("Spades have not been broken yet! You must lead with another suit.");
      }
    }

    if (!isLeadCard) {
      const leadSuit = currentTrickArray[0].card.suit;
      if (card.suit !== leadSuit) {
        const hasLeadSuit = myHand.some(c => c.suit === leadSuit);
        if (hasLeadSuit) {
          return alert(`You must follow suit! Please play a ${leadSuit}.`);
        }
      }
    }

    const updatedHand = [...myHand];
    updatedHand.splice(cardIndex, 1); 

    const newTrickMove = { playerId: playerId, card: card, seat: gameState.players[playerId].seat };
    const updatedTrick = [...currentTrickArray, newTrickMove];

    const currentSeat = gameState.players[playerId].seat;
    const clockwiseOrder = ['North', 'East', 'South', 'West'];
    const currentSeatIndex = clockwiseOrder.indexOf(currentSeat);
    const nextSeat = clockwiseOrder[(currentSeatIndex + 1) % 4];
    const nextPlayer = Object.keys(gameState.players).find(id => gameState.players[id].seat === nextSeat);

    let updatedSpadesBroken = gameState.spadesBroken || false;
    if (card.suit === '♠' && (!isLeadCard || myHand.every(c => c.suit === '♠'))) {
      updatedSpadesBroken = true;
    }

    await update(ref(db, `rooms/${roomId}`), {
      [`players/${playerId}/hand`]: updatedHand,
      currentTrick: updatedTrick,
      currentTurn: nextPlayer,
      spadesBroken: updatedSpadesBroken
    });
  };

  if (!gameState) return <h2 style={{ textAlign: 'center', marginTop: '2rem' }}>Taking a seat...</h2>;

  const Chair = ({ seatName }) => {
    const occupant = getPlayerInSeat(seatName);
    const occupantId = Object.keys(gameState.players || {}).find(key => gameState.players[key].seat === seatName);

    return (
      <div style={{
        padding: '1rem',
        backgroundColor: occupant ? '#4CAF50' : '#e0e0e0', 
        color: occupant ? 'white' : '#666',
        borderRadius: '8px',
        minWidth: '100px',
        border: occupant ? '2px solid #2E7D32' : '2px dashed #999',
        position: 'relative'
      }}>
        {/* Dealer Button Badge */}
        {gameState.dealer === occupantId && (
          <div style={{ position: 'absolute', top: '-10px', right: '-10px', backgroundColor: '#ffc107', color: '#000', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.8rem', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
            D
          </div>
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
        <button onClick={() => navigate('/')} style={{ padding: '0.5rem 1rem', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Leave</button>
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
                ♠️ {p.name} {p.id === playerId ? "(You)" : ""}
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
            gridColumn: '2', width: '100%', height: '180px', backgroundColor: '#2E7D32', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', border: '8px solid #5D4037' 
          }}>
            {(gameState.currentTrick ? Object.values(gameState.currentTrick) : []).map((move, index) => (
              <div key={index} style={{
                position: 'absolute', width: '50px', height: '75px', backgroundColor: 'white', border: '1px solid #000', borderRadius: '4px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', zIndex: 10,
                color: move.card.displaySuit === '♥' || move.card.displaySuit === '♦' ? '#d32f2f' : '#000',
                boxShadow: '0 4px 8px rgba(0,0,0,0.4)',
                transform: move.seat === 'North' ? 'translateY(-45px)' : move.seat === 'South' ? 'translateY(45px)' : move.seat === 'East' ? 'translateX(45px)' : 'translateX(-45px)'
              }}>
                <div style={{ lineHeight: '1' }}>{move.card.value}</div>
                <div style={{ lineHeight: '1' }}>{move.card.displaySuit}</div>
              </div>
            ))}
            
            {gameState.status === 'tricks' && (gameState.currentTrick ? Object.keys(gameState.currentTrick).length : 0) < 4 && (
              <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '1rem', fontWeight: 'bold', zIndex: 0 }}>
                {gameState.players[gameState.currentTurn]?.name}&apos;s Turn
              </div>
            )}
          </div>
          <div style={{ gridColumn: '3' }}><Chair seatName="East" /></div>
          <div style={{ gridColumn: '2' }}><Chair seatName="South" /></div>
        </div>
      )}

      {isHost && gameState.status === 'seated' && (
        <div style={{ marginTop: '2rem' }}>
          <button onClick={dealCards} style={{ padding: '0.75rem 1.5rem', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: 'pointer' }}>
            Deal Cards!
          </button>
        </div>
      )}

      {/* Sequential Bidding UI */}
      {gameState.status === 'playing' && gameState.players?.[playerId] && (
        <div style={{ marginTop: '2rem', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '2px solid #007bff' }}>
          {gameState.currentBidder === playerId ? (
            <>
              <h3>Place Your Bid</h3>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
                {['Nil', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((val) => (
                  <button
                    key={val}
                    onClick={() => submitBid(val === 'Nil' ? 0 : val)}
                    style={{ padding: '0.75rem', minWidth: '45px', cursor: 'pointer', backgroundColor: val === 'Nil' ? '#6f42c1' : '#007bff', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}
                  >
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
        <div style={{ marginTop: '2rem', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #ccc' }}>
          <h3>My Hand</h3>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem', overflowX: 'auto', paddingBottom: '1rem', paddingTop: '1rem' }}>
            {gameState.players[playerId].hand.map((card, idx) => (
              <div 
                key={idx} 
                onClick={() => gameState.status === 'tricks' && playCard(card, idx)}
                style={{ 
                  width: '60px', height: '90px', padding: '0.5rem', borderRadius: '6px',
                  border: gameState.currentTurn === playerId ? '2px solid #ffc107' : '1px solid #999',
                  color: card.displaySuit === '♥' || card.displaySuit === '♦' ? '#d32f2f' : '#000',
                  backgroundColor: '#fff', fontSize: '1.4rem', fontWeight: 'bold',
                  marginLeft: idx === 0 ? '0' : '-1.8rem', position: 'relative', zIndex: idx, 
                  transition: 'transform 0.2s', cursor: gameState.currentTurn === playerId ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '-3px 0 5px rgba(0,0,0,0.15)'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-20px)'; e.currentTarget.style.zIndex = '50'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.zIndex = idx; }}
              >
                <div style={{ lineHeight: '1' }}>{card.value}</div>
                <div style={{ lineHeight: '1' }}>{card.displaySuit}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default GameTable;