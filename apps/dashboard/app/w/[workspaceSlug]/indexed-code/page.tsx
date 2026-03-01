import { notFound } from 'next/navigation';
import { getWorkspaceBySlug, platformFetch } from '../../../../lib/platform';

type Repo = {
  id: string;
  fullName: string;
  defaultBranch?: string;
  installationId?: string;
  updatedAt: string;
};

function timeAgo(dateStr: string): string {
  try {
    const ms = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return dateStr;
  }
}

const LOG_LINES = [
  { time: '10:42:01', level: 'info', msg: 'Starting index run for workspace' },
  { time: '10:42:03', level: 'ok', msg: 'Connected to vector store — 3 shards active' },
  { time: '10:42:05', level: 'info', msg: 'Processing acme/api-service (branch: main)' },
  { time: '10:42:12', level: 'ok', msg: 'Embedded 1,284 chunks — 38,520 vectors written' },
  { time: '10:42:15', level: 'info', msg: 'Processing acme/web (branch: main)' },
  { time: '10:42:21', level: 'ok', msg: 'Embedded 892 chunks — 26,760 vectors written' },
  { time: '10:42:24', level: 'warn', msg: 'Rate limit approaching — throttling requests' },
  { time: '10:42:31', level: 'ok', msg: 'Index run complete — 65,280 vectors total' },
];

const VECTOR_USAGE = [
  { label: 'TypeScript', pct: 54, color: '#3178c6' },
  { label: 'JavaScript', pct: 22, color: '#f7df1e' },
  { label: 'Markdown', pct: 14, color: '#8b949e' },
  { label: 'Other', pct: 10, color: '#6e7681' },
];

