import { z } from "zod";

export const projectEntryModes = ["premise", "import-mend", "import-continue"] as const;
export type ProjectEntryMode = (typeof projectEntryModes)[number];

export const projectStatuses = ["active"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const createProjectInputSchema = z
  .object({
    name: z.string().trim().min(1, "Project name must not be empty"),
    entryMode: z.enum(projectEntryModes)
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const projectRecordSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1),
    entryMode: z.enum(projectEntryModes),
    status: z.enum(projectStatuses),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1)
  })
  .strict();

export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export function parseCreateProjectInput(value: unknown): CreateProjectInput {
  return createProjectInputSchema.parse(value);
}

export function parseProjectRecord(value: unknown): ProjectRecord {
  return projectRecordSchema.parse(value);
}
