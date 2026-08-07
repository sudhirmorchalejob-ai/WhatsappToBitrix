import React, { useState } from 'react';
import { Search, ExternalLink, CheckCircle2, Zap, RefreshCw } from 'lucide-react';
import { useFetch } from '../lib/useFetch';
import { TableSkeleton } from './Skeleton';
import { EmptyState, ErrorState } from './StateViews';
import SyncTimer from './SyncTimer';

export default function LeadsView({ token, onSync, isSyncing, syncElapsed, lastSyncDuration }) {
  const [searchTerm, setSearchTerm] = useState('');

  const {
    data: leadsData,
    error,
    loading,
    refreshing,
    refetch,
  } = useFetch('/api/contacts?limit=500', { token, ttl: 30000 });

  const leads = Array.isArray(leadsData) ? leadsData : [];

  const filteredLeads = leads.filter((l) => {
    const q = searchTerm.toLowerCase();
    const name = (l.name || `${l.firstName || ''} ${l.lastName || ''}`).toLowerCase();
    const phone = (l.whatsappPhone || l.phone || '').toLowerCase();
    const b24Id = String(l.bitrix24ContactId || l.bitrixContactId || '');
    return name.includes(q) || phone.includes(q) || b24Id.includes(q);
  });

  const handleSync = async () => {
    if (!onSync) return;
    await onSync();
    refetch({ force: true });
  };

  const renderBody = () => {
    if (error) {
      return <ErrorState message={error} onRetry={() => refetch({ force: true })} />;
    }
    if (loading && leads.length === 0) {
      return <TableSkeleton rows={7} columns={8} />;
    }
    if (leads.length === 0) {
      return (
        <EmptyState
          title="No leads yet"
          message="Incoming WhatsApp messages are synced here as leads. Click Sync All Leads to pull contacts from Bitrix24."
          action={
            <button className="btn btn-primary btn-sm" onClick={handleSync} disabled={isSyncing}>
              <Zap size={14} />
              <span>{isSyncing ? 'Syncing…' : 'Sync All Leads'}</span>
            </button>
          }
        />
      );
    }
    if (filteredLeads.length === 0) {
      return (
        <EmptyState
          title={`No leads matching "${searchTerm}"`}
          message="Try a different name, phone number, or Bitrix24 contact ID."
        />
      );
    }

    return (
      <table className="data-table">
        <thead>
          <tr>
            <th>Customer Name</th>
            <th>WhatsApp Phone</th>
            <th>Email</th>
            <th>Company</th>
            <th>Bitrix24 Contact ID</th>
            <th>Lead Source</th>
            <th>Sync Status</th>
            <th>Created Date</th>
          </tr>
        </thead>
        <tbody>
          {filteredLeads.map((lead) => {
            const name =
              lead.name ||
              [lead.firstName, lead.lastName].filter(Boolean).join(' ') ||
              'WhatsApp User';
            const createdDate = new Date(lead.createdAt).toLocaleString('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
            });
            const b24Id = lead.bitrix24ContactId || lead.bitrixContactId;

            return (
              <tr key={lead.id}>
                <td style={{ fontWeight: 600 }}>{name}</td>
                <td>
                  <span style={{ fontFamily: 'monospace', color: 'var(--accent-blue)' }}>
                    +{lead.whatsappPhone || lead.phone}
                  </span>
                </td>
                <td style={{ color: 'var(--text-muted)' }}>{lead.email || '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{lead.company || '—'}</td>
                <td>
                  {b24Id ? (
                    <span className="badge badge-blue">
                      <ExternalLink size={11} /> #{b24Id}
                    </span>
                  ) : (
                    <span className="badge badge-muted">Unlinked</span>
                  )}
                </td>
                <td>
                  <span className="badge badge-emerald">📲 WhatsApp</span>
                </td>
                <td>
                  <span className="badge badge-emerald">
                    <CheckCircle2 size={11} /> {lead.syncStatus || 'SYNCED'}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{createdDate}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="animate-fade">
      <div className="glass-card">
        <div className="glass-card-header">
          <div className="search-box">
            <Search size={16} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search by name, phone, or Bitrix ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SyncTimer
              isSyncing={isSyncing}
              elapsed={syncElapsed}
              lastSyncDuration={lastSyncDuration}
            />
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Showing <strong>{filteredLeads.length}</strong> of {leads.length} WhatsApp leads
            </span>
            <button
              className={`btn btn-secondary btn-sm ${refreshing ? 'btn-loading' : ''}`}
              onClick={() => refetch({ background: true })}
              disabled={refreshing}
              title="Refresh leads"
            >
              <RefreshCw size={14} className={refreshing ? 'spinner' : ''} />
              <span>Refresh</span>
            </button>
            <button
              className={`btn btn-primary btn-sm ${isSyncing ? 'btn-loading' : ''}`}
              onClick={handleSync}
              disabled={isSyncing}
            >
              <Zap size={14} />
              <span>{isSyncing ? 'Syncing…' : 'Sync All Leads'}</span>
            </button>
          </div>
        </div>

        <div className="table-container">{renderBody()}</div>
      </div>
    </div>
  );
}
