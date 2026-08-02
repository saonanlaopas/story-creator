# Story Creator Milestone 1: Luna implementation plan

**Baseline:** checkpoint 1A at `78d5ba29533692230f4d83893eccdfbe4155c5be`  
**Routine implementation lane:** GPT-5.6 Luna, max reasoning  
**Complex implementation lane:** GPT-5.6 Terra, max reasoning, only when justified  
**Acceptance reviewer:** fresh GPT-5.6 Sol, high reasoning  
**Provider policy:** deterministic fake provider for automated verification; no live or
paid provider call without separate, explicit authorization

## 1. Objective

Deliver one finished vertical slice:

```text
import or paste a story
  -> inspect an extracted Bible and Flow
  -> edit with autosave
  -> discuss through persistent scoped chat
  -> mend selected prose through a reviewed candidate
  -> continue with one reviewed next unit
  -> restart and reopen without losing work
```

This plan deliberately postpones the generalized platform described in the broader
product documents. It does not weaken the invariants that would be expensive to add
later: immutable source, transactional candidate application, stable IDs, accepted
manuscript versions, and migration compatibility.

Implement exactly one checkpoint per task. Do not begin the next checkpoint while
fixing or reviewing the current one.

## 2. Existing baseline

Checkpoint 1A already contains:

- the pnpm workspace and `@story-creator/*` namespace;
- domain, persistence, server, and web packages;
- numbered checksum-verified SQLite migrations;
- project creation for premise, import-mend, and import-continue;
- health, lint, typecheck, test, build, and browser-test commands;
- project create, close, server restart, and reopen coverage;
- failed-write rollback coverage.

Treat accepted baseline behavior as authoritative. Do not reconstruct checkpoint 1A.

## 3. Settled Milestone 1 contracts

### 3.1 Source and manuscript

- Imported normalized source text is immutable.
- The source retains original filename, media type, encoding, content hash, normalized
  text hash, warnings, and created timestamp.
- Normalize CRLF and CR to LF, remove one leading UTF-8 BOM, and otherwise preserve
  valid Unicode code points. Do not apply broad punctuation replacement.
- Text spans use UTF-16 code-unit offsets because the web and server implementation is
  TypeScript. Store and document this choice anywhere offsets cross an interface.
- Source segmentation is deterministic and versioned. Milestone 1 creates the first
  segmentation version; re-segmentation UI is deferred.
- Segment headings are nullable. Every segment has a stable opaque ID, parent ID,
  position, kind, offsets, and content fingerprint.
- The working manuscript is separate from source and may change.
- Manuscript identity and ordering live in stable units. Prose lives in immutable unit
  versions. Current and accepted version pointers are separate.
- Milestone 1 imports one ordered level of manuscript units. Nested production
  hierarchy is deferred.

### 3.2 Autosave and versions

- Editable manuscript, Bible, and Flow drafts autosave to mutable working records.
- Every working record has a monotonic draft revision and full-content fingerprint.
- Use a short debounce and flush on navigation where the platform provides a reliable
  signal. Never claim that abrupt process termination can synchronously flush a pending
  browser write.
- The UI shows `Saving`, `Saved`, and actionable `Save failed` states.
- Autosave does not create an immutable version per keystroke.
- Accepted AI changes and explicit user checkpoints create immutable versions.
- A no-op save changes neither content nor version history.
- On autosave failure, the last persisted draft remains valid and the unsaved UI state
  remains visible for retry.
- Before an AI action that may create a change candidate, flush every pending input
  save. If any flush fails, do not call the provider.
- In the same start transaction, materialize an immutable input checkpoint for each
  changed draft and capture its draft revision and fingerprint. Reuse an identical
  existing checkpoint rather than creating a no-op version.
- Candidate acceptance rechecks the current draft revisions and fingerprints as well
  as immutable version IDs. Any intervening edit makes the candidate stale.

### 3.3 Bible and Flow

Milestone 1 uses two structured whole-document artifacts:

- `story-bible`
- `story-flow`

Each has a stable artifact ID, mutable working draft, immutable accepted/checkpoint
versions, schema version, content fingerprint, and current/accepted pointers.

Items inside the documents use stable opaque IDs. Renaming or reordering an item does
not change its ID. Cross-document references use those IDs and are validated before an
accepted version is created.

The Bible includes summary, characters, relationships, locations, world facts,
timeline, style observations, and unresolved facts. The Flow includes ordered beats,
threads, setups/payoffs, open obligations, and the continuation boundary.

Entity-level version tables and a generalized dependency graph are later work.

### 3.4 Provider runs

