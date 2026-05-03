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
        // THE FIX: If the room doesn't exist, boot them to the lobby!
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
        currentTurn: 'player1', // Host leads first trick
        currentTrick: [] 
      });
    }
  }, [gameState, isHost, roomId]);

  // 3. Referee: Evaluate Trick after 4 cards are played
  useEffect(() => {
    if (!isHost || !gameState || gameState.status !== 'tricks') return;
    
    // FORCE FIREBASE DATA INTO AN ARRAY
    const trick = gameState.currentTrick ? Object.values(gameState.currentTrick) : [];
    
    if (trick.length === 4) {
      const timer = setTimeout(async () => {
        const leadSuit = trick[0].card.suit;
        let winningMove = trick[0];

        // Evaluate the 4 cards
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

        // Wipe the table clean, give trick to winner, make it their turn
        await update(ref(db, `rooms/${roomId}`), {
          currentTrick: null,
          currentTurn: winnerId,
          [`players/${winnerId}/tricksTaken`]: currentTricksTaken + 1
        });

      }, 3000); 

      return () => clearTimeout(timer);
    }
  }, [gameState?.currentTrick, isHost, roomId, gameState?.status]);

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
      status: 'seated' 
    });
  };

  const dealCards = async () => {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let deck = [];
    
    for (const suit of suits) {
      for (const value of values) {
        let weight = parseInt(value);
        if (value === 'J') weight = 11;
        if (value === 'Q') weight = 12;
        if (value === 'K') weight = 13;
        if (value === 'A') weight = 14;
        deck.push({ suit, value, weight });
      }
    }

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

    await update(ref(db, `rooms/${roomId}`), {
      status: 'playing',
      players: updatedPlayers,
      spadesBroken: false
    });
  };

  const submitBid = async (bidValue) => {
    const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
    await update(playerRef, { bid: bidValue });
  };

