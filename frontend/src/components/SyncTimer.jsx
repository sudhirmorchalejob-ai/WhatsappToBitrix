import React from 'react';
import { formatDuration } from '../lib/formatDuration';

export default function SyncTimer({ isSyncing, elapsed, lastSyncDuration }) {
  if (isSyncing) {
    const last = Math.max(0, Math.floor(Number(lastSyncDuration) || 0));
    const remaining = last > 0 && elapsed <= last ? last - elapsed : null;

    return (
      <span className="sync-timer">
        <span className="sync-dot" />
        <span>Syncing… {formatDuration(elapsed)} elapsed</span>
        {remaining !== null ? (
          <span className="sync-timer-muted">
            {' '}
            · ~{formatDuration(remaining)} left · last full sync {formatDuration(last)}
          </span>
        ) : last > 0 ? (
          <span className="sync-timer-muted">
            {' '}
            · longer than last sync ({formatDuration(last)})
          </span>
        ) : null}
      </span>
    );
  }

  if (lastSyncDuration) {
    return (
      <span className="sync-timer sync-timer-idle">
        <span className="sync-dot" />
        <span>Last full sync: {formatDuration(lastSyncDuration)}</span>
      </span>
    );
  }

  return null;
}