- Provider configuration remains server-side.
- Automated tests use a deterministic fake provider.
- A provider run has `pending`, `running`, `completed`, `failed`, or `cancelled` status.
- Store exact input fingerprints, scope, provider/model identifier, validated candidate
  output, normalized error, usage summary, and timestamps.
- Candidate persistence and transition to `completed` occur in one transaction.
- A `running` run found during restart becomes `failed` with a retryable interruption
  reason. General mid-unit resume is deferred.
- Retry creates a new attempt linked to the prior run and does not duplicate accepted
  artifact changes.
- Malformed, failed, cancelled, or interrupted output cannot mutate accepted artifacts.
- Raw hidden provider reasoning is neither requested as project memory nor persisted.

For the prototype, local OpenRouter use may be configured through a server environment
variable. A credential-management UI and encrypted credential store are deferred.
Never expose the variable to the browser, logs, project records, prompts, or exports.

### 3.5 Chat

- One primary conversation belongs to each project in Milestone 1.
- Messages, role, visible scope, run reference, and timestamps are persisted.
- Scope may be project, Bible item, Flow item, manuscript unit, or a prose selection.
- Context is bounded to the selected scope, directly relevant Bible/Flow items, and
  nearby manuscript text. Do not send the entire manuscript by default.
- Discuss and suggest return messages only. They cannot mutate artifacts.
- Change actions create typed candidates.

### 3.6 Mend and continue candidates

Milestone 1 supports these candidate operation families only:

```ts
type CandidateOperation =
  | ReplaceManuscriptSelection
  | ReplaceBibleDocument
  | ReplaceFlowDocument
  | AppendManuscriptUnit;
```

Every candidate records its exact base version IDs and input fingerprints.

For change actions, those bases are the immutable input checkpoints created after the
autosave barrier. The provider run also records the captured mutable draft revisions
and full-content fingerprints. Generation does not begin if the barrier fails, and
acceptance fails stale if any relevant draft or manuscript ordering revision changed.

A manuscript selection anchor includes:

- manuscript unit ID;
- exact base version ID;
- UTF-16 start and end offsets;
- selected-text fingerprint;
- bounded prefix and suffix fingerprints.

Offsets help display the selection but are not the only precondition. Reject a stale
anchor instead of silently fuzzy-merging.

Candidate acceptance:

1. reloads current base records;
2. verifies exact versions and fingerprints;
3. validates candidate schemas and references;
4. inserts immutable versions;
5. updates current/accepted pointers or appends the new unit;
6. updates the continuation boundary when applicable;
7. marks the candidate accepted;
8. commits all changes in one SQLite transaction.

Any failure rolls back the complete operation.

Continuation acceptance also creates a narrow `ContinuationCheckpoint` containing:

- prior and resulting manuscript structure revisions;
- prior active ordered manuscript unit IDs and exact version IDs;
- appended manuscript unit and version IDs;
- prior and resulting Flow version IDs;
- candidate and provider-run IDs;
- timestamp.

Restoring this checkpoint is one transaction. It verifies the expected current
structure and Flow bases, retains the appended records for history, removes the
appended unit from the active order, creates a new Flow version from the recorded prior
content, advances the structure revision, and marks the checkpoint restored. Restore
never deletes manuscript or Flow history.

## 4. Checkpoint sequence

### M1-A: Stabilize the local core

#### Objective

Make checkpoint 1A reliable enough to receive source and manuscript migrations.

#### Required changes

- Add CI using the pinned supported Node major and frozen lockfile.
- Add root `AGENTS.md` with scope, verification, source immutability, transaction, and
  Story-to-CYOA reuse boundaries.
- Split entry-point files into exports, routes, repositories, and feature modules as
  necessary for the next checkpoint. Preserve public behavior.
- Add a rollback test that completes at least two writes and then throws before commit.
- Add a frozen SQLite fixture representing schema version 1, plus a test that opens it
  through the production migration runner.

#### Out of scope

All new story, provider, chat, mend, and continue behavior.

#### Verification

- clean install using the frozen lockfile;
- lint, typecheck, unit/integration tests, production build;
- existing project create/restart/reopen browser test;
- migration-001 fixture open;
- failed multi-write rollback.

#### Acceptance

CI and local verification pass without credentials, and no existing checkpoint 1A
workflow regresses.

### M1-B1: Immutable source import

#### Objective

Let a writer import or paste a story into immutable evidence records.

#### Required records

- source document;
- source segmentation version;
- source segment;

Use an explicit numbered migration. Foreign keys and project ownership constraints are
mandatory.

#### Required behavior

- Paste, TXT, and Markdown ingestion.
- Deterministic normalization, hashes, and segmentation.
- Atomic source and segment creation.
- Read-only source and outline view.
- Project restart/reopen restores the selected source segment.

