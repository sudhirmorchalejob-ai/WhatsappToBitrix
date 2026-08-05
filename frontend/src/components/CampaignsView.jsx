import React from 'react';
import { Send, CheckCircle2, MessageSquare } from 'lucide-react';

export default function CampaignsView({ stats }) {
  const kpis = stats?.kpis || {};
  const campaignTotal = kpis.campaignMessages ?? 0;

  return (
    <div className="animate-fade">
      <div className="kpi-grid" style={{ marginBottom: 28 }}>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Campaign Total Messages</span>
            <div className="kpi-icon-wrapper kpi-icon-blue">
              <Send size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: 'var(--accent-blue)' }}>
            {campaignTotal}
          </div>
          <div className="kpi-subtext">Total campaign messages sent via WhatsApp</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Campaign Lead Integration</span>
            <div className="kpi-icon-wrapper kpi-icon-emerald">
              <CheckCircle2 size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: 'var(--accent-emerald)' }}>
            Active
          </div>
          <div className="kpi-subtext">Campaign outbound resolves & creates Bitrix24 leads</div>
        </div>
      </div>

      <div className="glass-card">
        <div className="glass-card-header">
          <h3 className="card-title">WhatsApp Campaign Overview</h3>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Campaign messages sent via the WhatsApp API pass through the shared customer resolution flow.
          If the target phone number is already synced or when a customer replies to a campaign message, an open lead is automatically created or linked in Bitrix24 CRM.
        </p>
      </div>
    </div>
  );
}
