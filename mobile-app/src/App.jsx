import React, { useState } from 'react';
import ChatWindow from './components/ChatWindow';
import Settings from './pages/Settings';

function App() {
  const [currentPage, setCurrentPage] = useState('chat'); // 'chat' | 'settings'

  if (currentPage === 'settings') {
    return <Settings onBack={() => setCurrentPage('chat')} />;
  }

  return (
    <ChatWindow
      title="Project IQ"
      appId="General"
      onOpenSettings={() => setCurrentPage('settings')}
    />
  );
}

export default App;
