import { describe, expect, it } from "vitest";
import { kernelProbeExecutionPolicy } from "@story-creator/domain";
import {
  canonicalJson,
  ManuscriptRepository,
  openDatabase,
  ProjectRepository,
  ProviderRunRepository,
  SourceRepository
} from "@story-creator/persistence";
import { FakeProvider } from "../src/providers/fake-provider.js";
import { OpenRouterProvider } from "../src/providers/openrouter-provider.js";
import { redactProviderText } from "../src/providers/provider.js";
import { ProviderRunService, ProviderRunValidationError } from "../src/services/provider-run-service.js";

const input = {
  kind: "kernel-probe" as const,
  provider: "fake",
  model: "fake-v1",
  scope: { type: "project" as const },
  input: { title: "Offline probe" }
};

function setup(fake = new FakeProvider(), timeoutMs = 500) {
  const database = openDatabase();
  const project = new ProjectRepository(database).create({ name: "Provider service", entryMode: "import-mend" });
  const repository = new ProviderRunRepository(database);
  const service = new ProviderRunService(repository, [fake], { timeoutMs });
  return { database, project, repository, service, fake };
}

function valueAtCanonicalBytes(target: number): { value: string } {
  const emptyBytes = Buffer.byteLength(canonicalJson({ value: "" }), "utf8");
  return { value: "x".repeat(target - emptyBytes) };
}

function candidateAtCanonicalBytes(target: number) {
  const emptyBytes = Buffer.byteLength(canonicalJson({ schemaVersion: 1, echo: { value: "" } }), "utf8");
  return { schemaVersion: 1 as const, echo: { value: "x".repeat(target - emptyBytes) } };
}

