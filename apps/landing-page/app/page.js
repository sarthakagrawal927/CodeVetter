'use client';

const GITHUB_URL = 'https://github.com/sarthakagrawal927/CodeVetter';
const DOWNLOAD_URL = 'https://github.com/sarthakagrawal927/CodeVetter/releases/latest';

export default function LandingPage() {
  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <div className="nav-logo">
            <div className="nav-logo-icon">CV</div>
            CodeVetter
          </div>
          <div className="nav-actions">
            <a href={GITHUB_URL} className="btn btn-ghost" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a href={DOWNLOAD_URL} className="btn btn-primary">Download</a>
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-badge">
          <span className="hero-badge-dot" />
          Free &middot; macOS
        </div>
        <h1>The quality gate for <span className="hero-highlight">AI-generated code</span></h1>
        <p className="hero-sub">
          CodeVetter reviews code from AI agents, catches bloat and hallucinated APIs,
          and sends findings back to the agent to fix. Locally or on GitHub PRs.
        </p>
        <div className="hero-actions">
          <a href={DOWNLOAD_URL} className="btn btn-primary btn-lg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download for macOS
          </a>
          <a href={GITHUB_URL} className="btn btn-secondary btn-lg" target="_blank" rel="noopener noreferrer">
            View Source
          </a>
        </div>
      </section>

      <hr className="divider" />

      <section className="section">
        <div className="feature-grid">
          <div className="feature-card">
            <h3>Review agent code</h3>
            <p>Runs AI-powered review on local diffs or GitHub PRs. Catches over-engineering, copy-paste, hallucinated APIs, and hardcoded secrets.</p>
          </div>
          <div className="feature-card">
            <h3>Feedback loop</h3>
            <p>When review fails, findings are sent back to the agent as fix instructions. Re-reviews automatically until the code passes or max attempts hit.</p>
          </div>
          <div className="feature-card">
            <h3>Orchestrate agents</h3>
            <p>Kanban board with agent personas. Assign tasks, track progress, manage concurrency. Plan, code, review pipeline runs autonomously.</p>
          </div>
        </div>
      </section>

      <hr className="divider" />

      <section className="cta-section" id="download">
        <div className="cta-box">
          <h2>Ship better code with AI agents</h2>
          <p>Free, open source, runs offline. Requires macOS 12+ and an AI provider API key.</p>
          <div className="cta-actions">
            <a href={DOWNLOAD_URL} className="btn btn-primary btn-lg">
              Download for macOS
            </a>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <div className="nav-logo-icon" style={{ width: 22, height: 22, fontSize: '0.55rem' }}>CV</div>
            <span className="footer-brand-name">CodeVetter</span>
          </div>
          <span className="footer-copy">Built by Sarthak Agrawal</span>
          <div className="footer-links">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>
        </div>
      </footer>
    </>
  );
}
