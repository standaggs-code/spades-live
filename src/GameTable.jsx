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
          <div style={{ marginTop: '0.5rem', backgroundColor: 'rgba(0,0,0,0.2)', padding: '2px 8px', borderRadius: '4px' }}>
            Bid: {occupant.bid === 0 ? 'NIL' : occupant.bid}
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

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: 'auto auto auto',
        gap: '1rem', alignItems: 'center', justifyItems: 'center', backgroundColor: '#f8f9fa', padding: '2rem', borderRadius: '16px'
      }}>
        <div style={{ gridColumn: '2' }}><Chair seatName="North" /></div>
        <div style={{ gridColumn: '1' }}><Chair seatName="West" /></div>
        <div style={{ 
          gridColumn: '2', width: '100%', height: '150px', backgroundColor: '#2E7D32', borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', border: '8px solid #5D4037' 
        }}>The Felt</div>
        <div style={{ gridColumn: '3' }}><Chair seatName="East" /></div>
        <div style={{ gridColumn: '2' }}><Chair seatName="South" /></div>
      </div>

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
                style={{ 
                  width: '60px', height: '90px', padding: '0.5rem', border: '1px solid #999', borderRadius: '6px',
                  color: card.suit === '♥' || card.suit === '♦' ? '#d32f2f' : '#000',
                  backgroundColor: '#fff', fontSize: '1.4rem', fontWeight: 'bold',
                  marginLeft: idx === 0 ? '0' : '-1.8rem', position: 'relative', zIndex: idx, 
                  transition: 'transform 0.2s', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
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