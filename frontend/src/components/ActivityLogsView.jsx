import React, { useState } from 'react';
import { ClipboardList, RefreshCw, Sparkles, MessageSquare, Zap, Shield } from 'lucide-react';
import { useFetch } from '../lib/useFetch';
import { TableSkeleton } from './Skeleton';
import { EmptyState, ErrorState } from './StateViews';

export default function ActivityLogsView({ token }) {
  const [filterCategory, setFilterCategory] = useState('ALL');

  const {
    data: logsData,
    error,
    loading,
    refreshing,
    refetch,
  } = useFetch('/api/dashboard/activities?limit=100', { token, ttl: 15000 });

  const logs = Array.isArray(logsData?.items) ? logsData.items : [];

  const filteredLogs = logs.filter((item) => {
    if (filterCategory === 'ALL') return true;
    return item.category === filterCategory;
  });

  const getActionBadge = (action) => {
    switch (action) {
      case 'LEAD_CREATED':
      case 'CUSTOMER_CREATED':
        return <span className="badge badge-emerald"><Sparkles size={12} /> Lead Created</span>;
      case 'OPERATOR_REPLY_SENT':
        return <span className="badge badge-blue"><MessageSquare size={12} /> Bitrix24 Reply</span>;
      case 'MESSAGE_RECEIVED':
        return <span className="badge badge-violet"><MessageSquare size={12} /> WA Message</span>;
      case 'INTEGRATION_SETUP_UPDATED':
        return <span className="badge badge-violet"><Zap size={12} /> Setup Saved</span>;
      case 'USER_LOGIN':
        return <span className="badge badge-muted"><Shield size={12} /> User Login</span>;
      default:
        return <span className="badge badge-muted">{action}</span>;
    }
  };

  const renderBody = () => {
    if (error) {
      return <ErrorState message={error} onRetry={() => refetch({ force: true })} />;
    }
    if (loading && logs.length === 0) {
      return <TableSkeleton rows={7} columns={5} />;
    }
    if (logs.length === 0) {
      return (
        <EmptyState
          title="No activity logs yet"
          message="Lead creations, operator replies, and integration events will be recorded here."
        />
      );
    }
    if (filteredLogs.length === 0) {
      return (
        <EmptyState
          title="Nothing in this category"
          message="Try switching the category filter."
        />
      );
    }

    return (
      <table className="data-table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Category</th>
            <th>Details / Description</th>
            <th>Triggered By</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {filteredLogs.map((log) => {
            const detailsText = log.details
              ? typeof log.details === 'object'
                ? log.details.text || log.details.reason || JSON.stringify(log.details)
                : String(log.details)
              : '—';

            const createdDate = new Date(log.createdAt).toLocaleString('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
            });

            return (
              <tr key={log.id}>
                <td>{getActionBadge(log.action)}</td>
                <td>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                    {log.category || 'SYSTEM'}
                  </span>
                </td>
                <td style={{ color: 'var(--text-main)', maxWidth: 360 }}>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {detailsText}
                  </div>
                </td>
                <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {log.user ? log.user.name || log.user.email : 'System Event'}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="kpi-icon-wrapper kpi-icon-violet" style={{ width: 36, height: 36 }}>
              <ClipboardList size={18} />
            </div>
            <div>
              <h3 className="card-title">Activity Audit Trail</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Real-time log of Bitrix24 Lead creations, operator replies, and integration activity
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select
              className="form-control"
              style={{ padding: '6px 12px', fontSize: 13, width: 160 }}
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="ALL">All Categories</option>
              <option value="CRM">CRM / Leads</option>
              <option value="MESSAGE">Messages & Replies</option>
              <option value="INTEGRATION">Integration</option>
              <option value="AUTH">Auth / Logins</option>
            </select>

            <button
              className={`btn btn-secondary btn-sm ${refreshing ? 'btn-loading' : ''}`}
              onClick={() => refetch({ background: true })}
              disabled={refreshing}
            >
              <RefreshCw size={14} className={refreshing ? 'spinner' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div className="table-container">{renderBody()}</div>
      </div>
    </div>
  );
}
