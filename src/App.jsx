import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Lobby from './Lobby';
import GameTable from './GameTable'; 

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/room/:roomId" element={<GameTable />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
