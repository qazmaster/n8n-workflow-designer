export type N8nHttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface N8nApiConfig {
  baseUrl: string;
  apiKey: string;
}

export interface N8nApiRequest {
  method?: N8nHttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

const SENSITIVE_KEYS = new Set([
  'accessToken',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'data',
  'password',
  'pinData',
  'secret',
  'staticData',
  'token',
]);

export interface N8nListResponse<T> {
  data?: T[];
  nextCursor?: string;
}

export async function n8nApiRequest<T = unknown>(config: N8nApiConfig, request: N8nApiRequest): Promise<T> {
  if (!config.apiKey) {
    throw new Error('N8N_API_KEY is required to call the n8n API.');
  }

  const response = await fetch(buildN8nApiUrl(config.baseUrl, request.path, request.query), {
    method: request.method || 'GET',
    headers: {
      'X-N8N-API-KEY': config.apiKey,
      ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`n8n API ${response.status}: ${redactSensitiveText(body)}`);
  }

  return parseJsonBody<T>(body);
}

export function buildN8nApiUrl(baseUrl: string, path: string, query?: N8nApiRequest['query']): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${normalizedBaseUrl}/api/v1${normalizedPath}`);

  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export function n8nPath(strings: TemplateStringsArray, ...segments: string[]): string {
  return strings.reduce((path, part, index) => {
    const segment = segments[index];
    return segment === undefined ? `${path}${part}` : `${path}${part}${encodeN8nPathSegment(segment)}`;
  }, '');
}

export function encodeN8nPathSegment(value: string): string {
  if (value.trim() === '') {
    throw new Error('n8n API path segment must be a non-empty string.');
  }
  return encodeURIComponent(value);
}

export function listFromN8nResponse<T>(response: unknown): T[] {
  if (Array.isArray(response)) {
    return response as T[];
  }
  if (isObjectRecord(response) && Array.isArray(response.data)) {
    return response.data as T[];
  }
  return [];
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function redactSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item));
  }

  if (!isObjectRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : redactSensitiveData(entry),
    ]),
  );
}

export function redactSensitiveText(text: string): string {
  if (!text) {
    return text;
  }

  try {
    return JSON.stringify(redactSensitiveData(JSON.parse(text)));
  } catch {
    return text
      .replace(/(api[_-]?key|access[_-]?token|authorization|password|secret|token)(["'\s:=]+)([^"'\s,}]+)/gi, '$1$2[REDACTED]')
      .replace(/(pinData|staticData|data)(["'\s:=]+)\{[^}]*\}/gi, '$1$2[REDACTED]');
  }
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.has(key) || [...SENSITIVE_KEYS].some((sensitiveKey) => normalized.includes(sensitiveKey.toLowerCase()));
}

function parseJsonBody<T>(body: string): T {
  if (!body) {
    return {} as T;
  }
  return JSON.parse(body) as T;
}
