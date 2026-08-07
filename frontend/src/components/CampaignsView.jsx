import React, { useState } from 'react';
import {
  Send,
  Play,
  Trash2,
  Eye,
  RefreshCw,
  Megaphone,
  Clock,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react';
import { useFetch } from '../lib/useFetch';
import { KpiSkeleton, TableSkeleton } from './Skeleton';
import { EmptyState, ErrorState } from './StateViews';

const STATUS_STYLE = {
  DRAFT: { cls: 'badge-muted', icon: Clock, label: 'Draft' },
  PROCESSING: { cls: 'badge-blue', icon: Clock, label: 'Processing' },
  COMPLETED: { cls: 'badge-emerald', icon: CheckCircle2, label: 'Completed' },
  PARTIAL: { cls: 'badge-amber', icon: AlertCircle, label: 'Partial' },
  FAILED: { cls: 'badge-rose', icon: AlertCircle, label: 'Failed' },
  PENDING: { cls: 'badge-muted', icon: Clock, label: 'Pending' },
  SENT: { cls: 'badge-emerald', icon: CheckCircle2, label: 'Sent' },
};

function statusBadge(status) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.DRAFT;
  const Icon = s.icon;
  return (
    <span className={`badge ${s.cls}`}>
      <Icon size={11} /> {s.label}
    </span>
  );
}

function sourceBadge(createdVia) {
  const isBitrix = createdVia === 'BITRIX24';
  return (
    <span className={`badge ${isBitrix ? 'badge-blue' : 'badge-emerald'}`}>
      {isBitrix ? 'Bitrix24' : 'WhatsApp'}
    </span>
  );
}

