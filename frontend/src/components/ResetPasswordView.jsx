import React, { useState } from 'react';
import { MessageSquare, Lock, Eye, EyeOff, ArrowRight, Loader2, CheckCircle2, ArrowLeft } from 'lucide-react';

export default function ResetPasswordView({ token, onDone }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to reset password');
      setSuccess(true);
      setTimeout(() => onDone && onDone(data.data.email), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card animate-fade">
          <div className="auth-header">
            <div className="auth-logo" style={{ background: 'var(--emerald-soft)', color: 'var(--accent-emerald)' }}>
              <CheckCircle2 size={28} />
            </div>
            <h1 className="auth-title">Password Updated</h1>
            <p className="auth-subtitle">Your password has been changed successfully. Redirecting to sign in...</p>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', padding: '12px' }} onClick={() => onDone && onDone()}>
            Go to Sign In <ArrowRight size={18} />
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
          <h1 className="auth-title">Set a New Password</h1>
          <p className="auth-subtitle">Choose a strong password for your WhatsApp By Averlon account</p>
        </div>

        {error && (
          <div className="alert-banner alert-error" style={{ marginBottom: 20 }}>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">New Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showNew ? 'text' : 'password'}
                className="form-control"
                style={{ paddingLeft: 42, paddingRight: 42 }}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                required
              />
              <Lock size={18} style={{ position: 'absolute', left: 14, top: 13, color: '#64748b' }} />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: 12, top: 11,
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#64748b',
                }}
              >
                {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 24 }}>
            <label className="form-label">Confirm Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showConfirm ? 'text' : 'password'}
                className="form-control"
                style={{ paddingLeft: 42, paddingRight: 42 }}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
              />
              <Lock size={18} style={{ position: 'absolute', left: 14, top: 13, color: '#64748b' }} />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: 12, top: 11,
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#64748b',
                }}
              >
                {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
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
                <Loader2 size={18} className="spinner" /> Updating password...
              </>
            ) : (
              <>
                Update Password <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <button className="auth-link" onClick={() => onDone && onDone()} style={{ marginTop: 16 }}>
          <ArrowLeft size={14} /> Back to Sign In
        </button>
      </div>
    </div>
  );
}
