import { ZodError } from "zod";
import type {
  CreateProviderRunInput,
  JsonValue,
  ProviderExecutionPolicy,
  ProviderRunDetail,
  ProviderRunError,
  ProviderUsage
} from "@story-creator/domain";
import {
  jsonValueSchema,
  kernelProbeCandidateSchema,
  parseCreateProviderRunInput,
  providerExecutionPolicyForKind,
  providerUsageSchema
} from "@story-creator/domain";
import { canonicalJson, ProviderRunStateError } from "@story-creator/persistence";
import type { ProviderRunRepository } from "@story-creator/persistence";
import {
  ProviderExecutionError,
  redactProviderText,
  type StoryProvider
} from "../providers/provider.js";

export interface ProviderRunServiceOptions {
  timeoutMs?: number;
}

export class ProviderRunValidationError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProviderRunValidationError";
  }
}

class ProviderOutputTooLargeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProviderOutputTooLargeError";
  }
}

class ProviderRunAbortedError extends Error {
  public constructor() {
    super("Provider run aborted");
    this.name = "ProviderRunAbortedError";
  }
}

function validateCandidate(kind: CreateProviderRunInput["kind"], output: unknown): JsonValue {
  switch (kind) {
    case "kernel-probe":
      return jsonValueSchema.parse(kernelProbeCandidateSchema.parse(output));
  }
}

function canonicalByteLength(value: JsonValue): number {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

function assertInputWithinPolicy(input: JsonValue, policy: ProviderExecutionPolicy): void {
  const byteLength = canonicalByteLength(input);
  if (byteLength > policy.maxCanonicalInputBytes) {
    throw new ProviderRunValidationError(
      "PROVIDER_INPUT_TOO_LARGE",
      `Canonical provider input is ${byteLength} UTF-8 bytes; the ${policy.version} limit is ${policy.maxCanonicalInputBytes} bytes.`
    );
  }
}

function normalizedFailure(error: unknown): ProviderRunError {
  if (error instanceof ZodError) {
    return {
      code: "PROVIDER_OUTPUT_MALFORMED",
      message: "Provider output did not match the required candidate schema",
      retryable: true
    };
  }
  if (error instanceof ProviderOutputTooLargeError) {
    return {
      code: "PROVIDER_OUTPUT_TOO_LARGE",
      message: error.message,
      retryable: true
    };
  }
  if (error instanceof ProviderExecutionError) {
    return {
      code: error.code,
      message: redactProviderText(error.message).slice(0, 500),
      retryable: error.retryable
    };
  }
  const message = error instanceof Error ? redactProviderText(error.message) : "Provider execution failed";
  return {
    code: "PROVIDER_FAILURE",
    message: message.slice(0, 500),
    retryable: true
  };
}

export class ProviderRunService {
  private readonly providers: Map<string, StoryProvider>;
  private readonly timeoutOverrideMs: number | undefined;
  private readonly activeControllers = new Map<string, AbortController>();

  public constructor(
    private readonly repository: ProviderRunRepository,
    providers: StoryProvider[],
    options: ProviderRunServiceOptions = {}
  ) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
    this.timeoutOverrideMs = options.timeoutMs;
  }

  public create(projectId: string, input: CreateProviderRunInput): ProviderRunDetail {
    const parsed = parseCreateProviderRunInput(input);
    assertInputWithinPolicy(parsed.input, providerExecutionPolicyForKind(parsed.kind));
    return this.repository.create(projectId, parsed);
  }

  public createRetry(projectId: string, previousRunId: string): ProviderRunDetail {
    const previous = this.repository.get(projectId, previousRunId);
    if (previous) assertInputWithinPolicy(previous.run.input, previous.run.executionPolicy);
    return this.repository.createRetry(projectId, previousRunId);
  }

  public get(projectId: string, runId: string): ProviderRunDetail | undefined {
    return this.repository.get(projectId, runId);
  }

  public list(projectId: string): ProviderRunDetail[] {
    return this.repository.list(projectId);
  }

  public recoverInterruptedRuns(): number {
    return this.repository.recoverInterruptedRuns();
  }

  public async execute(projectId: string, runId: string): Promise<ProviderRunDetail> {
    const running = this.repository.markRunning(projectId, runId);
    const provider = this.providers.get(running.run.provider);
    if (!provider) {
      return this.repository.fail(projectId, runId, {
        code: "PROVIDER_NOT_CONFIGURED",
        message: `Provider ${running.run.provider} is not configured on this server`,
        retryable: false
      }, null);
    }

    const policy = running.run.executionPolicy;
    const configuredTimeout = this.timeoutOverrideMs;
    const timeoutMs = configuredTimeout === undefined || !Number.isFinite(configuredTimeout)
      ? policy.timeoutMs
      : Math.min(Math.max(Math.floor(configuredTimeout), 1), policy.timeoutMs);
    const controller = new AbortController();
    this.activeControllers.set(runId, controller);
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new ProviderRunAbortedError()), { once: true });
    });
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    let observedUsage: ProviderUsage | null = null;
    try {
      const result = await Promise.race([
        provider.execute({
          runId,
          kind: running.run.kind,
          model: running.run.model,
          scope: running.run.scope,
          input: running.run.input,
          maxOutputTokens: policy.maxOutputTokens,
          signal: controller.signal
        }),
        aborted
      ]);
      const usage = providerUsageSchema.parse(result.usage);
      observedUsage = usage;
      const output = validateCandidate(running.run.kind, result.output);
      const outputBytes = canonicalByteLength(output);
      if (outputBytes > policy.maxCanonicalValidatedOutputBytes) {
        throw new ProviderOutputTooLargeError(
          `Canonical validated provider output is ${outputBytes} UTF-8 bytes; the ${policy.version} limit is ${policy.maxCanonicalValidatedOutputBytes} bytes.`
        );
      }
      if (usage.outputTokens > policy.maxOutputTokens) {
        throw new ProviderOutputTooLargeError(
          `Provider reported ${usage.outputTokens} output tokens; the ${policy.version} limit is ${policy.maxOutputTokens} tokens.`
        );
      }
      return this.repository.complete(projectId, runId, output, usage);
    } catch (error) {
      const current = this.repository.get(projectId, runId);
      if (current?.run.status === "cancelled") return current;
      if (timedOut) {
        return this.repository.fail(projectId, runId, {
          code: "PROVIDER_TIMEOUT",
          message: "Provider execution timed out",
          retryable: true
        }, null);
      }
      if (error instanceof ProviderRunStateError) throw error;
      return this.repository.fail(projectId, runId, normalizedFailure(error), observedUsage);
    } finally {
      if (timeout) clearTimeout(timeout);
      this.activeControllers.delete(runId);
    }
  }

  public cancel(projectId: string, runId: string): ProviderRunDetail {
    const cancelled = this.repository.cancel(projectId, runId);
    this.activeControllers.get(runId)?.abort();
    return cancelled;
  }
}