export default async function IndexedCodePage({
  params
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) {
    notFound();
  }

  const repositoriesResponse = await platformFetch<{ repositories: Repo[] }>(
    `/v1/workspaces/${encodeURIComponent(workspace.id)}/repositories`
  );

  const repos = repositoriesResponse.repositories;

  // Mock vector stats (not available via API yet)
  const totalVectors = repos.length > 0 ? repos.length * 38520 : 0;
  const storageUsedMB = repos.length > 0 ? repos.length * 12.4 : 0;
  const storageCapMB = 500;
  const storagePct = Math.min(Math.round((storageUsedMB / storageCapMB) * 100), 100);
  const tokensProcessed = repos.length > 0 ? repos.length * 248000 : 0;
  const estCost = (tokensProcessed / 1_000_000) * 0.0001;
  const indexHealth = repos.length > 0 ? 98 : 0;

  return (
    <>
      {/* Page header */}
      <div className="page-header">
        <div className="page-header-left">
          <h1>Codebase Index</h1>
          <p>Manage vector embeddings and indexing status for AI-powered code review.</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary" type="button">Configure</button>
          <button className="btn btn-primary" type="button">Trigger Global Re-index</button>
        </div>
      </div>

      {/* Search bar */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '10px 16px',
        }}>
          <span style={{ color: 'var(--text-subtle)', fontSize: '16px' }}>⌕</span>
          <input
            type="search"
            placeholder="Search indexed symbols, functions, or files..."
            aria-label="Search indexed code"
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: '14px',
              color: 'var(--text)',
              flex: 1,
              fontFamily: 'inherit',
            }}
          />
          <kbd style={{
            fontSize: '11px',
            color: 'var(--text-subtle)',
            background: 'var(--bg-card-hover)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            padding: '2px 6px',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
          }}>
            ⌘K
          </kbd>
        </div>
      </div>

      {/* 4-stat grid */}
      <div className="stat-grid-4">
        <div className="stat-card">
          <div className="stat-card-label">Total Vectors</div>
          <div className="stat-card-value">
            {totalVectors > 0 ? totalVectors.toLocaleString() : '—'}
          </div>
          <div className="stat-card-change">{repos.length} repositories indexed</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">Storage Used</div>
          <div className="stat-card-value">
            {storageUsedMB > 0 ? `${storageUsedMB.toFixed(1)} MB` : '—'}
          </div>
          <div style={{ marginTop: '6px' }}>
            <div className="progress-bar-wrap" style={{ margin: '4px 0 6px' }}>
              <div className="progress-bar-fill" style={{ width: `${storagePct}%` }} />
            </div>
            <div className="stat-card-change">{storagePct}% of {storageCapMB} MB</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">Tokens Processed</div>
          <div className="stat-card-value">
            {tokensProcessed > 0 ? (tokensProcessed / 1000).toFixed(0) + 'K' : '—'}
          </div>
          <div className="stat-card-change">
            Est. cost ${estCost.toFixed(4)}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">Index Health</div>
          <div className="stat-card-value" style={{ color: indexHealth > 90 ? 'var(--green)' : indexHealth > 70 ? 'var(--yellow)' : 'var(--red)' }}>
            {indexHealth > 0 ? `${indexHealth}%` : '—'}
          </div>
          <div className="stat-card-change positive">
            {indexHealth > 90 ? 'All shards healthy' : indexHealth > 70 ? 'Some issues' : 'No data'}
          </div>
        </div>
      </div>

      {/* Two-column: indexed branches table + vector usage panel */}
      <div className="two-col">
        <div>
          {/* Indexed Branches table */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2>Indexed Branches</h2>
                <p>{repos.length} repositories</p>
              </div>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Repository / Branch</th>
                    <th>Commit Hash</th>
                    <th>Vectors</th>
                    <th>Last Indexed</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {repos.length === 0 ? (
                    <tr className="empty-row">
                      <td colSpan={5}>No repositories indexed yet.</td>
                    </tr>
                  ) : (
                    repos.map(repo => {
                      const mockHash = (repo.id.replace(/-/g, '').slice(0, 8));
                      const mockVectors = (38520 + (repo.id.charCodeAt(0) * 100 % 10000)).toLocaleString();
                      return (
                        <tr key={repo.id}>
                          <td>
                            <div className="col-primary" style={{ fontSize: '13px', marginBottom: '2px' }}>
                              {repo.fullName}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>
                              {repo.defaultBranch || 'main'}
                            </div>
                          </td>
                          <td>
                            <code style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '11px',
                              background: 'var(--bg-card-hover)',
                              border: '1px solid var(--border)',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              color: 'var(--text-muted)',
                            }}>
                              {mockHash}
                            </code>
                          </td>
                          <td style={{ color: 'var(--text)', fontWeight: 500 }}>{mockVectors}</td>
                          <td style={{ color: 'var(--text-subtle)', fontSize: '12px' }}>
                            {timeAgo(repo.updatedAt)}
                          </td>
                          <td>
                            <button className="btn btn-ghost btn-sm" type="button">
                              Re-index
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Index log terminal */}
          <div className="terminal-panel">
            <div className="terminal-header">
              <div className="terminal-dots">
                <span className="terminal-dot" style={{ background: '#f85149' }} />
                <span className="terminal-dot" style={{ background: '#d29922' }} />
                <span className="terminal-dot" style={{ background: '#3fb950' }} />
              </div>
              <span className="terminal-title">Index Log</span>
              <span style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>Last run</span>
            </div>
            <div className="terminal-body">
              {LOG_LINES.map((line, i) => (
                <div key={i} className="log-line">
                  <span className="log-time">{line.time}</span>
                  <span className={`log-level-${line.level}`}>
                    [{line.level.toUpperCase()}]
                  </span>
                  <span>{line.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel: Vector Usage */}
        <div>
          <div className="card">
            <div className="card-header">
              <h2>Vector Usage</h2>
              <p>By file type</p>
            </div>
            <div className="card-body">
              {/* Bar chart */}
              <div className="bar-chart-row">
                {VECTOR_USAGE.map(seg => (
                  <div
                    key={seg.label}
                    className="bar-chart-seg"
                    style={{ width: `${seg.pct}%`, background: seg.color }}
                    title={`${seg.label}: ${seg.pct}%`}
                  />
                ))}
              </div>

              {/* Legend */}
              <div className="bar-chart-legend">
                {VECTOR_USAGE.map(seg => (
                  <div key={seg.label} className="bar-chart-legend-item">
                    <div className="bar-chart-legend-left">
                      <span className="bar-chart-legend-dot" style={{ background: seg.color }} />
                      {seg.label}
                    </div>
                    <span className="bar-chart-legend-pct">{seg.pct}%</span>
                  </div>
                ))}
              </div>

              <div style={{
                marginTop: '16px',
                padding: '10px 12px',
                background: 'var(--bg-card-hover)',
                borderRadius: '6px',
                fontSize: '12px',
                color: 'var(--text-muted)',
              }}>
                Monthly limit resets in <strong style={{ color: 'var(--text)' }}>18 days</strong>
              </div>

              <button
                className="btn btn-secondary"
                type="button"
                style={{ width: '100%', justifyContent: 'center', marginTop: '12px', fontSize: '12px' }}
              >
                View Detailed Analytics
              </button>
            </div>
          </div>

          {/* Quick index stats */}
          <div className="card">
            <div className="card-header">
              <h2>Current Index</h2>
              <span className="inline-badge inline-badge-green">
                <span style={{ width: 6, height: 6, background: 'var(--green)', borderRadius: '50%', display: 'inline-block' }} />
                Healthy
              </span>
            </div>
            <div className="card-body">
              <div className="index-status-panel" style={{ padding: 0, border: 'none', background: 'transparent' }}>
                <div className="index-status-row">
                  <span className="index-status-key">Vectors</span>
                  <span className="index-status-val">
                    {totalVectors > 0 ? totalVectors.toLocaleString() : '—'}
                  </span>
                </div>
                <div className="index-status-row">
                  <span className="index-status-key">Last Sync</span>
                  <span className="index-status-val">
                    {repos.length > 0 && repos[0].updatedAt ? timeAgo(repos[0].updatedAt) : '—'}
                  </span>
                </div>
                <div className="index-status-row">
                  <span className="index-status-key">Storage</span>
                  <span className="index-status-val">
                    {storageUsedMB > 0 ? `${storageUsedMB.toFixed(1)} MB` : '—'}
                  </span>
                </div>
                <div className="index-status-row">
                  <span className="index-status-key">Health</span>
                  <span className="index-status-val" style={{ color: indexHealth > 90 ? 'var(--green)' : 'var(--yellow)' }}>
                    {indexHealth > 0 ? `${indexHealth}%` : '—'}
                  </span>
                </div>
              </div>

              <button
                className="btn btn-primary"
                type="button"
                style={{ width: '100%', justifyContent: 'center', marginTop: '16px', fontSize: '12px' }}
              >
                Trigger Re-index
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
