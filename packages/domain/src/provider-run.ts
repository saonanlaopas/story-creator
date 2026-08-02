import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(jsonValueSchema)
]));

const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
const timestampSchema = z.string().min(1);

export const providerRunKinds = ["kernel-probe"] as const;
export type ProviderRunKind = (typeof providerRunKinds)[number];

export const providerRunStatuses = ["pending", "running", "completed", "failed", "cancelled"] as const;
export type ProviderRunStatus = (typeof providerRunStatuses)[number];

export const providerExecutionPolicySchema = z
  .object({
    version: z.string().trim().min(1),
    maxCanonicalInputBytes: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    maxCanonicalValidatedOutputBytes: z.number().int().positive(),
    timeoutMs: z.number().int().positive()
  })
  .strict();

export type ProviderExecutionPolicy = z.infer<typeof providerExecutionPolicySchema>;

export const kernelProbeExecutionPolicy = Object.freeze({
  version: "kernel-probe-execution-v1",
  maxCanonicalInputBytes: 4_096,
  maxOutputTokens: 256,
  maxCanonicalValidatedOutputBytes: 8_192,
  timeoutMs: 30_000
} satisfies ProviderExecutionPolicy);

export function providerExecutionPolicyForKind(kind: ProviderRunKind): ProviderExecutionPolicy {
  switch (kind) {
    case "kernel-probe":
      return kernelProbeExecutionPolicy;
  }
}

export const providerRunScopeSchema = z
  .object({
    type: z.literal("project")
  })
  .strict();

export type ProviderRunScope = z.infer<typeof providerRunScopeSchema>;

const credentialKeyPattern = /^(?:api[_-]?key|authorization|openrouter[_-]?api[_-]?key|access[_-]?token|bearer[_-]?token)$/i;
const credentialValuePattern = /(?:\bBearer\s+\S+|\bsk-or-v1-[A-Za-z0-9_.-]{8,}\b)/i;

function containsCredentialMaterial(value: JsonValue): boolean {
  if (typeof value === "string") return credentialValuePattern.test(value);
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsCredentialMaterial);
  return Object.entries(value).some(([key, item]) => credentialKeyPattern.test(key) || containsCredentialMaterial(item));
}

export const createProviderRunInputSchema = z
  .object({
    kind: z.enum(providerRunKinds),
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1),
    scope: providerRunScopeSchema,
    input: jsonValueSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (containsCredentialMaterial(value.input)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["input"],
        message: "Provider credentials must not be included in persisted run input"
      });
    }
  });

export type CreateProviderRunInput = z.infer<typeof createProviderRunInputSchema>;

export function parseCreateProviderRunInput(value: unknown): CreateProviderRunInput {
  return createProviderRunInputSchema.parse(value);
}

export const providerUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative()
  })
  .strict()
  .refine((usage) => usage.totalTokens >= usage.inputTokens + usage.outputTokens, {
    message: "Total tokens must include input and output tokens"
  });

export type ProviderUsage = z.infer<typeof providerUsageSchema>;

export const providerRunErrorSchema = z
  .object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    retryable: z.boolean()
  })
  .strict();

export type ProviderRunError = z.infer<typeof providerRunErrorSchema>;

export const providerRunSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    kind: z.enum(providerRunKinds),
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1),
    status: z.enum(providerRunStatuses),
    scope: providerRunScopeSchema,
    input: jsonValueSchema,
    inputFingerprint: fingerprintSchema,
    executionPolicy: providerExecutionPolicySchema,
    attemptNumber: z.number().int().positive(),
    retryOfRunId: z.string().uuid().nullable(),
    error: providerRunErrorSchema.nullable(),
    usage: providerUsageSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    startedAt: timestampSchema.nullable(),
    finishedAt: timestampSchema.nullable()
  })
  .strict();

export type ProviderRun = z.infer<typeof providerRunSchema>;

export const providerRunCandidateSchema = z
  .object({
    id: z.string().uuid(),
    providerRunId: z.string().uuid(),
    output: jsonValueSchema,
    outputFingerprint: fingerprintSchema,
    createdAt: timestampSchema
  })
  .strict();

export type ProviderRunCandidate = z.infer<typeof providerRunCandidateSchema>;

export const providerRunDetailSchema = z
  .object({
    run: providerRunSchema,
    candidate: providerRunCandidateSchema.nullable()
  })
  .strict();

export type ProviderRunDetail = z.infer<typeof providerRunDetailSchema>;

export const kernelProbeCandidateSchema = z
  .object({
    schemaVersion: z.literal(1),
    echo: jsonValueSchema
  })
  .strict();

export type KernelProbeCandidate = z.infer<typeof kernelProbeCandidateSchema>;
