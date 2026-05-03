import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, set, get, update } from 'firebase/database';
import { db } from './firebase';

function Lobby() {
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [isCreating, setIsCreating] = useState(true);
  const navigate = useNavigate();

  const createGame = async () => {
    if (!playerName.trim()) return alert("Please enter your name");

    // Generate a random 4-letter room code
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let newRoomCode = '';
    for (let i = 0; i < 4; i++) {
      newRoomCode += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    const roomRef = ref(db, `rooms/${newRoomCode}`);
    
    await set(roomRef, {
      status: 'waiting',
      players: {
        player1: {
          name: playerName,
          id: 'player1' // Ready for the randomizer!
        }
      }
    });

    navigate(`/room/${newRoomCode}?player=player1`);
  };

  const joinGame = async () => {
    if (!playerName.trim() || !joinCode.trim()) return alert("Enter name and room code");
    
    const upperCode = joinCode.toUpperCase();
    const roomRef = ref(db, `rooms/${upperCode}`);

    try {
      const snapshot = await get(roomRef);

      if (snapshot.exists()) {
        const roomData = snapshot.val();
        const currentPlayers = roomData.players || {};
        const count = Object.keys(currentPlayers).length;

        if (count >= 4) return alert("Room is full!");

        // Add them to the list of players without a seat yet
        const nextPlayerId = `player${count + 1}`;
        await update(ref(db, `rooms/${upperCode}/players/${nextPlayerId}`), {
          name: playerName,
          id: nextPlayerId
        });

        navigate(`/room/${upperCode}?player=${nextPlayerId}`);
      } else {
        alert("Room not found!");
      }
    } catch (error) {
      console.error("Join Error:", error);
      alert(`Error joining room: ${error.message}`);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '4rem auto', textAlign: 'center', padding: '2rem', border: '1px solid #ccc', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
      <h1 style={{ color: '#2E7D32' }}>Spades Live</h1>
      
      <div style={{ marginBottom: '1.5rem' }}>
        <input 
          type="text" 
          placeholder="Your Name" 
          value={playerName} 
          onChange={(e) => setPlayerName(e.target.value)}
          style={{ width: '100%', padding: '0.75rem', marginBottom: '1rem', boxSizing: 'border-box', fontSize: '1.2rem', borderRadius: '4px', border: '1px solid #ccc' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <button 
          onClick={() => setIsCreating(true)}
          style={{ padding: '0.5rem 1rem', backgroundColor: isCreating ? '#007bff' : '#e0e0e0', color: isCreating ? 'white' : 'black', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Create Game
        </button>
        <button 
          onClick={() => setIsCreating(false)}
          style={{ padding: '0.5rem 1rem', backgroundColor: !isCreating ? '#28a745' : '#e0e0e0', color: !isCreating ? 'white' : 'black', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Join Game
        </button>
      </div>

      {isCreating ? (
        <div>
          <p style={{ color: '#666', marginBottom: '1rem' }}>Host a new game and invite friends.</p>
          <button onClick={createGame} style={{ width: '100%', padding: '1rem', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 'bold' }}>
            Create Room
          </button>
        </div>
      ) : (
        <div>
          <input 
            type="text" 
            placeholder="4-Letter Room Code" 
            value={joinCode} 
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={4}
            style={{ width: '100%', padding: '0.75rem', marginBottom: '1rem', boxSizing: 'border-box', fontSize: '1.2rem', textTransform: 'uppercase', borderRadius: '4px', border: '1px solid #ccc', textAlign: 'center', letterSpacing: '2px' }}
          />
          <button onClick={joinGame} style={{ width: '100%', padding: '1rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 'bold' }}>
            Join Room
          </button>
        </div>
      )}
    </div>
  );
}

export default Lobby;