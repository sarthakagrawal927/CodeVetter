'use client';
import { useEffect, useRef } from 'react';

const GITHUB_URL = 'https://github.com/sarthakagrawal927/CodeVetter';
const DOWNLOAD_URL = 'https://github.com/sarthakagrawal927/CodeVetter/releases/latest';

function useFadeIn() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('visible');
          obs.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function FeatureCard({ icon, iconBg, title, body }) {
  const ref = useFadeIn();
  return (
    <div className="feature-card fade-up" ref={ref}>
      <div className="feature-icon" style={{ background: iconBg }}>{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function Step({ number, title, body }) {
  const ref = useFadeIn();
  return (
    <div className="step fade-up" ref={ref}>
      <div className="step-number">{number}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

export default function LandingPage() {
  const featuresRef = useFadeIn();
  const stepsRef = useFadeIn();
  const techRef = useFadeIn();
  const ctaRef = useFadeIn();

  return (
    <>
      {/* ============ NAV ============ */}
      <nav className="nav">
        <div className="nav-inner">
          <div className="nav-logo">
            <div className="nav-logo-icon">CV</div>
            CodeVetter
          </div>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#download">Download</a>
          </div>
          <div className="nav-actions">
            <a href={GITHUB_URL} className="btn btn-ghost" target="_blank" rel="noopener noreferrer">
              <span className="btn-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              </span>
              GitHub
            </a>
            <a href={DOWNLOAD_URL} className="btn btn-primary">Download</a>
          </div>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <section className="hero">
        <div className="hero-badge">
          <span className="hero-badge-dot" />
          macOS desktop app
        </div>
        <h1>AI agents that <span className="hero-highlight">actually ship code</span></h1>
        <p className="hero-sub">
          CodeVetter orchestrates AI coding agents in isolated workspaces. Review findings, manage PRs, and track progress — all from one desktop app.
        </p>
        <div className="hero-actions">
          <a href={DOWNLOAD_URL} className="btn btn-primary btn-lg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download for macOS
          </a>
          <a href={GITHUB_URL} className="btn btn-secondary btn-lg" target="_blank" rel="noopener noreferrer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            View on GitHub
          </a>
        </div>

        <div className="hero-screenshot">
          <div className="hero-screenshot-titlebar">
            <span className="hero-screenshot-dot red" />
            <span className="hero-screenshot-dot yellow" />
            <span className="hero-screenshot-dot green" />
            <span className="hero-screenshot-title">CodeVetter — workspace</span>
          </div>
          <div className="hero-screenshot-body">
            App screenshot placeholder
          </div>
        </div>
      </section>

      <hr className="divider" />

      {/* ============ FEATURES ============ */}
      <section className="section" id="features">
        <div className="section-header fade-up" ref={featuresRef}>
          <span className="section-label">Features</span>
          <h2>Everything you need to ship faster</h2>
          <p>A desktop app that combines AI agents, code review, and project management in one workspace.</p>
        </div>
        <div className="feature-grid">
          <FeatureCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>}
            iconBg="var(--amber-dim)"
            title="Workspaces"
            body="Branch-based workspaces with built-in chat, terminal, file explorer, and PR management. Each workspace is an isolated coding environment."
          />
          <FeatureCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>}
            iconBg="rgba(168, 85, 247, 0.15)"
            title="Agent Squad"
            body="Define AI personas for different roles — security auditor, backend architect, test writer. Assign tasks and watch them work autonomously."
          />
          <FeatureCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>}
            iconBg="rgba(34, 197, 94, 0.15)"
            title="Code Review"
            body="AI-powered review with severity triage, code suggestions, and one-click GitHub posting. Better than GitHub's built-in review."
          />
          <FeatureCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><line x1="14" y1="4" x2="10" y2="20"/></svg>}
            iconBg="rgba(59, 130, 246, 0.15)"
            title="Multi-Agent Coordination"
            body="CRDT-based coordination ensures agents don't duplicate work. File claiming, live progress indicators, and cleanly merged results."
          />
          <FeatureCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>}
            iconBg="var(--amber-dim)"
            title="Task Board"
            body="Kanban board with Linear integration. Import issues, assign to agent personas, track from To Do to Done — all without leaving the app."
          />
          <FeatureCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>}
            iconBg="rgba(168, 85, 247, 0.15)"
            title="Session Analytics"
            body="Track token usage, costs, and session history across Claude Code, Codex, and other AI tools. Know exactly what your agents are doing."
          />
        </div>
      </section>

      <hr className="divider" />

      {/* ============ HOW IT WORKS ============ */}
      <section className="section" id="how-it-works">
        <div className="section-header fade-up" ref={stepsRef}>
          <span className="section-label">How It Works</span>
          <h2>From branch to merged PR in minutes</h2>
          <p>Three steps to go from idea to shipped code with AI agents handling the heavy lifting.</p>
        </div>
        <div className="steps-grid">
          <div className="steps-connector" />
          <Step
            number="1"
            title="Create a workspace"
            body="Start from a branch, PR, or blank slate. Each workspace gets its own terminal, file explorer, and chat session."
          />
          <Step
            number="2"
            title="Chat or assign agents"
            body="Talk directly to Claude or dispatch tasks to specialized agent personas — security auditor, architect, test writer."
          />
          <Step
            number="3"
            title="Review and merge"
            body="Review AI findings with severity triage, accept suggestions, create PRs, and merge — all without leaving the app."
          />
        </div>
      </section>

      <hr className="divider" />

      {/* ============ TECH / INTEGRATIONS ============ */}
      <section className="section">
        <div className="section-header fade-up" ref={techRef}>
          <span className="section-label">Integrations</span>
          <h2>Built on the tools you already use</h2>
        </div>
        <div className="tech-row">
          <span className="tech-pill">
            <span className="tech-pill-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            </span>
            GitHub
          </span>
          <span className="tech-pill">
            <span className="tech-pill-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
            </span>
            Claude Code
          </span>
          <span className="tech-pill">
            <span className="tech-pill-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </span>
            Codex
          </span>
          <span className="tech-pill">
            <span className="tech-pill-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </span>
            Linear
          </span>
          <span className="tech-pill">
            <span className="tech-pill-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 12l2 2 4-4"/></svg>
            </span>
            Playwright
          </span>
          <span className="tech-pill">
            <span className="tech-pill-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </span>
            Tauri + React + Rust
          </span>
        </div>
      </section>

      <hr className="divider" />

      {/* ============ DOWNLOAD CTA ============ */}
      <section className="cta-section" id="download">
        <div className="cta-box fade-up" ref={ctaRef}>
          <span className="section-label">Get Started</span>
          <h2>Download CodeVetter</h2>
          <p>Free and open source. Built for engineers who ship with AI.</p>
          <div className="cta-actions">
            <a href={DOWNLOAD_URL} className="btn btn-primary btn-lg">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download for macOS
            </a>
            <a href={GITHUB_URL} className="btn btn-secondary btn-lg" target="_blank" rel="noopener noreferrer">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .3z"/></svg>
              Star on GitHub
            </a>
          </div>
          <p className="cta-requirements">Requires macOS 12+ and Claude Code CLI installed</p>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <div className="nav-logo-icon" style={{ width: 22, height: 22, fontSize: '0.55rem' }}>CV</div>
            <span className="footer-brand-name">CodeVetter</span>
          </div>
          <span className="footer-copy">Built by Sarthak Agrawal</span>
          <div className="footer-links">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="#">Documentation</a>
            <a href="#">Changelog</a>
          </div>
        </div>
      </footer>
    </>
  );
}
