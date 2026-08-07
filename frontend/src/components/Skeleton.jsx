import React from 'react';

/**
 * Reusable loading primitives. Every page builds its placeholder from these
 * so the whole app shares one look. Shimmer is driven by CSS (.skeleton).
 */

export function Skeleton({ width = '100%', height = 16, radius = 8, style = {} }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} aria-hidden="true" />;
}

export function KpiSkeleton({ count = 3 }) {
  return (
    <div className="kpi-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div className="kpi-card" key={i}>
          <Skeleton width="62%" height={14} />
          <Skeleton width="42%" height={36} style={{ marginTop: 20 }} />
          <Skeleton width="82%" height={12} style={{ marginTop: 14 }} />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 6, height = 15 }) {
  return (
    <div className="skeleton-table">
      <div className="skeleton-table-head">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} width="72%" height={12} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div className="skeleton-table-row" key={r}>
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} width={`${52 + ((r * 7 + c * 13) % 38)}%`} height={height} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton({ kpis = 3, tableRows = 6, tableColumns = 6 }) {
  return (
    <div className="animate-fade">
      <KpiSkeleton count={kpis} />
      <div className="glass-card">
        <div className="glass-card-header">
          <div>
            <Skeleton width="220px" height={18} />
            <Skeleton width="300px" height={12} style={{ marginTop: 8 }} />
          </div>
          <Skeleton width="130px" height={34} radius={10} />
        </div>
        <TableSkeleton rows={tableRows} columns={tableColumns} />
      </div>
    </div>
  );
}

export function CardSkeleton({ rows = 4 }) {
  return (
    <div className="glass-card">
      <div className="glass-card-header">
        <Skeleton width="200px" height={18} />
        <Skeleton width="100px" height={12} />
      </div>
      <div className="skeleton-lines">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} width={`${60 + (i * 9) % 30}%`} height={13} />
        ))}
      </div>
    </div>
  );
}

export function ChatSkeleton() {
  const items = [1, 2, 3, 4, 5, 6];
  const bubbles = [1, 2, 3, 4, 5];
  return (
    <div className="wa-app" style={{ minHeight: 480 }}>
      <div className="wa-list">
        <div className="wa-list-head">
          <Skeleton width="150px" height={18} />
        </div>
        <div className="wa-search">
          <Skeleton width="100%" height={38} radius={8} />
        </div>
        <div className="wa-list-body" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {items.map((i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Skeleton width={46} height={46} radius="50%" />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Skeleton width={`${60 + (i * 11) % 25}%`} height={13} />
                <Skeleton width="88%" height={11} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="wa-thread" style={{ padding: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {bubbles.map((b) => (
            <Skeleton
              key={b}
              height={42}
              radius={10}
              style={b % 2 === 0 ? { alignSelf: 'flex-end', width: `${38 + (b * 8) % 20}%` } : { width: `${45 + (b * 7) % 20}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Spinner({ size = 18 }) {
  return <span className="spinner-ring" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function FullPageLoader({ label = 'Loading data...' }) {
  return (
    <div className="page-loader">
      <div className="page-loader-inner">
        <Spinner size={44} />
        <div className="page-loader-label">{label}</div>
      </div>
    </div>
  );
}
