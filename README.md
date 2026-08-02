# Story Creator planning package

## Purpose

This repository contains the Story Creator planning package and the implemented checkpoint 1A application core. The planning documents remain the product and engineering contract for subsequent checkpoints.

Story Creator is a local-first AI-assisted long-form fiction workspace. A writer can:

- enter only a premise and ask the assistant to suggest or draft the planning foundation;
- import an existing manuscript and reconstruct its bible, timeline, arcs, and scene flow;
- mend selected prose or structure without rewriting unrelated work;
- continue an imported or original story from an explicit boundary;
- discuss any part of the project through a persistent, scoped assistant;
- review, accept, reject, compare, and restore every material AI change.

The application uses OpenRouter for deliberate AI work. Direct editing, project navigation, version history, comparison, validation, restore, and export remain local. Tests use deterministic offline providers and never require a paid request.

## Reading order

1. [01-product-design.md](01-product-design.md) — product behavior and settled decisions.
2. [02-domain-and-versioning.md](02-domain-and-versioning.md) — canonical data, provenance, versions, scopes, and proposals.
3. [03-ai-and-chat-workflows.md](03-ai-and-chat-workflows.md) — suggestion, extraction, mending, continuation, drafting, and assistant behavior.
4. [04-interface-design.md](04-interface-design.md) — guided workspace, manuscript editor, assistant, and review surfaces.
5. [05-implementation-roadmap.md](05-implementation-roadmap.md) — the focused first milestone, later roadmap, and acceptance gates.
6. [06-cyoa-reuse-map.md](06-cyoa-reuse-map.md) — what to copy, adapt, or leave behind from Story to CYOA.
7. [07-handoff-prompt.md](07-handoff-prompt.md) — prompts for starting and continuing implementation in the new repository.
8. [story-creator-luna-implementation-plan.md](story-creator-luna-implementation-plan.md) — detailed Milestone 1 checkpoints, contracts, lane routing, verification, and review protocol.

## Settled long-term product decisions

1. The manuscript and structured project artifacts are canonical; chat is an interface over them.
2. The assistant can suggest or draft every stage. Blank-form completion is never the only path.
3. A premise-only project can run a resumable **Create first planning pass** workflow.
4. Imported source is immutable. Mending creates recoverable manuscript versions.
5. AI discussion cannot mutate canonical state. Changes arrive as scoped proposals.
6. Scope is always visible and manually adjustable.
7. Large changes are divided into coherent review groups with summaries and diffs.
8. Stable IDs and base-version preconditions are used instead of array positions or fragile text offsets.
9. Long work is split into bounded, resumable jobs with persisted checkpoints and cost previews.
10. Failed, cancelled, interrupted, or malformed model output cannot mutate canonical artifacts.
11. Provider reasoning activity may be shown in a bounded, scrollable session panel. It is not persisted as project memory.
12. No live or paid OpenRouter request is part of normal development or automated verification.
13. The first application is single-user and local-first. Cloud collaboration is outside the initial scope.

## Product boundary

This is not another mode inside Story to CYOA. It should be a separate repository and application that reuses proven infrastructure deliberately. Its domain is linear fiction rather than executable branching fiction.

The initial release does not need choice graphs, stats, relationship mechanics, ending reachability, gameplay simulation, a browser game runtime, or Twee/SugarCube export.

## Recommended first implementation

Build Milestone 1 from the roadmap as a sequence of separately reviewed checkpoints. The milestone is a focused vertical slice: import or paste a story, derive a Bible and Flow, edit with autosave, discuss through persistent scoped chat, mend selected prose, and continue with one reviewed next unit. Use the detailed Luna implementation plan as the engineering handoff. Do not make a live model call during automated verification.

## Checkpoint 1A implementation quickstart

The initial local foundation is implemented as a private pnpm workspace (`@story-creator/domain`, `@story-creator/persistence`, `@story-creator/server`, and `@story-creator/web`). Run `pnpm install`, then `pnpm dev` for the local browser shell. Use `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` to verify the checkpoint. The default SQLite file is `data/story-creator.sqlite`; see [docs/user-guide.md](docs/user-guide.md) for the three project modes and restart/reopen behavior. Later planning features remain intentionally out of scope for this checkpoint.
