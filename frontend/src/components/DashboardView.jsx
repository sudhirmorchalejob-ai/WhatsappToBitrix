import React from 'react';
import {
  Users,
  Bot,
  Send,
  Sparkles,
  MessageCircle,
  ExternalLink,
  CheckCircle2,
  Clock,
  ArrowUpRight,
} from 'lucide-react';

export default function DashboardView({ stats, recentLeads, onViewAllLeads }) {
  const kpis = stats?.kpis || {};

  // 3 Primary Key Metrics requested by User:
  // 1. Leads created via WhatsApp
  // 2. Auto reply messages via WhatsApp
  // 3. Campaign total created via WhatsApp
  const leadsViaWhatsApp = kpis.leadsCreatedViaWhatsApp ?? kpis.totalCustomers ?? 0;
  const autoReplyMessages = kpis.automatedMessages ?? 0;
  const campaignTotal = kpis.campaignMessages ?? 0;

  const todaysLeads = kpis.todaysWhatsAppLeads ?? kpis.todaysLeads ?? 0;
  const activeChats = kpis.activeConversations ?? 0;

  return (
    <div className="animate-fade">
      {/* 3 Primary Focus KPI Cards */}
      <div className="kpi-grid">
        {/* Metric 1: Leads Created via WhatsApp */}
        <div className="kpi-card" style={{ background: 'var(--gradient-card)' }}>
          <div className="kpi-header">
            <span className="kpi-title">Leads Created via WhatsApp</span>
            <div className="kpi-icon-wrapper kpi-icon-emerald">
              <Users size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: 'var(--accent-emerald)' }}>
            {leadsViaWhatsApp}
          </div>
          <div className="kpi-subtext">Synced to Bitrix24 from incoming WhatsApp messages</div>
        </div>

        {/* Metric 2: Auto Reply Messages via WhatsApp */}
        <div className="kpi-card" style={{ background: 'var(--gradient-violet)' }}>
          <div className="kpi-header">
            <span className="kpi-title">Auto Replies via WhatsApp</span>
            <div className="kpi-icon-wrapper kpi-icon-violet">
              <Bot size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: 'var(--accent-violet)' }}>
            {autoReplyMessages}
          </div>
          <div className="kpi-subtext">Automated responses fired with Bitrix24 lead linked</div>
        </div>

        {/* Metric 3: Campaign Total Created via WhatsApp */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Campaign Total via WhatsApp</span>
            <div className="kpi-icon-wrapper kpi-icon-blue">
              <Send size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: 'var(--accent-blue)' }}>
            {campaignTotal}
          </div>
          <div className="kpi-subtext">Outbound broadcast campaign messages processed</div>
        </div>
      </div>

      {/* Secondary Metrics Bar */}
      <div className="kpi-grid" style={{ marginBottom: 28 }}>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Today's WhatsApp Leads</span>
            <div className="kpi-icon-wrapper kpi-icon-amber">
              <Sparkles size={18} />
            </div>
          </div>
          <div className="kpi-value">{todaysLeads}</div>
          <div className="kpi-subtext">New leads registered today</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Active WhatsApp Chats</span>
            <div className="kpi-icon-wrapper kpi-icon-emerald">
              <MessageCircle size={18} />
            </div>
          </div>
          <div className="kpi-value">{activeChats}</div>
          <div className="kpi-subtext">Open customer conversations</div>
        </div>
      </div>

      {/* Recent Leads Table Container */}
      <div className="glass-card">
        <div className="glass-card-header">
          <div>
            <h2 className="card-title">Recent Leads Created via WhatsApp</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Latest WhatsApp contacts synced as leads in Bitrix24 CRM
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onViewAllLeads}>
            View All Leads <ArrowUpRight size={14} />
          </button>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer Name</th>
                <th>WhatsApp Phone</th>
                <th>Bitrix24 Contact ID</th>
                <th>Lead Source</th>
                <th>Sync Status</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {!recentLeads || recentLeads.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-dim)' }}>
                    No leads created yet. Send a test message on WhatsApp to auto-create a Bitrix24 lead.
                  </td>
                </tr>
              ) : (
                recentLeads.map((lead) => {
                  const name = lead.name || [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'WhatsApp User';
                  const createdDate = new Date(lead.createdAt).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  });

                  return (
                    <tr key={lead.id}>
                      <td style={{ fontWeight: 600 }}>{name}</td>
                      <td>
                        <span style={{ fontFamily: 'monospace', color: 'var(--accent-blue)' }}>
                          +{lead.phone || lead.whatsappPhone}
                        </span>
                      </td>
                      <td>
                        {lead.bitrixContactId || lead.bitrix24ContactId ? (
                          <span className="badge badge-blue">
                            <ExternalLink size={11} /> #{lead.bitrixContactId || lead.bitrix24ContactId}
                          </span>
                        ) : (
                          <span className="badge badge-muted">Pending Sync</span>
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
