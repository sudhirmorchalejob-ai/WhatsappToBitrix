import React, { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  MessageCircle,
  ClipboardList,
  Webhook,
  Bot,
  Send,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
} from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab, user, onLogout, theme, onToggleTheme }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const userName = user?.name || user?.email || 'Admin';
  const userInitial = userName[0].toUpperCase();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'chats', label: 'WhatsApp Chats', icon: MessageCircle },
    { id: 'leads', label: 'WhatsApp Leads', icon: Users },
    { id: 'messages', label: '2-Way Message Logs', icon: MessageSquare },
    { id: 'activities', label: 'Activity Audit Trail', icon: ClipboardList },
    { id: 'webhooks', label: 'Webhook Setup', icon: Webhook },
    { id: 'autoreplies', label: 'Auto Replies', icon: Bot },
    { id: 'campaigns', label: 'Campaigns', icon: Send },
  ];

  const selectTab = (id) => {
    setActiveTab(id);
    setMobileOpen(false);
  };

  return (
    <>
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="brand-icon">
            <img src="/WA_logo.png" alt="WhatsApp By Averlon logo" />
          </div>
          <div>
            <div className="brand-title">WhatsApp By Averlon</div>
          </div>
          <button
            className="sidebar-toggle"
            onClick={() => setMobileOpen(false)}
            title="Close menu"
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-title">Navigation</div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                className={`nav-link ${isActive ? 'active' : ''}`}
                onClick={() => selectTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="avatar">{userInitial}</div>
            <div style={{ overflow: 'hidden' }}>
              <div className="user-name">{userName}</div>
              <div className="user-role">Administrator</div>
            </div>
          </div>
          <div className="sidebar-actions">
            <button
              className="theme-toggle"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle color theme"
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button className="logout-btn" title="Sign Out" onClick={onLogout}>
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      <button
        className="mobile-nav-toggle"
        onClick={() => setMobileOpen(true)}
        title="Open menu"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      <div
        className={`sidebar-backdrop ${mobileOpen ? 'visible' : ''}`}
        onClick={() => setMobileOpen(false)}
      />
    </>
  );
}
