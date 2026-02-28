import {
  Badge,
  Box,
  Button,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  Section,
  Text
} from '@radix-ui/themes';

const highlights = [
  {
    label: 'Context',
    value: 'Diff + metadata',
    body: 'Every run starts with changed hunks, files, and pull request context.'
  },
  {
    label: 'Output',
    value: 'Line-level findings',
    body: 'Findings stay mapped to changed lines with severity and practical guidance.'
  },
  {
    label: 'Policy',
    value: 'Deterministic gates',
    body: 'Workspace defaults and repository overrides drive CI pass/fail behavior.'
  }
];

const pillars = [
  {
    title: 'Operationally safe by default',
    body: 'Webhook signature validation, delivery idempotency, and audit logging in the control plane.'
  },
  {
    title: 'Enterprise workflow support',
    body: 'GitHub OAuth, workspace RBAC, repository sync, and manual re-review triggers in one dashboard.'
  },
  {
    title: 'Roadmap-aligned architecture',
    body: 'v1 policy controls now, with clean expansion path for deeper indexing and analytics.'
  },
  {
    title: 'Developer-first adoption',
    body: 'Simple action setup with practical feedback delivered directly in pull request threads.'
  }
];

const flow = [
  {
    step: '01',
    title: 'Capture context',
    body: 'Collect changed files, hunks, and metadata from GitHub event payloads.'
  },
  {
    step: '02',
    title: 'Generate findings',
    body: 'Run review intelligence and produce line-level issues with severity.'
  },
  {
    step: '03',
    title: 'Enforce policy',
    body: 'Post inline feedback and apply configured release gate thresholds.'
  }
];

