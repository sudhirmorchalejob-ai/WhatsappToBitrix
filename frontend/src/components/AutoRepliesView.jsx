import React from 'react';
import { Bot, CheckCircle2, MessageSquare } from 'lucide-react';

export default function AutoRepliesView({ stats }) {
  const kpis = stats?.kpis || {};
  const autoRepliesCount = kpis.automatedMessages ?? 0;

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
          <h3 className="card-title">Auto-Reply Rule Details</h3>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          When an incoming message arrives on WhatsApp, the Auto-Reply engine verifies whether an automated response should be delivered.
          Every auto-reply is checked against Bitrix24 to guarantee that an active open lead is linked to the conversation.
        </p>
      </div>
    </div>
  );
}