const playCard = async (card, cardIndex) => {
    if (gameState.currentTurn !== playerId) return alert("Wait your turn!");

    const currentTrickArray = gameState.currentTrick ? Object.values(gameState.currentTrick) : [];
    const myHand = gameState.players[playerId].hand;
    const isLeadCard = currentTrickArray.length === 0;

    // --- NEW: Breaking Spades Validation ---
    if (isLeadCard && card.suit === '♠' && !gameState.spadesBroken) {
      // Check if they ONLY have Spades left
      const onlyHasSpades = myHand.every(c => c.suit === '♠');
      
      if (!onlyHasSpades) {
        return alert("Spades have not been broken yet! You must lead with another suit.");
      }
    }
    // ---------------------------------------

    // --- EXISTING: Follow Suit Validation ---
    if (!isLeadCard) {
      const leadSuit = currentTrickArray[0].card.suit;
      if (card.suit !== leadSuit) {
        const hasLeadSuit = myHand.some(c => c.suit === leadSuit);
        if (hasLeadSuit) {
          return alert(`You must follow suit! Please play a ${leadSuit}.`);
        }
      }
    }
    // ----------------------------------------

    const updatedHand = [...myHand];
    updatedHand.splice(cardIndex, 1); 

    const newTrickMove = {
      playerId: playerId,
      card: card,
      seat: gameState.players[playerId].seat
    };

    const updatedTrick = [...currentTrickArray, newTrickMove];

// 4. Pass the turn clockwise based on the current player's SEAT
    const currentSeat = gameState.players[playerId].seat;
    const clockwiseOrder = ['North', 'East', 'South', 'West'];
    
    const currentSeatIndex = clockwiseOrder.indexOf(currentSeat);
    const nextSeat = clockwiseOrder[(currentSeatIndex + 1) % 4];
    
    // Find WHICH player ID is actually sitting in that next seat
    const nextPlayer = Object.keys(gameState.players).find(
      id => gameState.players[id].seat === nextSeat
    );

    // --- NEW: Detect if Spades just broke ---
    let updatedSpadesBroken = gameState.spadesBroken || false;
    // If they play a Spade and it's not the lead card (they are cutting) 
    // OR they legally led with a Spade because it's all they had left
    if (card.suit === '♠' && (!isLeadCard || myHand.every(c => c.suit === '♠'))) {
      updatedSpadesBroken = true;
    }

    // ----------------------------------------

    await update(ref(db, `rooms/${roomId}`), {
      [`players/${playerId}/hand`]: updatedHand,
      currentTrick: updatedTrick,
      currentTurn: nextPlayer,
      spadesBroken: updatedSpadesBroken // <-- Save the broken status
    });
  };

  if (!gameState) return <h2 style={{ textAlign: 'center', marginTop: '2rem' }}>Taking a seat...</h2>;

  const Chair = ({ seatName }) => {
    const occupant = getPlayerInSeat(seatName);
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
        <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>{seatName}</div>
        <div style={{ fontWeight: 'bold' }}>{occupant ? occupant.name : 'Empty'}</div>
        
        {occupant && occupant.bid !== undefined && (
          <div style={{ 
            marginTop: '0.5rem', 
            backgroundColor: 'rgba(0,0,0,0.2)', 
            padding: '4px 8px', 
            borderRadius: '4px',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.9rem'
          }}>
            <span>Bid: {occupant.bid === 0 ? 'NIL' : occupant.bid}</span>
            <span style={{ fontWeight: 'bold', color: '#ffeb3b' }}>
              Tricks: {occupant.tricksTaken || 0}
            </span>
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
            <button 
              onClick={randomizeSeats} 
              style={{ padding: '1rem 2rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '1.2rem', fontWeight: 'bold' }}
            >
              Randomize Seats & Start Game
            </button>
          )}
        </div>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: 'auto auto auto',
          gap: '1rem', alignItems: 'center', justifyItems: 'center', backgroundColor: '#f8f9fa', padding: '2rem', borderRadius: '16px'
        }}>
          <div style={{ gridColumn: '2' }}><Chair seatName="North" /></div>
          <div style={{ gridColumn: '1' }}><Chair seatName="West" /></div>
          <div style={{ 
            gridColumn: '2', width: '100%', height: '180px', backgroundColor: '#2E7D32', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', border: '8px solid #5D4037' 
          }}>
            {/* Display cards in the trick securely */}
            {(gameState.currentTrick ? Object.values(gameState.currentTrick) : []).map((move, index) => (
              <div key={index} style={{
                position: 'absolute', width: '50px', height: '75px', backgroundColor: 'white',
                border: '1px solid #000', borderRadius: '4px', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', zIndex: 10,
                color: move.card.suit === '♥' || move.card.suit === '♦' ? '#d32f2f' : '#000',
                boxShadow: '0 4px 8px rgba(0,0,0,0.4)',
                transform: 
                  move.seat === 'North' ? 'translateY(-45px)' :
                  move.seat === 'South' ? 'translateY(45px)' :
                  move.seat === 'East' ? 'translateX(45px)' :
                  'translateX(-45px)'
              }}>
                <div style={{ lineHeight: '1' }}>{move.card.value}</div>
                <div style={{ lineHeight: '1' }}>{move.card.suit}</div>
              </div>
            ))}
            
            {/* Show whose turn it is in the center if the trick isn't full */}
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
            Deal First Hand!
          </button>
        </div>
      )}

      {gameState.status === 'playing' && gameState.players?.[playerId] && 
       gameState.players[playerId].bid === undefined && (
        <div style={{ marginTop: '2rem', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '2px solid #007bff' }}>
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
                  color: card.suit === '♥' || card.suit === '♦' ? '#d32f2f' : '#000',
                  backgroundColor: '#fff', fontSize: '1.4rem', fontWeight: 'bold',
                  marginLeft: idx === 0 ? '0' : '-1.8rem', position: 'relative', zIndex: idx, 
                  transition: 'transform 0.2s', cursor: gameState.currentTurn === playerId ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '-3px 0 5px rgba(0,0,0,0.15)'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-20px)'; e.currentTarget.style.zIndex = '50'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.zIndex = idx; }}
              >
                <div style={{ lineHeight: '1' }}>{card.value}</div>
                <div style={{ lineHeight: '1' }}>{card.suit}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default GameTable;