export default function CampaignsView({ token }) {
  const [selected, setSelected] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [alert, setAlert] = useState(null);

  const {
    data: campaignsData,
    error,
    loading: campaignsLoading,
    refreshing,
    refetch: refetchCampaigns,
  } = useFetch('/api/campaigns?limit=100', { token, ttl: 15000 });

  const campaigns = Array.isArray(campaignsData) ? campaignsData : [];

  const firstLoad = campaignsData === undefined;
  const pageLoading = firstLoad && campaignsLoading;

  const showAlert = (type, text) => {
    setAlert({ type, text });
    setTimeout(() => setAlert(null), 6000);
  };

  const handleExecute = async (id) => {
    setActionBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${id}/execute`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to execute campaign');
      showAlert('success', `Campaign launched — ${data.data.totalRecipients || 0} recipients queued`);
      await refetchCampaigns({ force: true });
    } catch (err) {
      showAlert('error', err.message);
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this campaign? This cannot be undone.')) return;
    setActionBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to delete campaign');
      if (selected?.id === id) setSelected(null);
      showAlert('success', 'Campaign deleted');
      await refetchCampaigns({ force: true });
    } catch (err) {
      showAlert('error', err.message);
    } finally {
      setActionBusy(false);
    }
  };

  const handleView = async (id) => {
    setSelected(null);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.data) {
        setSelected(data.data);
      } else {
        showAlert('error', data.message || 'Failed to load campaign');
      }
    } catch (err) {
      showAlert('error', `Load error: ${err.message}`);
    }
  };

  const totalQueued = campaigns.reduce((sum, c) => sum + (c.totalRecipients || 0), 0);
  const totalSent = campaigns.reduce((sum, c) => sum + (c.sentCount || 0), 0);
  const completedCount = campaigns.filter((c) => c.status === 'COMPLETED').length;

  const recipientsCsv = (campaign) => campaign.recipients || [];

  return (
    <div className="animate-fade">
      {alert && (
        <div className={`alert-banner alert-${alert.type} animate-fade`} style={{ marginBottom: 20 }}>
          <span>{alert.text}</span>
        </div>
      )}

      {pageLoading ? (
        <KpiSkeleton count={3} />
      ) : (
        <div className="kpi-grid" style={{ marginBottom: 28 }}>
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-title">Total Campaigns</span>
              <div className="kpi-icon-wrapper kpi-icon-violet">
                <Megaphone size={20} />
              </div>
            </div>
            <div className="kpi-value" style={{ color: 'var(--accent-violet)' }}>{campaigns.length}</div>
            <div className="kpi-subtext">{completedCount} completed</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-title">Recipients Queued</span>
              <div className="kpi-icon-wrapper kpi-icon-blue">
                <Send size={20} />
              </div>
            </div>
            <div className="kpi-value" style={{ color: 'var(--accent-blue)' }}>{totalQueued}</div>
            <div className="kpi-subtext">Across all campaigns</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-title">Messages Sent</span>
              <div className="kpi-icon-wrapper kpi-icon-emerald">
                <CheckCircle2 size={20} />
              </div>
            </div>
            <div className="kpi-value" style={{ color: 'var(--accent-emerald)' }}>{totalSent}</div>
            <div className="kpi-subtext">Delivered via WhatsApp</div>
          </div>
        </div>
      )}

      <div className="glass-card">
        <div className="glass-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="kpi-icon-wrapper kpi-icon-violet" style={{ width: 36, height: 36 }}>
              <Megaphone size={18} />
            </div>
            <div>
              <h3 className="card-title">Marketing Campaigns</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                All campaigns created from the WhatsApp side and Bitrix24
              </p>
            </div>
          </div>

          <button
            className={`btn btn-secondary btn-sm ${refreshing ? 'btn-loading' : ''}`}
            onClick={() => refetchCampaigns({ background: true })}
            disabled={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? 'spinner' : ''} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="table-container">
          {pageLoading ? (
            <TableSkeleton rows={5} columns={9} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => refetchCampaigns({ force: true })} />
          ) : campaigns.length === 0 ? (
            <EmptyState
              title="No campaigns yet"
              message="Campaigns created from the WhatsApp side or Bitrix24 will appear here."
            />
          ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Type</th>
                <th>Status</th>
                <th>Source</th>
                <th>Recipients</th>
                <th>Sent / Failed</th>
                <th>Replies</th>
                <th>Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{campaign.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {campaign.segmentName
                          ? `Segment: ${campaign.segmentName}`
                          : campaign.body
                            ? campaign.body.slice(0, 50)
                            : campaign.mediaUrl || '—'}
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-muted">{campaign.type}</span>
                    </td>
                    <td>{statusBadge(campaign.status)}</td>
                    <td>{sourceBadge(campaign.createdVia)}</td>
                    <td>{campaign.totalRecipients ?? 0}</td>
                    <td>
                      <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>{campaign.sentCount ?? 0}</span>
                      {' / '}
                      <span style={{ color: 'var(--accent-rose)' }}>{campaign.failedCount ?? 0}</span>
                    </td>
                    <td>
                      <span style={{ color: 'var(--accent-violet)', fontWeight: 600 }}>{campaign.replyCount ?? 0}</span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {new Date(campaign.createdAt).toLocaleDateString('en-IN', {
                        dateStyle: 'medium',
                      })}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          title="View recipients"
                          onClick={() => handleView(campaign.id)}
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          className="btn btn-primary btn-sm"
                          title="Send campaign"
                          disabled={campaign.status === 'PROCESSING' || actionBusy}
                          onClick={() => handleExecute(campaign.id)}
                        >
                          <Play size={13} />
                          <span>Send</span>
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          title="Delete campaign"
                          disabled={campaign.status === 'PROCESSING' || actionBusy}
                          onClick={() => handleDelete(campaign.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          )}
        </div>
      </div>

      {selected && (
        <div className="glass-card">
          <div className="glass-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="kpi-icon-wrapper kpi-icon-blue" style={{ width: 36, height: 36 }}>
                <Megaphone size={18} />
              </div>
              <div>
                <h3 className="card-title">{selected.name}</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Recipients &amp; delivery status · {statusBadge(selected.status)}
                </p>
              </div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setSelected(null)}>
              <X size={14} />
              <span>Close</span>
            </button>
          </div>

          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-title">Recipients</span>
                <div className="kpi-icon-wrapper kpi-icon-blue">
                  <Send size={18} />
                </div>
              </div>
              <div className="kpi-value" style={{ color: 'var(--accent-blue)' }}>
                {selected.totalRecipients ?? 0}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-title">Sent</span>
                <div className="kpi-icon-wrapper kpi-icon-emerald">
                  <CheckCircle2 size={18} />
                </div>
              </div>
              <div className="kpi-value" style={{ color: 'var(--accent-emerald)' }}>
                {selected.sentCount ?? 0}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-title">Failed</span>
                <div className="kpi-icon-wrapper kpi-icon-rose">
                  <AlertCircle size={18} />
                </div>
              </div>
              <div className="kpi-value" style={{ color: 'var(--accent-rose)' }}>
                {selected.failedCount ?? 0}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-title">Replies</span>
                <div className="kpi-icon-wrapper kpi-icon-violet">
                  <Send size={18} />
                </div>
              </div>
              <div className="kpi-value" style={{ color: 'var(--accent-violet)' }}>
                {selected.replyCount ?? 0}
              </div>
            </div>
          </div>

          {selected.segmentName && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                padding: '10px 14px',
                borderRadius: 10,
                background: 'rgba(124, 108, 255, 0.08)',
                marginBottom: 16,
              }}
            >
              Audience segment: <strong>{selected.segmentName}</strong> · replies are linked back to this campaign
              conversation and synced to Bitrix24.
            </div>
          )}

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Replied</th>
                  <th>Error</th>
                  <th>Sent At</th>
                </tr>
              </thead>
              <tbody>
                {recipientsCsv(selected).length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)' }}>
                      No recipients recorded.
                    </td>
                  </tr>
                ) : (
                  recipientsCsv(selected).map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'monospace' }}>+{r.phone}</td>
                      <td>{statusBadge(r.status)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {r.repliedAt
                          ? new Date(r.repliedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                          : '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.error || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {r.sentAt ? new Date(r.sentAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
