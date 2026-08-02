# Story Creator implementation roadmap

## Delivery strategy

Build one useful vertical slice before expanding the platform.

The first finished milestone is not a complete long-form production suite. It proves
the central Story Creator experience:

```text
Put in a story
  -> receive a story bible and narrative flow
  -> discuss the story in persistent chat
  -> propose and review a mend
  -> propose and review what happens next
  -> close and reopen with everything saved
```

Checkpoint 1A already provides the workspace, local SQLite database, project records,
web/server shells, migrations, and project reopen workflow. Milestone 1 builds the
smallest trustworthy product on that base.

Implementation proceeds one checkpoint at a time. Each checkpoint receives focused
offline verification, primary-session inspection, and a fresh Sol review before it is
accepted. Automated verification never makes a live or paid provider request.

## Product invariants

These rules apply from Milestone 1 onward:

1. Imported source is immutable and remains available for evidence and comparison.
2. Mending changes a working manuscript, never the imported source.
3. Manual work is autosaved locally and survives application restart.
4. Autosave does not create an immutable version for every keystroke.
5. Accepted AI changes create restorable versions or checkpoints.
6. Before an AI change action, pending saves are flushed and the exact input drafts
   are checkpointed. A save failure prevents the provider call.
7. Chat discussion cannot mutate project artifacts.
8. AI changes remain candidates until the writer accepts them.
9. Candidate application is transactional and checks the exact input versions, draft
   revisions, and content fingerprints.
10. Failed, stale, cancelled, or malformed output cannot partially modify the project.
11. Credentials remain server-side and are excluded from project content and logs.
12. Tests use a deterministic fake provider.
13. Story Creator remains separate from Story to CYOA and does not adopt its graph,
    passage, choice, runtime, or Twine domain.

# Milestone 1: Understand, mend, and continue a story

## User outcome

A writer can paste or import an existing story, inspect an automatically prepared
bible and narrative flow, edit those materials, discuss the project through chat,
mend selected prose, and continue the story with a new scene or chapter. The writer
reviews every proposed change, and all local work survives close and reopen.

## Milestone 1 product surface

Use four primary workspace areas:

- **Story** — immutable source comparison and autosaved working manuscript.
- **Bible** — summary, characters, relationships, locations, world facts, style notes,
  timeline, and unresolved facts.
- **Flow** — ordered story beats or scenes, plot threads, open obligations, and the
  current continuation boundary.
- **Chat** — persistent discussion with visible scope and explicit actions to suggest,
  mend, or continue.

The Bible and Flow may use structured whole-document records during Milestone 1.
Items inside them still receive stable IDs. Entity-level version tables and large-scale
dependency graphs are deferred until measurements or later workflows require them.

## Checkpoint M1-A: Stabilize the local core

Harden the existing checkpoint 1A implementation before adding story data.

### Scope

- Add continuous integration for lint, typecheck, tests, build, and browser tests.
- Pin the supported Node major.
- Add root engineering instructions.
- Split server, persistence, domain, and web entry points as new modules arrive.
- Prove rollback after multiple successful writes in one failed transaction.
- Add a frozen migration-001 compatibility fixture.
- Preserve the existing create, close, restart, and reopen workflow.

### Acceptance gate

A fresh checkout installs and verifies without credentials. A clean database and the
frozen version-1 database fixture open successfully, and a failed multi-write
transaction leaves no partial rows.

## Checkpoint M1-B1: Immutable source import

Create the immutable evidence layer used by later analysis and comparison.

### Scope

- Accept pasted text plus UTF-8 TXT and Markdown files.
- Normalize line endings while preserving valid Unicode.
- Store immutable normalized source text, hashes, filename, media type, and warnings.
- Segment the source into a deterministic ordered chapter/scene outline.
- Reopen the exact source and segment outline after restart.

### Deliberate limits

- No HTML, DOCX, or EPUB import.
- No automatic re-segmentation UI.
- No paragraph-level global knowledge graph.
- No editable manuscript or autosave.
- No archive export/import.

### Acceptance gate

A writer can paste or import a representative story, close the application, and reopen
the exact normalized source and outline. Failed import leaves no partial source rows.

## Checkpoint M1-B2: Autosaved working manuscript

Create a separately editable manuscript from the immutable source.

### Scope

