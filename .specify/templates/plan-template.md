# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `__SPECKIT_COMMAND_PLAN__` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

### ASM Spec Gate

CRITICAL for any ASM-related feature:

- [ ] Plan cites `src/shared/spec/hk64s8x.v0.1.json` as the authoritative
      instruction/register source.
- [ ] Plan explains how the user's requirement and a fresh
      `SPEC_DRIVEN_ASM_CONTEXT` payload derived from that JSON file are sent to
      the model in the same ASM generation request.
- [ ] Plan states that numeric register, `JMP`, and `CALL` addresses must use
      ASMC `H` suffix form such as `38H`, `46H`, and `20H`; bare decimal or
      `0x` addresses are invalid final ASM.
- [ ] Plan forbids JSON-absent pseudo instructions such as `ORG`, `END`, `EQU`,
      `DB`, `DS`, `DW`, `SECTION`, and `INCLUDE`; it also states that `R` in
      instruction syntax is an operand placeholder, not a real register, and
      temporary counters should use RAM `H`-suffix addresses such as `80H`.
- [ ] Plan states that software delay counters use write-back skip instructions
      such as `DECSZR`/`INCSZR`, not `DECSZ`/`INCSZ`, because non-write-back
      skip instructions can lock LED code in one visible state.
- [ ] Plan states that software delay loops are estimated against the requested
      clock; for 16MHz and 500ms LED blinking, `#0AH/#FFH/#FFH` is the expected
      three-level `DECSZR` scale while `#7AH/#FFH/#FFH` is far too long.
- [ ] Plan states that the main external-model ASM path directly extracts and
      validates the model's `main.asm` code block, with no hidden local rewrite
      through `createPlan`, `generateValidatedAsm`, templates, or one-click
      normalization.
- [ ] Plan includes local validation through `parseAsm + validateAsm` or
      `npm run asm:validate -- <file.asm>` before ASM is displayed or written,
      and states that validation failures reject output instead of saving it.
- [ ] Any intentional instruction, register, bit field, memory, vector, or ASM
      syntax change is explicitly called out with matching tests.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (__SPECKIT_COMMAND_PLAN__ command output)
├── research.md          # Phase 0 output (__SPECKIT_COMMAND_PLAN__ command)
├── data-model.md        # Phase 1 output (__SPECKIT_COMMAND_PLAN__ command)
├── quickstart.md        # Phase 1 output (__SPECKIT_COMMAND_PLAN__ command)
├── contracts/           # Phase 1 output (__SPECKIT_COMMAND_PLAN__ command)
└── tasks.md             # Phase 2 output (__SPECKIT_COMMAND_TASKS__ command - NOT created by __SPECKIT_COMMAND_PLAN__)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
