export type { DatabaseSync, OpenDatabaseOptions } from "./database.js";
export { openDatabase, transaction } from "./database.js";
export type { Migration } from "./migrations.js";
export { applyMigrations, readMigrations } from "./migrations.js";
export { ProjectRepository } from "./repositories/project-repository.js";
export type { CreateProjectOptions } from "./repositories/project-repository.js";
export { ImmutableSourceError, SourceRepository } from "./repositories/source-repository.js";
export type { CreateSourceOptions } from "./repositories/source-repository.js";
export {
  DraftRevisionConflictError,
  ManuscriptAlreadyInitializedError,
  ManuscriptNotFoundError,
  ManuscriptRepository,
  ManuscriptUnitNotFoundError,
  SourceForManuscriptNotFoundError
} from "./repositories/manuscript-repository.js";
export type {
  CheckpointManuscriptUnitOptions,
  CheckpointManuscriptUnitResult,
  InitializeManuscriptOptions,
  SaveManuscriptDraftOptions,
  SaveManuscriptDraftResult
} from "./repositories/manuscript-repository.js";
