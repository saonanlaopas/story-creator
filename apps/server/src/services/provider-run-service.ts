import { ZodError } from "zod";
import type { CreateProviderRunInput, JsonValue, ProviderRunDetail, ProviderRunError, ProviderUsage } from "@story-creator/domain";
import { jsonValueSchema, kernelProbeCandidateSchema } from "@story-creator/domain";
import { ProviderRunStateError } from "@story-creator/persistence";
import type { ProviderRunRepository } from "@story-creator/persistence";
import {
  ProviderExecutionError,
  redactProviderText,
  type StoryProvider
} from "../providers/provider.js";

export interface ProviderRunServiceOptions {
  timeoutMs?: number;
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

function normalizedFailure(error: unknown): ProviderRunError {
  if (error instanceof ZodError) {
    return {
      code: "PROVIDER_OUTPUT_MALFORMED",
      message: "Provider output did not match the required candidate schema",
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
  private readonly timeoutMs: number;
  private readonly activeControllers = new Map<string, AbortController>();

  public constructor(
    private readonly repository: ProviderRunRepository,
    providers: StoryProvider[],
    options: ProviderRunServiceOptions = {}
  ) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  public create(projectId: string, input: CreateProviderRunInput): ProviderRunDetail {
    return this.repository.create(projectId, input);
  }

  public createRetry(projectId: string, previousRunId: string): ProviderRunDetail {
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

    const controller = new AbortController();
    this.activeControllers.set(runId, controller);
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new ProviderRunAbortedError()), { once: true });
    });
    if (this.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeoutMs);
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
          signal: controller.signal
        }),
        aborted
      ]);
      observedUsage = result.usage;
      const output = validateCandidate(running.run.kind, result.output);
      return this.repository.complete(projectId, runId, output, result.usage);
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
