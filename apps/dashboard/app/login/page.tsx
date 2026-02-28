import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge, Button, Card, Flex, Grid, Heading, Text } from '@radix-ui/themes';
import { getPlatformApiBaseUrl, getSession } from '../../lib/platform';

export default async function LoginPage() {
  const session = await getSession();
  if (session.authenticated && session.workspaces.length > 0) {
    redirect(`/w/${session.workspaces[0].slug}/overview`);
  }

  const startUrl = `${getPlatformApiBaseUrl()}/v1/auth/github/start?redirectTo=/onboarding`;

  return (
    <main className="shell">
      <Card size="4" className="hero">
        <Flex direction="column" gap="3">
          <Badge color="blue" variant="soft" size="2" style={{ width: 'fit-content' }}>
            Authentication
          </Badge>
          <Heading size="8" style={{ letterSpacing: '-0.02em' }}>
            Sign in with GitHub
          </Heading>
          <Text size="3" color="gray" style={{ maxWidth: 820, lineHeight: 1.7 }}>
            Authenticate once, then manage workspaces, repositories, rules, and review operations from a single control
            plane.
          </Text>
          <Flex gap="2" wrap="wrap">
            <Button asChild size="3">
              <a href={startUrl}>Continue with GitHub</a>
            </Button>
            <Button asChild variant="soft" color="gray" size="3">
              <Link href="/">Home</Link>
            </Button>
          </Flex>
        </Flex>
      </Card>

      <Grid columns={{ initial: '1', md: '2' }} gap="3" mt="4">
        <Card size="3">
          <Flex direction="column" gap="2">
            <Heading size="4">OAuth Flow</Heading>
            <Text size="2" color="gray" style={{ lineHeight: 1.65 }}>
              Uses <code>/v1/auth/github/start</code> and <code>/v1/auth/github/callback</code> with signed state and
              secure session cookies.
            </Text>
          </Flex>
        </Card>
        <Card size="3">
          <Flex direction="column" gap="2">
            <Heading size="4">Role-Aware Access</Heading>
            <Text size="2" color="gray" style={{ lineHeight: 1.65 }}>
              Workspace roles supported: <code>owner</code>, <code>admin</code>, <code>member</code>,{' '}
              <code>viewer</code>.
            </Text>
          </Flex>
        </Card>
      </Grid>
    </main>
  );
}
