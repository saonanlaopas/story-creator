export const selectedProjectStorageKey = "story-creator:selected-project";

export function selectedSourceSegmentStorageKey(projectId: string): string {
  return `story-creator:selected-source-segment:${projectId}`;
}

export function selectedManuscriptUnitStorageKey(projectId: string): string {
  return `story-creator:selected-manuscript-unit:${projectId}`;
}

export interface ApiErrorBody {
  [key: string]: unknown;
  error?: string;
  code?: string;
}

export class ApiRequestError extends Error {
  public constructor(public readonly status: number, public readonly body: ApiErrorBody) {
    super(body.error ?? `Request failed (${status})`);
    this.name = "ApiRequestError";
  }
}

function parseApiErrorBody(value: unknown): ApiErrorBody {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ApiErrorBody : {};
}

export async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) {
    const body = parseApiErrorBody(await response.json().catch(() => ({})));
    throw new ApiRequestError(response.status, body);
  }
  return (await response.json()) as T;
}
