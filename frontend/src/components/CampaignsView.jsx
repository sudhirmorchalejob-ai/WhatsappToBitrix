import React, { useState, useEffect } from 'react';
import {
  Send,
  Plus,
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

export default function CampaignsView({ token }) {
  const [campaigns, setCampaigns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [alert, setAlert] = useState(null);

  const [form, setForm] = useState({
    name: '',
    type: 'TEXT',
    body: '',
    mediaUrl: '',
    caption: '',
    recipients: '',
  });

  const showAlert = (type, text) => {
    setAlert({ type, text });
    setTimeout(() => setAlert(null), 6000);
  };

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/campaigns?limit=100', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.data)) {
        setCampaigns(data.data);
      } else {
        showAlert('error', data.message || 'Failed to load campaigns');
      }
    } catch (err) {
      showAlert('error', `Load error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, [token]);

  const handleInput = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return showAlert('error', 'Campaign name is required');

    const recipients = form.recipients
      .split(/[\n,]+/)
      .map((p) => p.trim())
      .filter(Boolean);

    const payload = {
      name: form.name.trim(),
      type: form.type,
      recipients,
    };
    if (form.body.trim()) payload.body = form.body.trim();
    if (form.mediaUrl.trim()) payload.mediaUrl = form.mediaUrl.trim();
    if (form.caption.trim()) payload.caption = form.caption.trim();

    setActionBusy(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create campaign');
      setForm({ name: '', type: 'TEXT', body: '', mediaUrl: '', caption: '', recipients: '' });
      setShowForm(false);
      showAlert('success', `Campaign "${data.data.name}" created`);
      await fetchCampaigns();
    } catch (err) {
      showAlert('error', err.message);
    } finally {
      setActionBusy(false);
    }
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
      await fetchCampaigns();
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
      await fetchCampaigns();
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

      <div className="glass-card">
        <div className="glass-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="kpi-icon-wrapper kpi-icon-violet" style={{ width: 36, height: 36 }}>
              <Megaphone size={18} />
            </div>
            <div>
              <h3 className="card-title">Marketing Campaigns</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Create, manage and launch WhatsApp campaigns from Bitrix24
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={fetchCampaigns} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spinner' : ''} />
              <span>Refresh</span>
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowForm((v) => !v)}
              disabled={actionBusy}
            >
              <Plus size={14} />
              <span>{showForm ? 'Cancel' : 'New Campaign'}</span>
            </button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="glass-card" style={{ marginBottom: 24 }}>
            <div className="form-group">
              <label className="form-label">Campaign Name</label>
              <input
                className="form-control"
                name="name"
                value={form.name}
                onChange={handleInput}
                placeholder="e.g. July Summer Promo"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Message Type</label>
              <select className="form-control" name="type" value={form.type} onChange={handleInput}>
                <option value="TEXT">Text Message</option>
                <option value="MEDIA">Media Message</option>
              </select>
            </div>

            {form.type === 'TEXT' ? (
              <div className="form-group">
                <label className="form-label">Message Body</label>
                <textarea
                  className="form-control"
                  name="body"
                  value={form.body}
                  onChange={handleInput}
                  rows={4}
                  placeholder="Hi {{name}}, don't miss our special offer!"
                  required
                />
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label">Media URL</label>
                  <input
                    className="form-control"
                    name="mediaUrl"
                    value={form.mediaUrl}
                    onChange={handleInput}
                    placeholder="https://example.com/image.jpg"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Caption</label>
                  <input
                    className="form-control"
                    name="caption"
                    value={form.caption}
                    onChange={handleInput}
                    placeholder="Optional caption for the media"
                  />
                </div>
              </>
            )}

            <div className="form-group">
              <label className="form-label">Recipients (phone numbers)</label>
              <textarea
                className="form-control"
                name="recipients"
                value={form.recipients}
                onChange={handleInput}
                rows={3}
                placeholder="Comma or newline separated, e.g.&#10;+15551234567, +15559876543"
              />
            </div>

            <button type="submit" className="btn btn-primary btn-sm" disabled={actionBusy}>
              <Plus size={14} />
              <span>{actionBusy ? 'Creating...' : 'Create Campaign'}</span>
            </button>
          </form>
        )}

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Type</th>
                <th>Status</th>
                <th>Recipients</th>
                <th>Sent / Failed</th>
                <th>Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-dim)' }}>
                    No campaigns yet. Create your first one to start sending WhatsApp campaigns.
                  </td>
                </tr>
              ) : (
                campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{campaign.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {campaign.body ? campaign.body.slice(0, 50) : campaign.mediaUrl || '—'}
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-muted">{campaign.type}</span>
                    </td>
                    <td>{statusBadge(campaign.status)}</td>
                    <td>{campaign.totalRecipients ?? 0}</td>
                    <td>
                      <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>{campaign.sentCount ?? 0}</span>
                      {' / '}
                      <span style={{ color: 'var(--accent-rose)' }}>{campaign.failedCount ?? 0}</span>
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
                ))
              )}
            </tbody>
          </table>
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
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Error</th>
                  <th>Sent At</th>
                </tr>
              </thead>
              <tbody>
                {recipientsCsv(selected).length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)' }}>
                      No recipients recorded.
                    </td>
                  </tr>
                ) : (
                  recipientsCsv(selected).map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'monospace' }}>+{r.phone}</td>
                      <td>{statusBadge(r.status)}</td>
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
