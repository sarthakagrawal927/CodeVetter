import { AuthSessionResponse, WorkspaceRecord } from '@code-reviewer/shared-types';
import { cookies } from 'next/headers';

export function getPlatformApiBaseUrl(): string {
  const value =
    process.env.PLATFORM_API_BASE_URL || process.env.NEXT_PUBLIC_PLATFORM_API_BASE_URL || 'http://127.0.0.1:8787';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const response = await fetch(`${getPlatformApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      cookie: cookieHeader
    },
    cache: 'no-store'
  });

  const text = await response.text();
  const payload = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    const message =
      isObject(payload) && typeof payload.message === 'string'
        ? payload.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function getSession(): Promise<AuthSessionResponse> {
  return platformFetch<AuthSessionResponse>('/v1/auth/session');
}

export async function getWorkspaceBySlug(slug: string): Promise<(WorkspaceRecord & { role: string }) | null> {
  const data = await platformFetch<{ workspaces: Array<WorkspaceRecord & { role: string }> }>('/v1/workspaces');
  return data.workspaces.find(item => item.slug === slug) || null;
}

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
