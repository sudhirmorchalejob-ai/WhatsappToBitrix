import React from 'react';
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  ClipboardList,
  Webhook,
  Bot,
  Send,
  LogOut,
} from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab, user, onLogout }) {
  const userName = user?.name || user?.email || 'Admin';
  const userInitial = userName[0].toUpperCase();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'leads', label: 'WhatsApp Leads', icon: Users },
    { id: 'messages', label: '2-Way Message Logs', icon: MessageSquare },
    { id: 'activities', label: 'Activity Audit Trail', icon: ClipboardList },
    { id: 'webhooks', label: 'Webhook Setup', icon: Webhook },
    { id: 'autoreplies', label: 'Auto Replies', icon: Bot },
    { id: 'campaigns', label: 'Campaigns', icon: Send },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand-icon">
          <MessageSquare size={22} />
        </div>
        <div>
          <div className="brand-title">WA → Bitrix24</div>
          <div className="brand-subtitle">Lead Integration</div>
        </div>
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
              onClick={() => setActiveTab(item.id)}
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
        <button className="logout-btn" title="Sign Out" onClick={onLogout}>
          <LogOut size={18} />
        </button>
      </div>
    </aside>
  );
}
