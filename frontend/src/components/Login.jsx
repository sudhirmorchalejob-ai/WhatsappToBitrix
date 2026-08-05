import React, { useState } from 'react';
import { MessageSquare, Lock, Mail, ArrowRight, Loader2 } from 'lucide-react';

export default function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('admin@system.com');
  const [password, setPassword] = useState('Admin@123456');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Login failed');
      }

      onLoginSuccess(data.data.token, data.data.user, data.data.tenant);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card animate-fade">
        <div className="auth-header">
          <div className="auth-logo">
            <MessageSquare size={28} />
          </div>
          <h1 className="auth-title">WhatsApp → Bitrix24</h1>
          <p className="auth-subtitle">Sign in to manage your WhatsApp leads & integrations</p>
        </div>

        {error && (
          <div className="alert-banner alert-error" style={{ marginBottom: 20 }}>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div style={{ position: 'relative' }}>
              <input
                type="email"
                className="form-control"
                style={{ paddingLeft: 42 }}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@system.com"
                required
              />
              <Mail size={18} style={{ position: 'absolute', left: 14, top: 13, color: '#64748b' }} />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 24 }}>
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type="password"
                className="form-control"
                style={{ paddingLeft: 42 }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
              <Lock size={18} style={{ position: 'absolute', left: 14, top: 13, color: '#64748b' }} />
            </div>
          </div>

          <button
            type="submit"
            className={`btn btn-primary ${loading ? 'btn-loading' : ''}`}
            style={{ width: '100%', padding: '12px' }}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="spinner" /> Signing in...
              </>
            ) : (
              <>
                Sign In to Dashboard <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <div className="auth-demo-hint">
          <strong>Default Login Credentials:</strong><br />
          Email: <strong>admin@system.com</strong><br />
          Password: <strong>Admin@123456</strong>
        </div>
      </div>
    </div>
  );
}
