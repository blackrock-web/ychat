import React, { useState } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { ChatProvider, useChat } from './context/ChatContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { AuthModal } from './components/AuthModal';
import { NewChatModal } from './components/NewChatModal';
import { SafetyNumberModal } from './components/SafetyNumberModal';
import { SecurityAuditModal } from './components/SecurityAuditModal';
import { NotificationsPanel } from './components/NotificationsPanel';
import { UserProfileModal } from './components/UserProfileModal';
import { SettingsModal } from './components/SettingsModal';

const ChatAppContent: React.FC = () => {
  const { user } = useChat();
  const [showNewChat, setShowNewChat] = useState(false);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  if (!user) {
    return <AuthModal />;
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 antialiased font-sans">
      <Header
        onOpenAudit={() => setShowAudit(true)}
        onOpenNotifications={() => setShowNotifications((prev) => !prev)}
        onOpenProfile={() => setShowProfile(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar
          onOpenNewChat={() => setShowNewChat(true)}
          onOpenProfile={() => setShowProfile(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenNotifications={() => setShowNotifications((prev) => !prev)}
        />
        <ChatArea onOpenSafetyNumber={() => setShowSafetyNumber(true)} />
      </div>

      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} />}
      {showSafetyNumber && <SafetyNumberModal onClose={() => setShowSafetyNumber(false)} />}
      {showAudit && <SecurityAuditModal onClose={() => setShowAudit(false)} />}

      {/* Slide-in Notifications Panel */}
      <NotificationsPanel
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
      />

      {/* User Profile Modal */}
      <UserProfileModal
        isOpen={showProfile}
        onClose={() => setShowProfile(false)}
      />

      {/* Application Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onOpenDevices={() => {
          setShowSettings(false);
          setShowProfile(true);
        }}
      />
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <ChatProvider>
        <ChatAppContent />
      </ChatProvider>
    </ThemeProvider>
  );
}
