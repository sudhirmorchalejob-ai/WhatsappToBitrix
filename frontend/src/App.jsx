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
import { useFetch, clearApiCache } from './lib/useFetch';
import { formatDuration } from './lib/formatDuration';
import { useTheme } from './lib/useTheme';

const initialTabFromUrl = () => {
  const tab = new URLSearchParams(window.location.search).get('tab');
  return tab || 'dashboard';
};

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token') || null);
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);

  const { theme, toggleTheme } = useTheme();

  const [activeTab, setActiveTab] = useState(initialTabFromUrl);

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStartedAt, setSyncStartedAt] = useState(null);
  const [syncElapsed, setSyncElapsed] = useState(0);
  const [lastSync, setLastSync] = useState(null); // { durationSec, created, updated, skipped, total }
  const [alert, setAlert] = useState(null); // { type: 'success'|'error'|'info', text: '' }

  useEffect(() => {
    if (syncStartedAt == null) return;
    const id = setInterval(() => {
      setSyncElapsed(Math.floor((Date.now() - syncStartedAt) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [syncStartedAt]);

  // Dashboard stats drive the header pills, dashboard KPI cards, and the
  // Auto Replies page. One hook = one fetch, cached, background-polled.
  const {
    data: statsData,
    loading: statsLoading,
    refreshing: statsRefreshing,
    refetch: refetchStats,
  } = useFetch('/api/dashboard/stats', { token, poll: 15000, ttl: 15000, skip: !token });

  const stats = statsData || null;
  const recentLeads = stats?.recentLeads || [];

  // Load user profile if token exists
  const fetchProfile = useCallback(async () => {
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
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchProfile();
    }
  }, [token, fetchProfile]);

  const handleLoginSuccess = (newToken, newUser, newTenant) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(newUser);
    setTenant(newTenant);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    clearApiCache();
    setToken(null);
    setUser(null);
    setTenant(null);
  };

  const handleAutoSync = async () => {
    if (!token || isSyncing) return;
    const startedAt = Date.now();
    setIsSyncing(true);
    setSyncStartedAt(startedAt);
    setSyncElapsed(0);
    setAlert({ type: 'info', text: 'Syncing contacts and leads from Bitrix24...' });

    try {
      const res = await fetch('/api/tenant/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Sync failed');

      if (data.data?.ok) {
        const durationSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        setLastSync({
          durationSec,
          created: data.data.created,
          updated: data.data.updated,
          skipped: data.data.skipped,
          total: data.data.synced,
        });
        setAlert({
          type: 'success',
          text: `Auto-Sync Complete in ${formatDuration(durationSec)}! ${data.data.created} new leads created, ${data.data.updated} updated, ${data.data.skipped} skipped (${data.data.synced} total processed).`,
        });
        await refetchStats({ force: true });
      } else {
        setAlert({ type: 'error', text: `Sync failed: ${data.data?.error || 'Unknown error'}` });
      }
    } catch (err) {
      setAlert({ type: 'error', text: `Sync Error: ${err.message}` });
    } finally {
      setIsSyncing(false);
      setSyncStartedAt(null);
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
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="main-content">
        <Header
          title={headerProps.title}
          subtitle={headerProps.subtitle}
          connectionStatus={stats?.connectionStatus}
          onRefresh={() => refetchStats({ background: true })}
          onSync={handleAutoSync}
          isRefreshing={statsRefreshing}
          isSyncing={isSyncing}
          syncElapsed={syncElapsed}
          lastSyncDuration={lastSync?.durationSec}
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
            loading={statsLoading}
          />
        )}

        {activeTab === 'leads' && (
          <LeadsView
            token={token}
            onSync={handleAutoSync}
            isSyncing={isSyncing}
            syncElapsed={syncElapsed}
            lastSyncDuration={lastSync?.durationSec}
          />
        )}

        {activeTab === 'messages' && <MessageLogsView token={token} />}

        {activeTab === 'chats' && <WhatsAppChatView token={token} />}

        {activeTab === 'activities' && <ActivityLogsView token={token} />}

        {activeTab === 'webhooks' && (
          <WebhookSetupView
            token={token}
            onSetupUpdated={() => refetchStats({ force: true })}
            onSync={handleAutoSync}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'autoreplies' && (
          <AutoRepliesView stats={stats} loading={statsLoading} token={token} />
        )}

        {activeTab === 'campaigns' && <CampaignsView token={token} />}
      </main>
    </div>
  );
}