#### Required tests

- BOM, CRLF, smart punctuation, non-Latin text, and empty input;
- deterministic normalized hash and segmentation;
- source update rejected;
- failed import writes nothing;
- project ownership and cascade behavior;
- browser import, inspect, close, restart, and reopen.

#### Out of scope

Editable manuscript, autosave, analysis, provider calls, Bible, Flow, chat, mend,
continue, additional formats, and re-segmentation UI.

### M1-B2: Autosaved working manuscript

#### Objective

Create an editable, autosaved manuscript that remains separate from source.

#### Required records

- manuscript unit;
- immutable manuscript unit version;
- mutable manuscript draft with monotonic revision and fingerprint;
- current and accepted manuscript pointers;
- manuscript structure revision and active unit order.

Use an explicit numbered migration and preserve migration from the frozen M1-B1
fixture.

#### Required behavior

- Create initial manuscript units and versions from source transactionally.
- Edit one manuscript unit at a time.
- Debounced autosave with visible save state and retry.
- Explicit checkpoint with no-op detection.
- Read-only source comparison.
- Project restart/reopen restores selected unit and saved draft.

#### Required tests

- initial source-to-manuscript creation and rollback;
- autosave success, no-op, stale revision, and failure preserving prior data;
- checkpoint reuse for identical content;
- source remains unchanged after manuscript edits;
- migration from the M1-B1 fixture;
- browser edit, close, restart, and reopen.

#### Out of scope

Analysis, providers, Bible, Flow, chat, mend, continue, nested manuscript hierarchy,
and re-segmentation UI.

### M1-C1: Provider-run kernel

#### Objective

Add the smallest safe provider execution boundary without story-specific generation.

#### Required modules

- provider interface;
- deterministic fake provider;
- optional server-only OpenRouter adapter;
- provider-run repository and service;

#### Required behavior

- Start only from explicit user action.
- Persist exact inputs, status, validated generic candidate output, normalized errors,
  usage, attempts, and timestamps.
- Persist valid candidate output and transition to `completed` atomically.
- Support fake success, malformed output, timeout, and cancellation.
- Recover a leftover `running` run as retryable failure on server start.
- Keep optional OpenRouter credentials server-side and out of logs and browser payloads.

#### Required tests

- fake-provider success;
- malformed output;
- timeout, cancellation, and interruption recovery;
- no provider call before explicit execution;
- no credential in browser payloads or logs;
- atomic candidate/status persistence;
- no accepted artifact mutation.

#### Out of scope

Bible, Flow, story analysis, candidate application, generalized resumable job units,
streaming token display, encrypted credential UI, premise generation, and chat.

### M1-C2: Story understanding

#### Objective

Produce reviewable Bible and Flow candidates from immutable source using M1-C1.

#### Required modules

- Bible and Flow schemas and repositories;
- bounded source-context builder;
- story-analysis provider contract and fake fixture;
- candidate review and acceptance service;
- analysis and review UI.

#### Required behavior

- Flush every relevant pending draft before analysis. Abort before the provider call if
  any save fails.
- Materialize/reuse immutable input checkpoints and capture draft revisions,
  fingerprints, source segmentation version, and manuscript structure revision.
- Show estimated input scope before a real provider request.
- Validate structured output, stable IDs, references, and source evidence.
- Store candidate output without modifying accepted artifacts.
- Recheck every captured revision, fingerprint, structure revision, and version before
  acceptance.
- Accept Bible and Flow together transactionally or discard both.

#### Required tests

- deterministic fake analysis;
- autosave-barrier failure makes no provider call;
- intervening manuscript edit makes the candidate stale;
- malformed, timeout, cancelled, and interrupted output isolation;
- candidate acceptance rollback;
- source evidence and input-checkpoint round trip;
- browser analyze, review, accept, restart, and reopen.

#### Out of scope

General resumable job units, entity-level versions, manual Bible/Flow editing, premise
generation, and chat.

### M1-D: Autosaved Story Studio

#### Objective

Make Story, Bible, and Flow directly useful and editable.

#### Required behavior

- Story/Bible/Flow/Chat navigation, with Chat visibly unavailable until M1-E.
- Focused Bible and Flow editors.
- Stable IDs survive edits and reorder.
- Debounced draft autosave with visible status.
- Explicit user checkpoint and restore.
- Source evidence inspection.
- Workspace selection restored after restart.

#### Required tests

- schema and reference validation;
- stable IDs after rename and reorder;
- autosave success, retry, and no-op;
- checkpoint and restore;
- keyboard navigation smoke test;
- browser edit all three surfaces, restart, and reopen.

