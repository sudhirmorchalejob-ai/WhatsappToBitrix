import React, { useState, useEffect } from 'react';
import { Smartphone, Save, Loader2, CheckCircle2, AlertCircle, Send, ExternalLink } from 'lucide-react';

export default function SmsConfigView({ token }) {
  const [config, setConfig] = useState({
    sms_provider: 'generic',
    sms_api_url: '',
    sms_api_key: '',
    sms_sender_id: '',
    sms_route: '',
    sms_template_id: '',
    sms_webhook_secret: '',
  });
  const [configured, setConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [connResult, setConnResult] = useState(null);
  const [testPhone, setTestPhone] = useState('');
  const [maskedKeys, setMaskedKeys] = useState({});

  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/sms/config', { headers: authHeaders });
      const data = await res.json();
      if (res.ok && data.data) {
        const incoming = data.data.config || {};
        setConfig((prev) => ({ ...prev, ...incoming }));
        setConfigured(data.data.configured);
        const masked = {};
        for (const key of Object.keys(incoming)) {
          if (incoming[key] === '********') masked[key] = true;
        }
        setMaskedKeys(masked);
      }
    } catch (err) {
      console.error('Failed to load SMS config:', err);
    } finally {
      setLoaded(true);
    }
  };

  const setField = (key, value) => setConfig((prev) => ({ ...prev, [key]: value }));

  const buildSavePayload = () => {
    const payload = {};
    for (const key of Object.keys(config)) {
      const value = String(config[key] || '').trim();
      // Leave an existing secret untouched unless the admin typed a new one.
      if (maskedKeys[key] && value === '') continue;
      payload[key] = value;
    }
    return payload;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setStatusMsg({ type: 'info', text: 'Saving SMS gateway configuration...' });
    try {
      const res = await fetch('/api/sms/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(buildSavePayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Save failed');
      const incoming = data.data?.config || {};
      setConfig((prev) => ({ ...prev, ...incoming }));
      setConfigured(data.data.configured);
      const masked = {};
      for (const key of Object.keys(incoming)) {
        if (incoming[key] === '********') masked[key] = true;
      }
      setMaskedKeys(masked);
      setStatusMsg({
        type: 'success',
        text: data.data.configured
          ? 'SMS gateway configuration saved. You can now send a test SMS.'
          : 'SMS gateway configuration saved (provider credentials incomplete).',
      });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Failed to save SMS config: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setStatusMsg({ type: 'info', text: 'Testing connection to the SMS gateway...' });
    try {
      const res = await fetch('/api/sms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ action: 'connection' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Test failed');
      setConnResult(data.data);
      setStatusMsg({
        type: data.data.ok ? 'success' : 'error',
        text: data.data.ok
          ? `Connection OK (${data.data.note || 'reachable'})`
          : `Connection failed: ${data.data.error || 'unknown error'}`,
      });
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSendTest = async (e) => {
    e.preventDefault();
    if (!testPhone.trim()) {
      setStatusMsg({ type: 'error', text: 'Enter a recipient phone number for the test SMS.' });
      return;
    }
    setSending(true);
    setStatusMsg({ type: 'info', text: `Sending test SMS to ${testPhone.trim()}...` });
    try {
      const res = await fetch('/api/sms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ action: 'send', to: testPhone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Send failed');
      setStatusMsg({
        type: 'success',
        text: `Test SMS accepted by the gateway${data.data.providerMessageId ? ` (id ${data.data.providerMessageId})` : ''}.`,
      });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Test SMS failed: ${err.message}` });
    } finally {
      setSending(false);
    }
  };

  if (!loaded) {
    return (
      <div className="animate-fade" style={{ maxWidth: 780 }}>
        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Loader2 size={18} className="spin" /> Loading SMS configuration…
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade" style={{ maxWidth: 780 }}>
      {statusMsg && (
        <div className={`alert-banner alert-${statusMsg.type}`}>
          {statusMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      <form onSubmit={handleSave}>
        <div className="glass-card">
          <div className="glass-card-header" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="kpi-icon-wrapper kpi-icon-blue" style={{ width: 36, height: 36 }}>
                <Smartphone size={18} />
              </div>
              <div>
                <h3 className="card-title">SMS Gateway Configuration</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Powers the “My SMS Gateway” message provider inside Bitrix24 (CRM, Automation, Workflows)
                </p>
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Provider</label>
            <select
              className="form-control"
              value={config.sms_provider}
              onChange={(e) => setField('sms_provider', e.target.value)}
            >
              <option value="generic">Generic JSON Gateway (HTTP POST)</option>
              <option value="msg91">MSG91 (sendhttp.php)</option>
            </select>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
              MSG91 uses its documented endpoint; Generic POSTs <code>{'{ to, message }'}</code> JSON to the URL below.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">API URL</label>
            <input
              type="text"
              className="form-control"
              placeholder="https://api.msg91.com/api/sendhttp.php"
              value={config.sms_api_url}
              onChange={(e) => setField('sms_api_url', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">API Key / Auth Key</label>
            <input
              type="password"
              className="form-control"
              placeholder="••••••••"
              value={config.sms_api_key === '********' ? '' : config.sms_api_key}
              onChange={(e) => setField('sms_api_key', e.target.value)}
              autoComplete="new-password"
            />
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
              Saved securely as a secret; never echoed back (shown as “********” once stored).
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Sender ID</label>
              <input
                type="text"
                className="form-control"
                placeholder="MYAPP"
                value={config.sms_sender_id}
                onChange={(e) => setField('sms_sender_id', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Route</label>
              <input
                type="text"
                className="form-control"
                placeholder="4"
                value={config.sms_route}
                onChange={(e) => setField('sms_route', e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">DLT Template ID</label>
              <input
                type="text"
                className="form-control"
                placeholder="1207160000000000001"
                value={config.sms_template_id}
                onChange={(e) => setField('sms_template_id', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Delivery Webhook Secret</label>
              <input
                type="password"
                className="form-control"
                placeholder="••••••••"
                value={config.sms_webhook_secret === '********' ? '' : config.sms_webhook_secret}
                onChange={(e) => setField('sms_webhook_secret', e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
            Point your gateway's delivery callback at{' '}
            <code>{`${window.location.origin}/webhooks/sms`}</code> and set the secret above (or{' '}
            <code>?secret=…</code>) so delivery reports reach Bitrix24.
          </p>

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />} Save Configuration
            </button>
            <button type="button" className="btn" onClick={handleTest} disabled={testing || !configured}>
              {testing ? <Loader2 size={16} className="spin" /> : <ExternalLink size={16} />} Test Connection
            </button>
          </div>
        </div>
      </form>

      <form onSubmit={handleSendTest}>
        <div className="glass-card">
          <div className="glass-card-header" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="kpi-icon-wrapper kpi-icon-green" style={{ width: 36, height: 36 }}>
                <Send size={18} />
              </div>
              <div>
                <h3 className="card-title">Send a Test SMS</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Dispatches a real SMS through the configured gateway
                </p>
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Recipient Phone</label>
            <input
              type="text"
              className="form-control"
              placeholder="+919999999999"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              disabled={!configured}
              required
            />
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={sending || !configured}>
              {sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Send Test SMS
            </button>
          </div>
        </div>
      </form>

      {connResult && (
        <div className={`glass-card ${connResult.ok ? 'card-border-green' : 'card-border-red'}`}>
          <h3 className="card-title" style={{ marginBottom: 8 }}>
            Last connection test
          </h3>
          <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(connResult, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
