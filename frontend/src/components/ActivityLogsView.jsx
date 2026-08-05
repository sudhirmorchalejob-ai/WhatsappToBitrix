import React, { useState, useEffect } from 'react';
import { ClipboardList, RefreshCw, UserCheck, Sparkles, MessageSquare, Zap, Shield } from 'lucide-react';

export default function ActivityLogsView({ token }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterCategory, setFilterCategory] = useState('ALL');

  useEffect(() => {
    fetchActivityLogs();
  }, [token]);

  const fetchActivityLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/activities?limit=100', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.data?.items) {
        setLogs(data.data.items);
      }
    } catch (err) {
      console.error('Failed to fetch activity logs:', err);
    } finally {
      setLoading(false);
    }
  };

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
              className={`btn btn-secondary btn-sm ${loading ? 'btn-loading' : ''}`}
              onClick={fetchActivityLogs}
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'spinner' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div className="table-container">
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
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-dim)' }}>
                    No activity logs recorded yet.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
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
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
