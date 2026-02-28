import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  Separator,
  Text
} from '@radix-ui/themes';
import { getPlatformApiBaseUrl, getSession } from '../../lib/platform';

const featureCards = [
  {
    title: 'GitHub OAuth',
    body: 'Secure OAuth start/callback with signed state handling and session cookies.'
  },
  {
    title: 'Workspace RBAC',
    body: 'Role-aware access with owner, admin, member, and viewer permission levels.'
  },
  {
    title: 'Operational Control',
    body: 'Repository sync, rules, review triggers, and audit logging from one platform.'
  }
];

const loginSignals = [
  { label: 'Workspaces Managed', value: '128' },
  { label: 'Review Runs', value: '2.4k' },
  { label: 'Policy Gates', value: '412' }
];

const trustPoints = [
  { label: 'Session Security', value: 'Signed cookie with secure attributes.' },
  { label: 'Auditability', value: 'Workspace actions captured with user and timestamp.' },
  { label: 'Platform Uptime', value: 'Control plane designed for resilient review operations.' }
];

export default async function LoginPage() {
  const session = await getSession();
  if (session.authenticated && session.workspaces.length > 0) {
    redirect(`/w/${session.workspaces[0].slug}/overview`);
  }

  const startUrl = `${getPlatformApiBaseUrl()}/v1/auth/github/start?redirectTo=/onboarding`;

  return (
    <main className="shell login-page">
      <Card size="2" className="chrome-bar login-topbar">
        <Flex align="center" justify="between" wrap="wrap" gap="2">
          <Flex align="center" gap="2">
            <Box className="dot-mark" />
            <Text size="2" weight="bold">
              Code Reviewer Dashboard
            </Text>
          </Flex>
          <Flex gap="2" wrap="wrap">
            <Button asChild size="2" variant="soft" color="gray">
              <Link href="/">Overview</Link>
            </Button>
            <Button asChild size="2" variant="soft" color="gray">
              <Link href="/onboarding">Onboarding</Link>
            </Button>
          </Flex>
        </Flex>
      </Card>

      <Grid columns={{ initial: '1', md: '7fr 5fr' }} gap="3" mt="3">
        <Card size="4" className="hero login-hero">
          <Flex direction="column" gap="3">
            <Badge color="blue" variant="soft" size="2" className="login-badge" style={{ width: 'fit-content' }}>
              Authentication
            </Badge>
            <Heading size="9" className="login-title" style={{ letterSpacing: '-0.03em', maxWidth: 720 }}>
              Sign in with GitHub to access your review control plane
            </Heading>
            <Text size="3" className="login-copy" style={{ lineHeight: 1.75, maxWidth: 760 }}>
              Connect once, then manage workspaces, repositories, policy rules, and pull request review operations from
              a single enterprise surface.
            </Text>
            <Flex gap="2" wrap="wrap" className="login-actions">
              <Button asChild size="3" className="login-primary-btn">
                <a href={startUrl}>Continue with GitHub</a>
              </Button>
              <Button asChild variant="soft" color="gray" size="3" className="login-secondary-btn">
                <Link href="/">Back to Home</Link>
              </Button>
            </Flex>
            <Separator size="4" />
            <Text size="2" className="login-endpoints">
              Endpoints: <code>/v1/auth/github/start</code> and <code>/v1/auth/github/callback</code>
            </Text>
            <Grid columns={{ initial: '1', sm: '3' }} gap="2">
              {loginSignals.map(item => (
                <Card key={item.label} size="2" className="login-signal-card">
                  <Flex direction="column" gap="1">
                    <Text size="1" className="login-signal-label">
                      {item.label}
                    </Text>
                    <Heading size="5" className="login-signal-value">
                      {item.value}
                    </Heading>
                  </Flex>
                </Card>
              ))}
            </Grid>
          </Flex>
        </Card>

        <Flex direction="column" gap="3">
          {featureCards.map(item => (
            <Card key={item.title} size="3" className="login-feature-card">
              <Flex direction="column" gap="2">
                <Heading size="4" className="login-feature-title">
                  {item.title}
                </Heading>
                <Text size="2" className="login-feature-copy" style={{ lineHeight: 1.65 }}>
                  {item.body}
                </Text>
              </Flex>
            </Card>
          ))}
        </Flex>
      </Grid>

      <Grid columns={{ initial: '1', md: '3' }} gap="3" mt="3">
        {trustPoints.map(item => (
          <Card key={item.label} size="3" className="login-trust-card">
            <Flex direction="column" gap="2">
              <Text size="1" className="login-trust-label">
                {item.label}
              </Text>
              <Text size="2" className="login-trust-copy" style={{ lineHeight: 1.65 }}>
                {item.value}
              </Text>
            </Flex>
          </Card>
        ))}
      </Grid>
    </main>
  );
}
