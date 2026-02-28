import Image from "next/image";

const highlights = [
  {
    label: "Context first",
    value: "Diff + metadata",
    body: "Every run starts with changed hunks, files, and PR thread context.",
  },
  {
    label: "Clear output",
    value: "Line-level findings",
    body: "Findings are mapped to exact lines with severity and practical fixes.",
  },
  {
    label: "Policy controls",
    value: "Deterministic gates",
    body: "Workspace defaults and repo overrides drive pass/fail behavior.",
  },
];

const pillars = [
  {
    title: "Operationally safe by default",
    body: "Webhook signature checks, delivery idempotency, and audit logs are built into the control plane.",
  },
  {
    title: "Enterprise-ready workflow",
    body: "GitHub OAuth, workspace RBAC, repository connection management, and manual re-review triggers in one dashboard.",
  },
  {
    title: "Roadmap-aligned architecture",
    body: "v1 ships deterministic policy controls now while keeping clean expansion paths for deeper indexing and analytics.",
  },
  {
    title: "Practical developer experience",
    body: "Action setup stays simple: configure platform URL/token once, then review feedback appears directly in pull requests.",
  },
];

const flow = [
  {
    step: "01",
    title: "Capture pull request context",
    body: "Collect changed files, hunks, and metadata from GitHub event payloads.",
  },
  {
    step: "02",
    title: "Generate review findings",
    body: "Run code analysis and produce line-level findings with severity and guidance.",
  },
  {
    step: "03",
    title: "Apply release policy",
    body: "Post inline comments and enforce configured thresholds in CI.",
  },
];

const workflowSnippet = `name: Trigger Enterprise Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    steps:
      - uses: actions/checkout@v4
      - uses: sarthakagrawal927/code-reviewer-action@v1
        with:
          platform_base_url: \${{ secrets.CODE_REVIEWER_PLATFORM_BASE_URL }}
          platform_token: \${{ secrets.CODE_REVIEWER_PLATFORM_TOKEN }}`;

export default function HomePage() {
  const year = new Date().getFullYear();

  return (
    <>
      <header className="site-header">
        <div className="container top-nav">
          <a className="brand" href="#home">
            <span className="brand-mark" />
            <span>Sarthak AI Code Reviewer</span>
          </a>
          <nav className="top-links">
            <a href="#capabilities">Capabilities</a>
            <a href="#workflow">Workflow</a>
            <a
              href="https://github.com/sarthakagrawal927/code-reviewer-action#readme"
              target="_blank"
              rel="noopener noreferrer"
            >
              Docs
            </a>
          </nav>
          <div className="top-actions">
            <a
              className="btn btn-solid"
              href="https://github.com/sarthakagrawal927/code-reviewer-action"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </header>

      <main id="home" className="container page">
        <section className="hero">
          <div>
            <span className="eyebrow">Enterprise v1</span>
            <h1>AI code review that engineering teams can trust in production.</h1>
            <p>
              Sarthak AI Code Reviewer combines practical line-level findings with
              deterministic policy controls, so pull request quality checks are
              both useful to developers and reliable for release gates.
            </p>
            <div className="hero-actions">
              <a
                className="btn btn-solid"
                href="https://github.com/sarthakagrawal927/code-reviewer-action"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get started
              </a>
              <a
                className="btn btn-ghost"
                href="https://github.com/sarthakagrawal927/code-reviewer-action/issues"
                target="_blank"
                rel="noopener noreferrer"
              >
                Report issue
              </a>
            </div>
          </div>

          <div className="hero-stack">
            <article className="code-panel">
              <div className="code-head">
                <span>workflow.yml</span>
                <span className="window-dots">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
              <pre>
                <code>{workflowSnippet}</code>
              </pre>
            </article>
            <article className="preview-card">
              <div className="preview-head">
                <span>Dashboard Preview</span>
                <b>Control Plane</b>
              </div>
              <Image
                src="/images/hero.png"
                alt="Code Reviewer dashboard preview"
                width={960}
                height={640}
                priority
              />
            </article>
          </div>
        </section>

        <section className="highlight-grid">
          {highlights.map((item) => (
            <article className="highlight-card" key={item.label}>
              <small>{item.label}</small>
              <h3>{item.value}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </section>

        <section className="section" id="capabilities">
          <h2>Built for modern delivery workflows, not marketing demos.</h2>
          <p className="section-copy">
            The platform is organized around real operational needs: trusted
            ingestion, useful review output, policy enforcement, and auditable
            changes.
          </p>
          <div className="pillar-grid">
            {pillars.map((item) => (
              <article className="pillar-card" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section" id="workflow">
          <h2>Execution flow from event to release gate</h2>
          <p className="section-copy">
            A clear path from pull request event ingestion to actionable findings
            and policy-driven CI decisions.
          </p>
          <div className="flow-grid">
            {flow.map((item) => (
              <article className="flow-card" key={item.step}>
                <span>{item.step}</span>
                <h4>{item.title}</h4>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="cta">
          <h3>Start with reliable PR review. Scale into policy intelligence.</h3>
          <p>
            Deploy the action quickly today, then expand into richer workspace
            policy and dashboard operations as your team grows.
          </p>
          <a
            className="btn btn-solid"
            href="https://github.com/sarthakagrawal927/code-reviewer-action"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open GitHub Project
          </a>
        </section>
      </main>

      <footer className="container footer">
        <span>© {year} Sarthak AI Code Reviewer</span>
      </footer>
    </>
  );
}