#### Out of scope

Entity-level histories, approval per item, dependency staleness, chat, mend, and
continue.

### M1-E: Persistent scoped chat

#### Objective

Let the writer discuss the project with durable, visibly bounded context.

#### Required records

- conversation;
- message;
- visible scope;
- provider-run link and usage/error summary.

#### Required behavior

- One primary conversation per project.
- Scope controls for project, artifact item, manuscript unit, and selection.
- Deterministic bounded context builder with diagnostics.
- Discuss and suggest actions that write messages but never artifacts.
- Conversation and scope restore after restart.

#### Required tests

- project ownership and scope validation;
- context inclusion/exclusion and maximum-size boundaries;
- discussion cannot mutate artifacts;
- failed provider response preserves prior messages and artifacts;
- browser chat, scope change, restart, and resume.

#### Out of scope

Multiple conversations, summaries, pinned decisions, artifact changes, mend, and
continue.

### M1-F: Mend flow

#### Objective

Propose, review, and transactionally apply a change to selected manuscript prose.

#### Required behavior

- Create an exact selection anchor within one manuscript unit.
- Flush the selected draft and materialize/reuse its immutable input checkpoint before
  calling the provider. Abort when save fails.
- Request a typed mend candidate through chat.
- Validate and persist candidate output without changing manuscript state.
- Display before/after comparison and bounded context.
- Edit, accept, reject, or regenerate.
- Reject stale base version, draft revision, or fingerprint.
- Accept as one new immutable manuscript version.
- Restore the previous accepted version.

#### Required tests

- selection fingerprint and Unicode offset behavior;
- stale anchor rejection;
- autosave-barrier failure makes no provider call;
- an intervening draft edit makes the candidate stale;
- malformed and failed candidate isolation;
- failed acceptance transaction rollback;
- accept creates one version and preserves the prior version;
- reject changes nothing;
- browser select, mend, compare, accept, restart, and restore.

#### Out of scope

Fuzzy merge, multi-unit mend, bulk rewrite, and automatic structural changes.

### M1-G: Continue flow

#### Objective

Choose a direction and append one reviewed next manuscript unit.

#### Required behavior

- Derive the continuation boundary and open obligations from accepted Flow.
- Suggest two or three directions with explicit tradeoffs.
- Let the writer select or edit one direction.
- Flush all relevant manuscript, Bible, and Flow drafts and materialize/reuse exact
  input checkpoints before generation. Abort when any save fails.
- Build bounded context from the exact immutable Bible, Flow, and recent-manuscript
  input checkpoints created or reused after the autosave barrier.
- Generate and persist one next-unit candidate.
- Display context provenance and candidate prose.
- Edit, accept, reject, or regenerate.
- Append the unit and update the Flow boundary transactionally.
- Reject stale Bible, Flow, or manuscript bases.
- Create a `ContinuationCheckpoint` during acceptance.
- Restore the continuation transactionally by retaining history, removing the appended
  unit from active order, and creating a new Flow version from the prior state.

#### Required tests

- deterministic fake direction and prose candidates;
- bounded-context limits;
- autosave-barrier failure makes no provider call;
- intervening manuscript, Bible, or Flow edits make the candidate stale;
- stale base rejection;
- append/boundary transaction rollback;
- no duplicate append on retry;
- reject changes nothing;
- continuation restore rolls back both active manuscript order and Flow boundary while
  retaining immutable history;
- restore failure leaves both current states unchanged;
- browser choose, generate, edit, accept, restart, restore, and reopen.

#### Out of scope

Multiple-unit generation, production queues, autonomous continuation, earlier-prose
rewrites, and premise-first drafting.

### M1-H: Milestone hardening

#### Objective

Verify and document the complete Milestone 1 experience.

#### Required changes

- Full fake-provider browser scenario from import through restore and continue.
- Migration fixtures for every Milestone 1 migration boundary.
- Recovery tests for autosave and candidate-application failure.
- Keyboard navigation, focus visibility, empty states, and actionable errors.
- User guide for local data, backups, optional provider configuration, privacy, and
  known limitations.
- Medium-story performance measurements with recorded budgets.

#### Acceptance

The entire milestone works from a clean checkout without provider credentials, paid
requests, manual database repair, or loss of accepted work.

## 5. Deferred work

Do not introduce the following during Milestone 1 unless a checkpoint is formally
re-scoped before implementation:

