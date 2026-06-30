<!--
Sync Impact Report
Version change: 2.0.0 -> 2.0.1
Modified principles: II. Spec Payload Before Model ASM -> II. Direct Spec Payload Before Model ASM; III. Candidate ASM Is Not Final ASM -> III. Model ASM Is Direct Output, Local Gate Only; IV. Tests Protect The Spec Driver expanded for no-rewrite regression coverage
Added sections: Direct generation constraints in ASM Spec Driver and Development Workflow
Removed sections: none
Templates requiring updates: updated .specify/templates/plan-template.md, updated .specify/templates/spec-template.md, updated .specify/templates/tasks-template.md, updated .agents/skills/speckit-*, updated AGENTS.md
Follow-up TODOs: none
-->

# ASM Agent Constitution

## Core Principles

### I. JSON Spec Is The ASM Source Of Truth

All ASM generation, parsing, validation, encoding, and review work MUST treat
`src/shared/spec/hk64s8x.v0.1.json` as the authoritative chip specification.
Conversation history, memory, prior generated ASM, and human summaries are not
valid substitutes for this JSON file. Any change that affects instructions,
registers, bit fields, addresses, vectors, memory regions, or syntax MUST cite
this file or the compiler path that generated it.

Rationale: the JSON carries the company instruction and register contract.
Summaries can drift; the checked-in JSON can be loaded and validated.

### II. Direct Spec Payload Before Model ASM

Every model-facing ASM task MUST attach the user's current requirement together
with a fresh payload generated from the built-in JSON spec, using the
`SPEC_DRIVEN_ASM_CONTEXT` block or an equivalent mechanical serialization of
the same source fields. The payload MUST include the complete instruction list,
register list, memory map, vectors, ASM syntax, source path, and integrity
metadata. A hand-written capsule or abbreviated summary MAY explain intent, but
MUST NOT replace the JSON-derived payload.

The payload and prompt MUST state the ASMC address literal rule: numeric
register addresses and numeric `JMP`/`CALL` addresses MUST use the `H` suffix
form, such as `38H`, `46H`, and `20H`. Bare decimal or `0x` numeric addresses
such as `MOV 38,A`, `CALL 46`, `JMP 20`, or `MOV 0x38,A` are invalid final ASM.

The payload and prompt MUST also state that pseudo instructions absent from the
JSON spec, including `ORG`, `END`, `EQU`, `DB`, `DS`, `DW`, `SECTION`, and
`INCLUDE`, are invalid final ASM. The `R` token in JSON instruction syntax is an
operand placeholder, not a concrete register. Model output MUST NOT invent
`R0`, `R1`, `R2`, or similar registers; temporary counters MUST use valid RAM
numeric addresses with `H` suffix form, for example `80H`, when appropriate.

For PA LED or blinking-light requirements, the payload and prompt MUST require
explicit visible-state masks written to `PA_PIO(38H)`, such as
`#01H -> #02H -> #04H -> #00H` for a PA0/PA1/PA2 chase or `#07H -> #00H` for
all-on/all-off blinking. Each visible state MUST be followed by a delay call.
Computed masks such as `#01H OR counter`, direct counter writes to `PA_PIO`, or
patterns that keep any requested PA bit permanently on are invalid final ASM.

Software delay counters MUST use skip instructions that write the updated value
back to RAM, such as `DECSZR` or `INCSZR`. `DECSZ` and `INCSZ` write their
computed value only to `A`; using them as RAM delay-loop counters can lock the
program in the first visible LED state and is invalid for generated delay loops.

Software delay loops MUST be estimated against the user-provided clock
frequency. At 16MHz, a three-level `DECSZR` delay using `#0AH/#FFH/#FFH` is in
the 500ms range, while `#7AH/#FFH/#FFH` is far longer than 500ms and MUST be
rejected for 500ms LED blinking requirements.

Rationale: long conversations and unrelated context can pollute model behavior.
The model must receive the chip contract at the time it is asked to produce or
reason about ASM.

### III. Model ASM Is Direct Output, Local Gate Only

The main external-model ASM generation path MUST ask the model to directly
return the deliverable `main.asm` content under the JSON-derived spec payload.
The local application MUST then extract the returned ASM and run local quality
validation against the original JSON spec through `parseAsm + validateAsm`, or
through `npm run asm:validate -- <file.asm>` for file-level checks.

The main path MUST NOT treat model output as an unconstrained draft and then
silently replace it with a locally rewritten ASM file from `createPlan`,
`generateValidatedAsm`, a template generator, or a one-click normalization
routine. Any parser or validator diagnostic is a CRITICAL failure: the output is
rejected, not saved, and not displayed as final ASM. A later repair loop MAY ask
the model to regenerate using the same JSON payload plus validation diagnostics;
it MUST NOT bypass the local quality gate.

