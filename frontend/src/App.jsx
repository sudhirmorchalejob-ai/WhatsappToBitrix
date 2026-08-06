import React, { useState, useEffect, useCallback } from 'react';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import DashboardView from './components/DashboardView';
import LeadsView from './components/LeadsView';
import WebhookSetupView from './components/WebhookSetupView';
import AutoRepliesView from './components/AutoRepliesView';
import CampaignsView from './components/CampaignsView';
import ActivityLogsView from './components/ActivityLogsView';
import MessageLogsView from './components/MessageLogsView';
import WhatsAppChatView from './components/WhatsAppChatView';

const initialTabFromUrl = () => {
  const tab = new URLSearchParams(window.location.search).get('tab');
  return tab || 'dashboard';
};

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token') || null);
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);

  const [activeTab, setActiveTab] = useState(initialTabFromUrl);
  const [stats, setStats] = useState(null);
  const [recentLeads, setRecentLeads] = useState([]);
  const [allLeads, setAllLeads] = useState([]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [alert, setAlert] = useState(null); // { type: 'success'|'error'|'info', text: '' }

  // Load user profile if token exists
  useEffect(() => {
    if (token) {
      fetchProfile();
    }
  }, [token]);

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      const data = await res.json();
      if (res.ok && data.data) {
        setUser(data.data.user);
        setTenant(data.data.tenant);
      }
    } catch (err) {
      console.error('Profile fetch failed:', err);
    }
  };

  // Fetch stats & leads
  const loadData = useCallback(async () => {
    if (!token) return;
    setIsRefreshing(true);

    try {
      // 1. Fetch dashboard stats
      const statsRes = await fetch('/api/dashboard/stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.data);
        if (statsData.data?.recentLeads) {
          setRecentLeads(statsData.data.recentLeads);
        }
      }

      // 2. Fetch all leads & contacts
      const leadsRes = await fetch('/api/contacts?limit=500', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (leadsRes.ok) {
        const leadsData = await leadsRes.json();
        setAllLeads(leadsData.data?.items || []);
      }
    } catch (err) {
      console.error('Data loading error:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      loadData();
      // Auto-poll stats every 15 seconds
      const timer = setInterval(() => loadData(), 15000);
      return () => clearInterval(timer);
    }
  }, [token, loadData]);

  const handleLoginSuccess = (newToken, newUser, newTenant) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(newUser);
    setTenant(newTenant);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setTenant(null);
  };

  const handleAutoSync = async () => {
    if (!token || isSyncing) return;
    setIsSyncing(true);
    setAlert({ type: 'info', text: 'Syncing contacts and leads from Bitrix24...' });

    try {
      const res = await fetch('/api/tenant/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Sync failed');

      if (data.data?.ok) {
        setAlert({
          type: 'success',
          text: `Auto-Sync Complete! ${data.data.created} new leads created, ${data.data.updated} updated, ${data.data.synced} total processed.`,
        });
        await loadData();
      } else {
        setAlert({ type: 'error', text: `Sync failed: ${data.data?.error || 'Unknown error'}` });
      }
    } catch (err) {
      setAlert({ type: 'error', text: `Sync Error: ${err.message}` });
    } finally {
      setIsSyncing(false);
      setTimeout(() => setAlert(null), 8000);
    }
  };

  // If not logged in, render Login page
  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // Titles mapping
  const getPageHeaderProps = () => {
    switch (activeTab) {
      case 'dashboard':
        return {
          title: 'WhatsApp Lead Dashboard',
          subtitle: 'Real-time metrics for leads, auto replies, and campaigns via WhatsApp',
        };
      case 'chats':
        return {
          title: 'WhatsApp Chats',
          subtitle: 'Live conversations from your WhatsApp Open Channel, WhatsApp-style',
        };
      case 'leads':
        return {
          title: 'WhatsApp Created Leads',
          subtitle: 'Directory of all leads created in Bitrix24 CRM from WhatsApp messages',
        };
      case 'messages':
        return {
          title: '2-Way Message Audit Logs',
          subtitle: 'Full history of incoming WhatsApp customer messages & Bitrix24 operator replies',
        };
      case 'activities':
        return {
          title: 'Activity Audit Trail',
          subtitle: 'Real-time audit log of Bitrix24 lead creations, operator replies, and system events',
        };
      case 'webhooks':
        return {
          title: 'Webhook Setup',
          subtitle: 'Configure Bitrix24 REST Webhook URL and WhatsApp Gateway Webhook URL',
        };
      case 'autoreplies':
        return {
          title: 'Auto Reply Messages',
          subtitle: 'Automated WhatsApp response statistics & lead integration',
        };
      case 'campaigns':
        return {
          title: 'WhatsApp Campaigns',
          subtitle: 'Create, manage and launch WhatsApp marketing campaigns from Bitrix24',
        };
      default:
        return { title: 'Dashboard', subtitle: '' };
    }
  };

  const headerProps = getPageHeaderProps();

  return (
    <div className="app-layout">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        user={user}
        onLogout={handleLogout}
      />

      <main className="main-content">
        <Header
          title={headerProps.title}
          subtitle={headerProps.subtitle}
          connectionStatus={stats?.connectionStatus}
          onRefresh={loadData}
          onSync={handleAutoSync}
          isRefreshing={isRefreshing}
          isSyncing={isSyncing}
        />

        {alert && (
          <div className={`alert-banner alert-${alert.type} animate-fade`}>
            <span>{alert.text}</span>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <DashboardView
            stats={stats}
            recentLeads={recentLeads}
            onViewAllLeads={() => setActiveTab('leads')}
          />
        )}

        {activeTab === 'leads' && (
          <LeadsView leads={allLeads} onSync={handleAutoSync} isSyncing={isSyncing} />
        )}

        {activeTab === 'messages' && <MessageLogsView token={token} />}

        {activeTab === 'chats' && <WhatsAppChatView token={token} />}

        {activeTab === 'activities' && <ActivityLogsView token={token} />}

        {activeTab === 'webhooks' && (
          <WebhookSetupView
            token={token}
            onSetupUpdated={loadData}
            onSync={handleAutoSync}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'autoreplies' && <AutoRepliesView stats={stats} />}

        {activeTab === 'campaigns' && <CampaignsView token={token} />}
      </main>
    </div>
  );
}
