import React from 'react';
import ChatWindow from './components/ChatWindow';

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
        <div className="absolute top-10 left-10 w-64 h-64 bg-primary rounded-full blur-3xl mix-blend-multiply filter animate-blob"></div>
        <div className="absolute top-10 right-10 w-64 h-64 bg-purple-500 rounded-full blur-3xl mix-blend-multiply filter animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-20 w-64 h-64 bg-pink-500 rounded-full blur-3xl mix-blend-multiply filter animate-blob animation-delay-4000"></div>
      </div>

      <div className="text-center z-10">
        <h1 className="text-4xl font-bold text-gray-800 mb-4 tracking-tight">GLPI Support Portal</h1>
        <p className="text-gray-600 text-lg max-w-md mx-auto">
          Welcome to the next-generation support experience.
          <br />Click the icon below to start chatting.
        </p>
      </div>

      <ChatWindow />
    </div>
  );
}

export default App;