- Create ordered manuscript units and initial immutable unit versions from source.
- Store mutable manuscript drafts with monotonic draft revisions and fingerprints.
- Autosave after a short debounce and on reliable navigation signals.
- Display `Saving`, `Saved`, and `Save failed` states.
- Create explicit manuscript checkpoints without versioning every keystroke.
- Show immutable source comparison beside the editable manuscript.
- Reopen the exact saved text and selected unit after restart.

### Deliberate limits

- No Bible, Flow, provider, chat, mend, or continue behavior.
- No nested production hierarchy or automatic re-segmentation.

### Acceptance gate

A writer can edit the working manuscript, close the application, and reopen without
losing persisted text. Autosave failure preserves the last good draft and remains
visible for retry; immutable source is unchanged.

## Checkpoint M1-C1: Provider-run kernel

Add the smallest safe provider boundary needed by story understanding.

### Scope

- Add a server-side provider interface and deterministic fake provider.
- Allow optional OpenRouter configuration without requiring it for local use or tests.
- Persist bounded provider runs, exact input fingerprints, validated candidate output,
  status, normalized errors, usage summaries, and timestamps.
- Start runs only from explicit user action.
- Recover interrupted `running` work as retryable failure after restart.
- Guarantee that provider output cannot directly mutate accepted artifacts.

### Deliberate limits

- No generalized multi-unit job platform or mid-unit resume.
- No Bible, Flow, analysis prompt, chat, streaming UI, or encrypted credential UI.

### Acceptance gate

The fake provider can complete, fail, cancel, and recover an interrupted bounded run.
Malformed or interrupted output changes no accepted project state, and tests require no
credential or network access.

## Checkpoint M1-C2: Story understanding

Generate the minimum useful story model from the immutable source.

### Scope

- Use the accepted provider-run kernel for one bounded analysis action.
- Produce a structured Bible containing:
  - story summary;
  - characters and relationships;
  - locations and world facts;
  - timeline entries;
  - style and voice observations;
  - unresolved facts or contradictions.
- Produce a structured Flow containing:
  - ordered beats or scenes;
  - plot threads;
  - setups and payoffs;
  - open obligations;
  - the current continuation boundary.
- Attach source-segment evidence where available.
- Validate provider output before storing it as a candidate.
- Let the writer accept or discard the generated Bible and Flow.
- Flush relevant working drafts before execution. If a draft is included, materialize
  an immutable input checkpoint and record its draft revision and fingerprint.
- Reject acceptance if any captured input revision or fingerprint has changed.

### Deliberate limits

- One analysis action may use a small fixed sequence; generalized durable job units
  remain deferred.
- No live provider call occurs without explicit user action and configured credentials.

### Acceptance gate

The fake provider turns an imported fixture into a reviewable Bible and Flow. Invalid,
failed, interrupted, or stale output changes no accepted project artifact. Accepted
results survive restart with their exact input checkpoints and source evidence.

## Checkpoint M1-D: Autosaved Story Studio

Make the generated material useful without requiring chat.

### Scope

- Add Story, Bible, Flow, and Chat workspace navigation.
- Provide focused editors for Bible and Flow rather than one giant form.
- Keep stable IDs on characters, relationships, locations, beats, and threads.
- Autosave Bible and Flow working drafts.
- Create restorable checkpoints for accepted AI changes and explicit user checkpoints.
- Preserve project and workspace selection across restart.
- Show source evidence without allowing the source to be edited.

### Acceptance gate

A writer can edit the manuscript, Bible, and Flow manually, move between workspace
areas, close and reopen, and recover the exact last autosaved drafts.

## Checkpoint M1-E: Persistent scoped chat

Add chat as a convenient control surface without giving it implicit write access.

### Scope

- Persist one primary conversation and its messages per project.
- Show the active scope: project, Bible item, Flow item, manuscript unit, or selection.
- Assemble bounded context from the selected scope, relevant Bible/Flow items, and
  nearby manuscript text.
- Support discussion and suggestions that cannot modify artifacts.
- Persist normalized provider errors and usage summaries, never raw hidden reasoning.
- Restore the conversation and active scope after restart.

### Deliberate limits

- One primary conversation per project.
- No branching conversations, long-term summary hierarchy, or pinned-decision system.
- No whole-manuscript context by default.

### Acceptance gate

A writer can discuss a selected story element, receive a bounded response, close and
reopen, and continue the same conversation. Discussion alone cannot change the story,
Bible, or Flow.

## Checkpoint M1-F: Mend flow

Let the writer safely change existing prose through chat.

### Scope

