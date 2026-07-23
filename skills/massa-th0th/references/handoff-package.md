# Handoff Package

Use this reference for long-session compaction, agent-to-agent transfer, or new-chat continuation.

## Goal

Produce a low-token continuation package that lets the next agent continue safely without full chat history.

## Required Fields

Keep each section short and dense.

```md
# Handoff

## Project
- purpose, stack, architecture style, current phase
- critical constraints and active spec/TDD/ADR references

## Current State
- done
- partial
- broken
- active target

## Key Decisions
- decision -> reason -> tradeoff -> do not revert because ...

## Implementation Plan
- immediate phases only
- execution order
- blockers and dependencies

## Active Files
- path -> responsibility -> status

## Known Issues
- severity -> reproduction -> suspected cause -> fix direction

## Rejected Approaches
- rejected approach -> why rejected -> risk avoided

## Next Tasks
- [ ] execution-ordered task

## Sensors And Validators
- exact commands or artifact checks required

## Continuation Rules
- invariants, forbidden patterns, compatibility rules, required skills/tools

## AI Continuation Instructions
- how to proceed safely
- what must not change
- where extra caution is required

## Context Recovery
- implicit assumptions, fragile integrations, temporary hacks
```

## Persistence

- Persist incomplete-work handoffs as `critical` with `memory:working` and `handoff`.
- Persist routine compaction as `conversation` with `memory:working` and `handoff`.
- Include exact `projectId`, `workflowSessionId`, workflow, entity, and next
  step. Do not persist an ephemeral `synapseSessionId` as continuation state.
- Receiving agent must call `recall` for the provided
  `workflowSessionId`, then open and optionally prime a fresh Synapse session
  when repeated searches are expected.

## User-Facing Reset Instruction

When the handoff is meant for a new chat or different agent, include this exact sentence:

`The context has been successfully consolidated. To avoid attention degradation and reduce token consumption, PLEASE OPEN A NEW CHAT WINDOW (Reset Context) and reference the created file to continue the implementation.`

## Exclusions

Do not include:

- long conversation history
- generic engineering advice
- copied code blocks
- exhaustive architecture docs
- low-value brainstorming
- stale facts not marked as historical
