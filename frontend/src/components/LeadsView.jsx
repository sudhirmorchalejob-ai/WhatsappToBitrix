import React, { useState } from 'react';
import { Search, ExternalLink, CheckCircle2, Zap } from 'lucide-react';

export default function LeadsView({ leads, onSync, isSyncing }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredLeads = leads.filter((l) => {
    const q = searchTerm.toLowerCase();
    const name = (l.name || `${l.firstName || ''} ${l.lastName || ''}`).toLowerCase();
    const phone = (l.whatsappPhone || l.phone || '').toLowerCase();
    const b24Id = String(l.bitrix24ContactId || l.bitrixContactId || '');
    return name.includes(q) || phone.includes(q) || b24Id.includes(q);
  });

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
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Showing <strong>{filteredLeads.length}</strong> of {leads.length} WhatsApp leads
            </span>
            <button
              className={`btn btn-primary btn-sm ${isSyncing ? 'btn-loading' : ''}`}
              onClick={onSync}
              disabled={isSyncing}
            >
              <Zap size={14} />
              <span>{isSyncing ? 'Syncing...' : 'Sync All Leads'}</span>
            </button>
          </div>
        </div>

        <div className="table-container">
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
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-dim)' }}>
                    No leads matching "{searchTerm}"
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => {
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
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
