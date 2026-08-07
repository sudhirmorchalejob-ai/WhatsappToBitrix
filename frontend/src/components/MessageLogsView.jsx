import React, { useState } from 'react';
import { MessageSquare, RefreshCw, ArrowDownLeft, ArrowUpRight, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { useFetch } from '../lib/useFetch';
import { TableSkeleton } from './Skeleton';
import { EmptyState, ErrorState } from './StateViews';

export default function MessageLogsView({ token }) {
  const [filterDirection, setFilterDirection] = useState('ALL');

  const {
    data: messagesData,
    error,
    loading,
    refreshing,
    refetch,
  } = useFetch('/api/messages?limit=100', { token, ttl: 15000 });

  const messages = Array.isArray(messagesData) ? messagesData : [];

  const filteredMessages = messages.filter((msg) => {
    if (filterDirection === 'ALL') return true;
    return msg.direction === filterDirection;
  });

  const renderBody = () => {
    if (error) {
      return <ErrorState message={error} onRetry={() => refetch({ force: true })} />;
    }
    if (loading && messages.length === 0) {
      return <TableSkeleton rows={7} columns={6} />;
    }
    if (messages.length === 0) {
      return (
        <EmptyState
          title="No messages recorded yet"
          message="Incoming WhatsApp messages and Bitrix24 operator replies will appear here."
        />
      );
    }
    if (filteredMessages.length === 0) {
      return (
        <EmptyState
          title={`No ${filterDirection === 'INCOMING' ? 'incoming' : 'outgoing'} messages`}
          message="Try switching the direction filter."
        />
      );
    }

    return (
      <table className="data-table">
        <thead>
          <tr>
            <th>Direction</th>
            <th>Customer / Phone</th>
            <th>Message Content</th>
            <th>Type</th>
            <th>Status</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {filteredMessages.map((msg) => {
            const isIncoming = msg.direction === 'INCOMING';
            const contactName = msg.contact
              ? msg.contact.name || `${msg.contact.firstName || ''} ${msg.contact.lastName || ''}`.trim() || `+${msg.contact.whatsappPhone}`
              : 'WhatsApp User';
            const createdDate = new Date(msg.createdAt).toLocaleString('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
            });

            return (
              <tr key={msg.id}>
                <td>
                  {isIncoming ? (
                    <span className="badge badge-emerald">
                      <ArrowDownLeft size={12} /> Incoming WA
                    </span>
                  ) : (
                    <span className="badge badge-blue">
                      <ArrowUpRight size={12} /> Bitrix Reply
                    </span>
                  )}
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{contactName}</div>
                  <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                    +{msg.contact?.whatsappPhone || '—'}
                  </div>
                </td>
                <td style={{ color: 'var(--text-main)', maxWidth: 380 }}>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {msg.body || msg.caption || '(Media Attachment)'}
                  </div>
                </td>
                <td>
                  <span className="badge badge-muted">{msg.type || 'TEXT'}</span>
                </td>
                <td>
                  {msg.status === 'SENT' || msg.status === 'DELIVERED' ? (
                    <span className="badge badge-emerald">
                      <CheckCircle2 size={11} /> {msg.status}
                    </span>
                  ) : msg.status === 'FAILED' ? (
                    <span className="badge badge-rose">
                      <AlertCircle size={11} /> FAILED
                    </span>
                  ) : (
                    <span className="badge badge-amber">
                      <Clock size={11} /> {msg.status}
                    </span>
                  )}
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
            <div className="kpi-icon-wrapper kpi-icon-emerald" style={{ width: 36, height: 36 }}>
              <MessageSquare size={18} />
            </div>
            <div>
              <h3 className="card-title">2-Way Message Audit Logs</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Full history of incoming WhatsApp customer messages &amp; Bitrix24 operator replies
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select
              className="form-control"
              style={{ padding: '6px 12px', fontSize: 13, width: 180 }}
              value={filterDirection}
              onChange={(e) => setFilterDirection(e.target.value)}
            >
              <option value="ALL">All Directions</option>
              <option value="INCOMING">Incoming (WhatsApp)</option>
              <option value="OUTGOING">Outgoing (Bitrix Reply)</option>
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
