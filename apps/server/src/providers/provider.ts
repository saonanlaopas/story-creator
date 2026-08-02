import type { JsonValue, ProviderRunKind, ProviderRunScope, ProviderUsage } from "@story-creator/domain";

export interface ProviderRequest {
  runId: string;
  kind: ProviderRunKind;
  model: string;
  scope: ProviderRunScope;
  input: JsonValue;
  signal: AbortSignal;
}

export interface ProviderResult {
  output: unknown;
  usage: ProviderUsage;
}

export interface StoryProvider {
  readonly id: string;
  execute(request: ProviderRequest): Promise<ProviderResult>;
}

export class ProviderExecutionError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "ProviderExecutionError";
  }
}

const bearerPattern = /(Bearer\s+)[^\s,}"']+/gi;
const environmentPattern = /(OPENROUTER_API_KEY\s*[=:]\s*)[^\s,}"']+/gi;
const openRouterKeyPattern = /\bsk-or-v1-[A-Za-z0-9_.-]{8,}\b/g;

export function redactProviderText(value: string): string {
  return value
    .replace(bearerPattern, "$1[REDACTED]")
    .replace(environmentPattern, "$1[REDACTED]")
    .replace(openRouterKeyPattern, "[REDACTED]");
}
