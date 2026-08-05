import React, { useState, useEffect } from 'react';
import { Webhook, Building2, Smartphone, Zap, Save, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export default function WebhookSetupView({ token, onSetupUpdated, onSync, isSyncing }) {
  const [b24Url, setB24Url] = useState('');
  const [waWebhookUrl, setWaWebhookUrl] = useState('');
  const [waChannelId, setWaChannelId] = useState('');

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null); // { type: 'success'|'error'|'info', text: '' }
  const [connResult, setConnResult] = useState(null);

  useEffect(() => {
    fetchSetupStatus();
  }, []);

  const fetchSetupStatus = async () => {
    try {
      const res = await fetch('/api/tenant/setup-status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.data) {
        if (data.data.bitrix24WebhookUrl) setB24Url(data.data.bitrix24WebhookUrl);
        if (data.data.whatsappWebhookUrl) setWaWebhookUrl(data.data.whatsappWebhookUrl);
        if (data.data.whatsboxChannelId) setWaChannelId(data.data.whatsboxChannelId);
      }
    } catch (err) {
      console.error('Failed to load setup status:', err);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setStatusMsg({ type: 'info', text: 'Saving integration webhooks and verifying connection...' });

    try {
      const res = await fetch('/api/tenant/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bitrix24WebhookUrl: b24Url,
          whatsappWebhookUrl: waWebhookUrl,
          whatsboxChannelId: waChannelId,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Save failed');

      const b24Ok = data.data?.connectionStatus?.bitrix24?.ok;
      const waOk = data.data?.connectionStatus?.whatsbox?.ok;

      setStatusMsg({
        type: b24Ok ? 'success' : 'error',
        text: `Webhooks Saved! Bitrix24 CRM: ${b24Ok ? '✅ Connected' : '⚠️ Unreachable'} | WhatsApp: ${waOk ? '✅ Ready' : '⚠️ Unconfigured'}`,
      });

      if (onSetupUpdated) onSetupUpdated();
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Failed to save setup: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setStatusMsg({ type: 'info', text: 'Testing live connection to Bitrix24 and WhatsApp Gateway...' });

    try {
      const res = await fetch('/api/tenant/test-connection', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Test failed');

      const b24 = data.data?.bitrix24;
      const wa = data.data?.whatsbox;
      setConnResult({ b24, wa });

      setStatusMsg({
        type: b24?.ok && wa?.ok ? 'success' : 'error',
        text: `Connection Test Result: Bitrix24 CRM (${b24?.ok ? 'OK' : 'Failed'}), WhatsApp (${wa?.ok ? 'Ready' : 'Pending'})`,
      });
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="animate-fade" style={{ maxWidth: 780 }}>
      {statusMsg && (
        <div className={`alert-banner alert-${statusMsg.type}`}>
          {statusMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* Bitrix24 Webhook Configuration Card */}
        <div className="glass-card">
          <div className="glass-card-header" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="kpi-icon-wrapper kpi-icon-blue" style={{ width: 36, height: 36 }}>
                <Building2 size={18} />
              </div>
              <div>
                <h3 className="card-title">Bitrix24 Webhook Integration</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Inbound REST Webhook URL generated from Bitrix24 CRM
                </p>
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Bitrix24 REST Webhook URL</label>
            <input
              type="text"
              className="form-control"
              placeholder="https://your-portal.bitrix24.com/rest/1/xxxxxxxxxx/"
              value={b24Url}
              onChange={(e) => setB24Url(e.target.value)}
              required
            />
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
              Found in Bitrix24 → Developer Resources → Inbound Webhooks. Required to create leads automatically.
            </p>
          </div>
        </div>

        {/* WhatsApp Gateway Webhook Configuration Card */}
        <div className="glass-card">
          <div className="glass-card-header" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="kpi-icon-wrapper kpi-icon-emerald" style={{ width: 36, height: 36 }}>
                <Smartphone size={18} />
              </div>
              <div>
                <h3 className="card-title">WhatsApp Webhook Integration</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  WhatsApp Gateway API Webhook endpoint & Channel Phone Number
                </p>
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">WhatsApp Gateway Webhook URL</label>
            <input
              type="text"
              className="form-control"
              placeholder="https://your-domain.com/webhooks/whatsbox"
              value={waWebhookUrl}
              onChange={(e) => setWaWebhookUrl(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">WhatsApp Channel Phone Number</label>
            <input
              type="text"
              className="form-control"
              placeholder="e.g. 919041800275"
              value={waChannelId}
              onChange={(e) => setWaChannelId(e.target.value)}
            />
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
          <button
            type="submit"
            className={`btn btn-primary ${saving ? 'btn-loading' : ''}`}
            disabled={saving}
          >

              <>
                <Save size={16} /> Save Webhooks
              </>

          </button>

          <button
            type="button"
            className={`btn btn-secondary ${testing ? 'btn-loading' : ''}`}
            onClick={handleTestConnection}
            disabled={testing}
          >
            {testing ? <Loader2 size={16} className="spinner" /> : <Webhook size={16} />}
            <span>Test Connection</span>
          </button>

          <button
            type="button"
            className={`btn btn-secondary ${isSyncing ? 'btn-loading' : ''}`}
            onClick={onSync}
            disabled={isSyncing}
          >
            <Zap size={16} style={{ color: 'var(--accent-emerald)' }} />
            <span>Auto-Sync All Leads</span>
          </button>
        </div>
      </form>
    </div>
  );
}
