'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavItem = {
  label: string;
  href: string;
  icon: string;
  badge?: string | number;
};

type SidebarProps = {
  workspaceSlug: string;
  workspaceName: string;
  userLogin: string;
  prCount?: number;
};

export function Sidebar({ workspaceSlug, workspaceName, userLogin, prCount }: SidebarProps) {
  const pathname = usePathname();
  const prefix = `/w/${workspaceSlug}`;

  const navItems: NavItem[] = [
    { label: 'Overview', href: `${prefix}/overview`, icon: '⬡' },
    { label: 'Repositories', href: `${prefix}/repositories`, icon: '⊡' },
    {
      label: 'Pull Requests',
      href: `${prefix}/pull-requests`,
      icon: '⤴',
      badge: prCount && prCount > 0 ? prCount : undefined
    },
    { label: 'Indexed Code', href: `${prefix}/indexed-code`, icon: '◈' },
    { label: 'Settings', href: `${prefix}/settings/members`, icon: '⚙' }
  ];

  const initials = workspaceName
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const userInitials = userLogin.slice(0, 2).toUpperCase();

  return (
    <nav className="sidebar">
      {/* Workspace header */}
      <div className="sidebar-header">
        <div className="sidebar-workspace-row">
          <div className="sidebar-logo">{initials}</div>
          <div className="sidebar-workspace-info">
            <div className="sidebar-workspace-name">{workspaceName}</div>
            <div className="sidebar-workspace-plan">Pro Plan</div>
          </div>
          <span className="sidebar-chevron">&#8964;</span>
        </div>
      </div>

      {/* Navigation */}
      <div className="sidebar-nav">
        <div className="sidebar-nav-label">Navigation</div>
        {navItems.map(item => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={`sidebar-nav-link${isActive ? ' active' : ''}`}>
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
              {item.badge !== undefined && <span className="sidebar-badge">{item.badge}</span>}
            </Link>
          );
        })}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <Link href={`${prefix}/repositories`} className="sidebar-new-project-btn">
          <span>+</span> New Project
        </Link>
        <div className="sidebar-user-row">
          <div className="sidebar-avatar">{userInitials}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{userLogin}</div>
            <div className="sidebar-user-action">View Profile</div>
          </div>
        </div>
      </div>
    </nav>
  );
}