Rationale: prompt compliance is not proof. Local validation is the enforceable
quality gate, but it is a gate over the model's spec-constrained output rather
than a hidden local rewrite stage.

### IV. Tests Protect The Spec Driver

Changes to ASM prompt construction, spec loading, ASM parsing, validation,
encoding, project generation, or file output MUST include focused tests that
prove the JSON spec is loaded and enforced. Tests for the external-model ASM
path MUST prove valid model ASM is preserved after extraction and validation,
and invalid model ASM is rejected without falling back to local rewrite. Tests
MUST cover at least one valid ASM path and one invalid instruction, register,
bit field, address, vector, or syntax path when the change can affect those
rules.

Rationale: the project needs regression evidence that the spec driver remains
attached even as UI, model adapters, and generation flows change.

### V. Minimal, Auditable Spec Changes

The built-in JSON spec and compiler sources MUST be changed narrowly. A spec
change MUST preserve chip identity, instruction counts, register counts, and
source provenance unless the feature explicitly updates those facts. Any
intentional change to the JSON contract MUST be called out in the feature spec,
plan, tasks, tests, and final verification notes.

Rationale: small, auditable changes reduce the chance of silently breaking the
company instruction/register contract.

## ASM Spec Driver

The current ASM spec driver is `src/shared/spec/hk64s8x.v0.1.json`. Runtime
model prompts use `src/shared/spec/SpecPromptContext.ts` to render
`SPEC_DRIVEN_ASM_CONTEXT`. Runtime and script validation use
`src/shared/asm/AsmQualityGate.ts`, which delegates to `parseAsm + validateAsm`.

The required external-model generation flow is:

1. User natural-language requirement is combined with `SPEC_DRIVEN_ASM_CONTEXT`.
2. The external model returns a single `asm` or `assembly` code block for
   `main.asm`, or explains which required parameters are missing.
3. The application extracts that code block without semantic rewriting.
4. The extracted ASM passes `parseAsm + validateAsm` before any file save,
   display as final ASM, or export.
5. Failed validation stops the output path. The failure MAY be shown as a
   diagnostic, but MUST NOT trigger a hidden local rewrite into a different ASM
   program.

All Spec Kit artifacts for ASM-related work MUST include these gates:

- The feature specification states whether ASM generation, validation, parsing,
  encoding, or file output is in scope.
- The implementation plan lists the JSON spec path and explains how the user's
  requirement and the JSON-derived prompt payload reach the model together.
- The implementation plan states that numeric register, `JMP`, and `CALL`
  addresses use ASMC `H` suffix form and that bare decimal or `0x` addresses are
  rejected by the local quality gate.
- The implementation plan states that external-model ASM is extracted and
  validated directly, with no main-path local rewrite fallback.
- The task list includes a local ASM quality gate step for every generated ASM
  artifact.
- Checklists and reviews treat missing JSON citation, missing prompt payload,
  hidden local rewrite, or missing validation as CRITICAL findings.

## Development Workflow

For any ASM-related feature or bug fix:

1. Start from the current JSON spec in `src/shared/spec/hk64s8x.v0.1.json`.
2. Build or update tests that prove the spec is attached to model-facing ASM
   prompts.
3. Build or update tests that prove numeric register, `JMP`, and `CALL`
   addresses without the ASMC `H` suffix are rejected before final output.
4. Build or update tests that prove external-model ASM is preserved after
   extraction, validated locally, and rejected on diagnostics without local
   rewrite.
5. Implement the smallest change that passes those tests.
6. Run `npm run asm:validate -- <file.asm>` for any ASM file produced by the
   change, and run the relevant Vitest or TypeScript checks before completion.

Non-ASM work does not need to embed the JSON payload, but MUST NOT weaken,
remove, bypass, or hide the ASM spec driver.

## Governance

This constitution supersedes informal practices and conversational memory for
ASM behavior in this repository. Amendments require a documented reason, an
explicit version bump, and synchronization of `.specify/templates/*`,
`.agents/skills/speckit-*`, `AGENTS.md`, and any affected tests.

Versioning follows semantic versioning:

- MAJOR for redefining or removing a core ASM governance principle.
- MINOR for adding a new principle, required gate, or governed artifact.
- PATCH for clarifications that do not change required behavior.

Compliance review is required before merging or delivering ASM-related changes.
Any missing spec payload, missing JSON citation, hidden main-path local rewrite,
or missing local quality gate is a CRITICAL violation.

**Version**: 2.0.1 | **Ratified**: 2026-06-24 | **Last Amended**: 2026-06-24
