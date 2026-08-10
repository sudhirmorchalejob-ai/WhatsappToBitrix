import React, { useState } from 'react';
import {
  MessageSquare, Lock, Mail, ArrowRight, Loader2, Eye, EyeOff, ArrowLeft,
} from 'lucide-react';

export default function Login({ onLoginSuccess, initialEmail }) {
  const [view, setView] = useState('login');
  const [email, setEmail] = useState(initialEmail || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [forgotEmail, setForgotEmail] = useState(initialEmail || '');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState(null);
  const [forgotSuccess, setForgotSuccess] = useState(false);

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

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setForgotError(null);
    setForgotSuccess(false);
    setForgotLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Could not send reset email');
      }

      setForgotSuccess(true);
    } catch (err) {
      setForgotError(err.message);
    } finally {
      setForgotLoading(false);
    }
  };

  if (view === 'forgot') {
    return (
      <div className="auth-wrapper">
        <div className="auth-card animate-fade">
          <div className="auth-header">
            <div className="auth-logo">
              <MessageSquare size={28} />
            </div>
            <h1 className="auth-title">Forgot Password</h1>
            <p className="auth-subtitle">
              Enter your account email and we'll send you a link to reset your password
            </p>
          </div>

          {forgotError && (
            <div className="alert-banner alert-error" style={{ marginBottom: 20 }}>
              <span>{forgotError}</span>
            </div>
          )}

          {forgotSuccess && (
            <div className="alert-banner alert-success" style={{ marginBottom: 20 }}>
              <span>
                If an account exists with that email, a password reset link has been sent. Check your inbox (and spam
                folder).
              </span>
            </div>
          )}

          <form onSubmit={handleForgotSubmit}>
            <div className="form-group" style={{ marginBottom: 24 }}>
              <label className="form-label">Email Address</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="email"
                  className="form-control"
                  style={{ paddingLeft: 42 }}
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                />
                <Mail size={18} style={{ position: 'absolute', left: 14, top: 13, color: '#64748b' }} />
              </div>
            </div>

            <button
              type="submit"
              className={`btn btn-primary ${forgotLoading ? 'btn-loading' : ''}`}
              style={{ width: '100%', padding: '12px' }}
              disabled={forgotLoading}
            >
              {forgotLoading ? (
                <>
                  <Loader2 size={18} className="spinner" /> Sending reset link...
                </>
              ) : (
                <>
                  Send Reset Link <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <button className="auth-link" style={{ marginTop: 16 }} onClick={() => setView('login')}>
            <ArrowLeft size={14} /> Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card animate-fade">
        <div className="auth-header">
          <div className="auth-logo">
            <MessageSquare size={28} />
          </div>
          <h1 className="auth-title">WhatsApp By Averlon</h1>
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
                placeholder="Enter your email"
                required
              />
              <Mail size={18} style={{ position: 'absolute', left: 14, top: 13, color: '#64748b' }} />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 24 }}>
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-control"
                style={{ paddingLeft: 42, paddingRight: 42 }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
              <Lock size={18} style={{ position: 'absolute', left: 14, top: 13, color: '#64748b' }} />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: 11,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  color: '#64748b',
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
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

        <button className="auth-link" style={{ marginTop: 16 }} onClick={() => setView('forgot')}>
          Forgot Password?
        </button>
      </div>
    </div>
  );
}
