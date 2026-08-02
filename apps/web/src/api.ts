export const selectedProjectStorageKey = "story-creator:selected-project";

export async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}