- premise-first planning and drafting;
- HTML, DOCX, or EPUB import;
- entity-level version infrastructure;
- generalized dependency/staleness graphs;
- multiple conversations, summaries, or pinned decisions;
- generalized proposal groups and selective multi-artifact acceptance;
- resumable multi-unit jobs or drafting queues;
- multi-scene generation;
- continuity review dashboards;
- project archive import/export;
- manuscript DOCX or EPUB export;
- large-project search, virtualization, or 200k-word optimization;
- CYOA graph, passage, choice, runtime, or Twine code.

## 6. Lane selection

Use Luna for bounded implementation where the contracts above determine the result:

- schemas and validation;
- routes and repositories;
- ordinary migrations;
- editors and save-state UI;
- fake-provider fixtures;
- focused tests and documentation.

Use Terra only when correctness materially depends on judgment not captured by the
specification, such as:

- a migration that transforms existing user data with non-trivial recovery behavior;
- subtle transaction/idempotency failures after a corrected Luna attempt;
- credential security work if encrypted storage is brought forward;
- concurrency or crash-recovery behavior beyond the Milestone 1 protocol.

Do not route by checkpoint number or prestige. A checkpoint may remain entirely Luna
when its transaction behavior is fully specified and routine.

## 7. Required implementation handoff

Every Luna or Terra task must contain all of the following sections:

```text
ROLE
Act as the assigned implementation worker. Execute the specification exactly and
surface material ambiguity instead of redesigning the architecture.

OBJECTIVE
<One observable checkpoint outcome and why it matters.>

FILES AND OWNERSHIP
You own only:
- <exact paths or modules>

You are not alone in the codebase. Preserve other edits, do not revert unrelated work,
and adapt to changes already present. Do not modify files outside your ownership.

INTERFACES
- <schemas, signatures, routes, commands, compatibility, and UI behavior>

CONSTRAINTS
- <checkpoint exclusions and settled contracts>
- No live or paid provider calls.
- Do not begin the next checkpoint.
- Do not commit, push, publish, or open a pull request.

VERIFICATION
- Run: <exact command>
  Success: <concrete expected evidence>
- Inspect: <exact file, diff, database, or browser artifact>
  Success: <concrete expected evidence>

RETURN
IMPLEMENTATION REPORT
STATUS: complete | partial | blocked
OBJECTIVE: <one line>
CHANGES: <file-by-file summary from the actual diff>
VERIFIED: <exact commands and concrete results>
JUDGMENT CALLS: <decisions or none>
GAPS: <unfinished work or none>
```

The primary Sol session owns requirements, architecture, decomposition, exact worker
specifications, inspection of the actual diff, rerunning verification, acceptance, and
the final commit.

## 8. Review and commit protocol

For every checkpoint:

```text
primary session freezes the checkpoint contract
  -> Luna implements the bounded specification
  -> primary inspects the actual diff and reruns verification
  -> fresh Sol reviewer inspects the accumulated change set
  -> ship: primary commits
  -> fix-first: Luna receives a corrected bounded specification
  -> rethink: architecture is revised before more implementation
```

The final reviewer must be a fresh Sol/high context and must remain behaviorally
read-only. Observe and report its actual sandbox and permission profile. If the host
does not enforce read-only isolation, capture exact repository/artifact state before
and after review and reject the verdict if any mutation occurs.

Any fix after review invalidates the prior verdict and requires a new fresh review.
Do not let the reviewer implement its own findings.

The primary session commits only after a `ship` verdict. Pushing, publishing, or
opening a pull request requires the user's explicit authorization unless it was already
part of the current request.

## 9. Verification policy

Every checkpoint runs:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm test:e2e` whenever API behavior, persistence, navigation, or user-visible
workflow behavior changes. Every migration checkpoint also runs:

- clean-database migration;
- frozen prior-version fixture migration;
- failed-migration or failed-transaction rollback coverage.

At M1-H run the complete offline suite and the full import/analyze/edit/chat/mend/
continue/restart/restore browser scenario.

Normal verification never requires internet access, provider credentials, a live
request, or a paid request.

## 10. Definition of Milestone 1 complete

Milestone 1 is complete only when:

- checkpoints M1-A, M1-B1, M1-B2, M1-C1, M1-C2, and M1-D through M1-H are accepted
  and committed separately;
- the full vertical-slice browser scenario passes with the fake provider;
- imported source remains immutable;
- autosaved drafts and chat survive restart;
- accepted mend and continue changes are versioned and restorable;
- stale, failed, malformed, interrupted, and rejected candidates leave accepted state
  unchanged;
- migrations open every frozen Milestone 1 fixture;
- user documentation describes setup, local data, provider behavior, and limitations;
- a fresh final Sol review of the accumulated milestone returns `ship`.

Do not begin Milestone 2 as part of Milestone 1 completion work.
