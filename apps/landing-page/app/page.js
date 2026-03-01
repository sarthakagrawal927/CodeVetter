'use client';
import { useEffect, useRef } from 'react';

const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL || '/login';

function useFadeIn() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add('visible'); obs.disconnect(); } },
      { threshold: 0.15 }
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

export default function LandingPage() {
  const featuresRef = useFadeIn();
  const demoRef = useFadeIn();

  return (
    <>
      <nav className="nav">
        <div className="nav-logo">
          <div className="nav-logo-icon">CR</div>
          CodeReviewAI
        </div>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#integrations">Integrations</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div className="nav-actions">
          <a href={`${DASHBOARD_URL}`} className="btn btn-ghost">Login</a>
          <a href={`${DASHBOARD_URL}`} className="btn btn-primary">Get Started</a>
        </div>
      </nav>

      <section className="hero">
        <div>
          <div className="hero-badge">
            <span className="hero-badge-dot" />
            Now in public beta
          </div>
          <h1>Review Code <span className="hero-highlight">10x Faster</span> with AI</h1>
          <p>Seamlessly integrate with GitHub to automate code quality checks and security scanning before you merge. Inline suggestions, severity scoring, and policy gates — all in your PR workflow.</p>
          <div className="hero-actions">
            <a href={DASHBOARD_URL} className="btn btn-primary btn-lg">Get Started for Free</a>
            <a href="#demo" className="btn btn-secondary btn-lg">▶ Watch Demo</a>
          </div>
          <div className="trust-bar">
            <span className="trust-label">Trusted by engineering teams at</span>
            <div className="trust-logos">
              <span className="trust-logo">ACME</span>
              <span className="trust-logo">Globex</span>
              <span className="trust-logo">Soylent</span>
              <span className="trust-logo">Initech</span>
            </div>
          </div>
        </div>

        <div className="editor-mock">
          <div className="editor-titlebar">
            <span className="editor-dot red" />
            <span className="editor-dot yellow" />
            <span className="editor-dot green" />
            <span className="editor-filename">calculateTotal.ts</span>
          </div>
          <div className="editor-body">
            <div className="code-line line-neutral"><span className="line-num">1</span><span>{'function calculateTotal(items) {'}</span></div>
            <div className="code-line line-neutral"><span className="line-num">2</span><span>{'  let total = 0;'}</span></div>
            <div className="code-line line-del"><span className="line-num">3</span><span>{'- items.forEach(i => total + i.price);'}</span></div>
            <div className="code-line line-add"><span className="line-num">4</span><span>{'+ items.forEach(i => total += i.price);'}</span></div>
            <div className="code-line line-neutral"><span className="line-num">5</span><span>{'  return total;'}</span></div>
            <div className="code-line line-neutral"><span className="line-num">6</span><span>{'}'}</span></div>
            <div className="ai-suggestion">
              <div className="ai-suggestion-head">✦ AI Suggestion</div>
              <div className="ai-suggestion-body">Assignment operator missing — total is never mutated. Use += instead of +.</div>
            </div>
          </div>
        </div>
      </section>

      <hr className="divider" />

      <section className="section" id="features">
        <div className="section-header fade-up" ref={featuresRef}>
          <h2>Why Engineering Teams Love Us</h2>
          <p>Supercharge your code review process with intelligent automation that fits right into your existing workflow.</p>
        </div>
        <div className="feature-grid">
          <FeatureCard icon="🧠" iconBg="rgba(124,58,237,0.15)" title="AI-Powered Insights" body="Get instant inline code suggestions and automated refactoring tips powered by advanced LLMs trained on millions of repositories." />
          <FeatureCard icon="⚡" iconBg="rgba(59,130,246,0.15)" title="Seamless Workflow" body="Integrates directly into your PR workflow on GitHub without adding friction. One YAML block and you're live." />
          <FeatureCard icon="🛡️" iconBg="rgba(34,197,94,0.15)" title="Security First" body="Automated vulnerability scanning ensures your code is secure and compliant before it ever merges to main." />
        </div>
      </section>

      <hr className="divider" />

      <section className="demo-section" id="demo">
        <div className="fade-up" ref={demoRef}>
          <h2>Catch Bugs Before Production</h2>
          <p>Visualizing the impact of automated code analysis on your deployment pipeline.</p>
        </div>
        <div className="demo-grid">
          <div className="demo-code">
            <div className="demo-code-header">calculateTotal.js — changed</div>
            <div className="demo-code-body">
              <div className="code-line line-neutral"><span className="line-num">1</span><span>{'function calculateTotal(items) {'}</span></div>
              <div className="code-line line-neutral"><span className="line-num">2</span><span>{'  let total = 0;'}</span></div>
              <div className="code-line line-del"><span className="line-num" style={{color:'#f85149'}}>-</span><span>{'  items.forEach(i => total + i.price);'}</span></div>
              <div className="code-line line-add"><span className="line-num" style={{color:'#3fb950'}}>+</span><span>{'  items.forEach(i => total += i.price);'}</span></div>
              <div className="code-line line-neutral"><span className="line-num">5</span><span>{'  return total;'}</span></div>
              <div className="code-line line-neutral"><span className="line-num">6</span><span>{'}'}</span></div>
            </div>
          </div>
          <div className="demo-alert">
            <div className="alert-icon">🛡️</div>
            <div className="alert-title">CRITICAL: Logic Bug Found</div>
            <div className="alert-badge">MERGE BLOCKED</div>
          </div>
        </div>
        <div className="demo-features">
          <div className="demo-feature">
            <h3>Inline Code Suggestions</h3>
            <p>See exactly where improvements can be made directly in your diff view with one-click commit suggestions.</p>
          </div>
          <div className="demo-feature">
            <h3>Automated Security Checks</h3>
            <p>Block merges that contain critical vulnerabilities automatically, ensuring you never ship insecure code.</p>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
          <div className="nav-logo-icon" style={{width:22,height:22,fontSize:'0.6rem'}}>CR</div>
          <span style={{fontSize:'0.875rem',fontWeight:600}}>CodeReviewAI</span>
        </div>
        <span className="footer-copy">© 2026 CodeReviewAI Inc. All rights reserved.</span>
        <div className="footer-links">
          <a href="#">Twitter</a>
          <a href="#">GitHub</a>
          <a href="#">Docs</a>
        </div>
      </footer>
    </>
  );
}