- Select prose within one manuscript unit.
- Request a mend such as clarity, pacing, voice, dialogue, continuity, or a specified
  story change.
- Anchor the request to the exact manuscript base version and selection fingerprint.
- Store the result as a candidate.
- Show a focused before/after diff with surrounding context.
- Allow edit, accept, reject, or regenerate.
- On accept, create a new manuscript version transactionally.
- Reject stale candidates when the underlying text has changed.
- Preserve the prior accepted version for restore.

### Deliberate limits

- One manuscript unit per mend.
- No silent fuzzy merge.
- No large multi-chapter rewrite.
- Structural Bible/Flow changes are separate visible proposals.

### Acceptance gate

A writer can mend a selected passage, inspect the exact change, accept it, restart the
application, and restore the earlier version. Rejecting, failing, or becoming stale
leaves the manuscript unchanged.

## Checkpoint M1-G: Continue flow

Let the writer decide what happens next and append new prose safely.

### Scope

- Show the current continuation boundary and open threads.
- Ask chat for two or three next-direction options with tradeoffs.
- Let the writer choose or edit a direction.
- Generate one next scene or chapter candidate using bounded context from the exact
  post-flush Bible, Flow, and manuscript input checkpoints.
- Show the exact Bible, Flow, recent prose, and instructions used.
- Allow editing, accepting, rejecting, or regenerating the candidate.
- On accept, append one new manuscript unit and update the continuation boundary in
  one transaction.
- Create a narrow continuation checkpoint containing the prior active manuscript
  order, prior Flow version, appended unit/version, and resulting Flow version.
- Restore a continuation checkpoint transactionally: retain the appended records for
  history, remove the unit from the active order, and create a new Flow version from
  the prior state.

### Deliberate limits

- Generate one unit at a time.
- No production queue, autonomous book generation, or multi-scene batch.
- No automatic rewriting of earlier prose.

### Acceptance gate

A writer can select a continuation direction, generate and revise the next unit,
accept it, close the application, and reopen with the new unit, updated boundary,
conversation, and supporting context intact. Restoring the continuation removes the
unit from the active manuscript and restores the Flow boundary without deleting
history.

## Checkpoint M1-H: Milestone hardening

Finish the vertical slice as a coherent milestone.

### Scope

- Add the complete import, analyze, edit, chat, mend, continue, restart, and restore
  browser scenario using the fake provider.
- Add migration fixtures for every Milestone 1 schema version.
- Verify failed candidate application and autosave failures do not corrupt prior state.
- Add keyboard navigation, visible focus, empty states, actionable errors, and a local
  data/privacy explanation.
- Document setup, optional provider configuration, backups, and known limits.
- Measure a representative medium story and record practical startup, save, and open
  budgets.

### Acceptance gate

The full offline vertical slice passes from a clean checkout. A writer can complete the
Milestone 1 workflow without data loss, direct database repair, or a provider key.

# Later milestones

Later milestones extend the proven vertical slice instead of blocking it.

## Milestone 2: Deeper planning and premise-first creation

- Premise-to-bible and premise-to-flow generation.
- Acts, chapters, scene plans, arcs, causality, and richer manual editors.
- Entity-level immutable versions, dependency edges, approval, staleness, snapshots,
  history comparison, and restore.
- Multiple conversations, summaries, and pinned decisions.
- Transactional multi-artifact proposal groups.

## Milestone 3: Long-form production

- Durable resumable job and unit queues.
- Multi-scene drafting and continuation batches.
- Progress, word budgets, cost previews, retry, pause, resume, and cancellation.
- Larger context indexes and retrieval.

## Milestone 4: Review and repair

- Deterministic continuity validators.
- Evidence-linked AI review.
- Review dashboard, findings, waivers, and targeted repair proposals.
- Dependency-aware revalidation.

## Milestone 5: Portability, formats, scale, and release readiness

- HTML, DOCX, and EPUB import.
- Markdown, plain-text, DOCX, and EPUB-ready manuscript export.
- Versioned project archives with checksum-verified import.
- Backup rotation, integrity diagnostics, migration matrix, and crash recovery.
- Search, virtualization, accessibility completion, and 200k-word performance work.

# Verification policy

Every checkpoint runs:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the relevant browser workflow whenever API, persistence, or visible behavior
changes. At the end of Milestone 1, run the complete offline suite and the full
vertical-slice browser scenario.

Live-provider smoke tests are optional, manually initiated, and separately authorized.
They are never required for implementation acceptance.
