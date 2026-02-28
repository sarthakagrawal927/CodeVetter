import Link from 'next/link';
import { Badge, Box, Button, Card, Flex, Grid, Heading, Separator, Text } from '@radix-ui/themes';

const routes = [
  { path: '/login', surface: 'Auth' },
  { path: '/onboarding', surface: 'Provisioning' },
  { path: '/w/[workspaceSlug]/overview', surface: 'Workspace' },
  { path: '/w/[workspaceSlug]/repositories', surface: 'Repositories' },
  { path: '/w/[workspaceSlug]/rules', surface: 'Policy Rules' },
  { path: '/w/[workspaceSlug]/pull-requests', surface: 'PR Ops' },
  { path: '/w/[workspaceSlug]/settings/members', surface: 'Membership' },
  { path: '/w/[workspaceSlug]/settings/audit', surface: 'Audit' }
];

const productPillars = [
  {
    title: 'Trusted Authentication',
    body: 'GitHub OAuth initiation, callback handling, and signed workspace sessions.'
  },
  {
    title: 'Operational Governance',
    body: 'Role-aware member access, repository controls, and policy ownership.'
  },
  {
    title: 'Review Execution',
    body: 'Trigger and monitor review operations with route-level platform observability.'
  }
];

const coreSignals = [
  { label: 'Active Workspaces', value: '128' },
  { label: 'Review Runs', value: '2.4k' },
  { label: 'Policy Blocks', value: '412' }
];

export default function HomePage() {
  return (
    <main className="shell dashboard-home">
      <Card size="2" className="chrome-bar home-topbar">
        <Flex align="center" justify="between" wrap="wrap" gap="2">
          <Flex align="center" gap="2">
            <Box className="dot-mark" />
            <Text size="2" weight="bold">
              Code Reviewer Dashboard
            </Text>
          </Flex>
          <Flex gap="2" wrap="wrap">
            <Button asChild size="2" variant="soft" color="gray">
              <Link href="/onboarding">Onboarding</Link>
            </Button>
            <Button asChild size="2">
              <Link href="/login">Sign In</Link>
            </Button>
          </Flex>
        </Flex>
      </Card>

      <Grid columns={{ initial: '1', md: '8fr 4fr' }} gap="3" mt="3">
        <Card size="4" className="hero home-hero">
          <Flex direction="column" gap="3">
            <Badge color="blue" variant="soft" size="2" style={{ width: 'fit-content' }}>
              Enterprise Control Plane
            </Badge>
            <Heading size="9" className="home-title" style={{ maxWidth: 760 }}>
              Run policy-aware AI code review from one operational surface
            </Heading>
            <Text size="3" className="home-copy" style={{ maxWidth: 820, lineHeight: 1.75 }}>
              Authenticate teams, configure repository rules, trigger review runs, and monitor outcomes through a
              single control plane aligned to engineering delivery.
            </Text>
            <Flex gap="2" wrap="wrap">
              <Button asChild size="3" className="home-primary-btn">
                <Link href="/login">Sign In</Link>
              </Button>
              <Button asChild variant="soft" color="gray" size="3" className="home-secondary-btn">
                <Link href="/onboarding">Start Onboarding</Link>
              </Button>
            </Flex>
            <Separator size="4" />
            <Grid columns={{ initial: '1', sm: '3' }} gap="2">
              {coreSignals.map(item => (
                <Card key={item.label} size="2" className="home-signal-card">
                  <Flex direction="column" gap="1">
                    <Text size="1" className="home-signal-label">
                      {item.label}
                    </Text>
                    <Heading size="5" className="home-signal-value">
                      {item.value}
                    </Heading>
                  </Flex>
                </Card>
              ))}
            </Grid>
          </Flex>
        </Card>
        <Card size="3" className="home-routes-card">
          <Flex direction="column" gap="3">
            <Flex justify="between" align="center" wrap="wrap" gap="2">
              <Heading size="5" className="home-routes-title">
                Route Surfaces
              </Heading>
              <Text size="2" className="home-routes-copy">
                Addressable and server-rendered
              </Text>
            </Flex>
            <Grid columns="1" gap="2">
              {routes.map(route => (
                <Card key={route.path} size="2" className="home-route-row">
                  <Flex justify="between" align="center" gap="2">
                    <Text size="1" className="home-route-surface">
                      {route.surface}
                    </Text>
                    <Text size="2" className="home-route-path" style={{ fontFamily: 'var(--font-mono)' }}>
                      {route.path}
                    </Text>
                  </Flex>
                </Card>
              ))}
            </Grid>
          </Flex>
        </Card>
      </Grid>

      <Box mt="4">
        <Grid columns={{ initial: '1', md: '3' }} gap="3">
          {productPillars.map(item => (
            <Card key={item.title} size="3" className="home-pillar-card">
              <Flex direction="column" gap="2">
                <Heading size="4" className="home-pillar-title">
                  {item.title}
                </Heading>
                <Text size="2" className="home-pillar-copy" style={{ lineHeight: 1.7 }}>
                  {item.body}
                </Text>
              </Flex>
            </Card>
          ))}
        </Grid>
      </Box>
    </main>
  );
}
