import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getWorkspaceBySlug, platformFetch } from '../../../../lib/platform';

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  let cls = 'badge badge-indexed';
  if (s === 'syncing') cls = 'badge badge-syncing';
  else if (s === 'archived') cls = 'badge badge-archived';
  else if (s === 'pending') cls = 'badge badge-pending';
  else if (s === 'open') cls = 'badge badge-open';
  else if (s === 'closed') cls = 'badge badge-closed';

  return (
    <span className={cls}>
      <span className="badge-dot" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

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

export default async function WorkspaceOverviewPage({
  params
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) {
    notFound();
  }

  const [installations, repositories, members] = await Promise.all([
    platformFetch<{
      installations: Array<{
        id: string;
        installationId: string;
        accountType: string;
        accountLogin?: string;
      }>;
    }>(`/v1/workspaces/${encodeURIComponent(workspace.id)}/github/installations`),
    platformFetch<{
      repositories: Array<{
        id: string;
        fullName: string;
        defaultBranch?: string;
        installationId?: string;
        updatedAt?: string;
      }>;
    }>(`/v1/workspaces/${encodeURIComponent(workspace.id)}/repositories`),
    platformFetch<{ members: Array<{ id: string }> }>(
      `/v1/workspaces/${encodeURIComponent(workspace.id)}/members`
    )
  ]);

  const repoCount = repositories.repositories.length;
  const memberCount = members.members.length;
  const installCount = installations.installations.length;

  // Pick 3 recent repos for the display
  const recentRepos = repositories.repositories.slice(0, 3);

  // Mock PR data for display (real PR fetching is on the PR page)
  const mockPRs = [
    { title: 'feat: add vector search endpoint', number: 142, repo: repoCount > 0 ? repositories.repositories[0]?.fullName : 'acme/api', status: 'Reviewing', age: '2h', author: 'dev' },
    { title: 'fix: auth cookie expiry handling', number: 141, repo: repoCount > 0 ? repositories.repositories[0]?.fullName : 'acme/api', status: 'Approved', age: '4h', author: 'ops' },
    { title: 'chore: upgrade next.js to 15.5', number: 140, repo: repoCount > 1 ? repositories.repositories[1]?.fullName : 'acme/web', status: 'Draft', age: '1d', author: 'web' },
    { title: 'refactor: split platform fetch util', number: 139, repo: repoCount > 0 ? repositories.repositories[0]?.fullName : 'acme/api', status: 'Changes Requested', age: '2d', author: 'dev' },
  ];

  const LANG_COLORS: Record<string, string> = {
    TypeScript: '#3178c6',
    JavaScript: '#f7df1e',
    Python: '#3572A5',
    Go: '#00add8',
    Rust: '#dea584',
    Ruby: '#701516',
  };

  return (
    <>
      {/* Stats */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card-label">Repositories</div>
          <div className="stat-card-value">{repoCount}</div>
          <div className="stat-card-change positive">+{installCount} installation{installCount !== 1 ? 's' : ''}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Team Members</div>
          <div className="stat-card-value">{memberCount}</div>
          <div className="stat-card-change">Active contributors</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Avg Review Time</div>
          <div className="stat-card-value">—</div>
          <div className="stat-card-change">No data yet</div>
        </div>
      </div>

      {/* Two-column layout: recent repos + indexing status */}
      <div className="two-col">
        <div>
          {/* Recent Repositories */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2>Recent Repositories</h2>
                <p>{repoCount} connected</p>
              </div>
              <Link href={`/w/${workspaceSlug}/repositories`} className="btn btn-secondary btn-sm">
                View All
              </Link>
            </div>
            <div className="card-body" style={{ padding: '12px 16px', display: 'grid', gap: '12px' }}>
              {recentRepos.length === 0 ? (
                <p style={{ color: 'var(--text-subtle)', fontSize: '13px', margin: 0 }}>
                  No repositories connected yet.{' '}
                  <Link href={`/w/${workspaceSlug}/repositories`} className="muted-link">
                    Connect one
                  </Link>
                </p>
              ) : (
                recentRepos.map(repo => {
                  const nameParts = repo.fullName.split('/');
                  const name = nameParts[nameParts.length - 1] ?? repo.fullName;
                  const lang = 'TypeScript';
                  return (
                    <div key={repo.id} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '12px',
                      paddingBottom: '12px',
                      borderBottom: '1px solid var(--border-subtle)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', minWidth: 0 }}>
                        <div className="repo-card-icon" style={{ marginTop: '2px' }}>📁</div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {name}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {repo.fullName}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
                              <span className="lang-dot" style={{ background: LANG_COLORS[lang] }} />
                              {lang}
                            </span>
                            {repo.updatedAt && (
                              <span style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>
                                Updated {timeAgo(repo.updatedAt)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <StatusBadge status="Indexed" />
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Recent Pull Requests */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2>Recent Pull Requests</h2>
                <p>Latest activity across repositories</p>
              </div>
              <Link href={`/w/${workspaceSlug}/pull-requests`} className="btn btn-secondary btn-sm">
                View All
              </Link>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>PR Name</th>
                    <th>Repo</th>
                    <th>Status</th>
                    <th>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {mockPRs.map(pr => {
                    const statusKey = pr.status.toLowerCase().replace(/\s+/g, '-');
                    return (
                      <tr key={pr.number}>
                        <td>
                          <div className="col-primary" style={{ fontSize: '13px', marginBottom: '2px' }}>{pr.title}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>#{pr.number} opened by {pr.author}</div>
                        </td>
                        <td>
                          <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                            {pr.repo}
                          </span>
                        </td>
                        <td>
                          <span className={`badge badge-${statusKey}`}>
                            <span className="badge-dot" />
                            {pr.status}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-subtle)', fontSize: '12px' }}>{pr.age}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right panel: Indexing Status */}
        <div>
          <div className="card">
            <div className="card-header">
              <div>
                <h2>Indexing Status</h2>
              </div>
              <span className="inline-badge inline-badge-green">
                <span style={{ width: 6, height: 6, background: 'var(--green)', borderRadius: '50%', display: 'inline-block' }} />
                Healthy
              </span>
            </div>
            <div className="card-body">
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  <span>Index coverage</span>
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>
                    {repoCount > 0 ? '82%' : '0%'}
                  </span>
                </div>
                <div className="progress-bar-wrap">
                  <div className="progress-bar-fill green" style={{ width: repoCount > 0 ? '82%' : '0%' }} />
                </div>
              </div>

              <div className="index-status-panel" style={{ padding: 0, border: 'none', background: 'transparent' }}>
                <div className="index-status-row">
                  <span className="index-status-key">Repositories</span>
                  <span className="index-status-val">{repoCount}</span>
                </div>
                <div className="index-status-row">
                  <span className="index-status-key">Installations</span>
                  <span className="index-status-val">{installCount}</span>
                </div>
                <div className="index-status-row">
                  <span className="index-status-key">Members</span>
                  <span className="index-status-val">{memberCount}</span>
                </div>
                <div className="index-status-row">
                  <span className="index-status-key">Last Sync</span>
                  <span className="index-status-val">Just now</span>
                </div>
                <div className="index-status-row">
                  <span className="index-status-key">Workspace</span>
                  <span className="index-status-val">{workspace.slug}</span>
                </div>
              </div>

              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Link href={`/w/${workspaceSlug}/indexed-code`} className="btn btn-secondary" style={{ justifyContent: 'center', fontSize: '12px' }}>
                  View Index Details
                </Link>
                <Link href={`/w/${workspaceSlug}/indexed-code`} className="btn btn-ghost" style={{ justifyContent: 'center', fontSize: '12px' }}>
                  Trigger Re-index
                </Link>
              </div>
            </div>
          </div>

          {/* Quick links */}
          <div className="card">
            <div className="card-header">
              <h2>Quick Links</h2>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: '6px', padding: '12px 16px' }}>
              {[
                { label: 'Manage Repositories', href: `/w/${workspaceSlug}/repositories` },
                { label: 'View Pull Requests', href: `/w/${workspaceSlug}/pull-requests` },
                { label: 'Indexed Code', href: `/w/${workspaceSlug}/indexed-code` },
                { label: 'Manage Members', href: `/w/${workspaceSlug}/settings/members` },
                { label: 'Audit Log', href: `/w/${workspaceSlug}/settings/audit` },
              ].map(link => (
                <Link key={link.href} href={link.href} style={{
                  display: 'block',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: 'var(--text-muted)',
                  textDecoration: 'none',
                  transition: 'background 140ms ease, color 140ms ease',
                  background: 'transparent'
                }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-card-hover)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
                  }}
                >
                  {link.label} →
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
