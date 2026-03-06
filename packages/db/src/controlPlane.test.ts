import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryControlPlaneDatabase, type ControlPlaneDatabase } from './controlPlane';

describe('InMemoryControlPlaneDatabase', () => {
  let db: ControlPlaneDatabase;

  beforeEach(() => {
    db = new InMemoryControlPlaneDatabase();
  });

  describe('users', () => {
    it('upsert + get by github ID', async () => {
      const user = await db.upsertUserFromGithub({
        githubUserId: '1001',
        githubLogin: 'alice',
        displayName: 'Alice',
      });
      assert.equal(user.githubUserId, '1001');
      assert.equal(user.githubLogin, 'alice');
      assert.ok(user.id.startsWith('usr_'));

      const fetched = await db.getUserByGithubId('1001');
      assert.ok(fetched);
      assert.equal(fetched.id, user.id);
    });

    it('re-upsert updates login', async () => {
      const first = await db.upsertUserFromGithub({
        githubUserId: '1001',
        githubLogin: 'alice',
      });
      const second = await db.upsertUserFromGithub({
        githubUserId: '1001',
        githubLogin: 'alice-renamed',
      });

      assert.equal(second.id, first.id);
      assert.equal(second.githubLogin, 'alice-renamed');
    });

    it('returns undefined for unknown github ID', async () => {
      const result = await db.getUserByGithubId('nonexistent');
      assert.equal(result, undefined);
    });
  });

  describe('sessions', () => {
    it('create + get by token hash', async () => {
      const user = await db.upsertUserFromGithub({
        githubUserId: '1001',
        githubLogin: 'alice',
      });

      const session = await db.createSession({
        userId: user.id,
        sessionTokenHash: 'hash_abc',
        expiresAt: '2099-01-01T00:00:00Z',
      });

      assert.ok(session.id.startsWith('sess_'));
      assert.equal(session.userId, user.id);

      const fetched = await db.getSessionByTokenHash('hash_abc');
      assert.ok(fetched);
      assert.equal(fetched.id, session.id);
    });

    it('revoke sets revokedAt', async () => {
      const user = await db.upsertUserFromGithub({
        githubUserId: '1001',
        githubLogin: 'alice',
      });
      const session = await db.createSession({
        userId: user.id,
        sessionTokenHash: 'hash_xyz',
        expiresAt: '2099-01-01T00:00:00Z',
      });

      assert.equal(session.revokedAt, undefined);

      const revoked = await db.revokeSession(session.id);
      assert.ok(revoked);
      assert.ok(revoked.revokedAt);
    });
  });

  describe('workspaces', () => {
    it('create + find by slug', async () => {
      const user = await db.upsertUserFromGithub({
        githubUserId: '1001',
        githubLogin: 'alice',
      });
      const ws = await db.createWorkspace({
        slug: 'my-team',
        name: 'My Team',
        kind: 'organization',
        createdByUserId: user.id,
      });

      assert.ok(ws.id.startsWith('ws_'));
      assert.equal(ws.slug, 'my-team');

      const bySlug = await db.getWorkspaceBySlug('my-team');
      assert.ok(bySlug);
      assert.equal(bySlug.id, ws.id);
    });

    it('add member + list members', async () => {
      const user = await db.upsertUserFromGithub({
        githubUserId: '1001',
        githubLogin: 'alice',
      });
      const ws = await db.createWorkspace({
        slug: 'team',
        name: 'Team',
        kind: 'organization',
        createdByUserId: user.id,
      });

      // createWorkspace auto-adds the creator as owner
      const membersBefore = await db.listWorkspaceMembers(ws.id);
      assert.equal(membersBefore.length, 1);
      assert.equal(membersBefore[0].role, 'owner');

      const user2 = await db.upsertUserFromGithub({
        githubUserId: '1002',
        githubLogin: 'bob',
      });
      await db.addWorkspaceMember({
        workspaceId: ws.id,
        userId: user2.id,
        githubUserId: '1002',
        githubLogin: 'bob',
        role: 'member',
        status: 'active',
      });

      const membersAfter = await db.listWorkspaceMembers(ws.id);
      assert.equal(membersAfter.length, 2);
    });
  });

  describe('repositories', () => {
    it('upsert + list by workspace', async () => {
      const user = await db.upsertUserFromGithub({
        githubUserId: '1001',
        githubLogin: 'alice',
      });
      const ws = await db.createWorkspace({
        slug: 'team',
        name: 'Team',
        kind: 'organization',
        createdByUserId: user.id,
      });

      const repo = await db.upsertRepository({
        workspaceId: ws.id,
        provider: 'github',
        owner: 'acme',
        name: 'api',
        fullName: 'acme/api',
        isActive: true,
      });

      assert.ok(repo.id.startsWith('repo_'));
      assert.equal(repo.fullName, 'acme/api');

      const repos = await db.listRepositories(ws.id);
      assert.equal(repos.length, 1);
      assert.equal(repos[0].id, repo.id);
    });
  });

  describe('review runs', () => {
    it('create + update status/score/findings', async () => {
      const user = await db.upsertUserFromGithub({
        githubUserId: '1001',
        githubLogin: 'alice',
      });
      const ws = await db.createWorkspace({
        slug: 'team',
        name: 'Team',
        kind: 'organization',
        createdByUserId: user.id,
      });
      const repo = await db.upsertRepository({
        workspaceId: ws.id,
        provider: 'github',
        owner: 'acme',
        name: 'api',
        fullName: 'acme/api',
        isActive: true,
      });

      const run = await db.createReviewRun({
        repositoryId: repo.id,
        prNumber: 42,
        headSha: 'abc123',
        status: 'queued',
      });

      assert.ok(run.id.startsWith('rr_'));
      assert.equal(run.status, 'queued');

      const updated = await db.updateReviewRun(run.id, {
        status: 'completed',
        scoreComposite: 85,
        findingsCount: 3,
      });

      assert.ok(updated);
      assert.equal(updated.status, 'completed');
      assert.equal(updated.scoreComposite, 85);
      assert.equal(updated.findingsCount, 3);
    });

    it('add + list findings', async () => {
      const user = await db.upsertUserFromGithub({
        githubUserId: '1001',
        githubLogin: 'alice',
      });
      const ws = await db.createWorkspace({
        slug: 'team',
        name: 'Team',
        kind: 'organization',
        createdByUserId: user.id,
      });
      const repo = await db.upsertRepository({
        workspaceId: ws.id,
        provider: 'github',
        owner: 'acme',
        name: 'api',
        fullName: 'acme/api',
        isActive: true,
      });
      const run = await db.createReviewRun({
        repositoryId: repo.id,
        prNumber: 1,
        headSha: 'sha1',
        status: 'running',
      });

      const finding = await db.addReviewFinding({
        reviewRunId: run.id,
        severity: 'high',
        title: 'SQL injection risk',
        summary: 'Unsanitized input used in query',
        filePath: 'src/db.ts',
        line: 42,
        confidence: 0.95,
      });

      assert.ok(finding.id.startsWith('rf_'));
      assert.equal(finding.severity, 'high');

      const findings = await db.listReviewFindingsByRun(run.id);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].title, 'SQL injection risk');
    });
  });

  describe('indexing runs', () => {
    it('create + update status', async () => {
      const user = await db.upsertUserFromGithub({
        githubUserId: '1001',
        githubLogin: 'alice',
      });
      const ws = await db.createWorkspace({
        slug: 'team',
        name: 'Team',
        kind: 'organization',
        createdByUserId: user.id,
      });
      const repo = await db.upsertRepository({
        workspaceId: ws.id,
        provider: 'github',
        owner: 'acme',
        name: 'api',
        fullName: 'acme/api',
        isActive: true,
      });

      const run = await db.createIndexingRun({
        repositoryId: repo.id,
        status: 'queued',
      });

      assert.ok(run.id.startsWith('idx_'));
      assert.equal(run.status, 'queued');

      const updated = await db.updateIndexingRun(run.id, {
        status: 'completed',
        completedAt: '2026-01-01T00:00:00Z',
      });

      assert.ok(updated);
      assert.equal(updated.status, 'completed');
      assert.equal(updated.completedAt, '2026-01-01T00:00:00Z');
    });
  });

  describe('audit logs', () => {
    it('append + list by workspace', async () => {
      const user = await db.upsertUserFromGithub({
        githubUserId: '1001',
        githubLogin: 'alice',
      });
      const ws = await db.createWorkspace({
        slug: 'team',
        name: 'Team',
        kind: 'organization',
        createdByUserId: user.id,
      });

      await db.appendAuditLog({
        workspaceId: ws.id,
        actorUserId: user.id,
        action: 'workspace.created',
        resourceType: 'workspace',
        resourceId: ws.id,
        metadata: { slug: 'team' },
      });

      await db.appendAuditLog({
        workspaceId: ws.id,
        actorUserId: user.id,
        action: 'repo.added',
        resourceType: 'repository',
        metadata: { repo: 'acme/api' },
      });

      const logs = await db.listAuditLogs(ws.id);
      assert.equal(logs.length, 2);
      // listAuditLogs sorts by createdAt descending
      assert.ok(logs[0].id.startsWith('audit_'));
    });
  });

  describe('webhook events', () => {
    it('record + get by delivery ID', async () => {
      const event = await db.recordWebhookEvent({
        event: 'pull_request',
        deliveryId: 'del-001',
        payload: { action: 'opened' },
        receivedAt: '2026-01-01T00:00:00Z',
      });

      assert.equal(event.deliveryId, 'del-001');
      assert.equal(event.processingStatus, 'received');

      const fetched = await db.getWebhookEventByDeliveryId('github', 'del-001');
      assert.ok(fetched);
      assert.equal(fetched.deliveryId, 'del-001');
      assert.equal(fetched.event, 'pull_request');
    });
  });
});
