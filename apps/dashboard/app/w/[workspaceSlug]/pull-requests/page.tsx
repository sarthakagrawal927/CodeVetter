import { notFound } from 'next/navigation';
import { ReviewTriggerForm } from '../../../../components/review-trigger-form';
import { getWorkspaceBySlug, platformFetch } from '../../../../lib/platform';

type PullRequestRow = {
  id: string;
  repositoryId: string;
  prNumber: number;
  title?: string;
  state: string;
  headSha?: string;
};

type EnrichedPR = PullRequestRow & { repositoryFullName: string };

function StatusBadge({ state }: { state: string }) {
  const s = state.toLowerCase();
  let cls = 'badge badge-open';
  let label = state;

  if (s === 'open') { cls = 'badge badge-reviewing'; label = 'Reviewing'; }
  else if (s === 'closed') { cls = 'badge badge-closed'; label = 'Closed'; }
  else if (s === 'merged') { cls = 'badge badge-approved'; label = 'Approved'; }
  else if (s === 'draft') { cls = 'badge badge-draft'; label = 'Draft'; }
  else if (s === 'changes_requested') { cls = 'badge badge-changes-requested'; label = 'Changes Requested'; }
  else if (s === 'approved') { cls = 'badge badge-approved'; label = 'Approved'; }
  else if (s === 'pending') { cls = 'badge badge-pending'; label = 'Pending'; }

  return (
    <span className={cls}>
      <span className="badge-dot" />
      {label}
    </span>
  );
}

function AvatarStack({ names }: { names: string[] }) {
  return (
    <div className="avatar-stack">
      {names.slice(0, 3).map((name, i) => (
        <div key={i} className="av" title={name}>
          {name.slice(0, 1).toUpperCase()}
        </div>
      ))}
    </div>
  );
}

export default async function WorkspacePullRequestsPage({
  params
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) {
    notFound();
  }

  const repositoriesResponse = await platformFetch<{
    repositories: Array<{ id: string; fullName: string }>;
  }>(`/v1/workspaces/${encodeURIComponent(workspace.id)}/repositories`);

  const pullRequestsNested = await Promise.all(
    repositoriesResponse.repositories.map(async repository => {
      const response = await platformFetch<{ pullRequests: PullRequestRow[] }>(
        `/v1/repositories/${encodeURIComponent(repository.id)}/pull-requests`
      );
      return response.pullRequests.map(pr => ({
        ...pr,
        repositoryFullName: repository.fullName
      }));
    })
  );

  const pullRequests: EnrichedPR[] = pullRequestsNested
    .flat()
    .sort((a, b) => b.prNumber - a.prNumber);

  const PAGE_SIZE = 10;
  const displayPRs = pullRequests.slice(0, PAGE_SIZE);

  return (
    <>
      {/* Page header */}
      <div className="page-header">
        <div className="page-header-left">
          <h1>Pull Requests</h1>
          <p>Monitor ingested pull requests and trigger manual re-reviews.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-row">
        <button className="tab-btn active" type="button">All</button>
        <button className="tab-btn" type="button">Created by me</button>
        <button className="tab-btn" type="button">Needs my review</button>
        <button className="tab-filter-btn" type="button">
          <span>⊞</span> Filter
        </button>
      </div>

      {/* Table */}
      <div className="card">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>PR Title</th>
                <th>Repository</th>
                <th>Author</th>
                <th>Reviewers</th>
                <th>Status</th>
                <th>Head SHA</th>
              </tr>
            </thead>
            <tbody>
              {displayPRs.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={6}>
                    No pull requests ingested yet. Trigger webhook deliveries to populate data.
                  </td>
                </tr>
              ) : (
                displayPRs.map(pr => (
                  <tr key={pr.id}>
                    <td>
                      <div className="col-primary" style={{ fontSize: '13px', marginBottom: '2px' }}>
                        {pr.title || `PR #${pr.prNumber}`}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>
                        #{pr.prNumber}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        {pr.repositoryFullName}
                      </span>
                    </td>
                    <td>
                      <div className="av-single" title="Author">A</div>
                    </td>
                    <td>
                      <AvatarStack names={['R1', 'R2']} />
                    </td>
                    <td>
                      <StatusBadge state={pr.state} />
                    </td>
                    <td>
                      <span className="col-mono">
                        {pr.headSha ? pr.headSha.slice(0, 8) : '—'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pullRequests.length > 0 && (
          <div className="pagination-row">
            <span>
              Showing 1–{displayPRs.length} of {pullRequests.length} pull requests
            </span>
            <div className="pagination-btns">
              <button className="pagination-btn" disabled type="button">Previous</button>
              <button
                className="pagination-btn"
                disabled={pullRequests.length <= PAGE_SIZE}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Review trigger form */}
      <div style={{ marginTop: '24px' }}>
        <div className="card">
          <div className="card-header">
            <h2>Trigger Review</h2>
            <p>Manually trigger a re-review for any pull request</p>
          </div>
          <div className="card-body">
            <ReviewTriggerForm
              pullRequests={pullRequests.map(pr => ({
                id: pr.id,
                prNumber: pr.prNumber,
                title: pr.title
              }))}
            />
          </div>
        </div>
      </div>
    </>
  );
}
