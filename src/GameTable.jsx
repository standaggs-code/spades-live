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

  // Check if the current user is the room creator
  const isHost = playerId === 'player1';

  useEffect(() => {
    const roomRef = ref(db, `rooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        setGameState(snapshot.val());
      }
    });
    return () => off(roomRef, 'value', unsubscribe);
  }, [roomId]);

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

        // Note: We use null instead of [] here so Firebase wipes the table completely clean
        await update(ref(db, `rooms/${roomId}`), {
          currentTrick: null,
          currentTurn: winnerId,
          [`players/${winnerId}/tricksTaken`]: currentTricksTaken + 1
        });

      }, 3000); 

      return () => clearTimeout(timer);
    }
  }, [gameState?.currentTrick, isHost, roomId, gameState?.status]);


const randomizeSeats = async () => {
  const seats = ['North', 'East', 'South', 'West'];
  // Shuffle seats array
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [seats[i], seats[j]] = [seats[j], seats[i]];
  }

  const updatedPlayers = { ...gameState.players };
  Object.keys(updatedPlayers).forEach((id, index) => {
    updatedPlayers[id].seat = seats[index];
    // Assign teams: North/South = Team A, East/West = Team B
    updatedPlayers[id].team = (seats[index] === 'North' || seats[index] === 'South') ? 'A' : 'B';
  });

  await update(ref(db, `rooms/${roomId}`), {
    players: updatedPlayers,
    status: 'seated' // New intermediate status
  });
};

  const getPlayerInSeat = (seatName) => {
    if (!gameState || !gameState.players) return null;
    return Object.values(gameState.players).find(p => p.seat === seatName);
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

    // Shuffle
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
      // Reset bid in case this is a new round
      delete updatedPlayers[key].bid; 
      cardIndex += 13;
    });

    await update(ref(db, `rooms/${roomId}`), {
      status: 'playing',
      players: updatedPlayers
    });
  };

  const submitBid = async (bidValue) => {
    const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
    await update(playerRef, { bid: bidValue });
  };

const playCard = async (card, cardIndex) => {
    if (gameState.currentTurn !== playerId) return alert("Wait your turn!");

    const updatedHand = [...gameState.players[playerId].hand];
    updatedHand.splice(cardIndex, 1); 

    const newTrickMove = {
      playerId: playerId,
      card: card,
      seat: gameState.players[playerId].seat
    };

    // FORCE FIREBASE DATA INTO AN ARRAY
    const currentTrickArray = gameState.currentTrick ? Object.values(gameState.currentTrick) : [];
    const updatedTrick = [...currentTrickArray, newTrickMove];

    const turnOrder = ['player1', 'player2', 'player3', 'player4'];
    const currentIndex = turnOrder.indexOf(playerId);
    const nextPlayer = turnOrder[(currentIndex + 1) % 4];

    await update(ref(db, `rooms/${roomId}`), {
      [`players/${playerId}/hand`]: updatedHand,
      currentTrick: updatedTrick,
      currentTurn: nextPlayer
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
        
        {/* Bid Logic */}
        {occupant && (
          <div style={{ marginTop: '0.5rem', backgroundColor: 'rgba(0,0,0,0.2)', padding: '2px 8px', borderRadius: '4px' }}>
            {occupant.bid !== undefined ? `Bid: ${occupant.bid === 0 ? 'NIL' : occupant.bid}` : 'Bidding...'}
          </div>
        )}
      </div>
    );
  };
  
return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2>Room: <span style={{ color: '#0066cc' }}>{roomId}</span></h2>
        <button onClick={() => navigate('/')} style={{ padding: '0.5rem 1rem', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px' }}>Leave</button>
      </div>

      {/* PHASE 3 START: Conditional Rendering */}
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
          
          {/* Only show the Randomize button to the host when 4 people are here */}
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
        /* This is your existing Card Table Grid */
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
                {gameState.players[gameState.currentTurn]?.name}'s Turn
              </div>
            )}
          </div>
          <div style={{ gridColumn: '3' }}><Chair seatName="East" /></div>
          <div style={{ gridColumn: '2' }}><Chair seatName="South" /></div>
        </div>
      )}
      {/* PHASE 3 END */}

      {/* Host Controls for Dealing (Only show once seated) */}
      {isHost && gameState.status === 'seated' && (
        <div style={{ marginTop: '2rem' }}>
          <button onClick={dealCards} style={{ padding: '0.75rem 1.5rem', backgroundColor: '#007bff', color: 'white', borderRadius: '8px', fontSize: '1.2rem' }}>
            Deal First Hand!
          </button>
        </div>
      )}

      {/* ... Rest of your file (Bidding UI and My Hand) ... */}

      {/* Host Controls */}
      {isHost && gameState.status === 'waiting' && (
        <div style={{ marginTop: '2rem' }}>
          <button onClick={dealCards} style={{ padding: '0.75rem 1.5rem', backgroundColor: '#007bff', color: 'white', borderRadius: '8px', fontSize: '1.2rem' }}>
            Deal Cards!
          </button>
        </div>
      )}

      {/* Bidding Phase UI */}
      {gameState.status === 'playing' && gameState.players?.[playerId] && 
       gameState.players[playerId].bid === undefined && (
        <div style={{ marginTop: '2rem', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '2px solid #007bff' }}>
          <h3>Place Your Bid</h3>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
            {['Nil', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((val) => (
              <button
                key={val}
                onClick={() => submitBid(val === 'Nil' ? 0 : val)}
                style={{ padding: '0.75rem', minWidth: '45px', cursor: 'pointer', backgroundColor: val === 'Nil' ? '#6f42c1' : '#007bff', color: 'white', borderRadius: '4px' }}
              >
                {val}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* My Hand */}
      {gameState.players?.[playerId]?.hand && (
        <div style={{ marginTop: '2rem', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #ccc' }}>
          <h3>My Hand</h3>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem', overflowX: 'auto', paddingBottom: '1rem' }}>
            {gameState.players[playerId].hand.map((card, idx) => (
              <div 
                key={idx} 
                onClick={() => playCard(card, idx)}
                style={{ 
                  width: '60px', height: '90px', padding: '0.5rem', border: '1px solid #999', borderRadius: '6px',
                  color: card.suit === '♥' || card.suit === '♦' ? '#d32f2f' : '#000',
                  backgroundColor: '#fff', fontSize: '1.4rem', fontWeight: 'bold',
                  marginLeft: idx === 0 ? '0' : '-1.8rem', position: 'relative', zIndex: idx, 
                  transition: 'transform 0.2s', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  border: gameState.currentTurn === playerId ? '2px solid #ffc107' : '1px solid #999', // Highlight hand if it's your turn
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-20px)'; e.currentTarget.style.zIndex = '50'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.zIndex = idx; }}
              >
                <div>{card.value}</div>
                <div>{card.suit}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default GameTable;