describe("provider run service", () => {
  it("does not call a provider until explicit execution and stores validated output", async () => {
    const { database, project, service, fake } = setup();
    try {
      const pending = service.create(project.id, input);
      expect(pending.run.status).toBe("pending");
      expect(fake.calls).toHaveLength(0);

      const completed = await service.execute(project.id, pending.run.id);
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0].maxOutputTokens).toBe(kernelProbeExecutionPolicy.maxOutputTokens);
      expect(completed).toMatchObject({
        run: {
          status: "completed",
          executionPolicy: kernelProbeExecutionPolicy,
          error: null,
          usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }
        },
        candidate: {
          output: { schemaVersion: 1, echo: input.input }
        }
      });
    } finally {
      database.close();
    }
  });

  it("enforces the canonical input ceiling before persistence or provider execution", () => {
    const { database, project, service, repository, fake } = setup();
    try {
      const exact = service.create(project.id, {
        ...input,
        input: valueAtCanonicalBytes(kernelProbeExecutionPolicy.maxCanonicalInputBytes)
      });
      expect(Buffer.byteLength(canonicalJson(exact.run.input), "utf8")).toBe(kernelProbeExecutionPolicy.maxCanonicalInputBytes);
      expect(fake.calls).toHaveLength(0);

      expect(() => service.create(project.id, {
        ...input,
        input: valueAtCanonicalBytes(kernelProbeExecutionPolicy.maxCanonicalInputBytes + 1)
      })).toThrow(ProviderRunValidationError);
      expect(repository.list(project.id)).toHaveLength(1);
      expect(fake.calls).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("isolates malformed output and preserves all accepted source and manuscript state", async () => {
    const fake = new FakeProvider(() => ({
      output: { unexpected: true },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    }));
    const { database, project, service } = setup(fake);
    try {
      const sourceRepository = new SourceRepository(database);
      const source = sourceRepository.create(project.id, {
        filename: "provider-source.txt",
        mediaType: "text/plain",
        encoding: "utf-8",
        text: "Immutable provider source"
      });
      const manuscriptRepository = new ManuscriptRepository(database, sourceRepository);
      const manuscript = manuscriptRepository.initialize(project.id, source.document.id);
      const sourceBefore = sourceRepository.get(project.id, source.document.id);
      const manuscriptBefore = manuscriptRepository.get(project.id);
      expect(manuscriptBefore).toEqual(manuscript);

      const failed = await service.execute(project.id, service.create(project.id, input).run.id);
      expect(failed).toMatchObject({
        run: {
          status: "failed",
          error: { code: "PROVIDER_OUTPUT_MALFORMED", retryable: true },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
        },
        candidate: null
      });
      expect(sourceRepository.get(project.id, source.document.id)).toEqual(sourceBefore);
      expect(manuscriptRepository.get(project.id)).toEqual(manuscriptBefore);
      expect(database.prepare("SELECT count(*) AS count FROM provider_run_candidates").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("accepts output at the byte ceiling and rejects oversized output without a candidate", async () => {
    const fake = new FakeProvider((request) => {
      const mode = (request.input as { mode?: string }).mode;
      if (mode === "oversized") {
        return {
          output: candidateAtCanonicalBytes(kernelProbeExecutionPolicy.maxCanonicalValidatedOutputBytes + 1),
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
        };
      }
      if (mode === "too-many-tokens") {
        return {
          output: { schemaVersion: 1, echo: { mode } },
          usage: {
            inputTokens: 1,
            outputTokens: kernelProbeExecutionPolicy.maxOutputTokens + 1,
            totalTokens: kernelProbeExecutionPolicy.maxOutputTokens + 2
          }
        };
      }
      return {
        output: candidateAtCanonicalBytes(kernelProbeExecutionPolicy.maxCanonicalValidatedOutputBytes),
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
      };
    });
    const { database, project, service } = setup(fake);
    try {
      const sourceRepository = new SourceRepository(database);
      const source = sourceRepository.create(project.id, {
        filename: "bounded-source.txt",
        mediaType: "text/plain",
        encoding: "utf-8",
        text: "Accepted source remains unchanged"
      });
      const manuscriptRepository = new ManuscriptRepository(database, sourceRepository);
      const manuscript = manuscriptRepository.initialize(project.id, source.document.id);
      const sourceBefore = sourceRepository.get(project.id, source.document.id);
      const manuscriptBefore = manuscriptRepository.get(project.id);

      const exact = await service.execute(project.id, service.create(project.id, {
        ...input,
        input: { mode: "exact" }
      }).run.id);
      expect(exact.run.status).toBe("completed");
      expect(exact.candidate).not.toBeNull();
      expect(Buffer.byteLength(canonicalJson(exact.candidate!.output), "utf8")).toBe(
        kernelProbeExecutionPolicy.maxCanonicalValidatedOutputBytes
      );

      const oversized = await service.execute(project.id, service.create(project.id, {
        ...input,
        input: { mode: "oversized" }
      }).run.id);
      expect(oversized).toMatchObject({
        run: { status: "failed", error: { code: "PROVIDER_OUTPUT_TOO_LARGE" } },
        candidate: null
      });

      const tooManyTokens = await service.execute(project.id, service.create(project.id, {
        ...input,
        input: { mode: "too-many-tokens" }
      }).run.id);
      expect(tooManyTokens).toMatchObject({
        run: { status: "failed", error: { code: "PROVIDER_OUTPUT_TOO_LARGE" } },
        candidate: null
      });
      expect(database.prepare("SELECT count(*) AS count FROM provider_run_candidates").get()).toEqual({ count: 1 });
      expect(sourceRepository.get(project.id, source.document.id)).toEqual(sourceBefore);
      expect(manuscriptRepository.get(project.id)).toEqual(manuscriptBefore);
      expect(manuscript).toEqual(manuscriptBefore);
    } finally {
      database.close();
    }
  });

  it("times out bounded execution without persisting a candidate", async () => {
    const fake = new FakeProvider(() => new Promise(() => undefined));
    const { database, project, service } = setup(fake, 10);
    try {
      const failed = await service.execute(project.id, service.create(project.id, input).run.id);
      expect(failed).toMatchObject({
        run: {
          status: "failed",
          error: { code: "PROVIDER_TIMEOUT", retryable: true }
        },
        candidate: null
      });
    } finally {
      database.close();
    }
  });

  it("cancels active execution and does not overwrite cancellation with failure", async () => {
    const fake = new FakeProvider((request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener("abort", () => reject(new Error("aborted by test")), { once: true });
    }));
    const { database, project, service } = setup(fake);
    try {
      const pending = service.create(project.id, input);
      const execution = service.execute(project.id, pending.run.id);
      expect(fake.calls).toHaveLength(1);
      expect(service.cancel(project.id, pending.run.id).run.status).toBe("cancelled");
      const cancelled = await execution;
      expect(cancelled).toMatchObject({ run: { status: "cancelled", error: null }, candidate: null });

      const retry = service.createRetry(project.id, pending.run.id);
      expect(retry.run).toMatchObject({
        attemptNumber: 2,
        retryOfRunId: pending.run.id,
        status: "pending",
        executionPolicy: pending.run.executionPolicy
      });
      expect(fake.calls).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("keeps the OpenRouter credential out of persisted errors and returned payloads", async () => {
    const apiKey = "sk-or-v1-super-secret-provider-key";
    let authorization = "";
    let requestBody: { max_tokens?: number } | undefined;
    const openRouter = new OpenRouterProvider({
      apiKey,
      fetch: async (_url, init) => {
        authorization = String(new Headers(init?.headers).get("authorization"));
        requestBody = JSON.parse(String(init?.body)) as { max_tokens?: number };
        return new Response(JSON.stringify({
          error: { message: `Upstream echoed ${apiKey} and Bearer ${apiKey}` }
        }), {
          status: 500,
          headers: { "content-type": "application/json" }
        });
      }
    });
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Credential boundary", entryMode: "premise" });
      const service = new ProviderRunService(new ProviderRunRepository(database), [openRouter]);
      const pending = service.create(project.id, { ...input, provider: "openrouter", model: "offline/stub" });
      const failed = await service.execute(project.id, pending.run.id);

      expect(authorization).toBe(`Bearer ${apiKey}`);
      expect(requestBody?.max_tokens).toBe(kernelProbeExecutionPolicy.maxOutputTokens);
      expect(JSON.stringify(failed)).not.toContain(apiKey);
      expect(JSON.stringify(failed)).toContain("[REDACTED]");
      const stored = database.prepare("SELECT error_json, input_json, scope_json FROM provider_runs WHERE id = ?").get(pending.run.id);
      expect(JSON.stringify(stored)).not.toContain(apiKey);
    } finally {
      database.close();
    }
  });

  it("redacts an arbitrary configured OpenRouter secret before normalized persistence", async () => {
    const apiKey = "local-development-secret-123";
    const openRouter = new OpenRouterProvider({
      apiKey,
      fetch: async () => new Response(JSON.stringify({
        error: { message: `Upstream echoed ${apiKey} without a credential prefix` }
      }), {
        status: 502,
        headers: { "content-type": "application/json" }
      })
    });
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Exact secret boundary", entryMode: "premise" });
      const service = new ProviderRunService(new ProviderRunRepository(database), [openRouter]);
      const pending = service.create(project.id, { ...input, provider: "openrouter", model: "offline/stub" });
      const failed = await service.execute(project.id, pending.run.id);

      expect(failed.run.error?.message).toContain("[REDACTED]");
      expect(JSON.stringify(failed)).not.toContain(apiKey);
      const stored = database.prepare("SELECT error_json FROM provider_runs WHERE id = ?").get(pending.run.id);
      expect(JSON.stringify(stored)).not.toContain(apiKey);
      expect(JSON.stringify(stored)).toContain("[REDACTED]");
    } finally {
      database.close();
    }
  });

  it("keeps existing credential redaction patterns and ignores empty secrets", () => {
    const redacted = redactProviderText(
      "Bearer bearer-value OPENROUTER_API_KEY=environment-value sk-or-v1-pattern-value exact-value",
      ["", "exact-value"]
    );
    expect(redacted).toBe("Bearer [REDACTED] OPENROUTER_API_KEY=[REDACTED] [REDACTED] [REDACTED]");
    expect(redactProviderText("safe text", [""])).toBe("safe text");
  });

  it("redacts an arbitrary configured OpenRouter secret from network failures", async () => {
    const apiKey = "local-development-secret-123";
    const openRouter = new OpenRouterProvider({
      apiKey,
      fetch: async () => {
        throw new Error(`Network failure echoed ${apiKey}`);
      }
    });
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Network secret boundary", entryMode: "premise" });
      const service = new ProviderRunService(new ProviderRunRepository(database), [openRouter]);
      const pending = service.create(project.id, { ...input, provider: "openrouter", model: "offline/stub" });
      const failed = await service.execute(project.id, pending.run.id);

      expect(failed.run.error?.message).toContain("[REDACTED]");
      expect(JSON.stringify(failed)).not.toContain(apiKey);
    } finally {
      database.close();
    }
  });
});
