# Technical Project Plans (TPPs)

TPPs are markdown files that persist research, design decisions, and progress across Claude Code sessions. They solve a specific problem: when a session ends (context limit, crash, task switch), all the accumulated understanding is lost. TPPs capture that understanding so the next session starts informed, not from scratch.

## Why TPPs exist

Claude Code has three built-in persistence mechanisms, and all have failure modes:

- **CLAUDE.md** — project-wide, not task-specific. Can't hold active task state.
- **/compact** — lossy compression. Nuance, failed approaches, and partial progress are discarded.
- **Plan mode** — ephemeral. Gone when the session ends.

TPPs fill the gap: task-specific, persistent, and designed for handoff between sessions.

## Directory structure

```
_todo/          # Active TPPs (work in progress)
_done/          # Completed TPPs (reference/archive)
```

TPP filenames use date prefixes for chronological sorting:

```
_todo/20260316-volume-metadata-refactor.md
_todo/20260320-linux-gio-support.md
_done/20260310-hidden-file-root-fix.md
```

## TPP template

```markdown
# TPP: Feature name

## Summary

Short description of the problem (under 10 lines).

## Current phase

- [x] Research & Planning
- [x] Write breaking tests
- [ ] Design alternatives
- [ ] Task breakdown
- [ ] Implementation
- [ ] Review & Refinement
- [ ] Final Integration
- [ ] Review

## Required reading

Files and docs the engineer must study before starting work.

## Description

Detailed context about the problem (under 20 lines).

## Lore

- Non-obvious details that will save time
- Prior gotchas that tripped up previous sessions
- Relevant functions, classes, and historical context

## Solutions

### Option A (preferred)

Description with pros/cons and code snippets if helpful.

### Option B (alternative)

Why this was considered and why Option A is better.

## Tasks

- [x] Task 1: Clear deliverable, files to change, verification command
- [ ] Task 2: ...
```

## How to use TPPs

### Starting a new task

1. Create a new file in `_todo/` with today's date and a descriptive name
2. Fill in the Summary, Description, and Required reading sections
3. Use `/tpp _todo/YYYY-MM-DD-name.md` to begin working

### Resuming work

1. Start a new session
2. Run `/tpp _todo/YYYY-MM-DD-name.md` — the skill reads the TPP and picks up where the last session left off

### Ending a session

When context is running low or you're switching tasks:

1. Run `/handoff` — this updates the TPP with current progress, discoveries, and next steps
2. The next session can pick up cold from the updated TPP

### Completing a task

When all phases are done:

1. Move the TPP from `_todo/` to `_done/`
2. The completed TPP serves as reference for future related work

## Writing good TPPs

### The Lore section is critical

This is where you capture things that aren't obvious from the code:

- "DiskArbitration callbacks fire on a different thread — must use dispatch queues"
- "Windows GetVolumeInformation blocks indefinitely on disconnected network drives"
- "The mtab parser must handle both /etc/mtab and /proc/self/mountinfo formats"

### Document failed approaches

When something doesn't work, record it and WHY:

- "Tried using statfs for remote detection but it doesn't distinguish NFS subtypes on Linux"
- "CFURLCopyResourcePropertyForKey returns null for /.vol paths — use getattrlist instead"

This prevents the next session from wasting time re-exploring dead ends.

### Tasks must be concrete

Bad: "Implement Windows support"
Good: "Add GetVolumeInformationW call in src/windows/volume_metadata.cpp, handle ERROR_NOT_READY for removable drives, add test case in src/volume_metadata.test.ts"

### Keep it current

A stale TPP is worse than no TPP. Update it as you learn things, not just at handoff time.

## Project-specific conventions

This project is a cross-platform native Node.js module. TPPs should always consider:

1. **All three platforms** — Windows, macOS, Linux (including Alpine/musl and ARM64)
2. **Native + TypeScript** — changes often span both C++ and TS layers
3. **RAII everywhere** — no raw resource management in C++ code
4. **Backwards compatibility** — this is a published npm package
5. **CI reliability** — tests must be deterministic (see CLAUDE.md anti-patterns)
6. **Timeouts** — native calls can hang on network filesystems
