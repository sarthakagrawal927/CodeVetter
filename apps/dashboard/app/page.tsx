import Link from 'next/link';
import { Badge, Box, Button, Card, Flex, Grid, Heading, Text } from '@radix-ui/themes';

const routes = [
  '/login',
  '/onboarding',
  '/w/[workspaceSlug]/overview',
  '/w/[workspaceSlug]/repositories',
  '/w/[workspaceSlug]/rules',
  '/w/[workspaceSlug]/pull-requests',
  '/w/[workspaceSlug]/settings/members',
  '/w/[workspaceSlug]/settings/audit'
];

export default function HomePage() {
  return (
    <main className="shell">
      <Card size="4" className="hero">
        <Flex direction="column" gap="3">
          <Badge color="blue" variant="soft" size="2" style={{ width: 'fit-content' }}>
            Enterprise Control Plane
          </Badge>
          <Heading size="8" style={{ letterSpacing: '-0.02em' }}>
            Code Reviewer Dashboard
          </Heading>
          <Text size="3" color="gray" style={{ maxWidth: 840, lineHeight: 1.7 }}>
            Manage authentication, workspace operations, repository sync, policy rules, and pull request review
            lifecycle from one platform surface.
          </Text>
          <Flex gap="2" wrap="wrap">
            <Button asChild size="3">
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild variant="soft" color="gray" size="3">
              <Link href="/onboarding">Onboarding</Link>
            </Button>
          </Flex>
        </Flex>
      </Card>

      <Box mt="4">
        <Card size="3">
          <Flex direction="column" gap="3">
            <Flex justify="between" align="center" wrap="wrap" gap="2">
              <Heading size="5">Canonical Routes</Heading>
              <Text size="2" color="gray">
                Addressable and server-rendered
              </Text>
            </Flex>
            <Grid columns={{ initial: '1', md: '2' }} gap="2">
              {routes.map(route => (
                <Card key={route} variant="surface" size="2">
                  <Text size="2" style={{ fontFamily: 'var(--font-mono)' }}>
                    {route}
                  </Text>
                </Card>
              ))}
            </Grid>
          </Flex>
        </Card>
      </Box>
    </main>
  );
}
