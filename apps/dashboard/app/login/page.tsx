import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getPlatformApiBaseUrl, getSession } from '../../lib/platform';

export default async function LoginPage() {
  const session = await getSession();
  if (session.authenticated && session.workspaces.length > 0) {
    redirect(`/w/${session.workspaces[0].slug}/overview`);
  }

  const startUrl = `${getPlatformApiBaseUrl()}/v1/auth/github/start?redirectTo=/onboarding`;

  return (
    <main className="lsp-root">
      {/* ── Left: visual panel ── */}
      <div className="lsp-left">
        <div className="lsp-brand">
          <div className="lsp-mark">CV</div>
          <span className="lsp-brand-text">CodeVetter</span>
        </div>

        <div className="lsp-window">
          <div className="lsp-win-bar">
            <div className="lsp-win-dots">
              <span className="lsp-dot" style={{ background: '#ff5f57' }} />
              <span className="lsp-dot" style={{ background: '#ffbd2e' }} />
              <span className="lsp-dot" style={{ background: '#28c840' }} />
            </div>
            <span className="lsp-win-title">auth.service.ts — PR #247</span>
          </div>

          <div className="lsp-win-body">
            <div className="lsp-line lsp-ctx" style={{ '--i': 0 } as React.CSSProperties}>
              <span className="lsp-ln">1</span>
              <span className="lsp-code">
                <span className="lsp-kw">async function</span>{' '}
                <span className="lsp-fn">validateUser</span>
                <span className="lsp-pn">(</span>
                <span className="lsp-id">id</span>
                <span className="lsp-pn">:</span>{' '}
                <span className="lsp-ty">string</span>
                <span className="lsp-pn">) {'{'}</span>
              </span>
            </div>
            <div className="lsp-line lsp-add" style={{ '--i': 1 } as React.CSSProperties}>
              <span className="lsp-ln">2</span>
              <span className="lsp-code">
                <span className="lsp-diff-mark lsp-add-mark">+</span>
                {'  '}
                <span className="lsp-kw">if</span>
                <span className="lsp-pn"> (!</span>
                <span className="lsp-id">id</span>
                <span className="lsp-pn">.</span>
                <span className="lsp-fn">trim</span>
                <span className="lsp-pn">())</span>{' '}
                <span className="lsp-kw">throw new</span>{' '}
                <span className="lsp-ty">Error</span>
                <span className="lsp-pn">(</span>
                <span className="lsp-str">'id required'</span>
                <span className="lsp-pn">);</span>
              </span>
            </div>
            <div className="lsp-line lsp-ctx" style={{ '--i': 2 } as React.CSSProperties}>
              <span className="lsp-ln">3</span>
              <span className="lsp-code">
                {'  '}
                <span className="lsp-kw">const</span>{' '}
                <span className="lsp-id">user</span>{' '}
                <span className="lsp-op">=</span>{' '}
                <span className="lsp-kw">await</span>{' '}
                <span className="lsp-id">db</span>
                <span className="lsp-pn">.</span>
                <span className="lsp-fn">findById</span>
                <span className="lsp-pn">(</span>
                <span className="lsp-id">id</span>
                <span className="lsp-pn">);</span>
              </span>
            </div>
            <div className="lsp-line lsp-rm" style={{ '--i': 3 } as React.CSSProperties}>
              <span className="lsp-ln">4</span>
              <span className="lsp-code">
                <span className="lsp-diff-mark lsp-rm-mark">-</span>
                {'  '}
                <span className="lsp-kw">return</span>{' '}
                <span className="lsp-id">user</span>
                <span className="lsp-pn">;</span>
              </span>
            </div>
            <div className="lsp-line lsp-add" style={{ '--i': 4 } as React.CSSProperties}>
              <span className="lsp-ln">5</span>
              <span className="lsp-code">
                <span className="lsp-diff-mark lsp-add-mark">+</span>
                {'  '}
                <span className="lsp-kw">return</span>{' '}
                <span className="lsp-id">user</span>{' '}
                <span className="lsp-op">??</span>{' '}
                <span className="lsp-kw">null</span>
                <span className="lsp-pn">;</span>
              </span>
            </div>
            <div className="lsp-line lsp-ctx" style={{ '--i': 5 } as React.CSSProperties}>
              <span className="lsp-ln">6</span>
              <span className="lsp-code">
                <span className="lsp-pn">{'}'}</span>
              </span>
            </div>
          </div>

          <div className="lsp-annotations">
            <div className="lsp-ann lsp-ann-ok">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
              </svg>
              <span>Null check prevents runtime crash — looks good</span>
            </div>
            <div className="lsp-ann lsp-ann-info">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/>
              </svg>
              <span>Optional chaining <span className="lsp-code-inline">user?.id</span> also valid here</span>
            </div>
          </div>
        </div>

        <div className="lsp-stats">
          <div className="lsp-stat">
            <span className="lsp-stat-val">2.4k</span>
            <span className="lsp-stat-label">Reviews run</span>
          </div>
          <div className="lsp-stat-sep" />
          <div className="lsp-stat">
            <span className="lsp-stat-val">128</span>
            <span className="lsp-stat-label">Workspaces</span>
          </div>
          <div className="lsp-stat-sep" />
          <div className="lsp-stat">
            <span className="lsp-stat-val">&lt;60s</span>
            <span className="lsp-stat-label">Avg review</span>
          </div>
        </div>
      </div>

      {/* ── Right: auth panel ── */}
      <div className="lsp-right">
        <div className="lsp-auth-card">
          <div className="lsp-auth-mark">CV</div>
          <h1 className="lsp-auth-title">Welcome back</h1>
          <p className="lsp-auth-sub">Sign in to your review control plane</p>

          <a href={startUrl} className="lsp-github-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Continue with GitHub
          </a>

          <Link href="/" className="lsp-back">← Back to home</Link>
        </div>
      </div>
    </main>
  );
}
