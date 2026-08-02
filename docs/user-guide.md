# Story Creator checkpoint 1A

Story Creator is a local-first shell for creating and reopening story projects. Checkpoint 1A deliberately keeps the surface small: project records, a local SQLite database, and a browser flow that proves data survives an app restart.

## Setup

Install Node.js 22 or newer (the implementation uses Node's built-in `node:sqlite`) and pnpm. From this directory run:

```text
pnpm install
pnpm dev
```

The development web server is available at <http://127.0.0.1:5173> and proxies `/api` to the Fastify server at <http://127.0.0.1:3001>. For a production-like local server, run `pnpm build` and then `pnpm --filter @story-creator/server start`; the server serves `apps/web/dist` when it is present.

Useful checks are `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e`.

## Creating a project

The create form asks for a non-empty project name and one of three entry modes:

- **Start from a premise** — begin a new story from an idea.
- **Import and mend** — reserve an imported story for focused repairs.
- **Import and continue** — reserve an imported story for continuation from a boundary.

Checkpoint 1A stores the selected mode and the project status (`active`) but does not yet import source text or run any planning workflow. After creating a project it appears in the saved-project list and is selected in the reopen panel. The selected project ID is kept in local browser storage, so refreshing the page or restarting the local server restores it when the same database is used.

## Local database

By default the server writes `data/story-creator.sqlite` relative to the repository. Set `STORY_CREATOR_DATABASE_PATH` to use another file (the parent directories are created automatically). The database opens with foreign keys enabled and applies numbered, checksummed migrations atomically.

## Scope of checkpoint 1A

This checkpoint intentionally excludes source import, manuscript editors, artifacts and versions, AI/provider calls, jobs, chat, proposals, archive/export, graphs, passages, runtime features, and all other checkpoint 1B or later work. The project ID and relational foundation are stable so those later capabilities can add migrations without changing existing project records.
