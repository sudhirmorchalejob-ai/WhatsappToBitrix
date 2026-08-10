import React from 'react';
import {
  Users,
  Bot,
  Send,
  Sparkles,
  MessageCircle,
  ExternalLink,
  CheckCircle2,
  ArrowUpRight,
} from 'lucide-react';
import { PageSkeleton } from './Skeleton';
import { EmptyState } from './StateViews';

export default function DashboardView({ stats, recentLeads, onViewAllLeads, loading }) {
  const kpis = stats?.kpis || {};

  // First paint has nothing yet — show a full-page skeleton immediately.
  if (loading && !stats) {
    return <PageSkeleton kpis={3} tableRows={5} />;
  }

  // Primary Key Metrics:
  // 1. Total leads (synced from Bitrix24 + created via WhatsApp)
  // 2. Auto reply messages via WhatsApp
  // 3. Campaign total created via WhatsApp
  const totalLeads = kpis.totalLeads ?? kpis.leadsCreatedViaWhatsApp ?? kpis.totalCustomers ?? 0;
  const whatsAppLeads = kpis.leadsCreatedViaWhatsApp ?? 0;
  const autoReplyMessages = kpis.automatedMessages ?? 0;
  const campaignTotal = kpis.campaignMessages ?? 0;

  const todaysLeads = kpis.todaysLeads ?? kpis.todaysWhatsAppLeads ?? 0;
  const activeChats = kpis.activeConversations ?? 0;

  return (
    <div className="animate-fade">
      {/* 3 Primary Focus KPI Cards */}
      <div className="kpi-grid">
        {/* Metric 1: Total Leads */}
        <div className="kpi-card" style={{ background: 'var(--gradient-card)' }}>
          <div className="kpi-header">
            <span className="kpi-title">Total Leads</span>
            <div className="kpi-icon-wrapper kpi-icon-emerald">
              <Users size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: 'var(--accent-emerald)' }}>
            {totalLeads}
          </div>
          <div className="kpi-subtext">
            Contacts &amp; leads synced from Bitrix24 ({whatsAppLeads} via WhatsApp)
          </div>
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
            <span className="kpi-title">Today's Leads</span>
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
            <h2 className="card-title">Recent Leads</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Latest contacts and leads pulled from Bitrix24 CRM / WhatsApp
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onViewAllLeads}>
            View All Leads <ArrowUpRight size={14} />
          </button>
        </div>

        <div className="table-container">
          {recentLeads.length === 0 ? (
            <EmptyState
              title="No leads yet"
              message="Run Auto-Sync Leads to pull contacts from Bitrix24, or send a test message on WhatsApp to auto-create a Bitrix24 lead."
            />
          ) : (
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
                {recentLeads.map((lead) => {
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
                        {lead.bitrixLeadId ? (
                          <span className="badge badge-blue">Bitrix Lead</span>
                        ) : lead.bitrixContactId || lead.bitrix24ContactId ? (
                          <span className="badge badge-emerald">📲 WhatsApp</span>
                        ) : (
                          <span className="badge badge-muted">Synced</span>
                        )}
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
          )}
        </div>
      </div>
    </div>
  );
}
