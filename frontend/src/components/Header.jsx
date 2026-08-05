import React from 'react';
import { RefreshCw, Zap, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function Header({
  title,
  subtitle,
  connectionStatus,
  onRefresh,
  onSync,
  isRefreshing,
  isSyncing,
}) {
  const b24Ok = connectionStatus?.bitrix24?.ok;
  const waOk = connectionStatus?.whatsbox?.ok;

  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{subtitle}</p>
      </div>

      <div className="header-actions">
        {/* Status Pills */}
        <div style={{ display: 'flex', gap: 8, marginRight: 8 }}>
          <div className={`status-pill ${b24Ok ? 'status-online' : 'status-offline'}`}>
            <span className="status-dot"></span>
            <span>Bitrix24 CRM {b24Ok ? 'Connected' : 'Disconnected'}</span>
          </div>
          <div className={`status-pill ${waOk ? 'status-online' : 'status-offline'}`}>
            <span className="status-dot"></span>
            <span>WhatsApp {waOk ? 'Ready' : 'Unconfigured'}</span>
          </div>
        </div>

        {onSync && (
          <button
            className={`btn btn-primary btn-sm ${isSyncing ? 'btn-loading' : ''}`}
            onClick={onSync}
            disabled={isSyncing}
          >
            <Zap size={14} />
            <span>{isSyncing ? 'Syncing...' : 'Auto-Sync Leads'}</span>
          </button>
        )}

        {onRefresh && (
          <button
            className={`btn btn-secondary btn-sm ${isRefreshing ? 'btn-loading' : ''}`}
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw size={14} className={isRefreshing ? 'spinner' : ''} />
            <span>Refresh</span>
          </button>
        )}
      </div>
    </header>
  );
}
