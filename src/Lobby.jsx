import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, set, get } from 'firebase/database';
import { db } from './firebase'; // Your database connection

function Lobby() {
  const [playerName, setPlayerName] = useState('Daniel');
  const [joinCode, setJoinCode] = useState('');
  const navigate = useNavigate();

  // Function to generate a random 4-letter room code
  const generateRoomCode = () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 4; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  };

const createGame = async () => {
    if (!playerName.trim()) return alert("Please enter a name");
    
    const newRoomCode = generateRoomCode();
    const roomRef = ref(db, `rooms/${newRoomCode}`);

    try {
      console.log("Attempting to connect to Firebase...");
      
      // Create the room structure in Firebase
      await set(roomRef, {
        status: 'waiting', 
        players: {
          player1: { name: playerName, seat: 'North' }
        }
      });

      console.log("Success! Routing to room...");
      // Send the user to the new room's URL
      navigate(`/room/${newRoomCode}?player=player1`);
      
    } catch (error) {
      console.error("Firebase connection failed:", error);
      alert(`Database Error: ${error.message}`);
    }
  };

const joinGame = async () => {
    if (!playerName.trim() || !joinCode.trim()) return alert("Enter name and room code");
    
    const upperCode = joinCode.toUpperCase();
    const roomRef = ref(db, `rooms/${upperCode}`);
    
    try {
      const snapshot = await get(roomRef);

      if (snapshot.exists()) {
        const roomData = snapshot.val();
        const players = roomData.players || {};
        const playerCount = Object.keys(players).length;

        if (playerCount >= 4) {
          return alert("Sorry, this table is full!");
        }

        // Determine the next available player slot and seat
        const newPlayerId = `player${playerCount + 1}`;
        const seatOrder = ['North', 'East', 'South', 'West'];
        
        // Find which seats are already taken
        const takenSeats = Object.values(players).map(p => p.seat);
        // Find the first empty seat
        const availableSeat = seatOrder.find(seat => !takenSeats.includes(seat));

        // Update the database to add the new player
        const newPlayerRef = ref(db, `rooms/${upperCode}/players/${newPlayerId}`);
        await set(newPlayerRef, {
          name: playerName,
          seat: availableSeat
        });

        // Send them to the room with their official player ID
        navigate(`/room/${upperCode}?player=${newPlayerId}`);

      } else {
        alert("Room not found!");
      }
    } catch (error) {
      console.error("Join error:", error);
      alert("Failed to join room.");
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
      <h1>Spades Live ♠️</h1>
      
      <div style={{ marginBottom: '2rem' }}>
        <input 
          type="text" 
          placeholder="Your Name" 
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          style={{ padding: '0.5rem', width: '100%', marginBottom: '1rem', fontSize: '1.2rem' }}
        />
      </div>

      <div style={{ padding: '1rem', border: '1px solid #ccc', borderRadius: '8px', marginBottom: '1rem' }}>
        <h3>Host a New Game</h3>
        <button onClick={createGame} style={{ padding: '0.5rem 1rem', fontSize: '1.1rem', cursor: 'pointer' }}>
          Create Room
        </button>
      </div>

      <div style={{ padding: '1rem', border: '1px solid #ccc', borderRadius: '8px' }}>
        <h3>Join Existing Game</h3>
        <input 
          type="text" 
          placeholder="4-Letter Code" 
          maxLength={4}
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          style={{ padding: '0.5rem', width: '60%', marginRight: '0.5rem', fontSize: '1.1rem', textTransform: 'uppercase' }}
        />
        <button onClick={joinGame} style={{ padding: '0.5rem 1rem', fontSize: '1.1rem', cursor: 'pointer' }}>
          Join
        </button>
      </div>
    </div>
  );
}

export default Lobby;
