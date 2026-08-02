import { createHash, randomUUID } from "node:crypto";
import type {
  CreateProviderRunInput,
  JsonValue,
  ProviderRun,
  ProviderRunCandidate,
  ProviderRunDetail,
  ProviderRunError,
  ProviderUsage
} from "@story-creator/domain";
import {
  jsonValueSchema,
  parseCreateProviderRunInput,
  providerRunCandidateSchema,
  providerRunDetailSchema,
  providerRunErrorSchema,
  providerRunSchema,
  providerUsageSchema
} from "@story-creator/domain";
import type { DatabaseSync } from "../database.js";
import { transaction } from "../database.js";

interface ProviderRunRow {
  id: string;
  project_id: string;
  kind: ProviderRun["kind"];
  provider: string;
  model: string;
  status: ProviderRun["status"];
  scope_json: string;
  input_json: string;
  input_fingerprint: string;
  attempt_number: number;
  retry_of_run_id: string | null;
  error_json: string | null;
  usage_json: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface ProviderRunCandidateRow {
  id: string;
  provider_run_id: string;
  output_json: string;
  output_fingerprint: string;
  created_at: string;
}

export interface CreateProviderRunOptions {
  id?: string;
  now?: Date;
}

export interface CompleteProviderRunOptions {
  candidateId?: string;
  now?: Date;
}

export interface TransitionProviderRunOptions {
  now?: Date;
}

export class ProviderRunNotFoundError extends Error {
  public constructor() {
    super("Provider run not found for this project");
    this.name = "ProviderRunNotFoundError";
  }
}

export class ProviderRunStateError extends Error {
  public constructor(public readonly status: ProviderRun["status"], expected: string) {
    super(`Provider run is ${status}; expected ${expected}`);
    this.name = "ProviderRunStateError";
  }
}

function canonicalJsonValue(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonValue).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJsonValue(item)}`).join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  return canonicalJsonValue(jsonValueSchema.parse(value));
}

export function jsonFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function parseStoredJson(value: string): JsonValue {
  return jsonValueSchema.parse(JSON.parse(value) as unknown);
}

function runFromRow(row: ProviderRunRow): ProviderRun {
  return providerRunSchema.parse({
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    provider: row.provider,
    model: row.model,
    status: row.status,
    scope: JSON.parse(row.scope_json) as unknown,
    input: parseStoredJson(row.input_json),
    inputFingerprint: row.input_fingerprint,
    attemptNumber: row.attempt_number,
    retryOfRunId: row.retry_of_run_id,
    error: row.error_json ? JSON.parse(row.error_json) as unknown : null,
    usage: row.usage_json ? JSON.parse(row.usage_json) as unknown : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  });
}

function candidateFromRow(row: ProviderRunCandidateRow): ProviderRunCandidate {
  return providerRunCandidateSchema.parse({
    id: row.id,
    providerRunId: row.provider_run_id,
    output: parseStoredJson(row.output_json),
    outputFingerprint: row.output_fingerprint,
    createdAt: row.created_at
  });
}

const runColumns = `id, project_id, kind, provider, model, status, scope_json, input_json,
  input_fingerprint, attempt_number, retry_of_run_id, error_json, usage_json, created_at,
  updated_at, started_at, finished_at`;

export class ProviderRunRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public create(
    projectId: string,
    input: CreateProviderRunInput,
    options: CreateProviderRunOptions = {}
  ): ProviderRunDetail {
    const parsed = parseCreateProviderRunInput(input);
    return this.insertPending(projectId, parsed, 1, null, options);
  }

  public createRetry(
    projectId: string,
    previousRunId: string,
    options: CreateProviderRunOptions = {}
  ): ProviderRunDetail {
    const previous = this.requireRun(projectId, previousRunId);
    if (previous.status !== "failed" && previous.status !== "cancelled") {
      throw new ProviderRunStateError(previous.status, "failed or cancelled");
    }
    return this.insertPending(projectId, {
      kind: previous.kind,
      provider: previous.provider,
      model: previous.model,
      scope: previous.scope,
      input: previous.input
    }, previous.attemptNumber + 1, previous.id, options);
  }

  public get(projectId: string, runId: string): ProviderRunDetail | undefined {
    const row = this.database
      .prepare(`SELECT ${runColumns} FROM provider_runs WHERE project_id = ? AND id = ?`)
      .get(projectId, runId) as unknown as ProviderRunRow | undefined;
    if (!row) return undefined;
    return this.detailForRun(runFromRow(row));
  }

  public list(projectId: string): ProviderRunDetail[] {
    const rows = this.database
      .prepare(`SELECT ${runColumns} FROM provider_runs WHERE project_id = ? ORDER BY created_at DESC, id ASC`)
      .all(projectId) as unknown as ProviderRunRow[];
    return rows.map((row) => this.detailForRun(runFromRow(row)));
  }

  public markRunning(
    projectId: string,
    runId: string,
    options: TransitionProviderRunOptions = {}
  ): ProviderRunDetail {
    const now = (options.now ?? new Date()).toISOString();
    transaction(this.database, () => {
      const current = this.requireRun(projectId, runId);
      if (current.status !== "pending") throw new ProviderRunStateError(current.status, "pending");
      this.database
        .prepare(
          `UPDATE provider_runs
           SET status = 'running', started_at = ?, updated_at = ?, error_json = NULL,
               usage_json = NULL, finished_at = NULL
           WHERE project_id = ? AND id = ? AND status = 'pending'`
        )
        .run(now, now, projectId, runId);
    });
    return this.requireDetail(projectId, runId);
  }

  public complete(
    projectId: string,
    runId: string,
    output: JsonValue,
    usage: ProviderUsage,
    options: CompleteProviderRunOptions = {}
  ): ProviderRunDetail {
    const parsedOutput = jsonValueSchema.parse(output);
    const parsedUsage = providerUsageSchema.parse(usage);
    const now = (options.now ?? new Date()).toISOString();
    const candidate = providerRunCandidateSchema.parse({
      id: options.candidateId ?? randomUUID(),
      providerRunId: runId,
      output: parsedOutput,
      outputFingerprint: jsonFingerprint(parsedOutput),
      createdAt: now
    });
    transaction(this.database, () => {
      const current = this.requireRun(projectId, runId);
      if (current.status !== "running") throw new ProviderRunStateError(current.status, "running");
      this.database
        .prepare(
          `INSERT INTO provider_run_candidates
            (id, provider_run_id, output_json, output_fingerprint, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          candidate.id,
          candidate.providerRunId,
          canonicalJson(candidate.output),
          candidate.outputFingerprint,
          candidate.createdAt
        );
      this.database
        .prepare(
          `UPDATE provider_runs
           SET status = 'completed', usage_json = ?, error_json = NULL,
               updated_at = ?, finished_at = ?
           WHERE project_id = ? AND id = ? AND status = 'running'`
        )
        .run(canonicalJson(parsedUsage), now, now, projectId, runId);
    });
    return this.requireDetail(projectId, runId);
  }

  public fail(
    projectId: string,
    runId: string,
    error: ProviderRunError,
    usage: ProviderUsage | null = null,
    options: TransitionProviderRunOptions = {}
  ): ProviderRunDetail {
    const parsedError = providerRunErrorSchema.parse(error);
    const parsedUsage = usage === null ? null : providerUsageSchema.parse(usage);
    const now = (options.now ?? new Date()).toISOString();
    transaction(this.database, () => {
      const current = this.requireRun(projectId, runId);
      if (current.status !== "pending" && current.status !== "running") {
        throw new ProviderRunStateError(current.status, "pending or running");
      }
      this.database
        .prepare(
          `UPDATE provider_runs
           SET status = 'failed', error_json = ?, usage_json = ?,
               updated_at = ?, finished_at = ?
           WHERE project_id = ? AND id = ?`
        )
        .run(
          canonicalJson(parsedError),
          parsedUsage === null ? null : canonicalJson(parsedUsage),
          now,
          now,
          projectId,
          runId
        );
    });
    return this.requireDetail(projectId, runId);
  }

  public cancel(
    projectId: string,
    runId: string,
    options: TransitionProviderRunOptions = {}
  ): ProviderRunDetail {
    const current = this.requireRun(projectId, runId);
    if (current.status === "cancelled") return this.requireDetail(projectId, runId);
    if (current.status !== "pending" && current.status !== "running") {
      throw new ProviderRunStateError(current.status, "pending or running");
    }
    const now = (options.now ?? new Date()).toISOString();
    transaction(this.database, () => {
      const fresh = this.requireRun(projectId, runId);
      if (fresh.status !== "pending" && fresh.status !== "running") {
        throw new ProviderRunStateError(fresh.status, "pending or running");
      }
      this.database
        .prepare(
          `UPDATE provider_runs
           SET status = 'cancelled', error_json = NULL, usage_json = NULL,
               updated_at = ?, finished_at = ?
           WHERE project_id = ? AND id = ?`
        )
        .run(now, now, projectId, runId);
    });
    return this.requireDetail(projectId, runId);
  }

  public recoverInterruptedRuns(options: TransitionProviderRunOptions = {}): number {
    const now = (options.now ?? new Date()).toISOString();
    const error = providerRunErrorSchema.parse({
      code: "PROVIDER_INTERRUPTED",
      message: "Provider execution was interrupted by a server restart; retry the run",
      retryable: true
    });
    let changed = 0;
    transaction(this.database, () => {
      const result = this.database
        .prepare(
          `UPDATE provider_runs
           SET status = 'failed', error_json = ?, usage_json = NULL,
               updated_at = ?, finished_at = ?
           WHERE status = 'running'`
        )
        .run(canonicalJson(error), now, now);
      changed = Number(result.changes);
    });
    return changed;
  }

  private insertPending(
    projectId: string,
    input: CreateProviderRunInput,
    attemptNumber: number,
    retryOfRunId: string | null,
    options: CreateProviderRunOptions
  ): ProviderRunDetail {
    const id = options.id ?? randomUUID();
    const now = (options.now ?? new Date()).toISOString();
    const run = providerRunSchema.parse({
      id,
      projectId,
      kind: input.kind,
      provider: input.provider,
      model: input.model,
      status: "pending",
      scope: input.scope,
      input: input.input,
      inputFingerprint: jsonFingerprint(input.input),
      attemptNumber,
      retryOfRunId,
      error: null,
      usage: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null
    });
    transaction(this.database, () => {
      this.database
        .prepare(
          `INSERT INTO provider_runs
            (id, project_id, kind, provider, model, status, scope_json, input_json,
             input_fingerprint, attempt_number, retry_of_run_id, error_json, usage_json,
             created_at, updated_at, started_at, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL)`
        )
        .run(
          run.id,
          run.projectId,
          run.kind,
          run.provider,
          run.model,
          run.status,
          canonicalJson(run.scope),
          canonicalJson(run.input),
          run.inputFingerprint,
          run.attemptNumber,
          run.retryOfRunId,
          run.createdAt,
          run.updatedAt
        );
    });
    return this.requireDetail(projectId, id);
  }

  private requireRun(projectId: string, runId: string): ProviderRun {
    const row = this.database
      .prepare(`SELECT ${runColumns} FROM provider_runs WHERE project_id = ? AND id = ?`)
      .get(projectId, runId) as unknown as ProviderRunRow | undefined;
    if (!row) throw new ProviderRunNotFoundError();
    return runFromRow(row);
  }

  private requireDetail(projectId: string, runId: string): ProviderRunDetail {
    const detail = this.get(projectId, runId);
    if (!detail) throw new ProviderRunNotFoundError();
    return detail;
  }

  private detailForRun(run: ProviderRun): ProviderRunDetail {
    const candidateRow = this.database
      .prepare(
        `SELECT id, provider_run_id, output_json, output_fingerprint, created_at
         FROM provider_run_candidates WHERE provider_run_id = ?`
      )
      .get(run.id) as unknown as ProviderRunCandidateRow | undefined;
    return providerRunDetailSchema.parse({
      run,
      candidate: candidateRow ? candidateFromRow(candidateRow) : null
    });
  }
}
