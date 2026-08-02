# Story Creator implementation handoff

## Current direction

Checkpoint 1A is complete. The next delivery target is Milestone 1 from
`05-implementation-roadmap.md`: a focused import, understand, chat, mend, and continue
vertical slice.

Use `story-creator-luna-implementation-plan.md` as the detailed engineering contract.
Do not ask an implementation task to complete the whole milestone at once.

## Checkpoint request template

> Use `$sol-advisor:orchestration` to implement Story Creator checkpoint `<ID and
> title>` from the committed Milestone 1 plan.
>
> Before delegation, inspect the current repository, `AGENTS.md`, the roadmap, the
> complete Luna implementation plan, all planning documents relevant to this
> checkpoint, the preceding checkpoint's evidence, and the Story-to-CYOA repository
> only where `06-cyoa-reuse-map.md` permits reuse. Treat accepted repository behavior
> as authoritative and do not redo completed work.
>
> Freeze a five-part implementation specification containing the objective, exact file
> ownership, interfaces, constraints, and concrete verification evidence. Use Luna for
> routine bounded implementation. Use Terra only when migration, transaction,
> concurrency, security, or recovery correctness requires judgment the specification
> cannot adequately encode.
>
> Preserve immutable source, autosaved working drafts, stable IDs, accepted manuscript
> versions, exact base-version checks, transactional candidate application, and local
> restart/reopen behavior. Chat discussion must not mutate artifacts. Failed,
> cancelled, interrupted, malformed, rejected, or stale AI output must not modify
> accepted state.
>
> Use deterministic offline fixtures and fake providers. Make no live or paid provider
> call. Do not copy Story-to-CYOA graph, passage, choice, runtime, prompt, or Twine
> domain code. Do not begin the next checkpoint.
>
> After implementation, inspect the actual diff and rerun lint, typecheck, tests,
> production build, and the relevant browser workflow in the primary session. Obtain
> a fresh Sol review before acceptance. The primary session commits only after a
> `ship` verdict. Do not push or publish unless separately authorized.

## Checkpoint scope block

Append this completed block to the request:

```text
CHECKPOINT
<ID and exact title>

OBJECTIVE
<Observable outcome.>

IN SCOPE
- <Copied from the detailed plan.>

OUT OF SCOPE
- <Copied from the detailed plan.>
- All later checkpoints.

SETTLED CONTRACTS
- <Only the source, autosave, version, provider, chat, or candidate contracts that
  apply to this checkpoint.>

VERIFICATION
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm build
- pnpm test:e2e when API, persistence, navigation, or visible workflow changes
- <Checkpoint-specific regression and rollback evidence.>
```

## Continuation note

Use `docs/continuation.md` only when a checkpoint cannot be completed in one task.
Remove it once the next task has incorporated the note and completed the checkpoint.

```markdown
# Continuation: checkpoint <ID>

## Completed

- ...

## Remaining

- ...

## Verification

- Passed: ...
- Not yet run: ...
- Known failure: ...

## Repository state

- Branch: ...
- Latest accepted commit: ...
- Intentional uncommitted files: ...

## Next concrete step

...
```

## Milestone 1 requirements to preserve

- Imported source is immutable and remains available for evidence and comparison.
- Mending changes a separate working manuscript.
- Manuscript, Bible, Flow, chat, and workspace state autosave locally.
- Autosave drafts are distinct from immutable accepted versions.
- AI change actions flush pending saves, materialize exact input checkpoints, and abort
  before provider execution when saving fails.
- The initial Bible and Flow use structured whole-document versions with stable IDs
  inside them.
- One persistent, visibly scoped conversation is sufficient for Milestone 1.
- Discussion and suggestions cannot mutate project artifacts.
- Mend and continue results remain candidates until explicitly accepted.
- Candidate application verifies exact bases and commits transactionally.
- Continue produces one reviewed next unit at a time.
- Continuation acceptance and restore keep active manuscript order and the Flow
  boundary consistent in one transaction while retaining immutable history.
- Automated verification requires no provider key, internet access, or paid request.
- Premise-first planning, generalized jobs, entity-level histories, archives, advanced
  review, additional import formats, and long-form production queues remain later work.

## Next checkpoint

Begin with M1-A, stabilization of the local core. Do not begin source import until
M1-A has passed primary verification, fresh Sol review, and commit.
