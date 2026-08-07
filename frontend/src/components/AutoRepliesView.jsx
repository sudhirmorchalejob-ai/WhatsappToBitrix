import React from 'react';
import { Bot, CheckCircle2, RefreshCw } from 'lucide-react';
import { useFetch } from '../lib/useFetch';
import { KpiSkeleton, TableSkeleton } from './Skeleton';
import { EmptyState, ErrorState } from './StateViews';

export default function AutoRepliesView({ stats, loading, token }) {
  const {
    data: logsData,
    error,
    loading: logsLoading,
    refreshing,
    refetch,
  } = useFetch('/api/auto-replies?limit=100', { token, ttl: 15000, poll: 15000 });

  const logs = Array.isArray(logsData) ? logsData : [];
  const kpis = stats?.kpis || {};
  const autoRepliesCount = kpis.automatedMessages ?? logs.length ?? 0;

  const pageLoading = (loading && !stats) || (logsLoading && logs.length === 0);

  if (pageLoading) {
    return (
      <div className="animate-fade">
        <KpiSkeleton count={2} />
        <TableSkeleton rows={5} columns={5} />
      </div>
    );
  }

  const customerName = (log) => {
    const c = log.contact;
    if (!c) return 'WhatsApp User';
    return c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || `+${c.whatsappPhone}`;
  };

  return (
    <div className="animate-fade">
      <div className="kpi-grid" style={{ marginBottom: 28 }}>
        <div className="kpi-card" style={{ background: 'var(--gradient-violet)' }}>
          <div className="kpi-header">
            <span className="kpi-title">Auto Reply Messages Fired</span>
            <div className="kpi-icon-wrapper kpi-icon-violet">
              <Bot size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: 'var(--accent-violet)' }}>
            {autoRepliesCount}
          </div>
          <div className="kpi-subtext">Total automated WhatsApp responses sent</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Auto-Reply Lead Creation</span>
            <div className="kpi-icon-wrapper kpi-icon-emerald">
              <CheckCircle2 size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: 'var(--accent-emerald)' }}>
            Active
          </div>
          <div className="kpi-subtext">Ensures leads are linked/created on auto-reply</div>
        </div>
      </div>

      <div className="glass-card">
        <div className="glass-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="kpi-icon-wrapper kpi-icon-violet" style={{ width: 36, height: 36 }}>
              <Bot size={18} />
            </div>
            <div>
              <h3 className="card-title">Auto-Reply History</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Every automated reply fired from the WhatsApp side
              </p>
            </div>
          </div>

          <button
            className={`btn btn-secondary btn-sm ${refreshing ? 'btn-loading' : ''}`}
            onClick={() => refetch({ background: true })}
            disabled={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? 'spinner' : ''} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="table-container">
          {error ? (
            <ErrorState message={error} onRetry={() => refetch({ force: true })} />
          ) : logs.length === 0 ? (
            <EmptyState
              title="No auto-replies fired yet"
              message="When an incoming WhatsApp message triggers an automated response, it will be recorded here with the customer and the reply text."
            />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Reply Message</th>
                  <th>Template Used</th>
                  <th>Sent At</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{customerName(log)}</div>
                      <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        +{log.contact?.whatsappPhone || '—'}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-main)', maxWidth: 420 }}>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {log.body}
                      </div>
                    </td>
                    <td>
                      {log.template ? (
                        <span className="badge badge-blue">{log.template.name}</span>
                      ) : (
                        <span className="badge badge-muted">Literal</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {new Date(log.createdAt).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
