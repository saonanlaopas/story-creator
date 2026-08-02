# Story Creator checkpoint M1-B1

Story Creator is a local-first shell for creating, reopening, and importing story projects. M1-B1 adds an immutable source document and a deterministic read-only outline while keeping manuscript editing and AI workflows out of scope.

## Setup

Install Node.js 22.x (the implementation uses Node's built-in `node:sqlite`) and pnpm 11.9.0. The supported Node major is recorded in `.node-version`. From this directory run:

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

Checkpoint M1-B1 stores the selected mode and the project status (`active`). After creating a project it appears in the saved-project list and is selected in the reopen panel. The selected project ID is kept in local browser storage, so refreshing the page or restarting the local server restores it when the same database is used.

## Importing a source

With a project open, paste text or choose a UTF-8 `.txt`, `.md`, or `.markdown` file. Markdown files are stored as `text/markdown`; pasted text and plain-text files are stored as `text/plain`.

Import performs only these normalizations:

- one leading UTF-8 BOM is removed;
- CRLF and CR line endings become LF;
- all other valid Unicode and punctuation are preserved.

The normalized source is immutable. The application stores its original filename, media type, UTF-8 encoding, raw and normalized SHA-256 hashes, warnings, creation time, and normalized text. A single `source-segmentation-v1` version produces the read-only outline. Markdown H1 headings begin chapters, H2 headings begin scenes, recognized `Chapter 1`, `Chapter I`, or `Chapter One` plain-text headings begin chapters, and standalone `***`, `---`, or `#` lines begin scenes. If no boundary is found, the whole source is one segment. Unsupported heading-like lines remain prose and produce a warning.

All source segment offsets are UTF-16 code-unit offsets, matching JavaScript and TypeScript string indexing. They can be used with `String.slice(startOffset, endOffset)`; a visual Unicode character outside the Basic Multilingual Plane counts as two code units.

## Local database

By default the server writes `data/story-creator.sqlite` relative to the repository. Set `STORY_CREATOR_DATABASE_PATH` to use another file (the parent directories are created automatically). The database opens with foreign keys enabled and applies numbered, checksummed migrations atomically.

## Scope of checkpoint M1-B1

This checkpoint intentionally excludes working manuscript editors, autosave, Bible and Flow artifacts, AI/provider calls, jobs, chat, proposals, archive/export, graphs, passages, runtime features, HTML/DOCX/EPUB import, re-segmentation, and all later workflow checkpoints. Imported source remains available for later evidence and manuscript comparison without being edited in place.
