# Story Creator engineering instructions

## Scope and ownership

- Treat the planning documents and previously accepted checkpoints as the product and
  engineering contract.
- Implement one named checkpoint at a time. Do not pull later checkpoint behavior
  forward or perform speculative refactors.
- Preserve unrelated working-tree changes. In particular, do not rewrite planning
  documents that are already modified by the owner.
- Story Creator is a separate linear-fiction product. Do not introduce Story-to-CYOA
  passages, choices, routes, runtime, prompts, or Twine assumptions.

## Required verification

Run these commands for every checkpoint:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm test:e2e` whenever API, persistence, navigation, or visible behavior
changes. Automated verification uses deterministic offline fixtures and fake providers;
never make a live or paid OpenRouter request.

The supported runtime is Node.js 22, recorded in `.node-version`. Use the frozen
`pnpm-lock.yaml` for installs.

## Data integrity invariants

- Imported source is immutable and remains available for evidence and comparison.
- Working drafts are separate from immutable accepted versions and use explicit
  revisions and content fingerprints.
- Stable IDs, exact version preconditions, and transactional application are required
  for AI-generated changes.
- A failed transaction must leave every write in that transaction unapplied.
- Provider output must never mutate accepted project state directly.
- Credentials stay server-side and out of browser payloads, logs, prompts, and exports.

## Package boundaries

- `packages/domain` owns validated product contracts and stable domain types.
- `packages/persistence` owns SQLite connections, migrations, transactions, and
  repositories; callers should not duplicate SQL or migration policy.
- `apps/server` owns HTTP configuration and route composition over domain and
  persistence services.
- `apps/web` owns browser state, presentation, and API calls; it must not access
  SQLite or server-only credentials.

Keep boundaries small and extract only what the active checkpoint or the next explicit
checkpoint requires.
