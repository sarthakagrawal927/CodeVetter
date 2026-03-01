import { notFound } from 'next/navigation';
import { GitHubSyncForm } from '../../../../components/github-sync-form';
import { RepositoryIndexingForm } from '../../../../components/repository-indexing-form';
import { getWorkspaceBySlug, platformFetch } from '../../../../lib/platform';

type Repo = {
  id: string;
  fullName: string;
  defaultBranch?: string;
  installationId?: string;
  updatedAt: string;
};

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f7df1e',
  Python: '#3572A5',
  Go: '#00add8',
  Rust: '#dea584',
  Ruby: '#701516',
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

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  let cls = 'badge badge-indexed';
  if (s === 'syncing') cls = 'badge badge-syncing';
  else if (s === 'archived') cls = 'badge badge-archived';
  else if (s === 'pending') cls = 'badge badge-pending';
  return (
    <span className={cls}>
      <span className="badge-dot" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default async function WorkspaceRepositoriesPage({
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
  const PAGE_SIZE = 6;
  const displayRepos = repos.slice(0, PAGE_SIZE);

  return (
    <>
      {/* Page header */}
      <div className="page-header">
        <div className="page-header-left">
          <h1>Repositories</h1>
          <p>Manage connected repositories and indexing for this workspace.</p>
        </div>
      </div>

      {/* Controls */}
      <div className="controls-row">
        <div className="search-input-wrap">
          <span style={{ color: 'var(--text-subtle)', fontSize: '13px' }}>⌕</span>
          <input type="search" placeholder="Search repositories..." aria-label="Search repositories" />
        </div>
        <select className="filter-select" aria-label="Filter by language">
          <option>All Languages</option>
          <option>TypeScript</option>
          <option>JavaScript</option>
          <option>Python</option>
          <option>Go</option>
        </select>
        <select className="filter-select" aria-label="Filter by status">
          <option>All Statuses</option>
          <option>Indexed</option>
          <option>Syncing</option>
          <option>Archived</option>
          <option>Pending</option>
        </select>
      </div>

      {/* Repo grid */}
      {repos.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '48px 20px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📭</div>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 16px', fontSize: '14px' }}>
              No repositories connected yet.
            </p>
            <p style={{ color: 'var(--text-subtle)', margin: 0, fontSize: '13px' }}>
              Use the sync form below to connect your GitHub repositories.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="repo-grid" style={{ marginBottom: '16px' }}>
            {displayRepos.map(repo => {
              const nameParts = repo.fullName.split('/');
              const name = nameParts[nameParts.length - 1] ?? repo.fullName;
              const lang = 'TypeScript';
              const status = repo.installationId ? 'Indexed' : 'Pending';
              return (
                <div key={repo.id} className="repo-card">
                  <div className="repo-card-header">
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', minWidth: 0 }}>
                      <div className="repo-card-icon">📁</div>
                      <div style={{ minWidth: 0 }}>
                        <div className="repo-card-name">{name}</div>
                        <div className="repo-card-path">{repo.fullName}</div>
                      </div>
                    </div>
                    <StatusBadge status={status} />
                  </div>
                  <div className="repo-card-desc" style={{ marginTop: '8px' }}>
                    Default branch:{' '}
                    <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--blue)' }}>
                      {repo.defaultBranch || 'main'}
                    </code>
                  </div>
                  <div className="repo-card-footer">
                    <div className="repo-card-meta">
                      <span className="repo-card-meta-item">
                        <span className="lang-dot" style={{ background: LANG_COLORS[lang] }} />
                        {lang}
                      </span>
                      <span className="repo-card-meta-item" style={{ fontSize: '11px' }}>
                        ★ —
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>
                      Synced {timeAgo(repo.updatedAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="card">
            <div className="pagination-row">
              <span>Showing 1–{displayRepos.length} of {repos.length} repositories</span>
              <div className="pagination-btns">
                <button className="pagination-btn" disabled type="button">Previous</button>
                <button
                  className="pagination-btn"
                  disabled={repos.length <= PAGE_SIZE}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Connect / sync forms */}
      <div style={{ marginTop: '24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <GitHubSyncForm workspaceId={workspace.id} />
        <RepositoryIndexingForm
          workspaceId={workspace.id}
          repositories={repos.map(r => ({ id: r.id, fullName: r.fullName }))}
        />
      </div>
    </>
  );
}