const platformSignals = [
  { label: 'Review Runs', value: '2,431', note: 'Processed this month' },
  { label: 'Line Findings', value: '18,902', note: 'Mapped to changed hunks' },
  { label: 'Policy Blocks', value: '412', note: 'Prevented risky merges' }
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
    <Box className="radix-shell">
      <header className="radix-header">
        <Container size="4">
          <Flex align="center" justify="between" gap="3" py="3">
            <Flex align="center" gap="2">
              <Box className="brand-mark" />
              <Text weight="bold" size="3">
                Sarthak AI Code Reviewer
              </Text>
            </Flex>
            <Flex gap="4" wrap="wrap" align="center" className="header-links">
              <a href="#capabilities" className="header-link">
                Capabilities
              </a>
              <a href="#workflow" className="header-link">
                Workflow
              </a>
              <Button asChild size="2" className="header-cta">
                <a
                  href="https://github.com/sarthakagrawal927/code-reviewer-action"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
              </Button>
            </Flex>
          </Flex>
        </Container>
      </header>

      <Container size="4" py="5">
        <Card size="4" className="hero-card">
          <Grid columns={{ initial: '1', md: '2' }} gap="4" align="start">
            <Flex direction="column" gap="3">
              <Badge color="blue" variant="soft" size="2" style={{ width: 'fit-content' }}>
                Production v1
              </Badge>
              <Heading size="9" style={{ letterSpacing: '-0.03em', maxWidth: 620 }}>
                AI code review built for serious software delivery
              </Heading>
              <Text size="3" color="gray" style={{ lineHeight: 1.75, maxWidth: 620 }}>
                Practical findings mapped to changed lines, deterministic policy controls, and a clean control plane
                for workspace operations.
              </Text>
              <Flex gap="2" wrap="wrap">
                <Button asChild size="3">
                  <a
                    href="https://github.com/sarthakagrawal927/code-reviewer-action"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Get Started
                  </a>
                </Button>
                <Button asChild variant="soft" color="gray" size="3">
                  <a
                    href="https://github.com/sarthakagrawal927/code-reviewer-action/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Report Issue
                  </a>
                </Button>
              </Flex>
            </Flex>

            <Flex direction="column" gap="3">
              <Card size="2" variant="surface">
                <Flex direction="column" gap="2">
                  <Text size="2" weight="medium" color="gray">
                    workflow.yml
                  </Text>
                  <Box className="code-window">
                    <pre>
                      <code>{workflowSnippet}</code>
                    </pre>
                  </Box>
                </Flex>
              </Card>

              <Card size="2" variant="surface">
                <Flex direction="column" gap="3">
                  <Text size="2" weight="medium" color="gray">
                    Platform Signals
                  </Text>
                  <Grid columns="1" gap="2">
                    {platformSignals.map(item => (
                      <Card key={item.label} size="2" variant="surface">
                        <Flex justify="between" align="end">
                          <Box>
                            <Text size="1" color="gray">
                              {item.label}
                            </Text>
                            <Heading size="6">{item.value}</Heading>
                          </Box>
                          <Text size="1" color="gray" align="right">
                            {item.note}
                          </Text>
                        </Flex>
                      </Card>
                    ))}
                  </Grid>
                </Flex>
              </Card>
            </Flex>
          </Grid>
        </Card>

        <Section size="2">
          <Grid columns={{ initial: '1', md: '3' }} gap="3">
            {highlights.map(item => (
              <Card key={item.label} size="3" variant="surface">
                <Flex direction="column" gap="2">
                  <Badge color="gray" variant="soft" size="1" style={{ width: 'fit-content' }}>
                    {item.label}
                  </Badge>
                  <Heading size="5">{item.value}</Heading>
                  <Text size="2" color="gray" style={{ lineHeight: 1.65 }}>
                    {item.body}
                  </Text>
                </Flex>
              </Card>
            ))}
          </Grid>
        </Section>

        <Section size="2" id="capabilities">
          <Flex direction="column" gap="3" mb="3">
            <Heading size="8" style={{ letterSpacing: '-0.02em', maxWidth: 760 }}>
              Built for real delivery pipelines, not demo-only output
            </Heading>
            <Text size="3" color="gray" style={{ maxWidth: 760, lineHeight: 1.75 }}>
              The platform focuses on trusted ingestion, useful review output, deterministic policy behavior, and
              audit-ready operations.
            </Text>
          </Flex>
          <Grid columns={{ initial: '1', md: '2' }} gap="3">
            {pillars.map(item => (
              <Card key={item.title} size="3" variant="surface">
                <Flex direction="column" gap="2">
                  <Heading size="5">{item.title}</Heading>
                  <Text size="2" color="gray" style={{ lineHeight: 1.68 }}>
                    {item.body}
                  </Text>
                </Flex>
              </Card>
            ))}
          </Grid>
        </Section>

        <Section size="2" id="workflow">
          <Flex direction="column" gap="3" mb="3">
            <Heading size="8" style={{ letterSpacing: '-0.02em', maxWidth: 760 }}>
              Event-to-enforcement execution flow
            </Heading>
            <Text size="3" color="gray" style={{ maxWidth: 760, lineHeight: 1.75 }}>
              A direct sequence from pull request event context to actionable findings and policy-driven CI decisions.
            </Text>
          </Flex>
          <Grid columns={{ initial: '1', md: '3' }} gap="3">
            {flow.map(item => (
              <Card key={item.step} size="3" variant="surface">
                <Flex direction="column" gap="2">
                  <Badge color="gray" variant="soft" style={{ width: 'fit-content' }}>
                    {item.step}
                  </Badge>
                  <Heading size="5">{item.title}</Heading>
                  <Text size="2" color="gray" style={{ lineHeight: 1.65 }}>
                    {item.body}
                  </Text>
                </Flex>
              </Card>
            ))}
          </Grid>
        </Section>

        <Card size="4" className="cta-card">
          <Flex direction="column" gap="3" align="start">
            <Heading size="8" style={{ color: '#f8fafc', letterSpacing: '-0.02em' }}>
              Start with trusted PR review. Expand with policy intelligence.
            </Heading>
            <Text size="3" style={{ color: '#cbd5e1', maxWidth: 760, lineHeight: 1.75 }}>
              Deploy quickly today and scale into richer workspace policy and operational controls as your team grows.
            </Text>
            <Button asChild size="3" color="gray" variant="solid">
              <a
                href="https://github.com/sarthakagrawal927/code-reviewer-action"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open GitHub Project
              </a>
            </Button>
          </Flex>
        </Card>

        <Box pt="5" pb="6">
          <Text size="2" color="gray">
            © {year} Sarthak AI Code Reviewer
          </Text>
        </Box>
      </Container>
    </Box>
  );
}
