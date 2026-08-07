import React from 'react';
import { RefreshCw, Inbox } from 'lucide-react';

/**
 * Shared success-empty / error states so every page renders the same
 * professional placeholder instead of a blank table body.
 */

export function EmptyState({ icon: Icon = Inbox, title = 'Nothing here yet', message = 'No data to display.', action }) {
  return (
    <div className="state-box">
      <div className="state-icon">{<Icon size={32} />}</div>
      <h4 className="state-title">{title}</h4>
      <p className="state-message">{message}</p>
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ message = 'Failed to load data.', onRetry, retryLabel = 'Retry' }) {
  return (
    <div className="state-box">
      <div className="state-icon state-icon-error">!</div>
      <h4 className="state-title">Something went wrong</h4>
      <p className="state-message">{message}</p>
      {onRetry && (
        <button className="btn btn-secondary btn-sm" onClick={onRetry}>
          <RefreshCw size={14} />
          <span>{retryLabel}</span>
        </button>
      )}
    </div>
  );
}
