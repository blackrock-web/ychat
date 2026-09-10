import React, { useState } from 'react';
import { ChatProvider, useChat } from './context/ChatContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { AuthModal } from './components/AuthModal';
import { NewChatModal } from './components/NewChatModal';
import { SafetyNumberModal } from './components/SafetyNumberModal';
import { SecurityAuditModal } from './components/SecurityAuditModal';

const ChatAppContent: React.FC = () => {
  const { user } = useChat();
  const [showNewChat, setShowNewChat] = useState(false);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  if (!user) {
    return <AuthModal />;
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 antialiased font-sans">
      <Header onOpenAudit={() => setShowAudit(true)} />

      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar onOpenNewChat={() => setShowNewChat(true)} />
        <ChatArea onOpenSafetyNumber={() => setShowSafetyNumber(true)} />
      </div>

      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} />}
      {showSafetyNumber && <SafetyNumberModal onClose={() => setShowSafetyNumber(false)} />}
      {showAudit && <SecurityAuditModal onClose={() => setShowAudit(false)} />}
    </div>
  );
};

export default function App() {
  return (
    <ChatProvider>
      <ChatAppContent />
    </ChatProvider>
  );
}
