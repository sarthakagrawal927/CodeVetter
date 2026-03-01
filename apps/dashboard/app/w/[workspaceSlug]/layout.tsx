import { notFound, redirect } from 'next/navigation';
import { Sidebar } from '../../../components/sidebar';
import { Topbar } from '../../../components/topbar';
import { getSession, getWorkspaceBySlug } from '../../../lib/platform';

export default async function WorkspaceLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const session = await getSession();

  if (!session.authenticated || !session.user) {
    redirect('/login');
  }

  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) {
    notFound();
  }

  const userLogin = session.user.githubLogin || session.user.displayName || 'User';

  return (
    <div className="workspace-shell">
      <Sidebar
        workspaceSlug={workspace.slug}
        workspaceName={workspace.name}
        userLogin={userLogin}
      />
      <div className="workspace-main">
        <Topbar workspaceSlug={workspace.slug} />
        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
