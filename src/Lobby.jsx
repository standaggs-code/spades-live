import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, set, get, update, onValue } from 'firebase/database';
import { db } from './firebase';

function Lobby() {
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [isCreating, setIsCreating] = useState(true);
  const [leaderboard, setLeaderboard] = useState([]);
  const navigate = useNavigate();

  // Fetch the Global Leaderboard
  useEffect(() => {
    const boardRef = ref(db, 'leaderboard');
    const unsubscribe = onValue(boardRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        // Convert Firebase object into a sorted array
        const sortedPlayers = Object.keys(data).map(name => {
          const wins = data[name].wins || 0;
          const losses = data[name].losses || 0;
          const totalGames = wins + losses;
          const winPct = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
          
          return { name, wins, losses, winPct };
        }).sort((a, b) => b.wins - a.wins || b.winPct - a.winPct); // Sort by Wins, then Win %
        
        setLeaderboard(sortedPlayers);
      }
    });
    return () => unsubscribe();
  }, []);

  const createGame = async () => {
    if (!playerName.trim()) return alert("Please enter your name");

    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let newRoomCode = '';
    for (let i = 0; i < 4; i++) {
      newRoomCode += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    const roomRef = ref(db, `rooms/${newRoomCode}`);
    
    await set(roomRef, {
      status: 'waiting',
      players: {
        player1: { name: playerName, id: 'player1' }
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
    <div style={{ maxWidth: '600px', margin: '3rem auto', textAlign: 'center', padding: '0 1rem' }}>
      
      {/* Game Controls Area */}
      <div style={{ padding: '2rem', border: '1px solid #ccc', borderRadius: '12px', backgroundColor: '#f9f9f9', marginBottom: '2rem', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <h1 style={{ color: '#2E7D32', marginTop: 0 }}>Spades Live</h1>
        
        <div style={{ marginBottom: '1.5rem' }}>
          <input 
            type="text" placeholder="Your Name" value={playerName} onChange={(e) => setPlayerName(e.target.value)}
            style={{ width: '100%', padding: '0.75rem', marginBottom: '1rem', boxSizing: 'border-box', fontSize: '1.2rem', borderRadius: '4px', border: '1px solid #ccc', textAlign: 'center' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <button onClick={() => setIsCreating(true)} style={{ padding: '0.5rem 1rem', backgroundColor: isCreating ? '#007bff' : '#e0e0e0', color: isCreating ? 'white' : 'black', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Create Game</button>
          <button onClick={() => setIsCreating(false)} style={{ padding: '0.5rem 1rem', backgroundColor: !isCreating ? '#28a745' : '#e0e0e0', color: !isCreating ? 'white' : 'black', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Join Game</button>
        </div>

        {isCreating ? (
          <button onClick={createGame} style={{ width: '100%', padding: '1rem', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 'bold' }}>Create Room</button>
        ) : (
          <div>
            <input type="text" placeholder="4-Letter Room Code" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={4} style={{ width: '100%', padding: '0.75rem', marginBottom: '1rem', boxSizing: 'border-box', fontSize: '1.2rem', textTransform: 'uppercase', borderRadius: '4px', border: '1px solid #ccc', textAlign: 'center', letterSpacing: '2px' }} />
            <button onClick={joinGame} style={{ width: '100%', padding: '1rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 'bold' }}>Join Room</button>
          </div>
        )}
      </div>

      {/* Global Leaderboard Area */}
      <div style={{ padding: '2rem', backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #ccc', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', overflowX: 'auto' }}>
        <h2 style={{ margin: '0 0 1rem 0', color: '#333' }}>🏆 All-Time Leaderboard</h2>
        {leaderboard.length === 0 ? (
          <p style={{ color: '#777' }}>No games played yet. Be the first to win!</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
            <thead>
              <tr style={{ backgroundColor: '#f0f2f5', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '1rem' }}>Rank</th>
                <th style={{ padding: '1rem', textAlign: 'left' }}>Player</th>
                <th style={{ padding: '1rem', color: '#28a745' }}>Wins</th>
                <th style={{ padding: '1rem', color: '#dc3545' }}>Losses</th>
                <th style={{ padding: '1rem' }}>Win %</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((player, index) => (
                <tr key={index} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '1rem', fontWeight: 'bold', color: index === 0 ? '#ffc107' : '#555' }}>
                    {index === 0 ? '🥇 1' : index === 1 ? '🥈 2' : index === 2 ? '🥉 3' : index + 1}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'left', fontWeight: 'bold' }}>{player.name}</td>
                  <td style={{ padding: '1rem', color: '#28a745', fontWeight: 'bold' }}>{player.wins}</td>
                  <td style={{ padding: '1rem', color: '#dc3545' }}>{player.losses}</td>
                  <td style={{ padding: '1rem' }}>{player.winPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default Lobby;