import type { JsonValue, ProviderUsage } from "@story-creator/domain";
import {
  ProviderExecutionError,
  redactProviderText,
  type ProviderRequest,
  type ProviderResult,
  type StoryProvider
} from "./provider.js";

export interface OpenRouterProviderOptions {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  error?: { message?: unknown };
}

function nonnegativeInteger(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
}

function usageFromResponse(response: OpenRouterResponse): ProviderUsage {
  const inputTokens = nonnegativeInteger(response.usage?.prompt_tokens);
  const outputTokens = nonnegativeInteger(response.usage?.completion_tokens);
  const reportedTotal = nonnegativeInteger(response.usage?.total_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(reportedTotal, inputTokens + outputTokens)
  };
}

function responseContent(response: OpenRouterResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part && typeof part === "object" && "text" in part ? String(part.text ?? "") : "")
      .join("");
  }
  throw new ProviderExecutionError("PROVIDER_RESPONSE_INVALID", "OpenRouter returned no completion content", true);
}

function providerError(status: number, response: OpenRouterResponse): ProviderExecutionError {
  const rawMessage = typeof response.error?.message === "string"
    ? response.error.message
    : `OpenRouter request failed (${status})`;
  const message = redactProviderText(rawMessage).slice(0, 500);
  if (status === 401) return new ProviderExecutionError("PROVIDER_UNAUTHENTICATED", message, false);
  if (status === 402) return new ProviderExecutionError("PROVIDER_INSUFFICIENT_CREDITS", message, false);
  if (status === 429) return new ProviderExecutionError("PROVIDER_RATE_LIMITED", message, true);
  if (status === 503 || status === 504) return new ProviderExecutionError("PROVIDER_UNAVAILABLE", message, true);
  return new ProviderExecutionError("PROVIDER_FAILURE", message, status >= 500);
}

function kernelProbeMessages(input: JsonValue): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: "Return only JSON with schemaVersion 1 and an echo field containing the supplied JSON input exactly."
    },
    {
      role: "user",
      content: JSON.stringify(input)
    }
  ];
}

export class OpenRouterProvider implements StoryProvider {
  public readonly id = "openrouter";
  private readonly request: typeof fetch;
  private readonly baseUrl: string;

  public constructor(private readonly options: OpenRouterProviderOptions) {
    this.request = options.fetch ?? globalThis.fetch;
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  }

  public async execute(request: ProviderRequest): Promise<ProviderResult> {
    let response: Response;
    try {
      response = await this.request(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: request.signal,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          messages: kernelProbeMessages(request.input),
          response_format: { type: "json_object" }
        })
      });
    } catch (error) {
      if (request.signal.aborted) {
        throw new ProviderExecutionError("PROVIDER_CANCELLED", "Provider request was cancelled", true);
      }
      const message = error instanceof Error ? redactProviderText(error.message) : "OpenRouter request failed";
      throw new ProviderExecutionError("PROVIDER_FAILURE", message.slice(0, 500), true);
    }

    let envelope: OpenRouterResponse;
    try {
      envelope = await response.json() as OpenRouterResponse;
    } catch {
      throw new ProviderExecutionError("PROVIDER_RESPONSE_INVALID", "OpenRouter returned invalid JSON", true);
    }
    if (!response.ok || envelope.error) throw providerError(response.status, envelope);

    const content = responseContent(envelope);
    let output: unknown;
    try {
      output = JSON.parse(content) as unknown;
    } catch {
      throw new ProviderExecutionError("PROVIDER_OUTPUT_INVALID_JSON", "OpenRouter completion was not valid JSON", true);
    }
    return { output, usage: usageFromResponse(envelope) };
  }
}
