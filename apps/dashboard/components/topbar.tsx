'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type TopbarProps = {
  workspaceSlug: string;
};

const PAGE_LABELS: Record<string, string> = {
  overview: 'Overview',
  repositories: 'Repositories',
  'pull-requests': 'Pull Requests',
  'indexed-code': 'Indexed Code',
  members: 'Members',
  audit: 'Audit'
};

export function Topbar({ workspaceSlug }: TopbarProps) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  // segments: ['w', workspaceSlug, ...rest]
  const rest = segments.slice(2);
  const currentSegment = rest[rest.length - 1] ?? '';
  const pageName = PAGE_LABELS[currentSegment] ?? currentSegment;

  return (
    <header className="topbar">
      <nav className="topbar-breadcrumb" aria-label="Breadcrumb">
        <Link href={`/w/${workspaceSlug}/overview`}>{workspaceSlug}</Link>
        <span className="crumb-sep">›</span>
        <span className="crumb-current">{pageName}</span>
      </nav>

      <div className="topbar-spacer" />

      <div className="topbar-search">
        <span className="topbar-search-icon">⌕</span>
        <input type="search" placeholder="Search..." aria-label="Search" />
      </div>

      <button className="topbar-icon-btn" aria-label="Notifications" type="button">
        🔔
      </button>

      <a
        href="https://docs.github.com"
        target="_blank"
        rel="noopener noreferrer"
        className="topbar-icon-btn"
        aria-label="Help"
      >
        ?
      </a>
    </header>
  );
}
