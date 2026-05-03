import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Lobby from './Lobby';
import GameTable from './GameTable';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* The Root URL goes to the Lobby */}
        <Route path="/" element={<Lobby />} />
        
        {/* URLs with a room ID go to the Game Table */}
        <Route path="/room/:roomId" element={<GameTable />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;