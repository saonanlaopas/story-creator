import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  openDatabase,
  ProjectRepository,
  ProviderRunNotFoundError,
  ProviderRunRepository,
  ProviderRunStateError
} from "../src/index.js";

const runInput = {
  kind: "kernel-probe" as const,
  provider: "fake",
  model: "fake-v1",
  scope: { type: "project" as const },
  input: { z: 1, a: ["two", true] }
};

describe("provider run persistence", () => {
  it("persists exact pending inputs and atomically completes with one immutable candidate", () => {
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Provider project", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000201"
      });
      const repository = new ProviderRunRepository(database);
      const pending = repository.create(project.id, runInput, {
        id: "00000000-0000-4000-8000-000000000202",
        now: new Date("2025-01-01T00:00:00.000Z")
      });
      expect(pending).toMatchObject({
        run: {
          id: "00000000-0000-4000-8000-000000000202",
          status: "pending",
          input: runInput.input,
          attemptNumber: 1,
          retryOfRunId: null,
          startedAt: null,
          finishedAt: null
        },
        candidate: null
      });
      expect(pending.run.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);

      repository.markRunning(project.id, pending.run.id, { now: new Date("2025-01-01T00:01:00.000Z") });
      const completed = repository.complete(project.id, pending.run.id, {
        schemaVersion: 1,
        echo: runInput.input
      }, {
        inputTokens: 5,
        outputTokens: 3,
        totalTokens: 8
      }, {
        candidateId: "00000000-0000-4000-8000-000000000203",
        now: new Date("2025-01-01T00:02:00.000Z")
      });
      expect(completed).toMatchObject({
        run: {
          status: "completed",
          error: null,
          usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
          startedAt: "2025-01-01T00:01:00.000Z",
          finishedAt: "2025-01-01T00:02:00.000Z"
        },
        candidate: {
          id: "00000000-0000-4000-8000-000000000203",
          output: { schemaVersion: 1, echo: runInput.input }
        }
      });
      expect(() => database.prepare("UPDATE provider_run_candidates SET output_json = '{}' WHERE id = ?").run(completed.candidate?.id)).toThrow(/immutable/i);
      expect(() => repository.complete(project.id, pending.run.id, { schemaVersion: 1 }, {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      })).toThrow(ProviderRunStateError);
    } finally {
      database.close();
    }
  });

  it("rolls back candidate insertion when the completion status transition fails", () => {
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Atomic provider project", entryMode: "premise" });
      const repository = new ProviderRunRepository(database);
      const pending = repository.create(project.id, runInput);
      repository.markRunning(project.id, pending.run.id);
      database.exec(
        `CREATE TRIGGER fail_provider_completion
         BEFORE UPDATE ON provider_runs
         WHEN NEW.status = 'completed'
         BEGIN SELECT RAISE(ABORT, 'simulated provider completion failure'); END`
      );

      expect(() => repository.complete(project.id, pending.run.id, {
        schemaVersion: 1,
        echo: runInput.input
      }, {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      })).toThrow(/simulated provider completion failure/);
      expect(repository.get(project.id, pending.run.id)).toMatchObject({
        run: { status: "running", usage: null },
        candidate: null
      });
      expect(database.prepare("SELECT count(*) AS count FROM provider_run_candidates").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("supports cancellation and linked retries without repeating terminal runs", () => {
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Retry provider project", entryMode: "premise" });
      const repository = new ProviderRunRepository(database);
      const first = repository.create(project.id, runInput, {
        id: "00000000-0000-4000-8000-000000000204"
      });
      const cancelled = repository.cancel(project.id, first.run.id);
      expect(cancelled.run.status).toBe("cancelled");
      expect(repository.cancel(project.id, first.run.id).run.status).toBe("cancelled");

      const retry = repository.createRetry(project.id, first.run.id, {
        id: "00000000-0000-4000-8000-000000000205"
      });
      expect(retry.run).toMatchObject({
        status: "pending",
        attemptNumber: 2,
        retryOfRunId: first.run.id,
        input: first.run.input,
        inputFingerprint: first.run.inputFingerprint
      });
      expect(() => repository.createRetry(project.id, retry.run.id)).toThrow(ProviderRunStateError);
    } finally {
      database.close();
    }
  });

  it("recovers running work after reopen and preserves project ownership", () => {
    const directory = mkdtempSync(join(tmpdir(), "story-creator-provider-run-"));
    const databasePath = join(directory, "story.sqlite");
    let projectId = "";
    let otherProjectId = "";
    let runId = "";
    const firstDatabase = openDatabase(databasePath);
    try {
      const projects = new ProjectRepository(firstDatabase);
      projectId = projects.create({ name: "Interrupted provider project", entryMode: "import-continue" }).id;
      otherProjectId = projects.create({ name: "Other provider project", entryMode: "premise" }).id;
      const repository = new ProviderRunRepository(firstDatabase);
      runId = repository.create(projectId, runInput).run.id;
      repository.markRunning(projectId, runId);
      expect(repository.get(otherProjectId, runId)).toBeUndefined();
      expect(() => repository.markRunning(otherProjectId, runId)).toThrow(ProviderRunNotFoundError);
    } finally {
      firstDatabase.close();
    }

    const reopened = openDatabase(databasePath);
    try {
      const repository = new ProviderRunRepository(reopened);
      expect(repository.recoverInterruptedRuns({ now: new Date("2025-01-02T00:00:00.000Z") })).toBe(1);
      expect(repository.get(projectId, runId)).toMatchObject({
        run: {
          status: "failed",
          error: {
            code: "PROVIDER_INTERRUPTED",
            retryable: true
          },
          finishedAt: "2025-01-02T00:00:00.000Z"
        },
        candidate: null
      });
      expect(repository.recoverInterruptedRuns()).toBe(0);

      reopened.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
      expect(repository.get(projectId, runId)).toBeUndefined();
      expect(reopened.prepare("SELECT count(*) AS count FROM provider_runs").get()).toEqual({ count: 0 });
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
