import {
  GatewayConfig,
  GatewayReviewRequest,
  GatewayReviewResponse,
  REVIEW_SEVERITIES,
  ReviewFinding,
  ReviewSeverity
} from '../../shared-types/src';

const MAX_DIFF_CHARS = 120000;
const REQUEST_TIMEOUT_MS = 60000;

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error('ai_base_url is required for gateway mode.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid ai_base_url: "${baseUrl}". Provide a valid http(s) URL.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid ai_base_url protocol: "${parsed.protocol}". Use http or https.`);
  }

  const normalizedPath = parsed.pathname.endsWith('/') ? parsed.pathname.slice(0, -1) : parsed.pathname;
  parsed.pathname = normalizedPath;
  return parsed.toString();
}

function truncateDiff(diff: string): { text: string; truncated: boolean } {
  if (diff.length <= MAX_DIFF_CHARS) {
    return { text: diff, truncated: false };
  }

  return {
    text: `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated for token safety]`,
    truncated: true
  };
}

function normalizeSeverity(value: unknown): ReviewSeverity | null {
  if (typeof value !== 'string') {
    return null;
  }

  const severity = value.trim().toLowerCase();
  return REVIEW_SEVERITIES.includes(severity as ReviewSeverity) ? (severity as ReviewSeverity) : null;
}

function coerceFinding(raw: unknown): ReviewFinding | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const item = raw as Record<string, unknown>;
  const severity = normalizeSeverity(item.severity);
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const summary = typeof item.summary === 'string' ? item.summary.trim() : '';

  if (!severity || !title || !summary) {
    return null;
  }

  const filePath = typeof item.filePath === 'string'
    ? item.filePath.trim()
    : typeof item.file === 'string'
      ? item.file.trim()
      : undefined;

  const line =
    typeof item.line === 'number' && Number.isInteger(item.line) && item.line > 0 ? item.line : undefined;

  const confidence =
    typeof item.confidence === 'number' && Number.isFinite(item.confidence)
      ? Math.max(0, Math.min(1, item.confidence))
      : undefined;

  return {
    severity,
    title,
    summary,
    filePath: filePath || undefined,
    line,
    confidence
  };
}

function buildPrompt(request: GatewayReviewRequest, truncated: boolean): string {
  const fileList = request.files.map(file => `- ${file.path} (${file.status ?? 'modified'})`).join('\n');

  return [
    'Review this pull request diff and return ONLY JSON with this shape:',
    '{"findings":[{"severity":"low|medium|high|critical","title":"...","summary":"...","filePath":"...","line":123,"confidence":0.0}]}',
    'Rules:',
    '- Findings must be concrete and evidence-based.',
    '- Use higher severity only for significant risk.',
    '- Use filePath and line when possible.',
    '- confidence must be between 0 and 1.',
    truncated ? '- Note: diff content was truncated for token safety.' : '',
    '',
    `Review tone: ${request.context?.reviewTone ?? 'balanced'}`,
    `Repository: ${request.context?.repoFullName ?? 'unknown'}`,
    `PR Number: ${request.context?.prNumber ?? 'unknown'}`,
    '',
    'Changed files:',
    fileList || '- none',
    '',
    'Diff:',
    request.diff
  ].filter(Boolean).join('\n');
}

export async function reviewDiffWithOpenAICompatibleGateway(
  config: GatewayConfig,
  request: GatewayReviewRequest
): Promise<GatewayReviewResponse> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const endpoint = `${baseUrl}/chat/completions`;

  const diffResult = truncateDiff(request.diff);
  const prompt = buildPrompt({ ...request, diff: diffResult.text }, diffResult.truncated);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a senior code reviewer. Return strict JSON only in the requested schema and avoid speculative findings.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Gateway request timed out after 60 seconds.');
    }

    throw new Error(`Gateway request failed: ${String(error)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const rawResponse = await response.text();

  if (!response.ok) {
    throw new Error(
      `Gateway request failed with status ${response.status}. Response: ${rawResponse.slice(0, 1000)}`
    );
  }

  let outer: unknown;
  try {
    outer = JSON.parse(rawResponse);
  } catch {
    throw new Error('Gateway response was not valid JSON.');
  }

  const messageContent =
    outer &&
    typeof outer === 'object' &&
    Array.isArray((outer as { choices?: unknown[] }).choices) &&
    (outer as { choices: Array<{ message?: { content?: unknown } }> }).choices.length > 0
      ? (outer as { choices: Array<{ message?: { content?: unknown } }> }).choices[0]?.message?.content
      : undefined;

  if (typeof messageContent !== 'string' || !messageContent.trim()) {
    throw new Error('Gateway response did not include choices[0].message.content.');
  }

  let inner: unknown;
  try {
    inner = JSON.parse(messageContent);
  } catch {
    throw new Error('Gateway content field was not valid JSON.');
  }

  const rawFindings =
    inner && typeof inner === 'object' && Array.isArray((inner as { findings?: unknown }).findings)
      ? (inner as { findings: unknown[] }).findings
      : [];

  const findings = rawFindings.map(coerceFinding).filter((finding): finding is ReviewFinding => finding !== null);

  return {
    findings,
    rawResponse
  };
}
