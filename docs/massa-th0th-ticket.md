# massa-th0th Ticket Workflow

Human-facing guide for the Jira-only ticket workflow built directly into `massa-th0th`. Canonical agent instructions live in [`workflows/ticket.md`](../../skills/massa-th0th/workflows/ticket.md) and [`references/ticket/`](../../skills/massa-th0th/references/ticket/).

## Purpose

Use this workflow to turn requirements, specs, defects, or technical work into reviewed Jira Epics, issues, and sub-tasks. It drafts first, validates against current Jira metadata, and creates through Atlassian MCP only after explicit approval.

## Quick Start

```text
Use the ticket workflow. Create an Epic with implementation tickets for MOBILE.
```

```text
Draft Jira tickets and sub-tasks for SA from this TDD. Use SA-142 as the formatting reference.
```

```text
Create a bug ticket for EXP. Use our Confluence DoR and DoD pages, then let me review before Jira creation.
```

## Behavior

- Intake confirms the exact Jira project, hierarchy, template source, and optional DoR/DoD sources before drafting.
- Reference tickets influence structure and tone only; their business facts and fields are not copied blindly.
- Titles use one supported mobile, frontend, backend, spike, E2E, infrastructure, or DevOps prefix.
- Current Jira metadata controls issue types, required fields, allowed values, and parent relationships.
- Current source may be explored through the read-only massa-th0th exploration workflow, but Git history and repository ticket examples are excluded.
- One temporary review artifact is written to the active agent's plans directory outside the repository.
- Every revision invalidates prior approval. Creation proceeds Epic first, then standard issues, then sub-tasks.
- Partial failures retain the draft and stop further mutations. Resume re-checks Jira before creating only confirmed missing items.
- Complete success reports Jira links and deletes the temporary review artifact.

## Defaults

When no team template is supplied, the workflow provides distinct Epic, Story/Task, Bug, Spike, and Sub-task structures plus generic Definition of Ready and Definition of Done checklists. These defaults are trimmed when a check is irrelevant; they are not used to invent project requirements.

## Retained And Corrected Design

Useful upstream behavior retained:

- Reviewable drafts and explicit approval before tracker mutation.
- Type-specific ticket templates and observable acceptance criteria.
- Codebase grounding that gives implementers current source pointers.
- Top-down parent creation and ticket decomposition by dependencies.

Risky or mismatched behavior corrected:

- Multi-tracker and CLI detection was replaced with Atlassian MCP-only preflight.
- Git history and repository tickets are never treated as template evidence.
- Repository backlog files and index updates were replaced with one temporary agent-plans artifact.
- Fixed two-to-three-day sizing was replaced with outcome, dependency, and reviewability boundaries.
- Provider-specific cross-skill calls and prose-polishing steps were removed.
- Revision-bound approval, duplicate checks, ambiguous-result handling, and resumable partial-failure behavior were added.

## Boundaries

- Atlassian MCP is required for Jira reads and writes. No Jira CLI, direct REST, browser automation, or alternate tracker fallback is used.
- No Markdown backlog, index, execution state, or ticket file is stored in the active repository.
- The workflow does not auto-delete, transition, comment on, assign, or block Jira issues after a partial failure.
- Jira issue types and custom fields are discovered per project rather than assumed from generic names.

## Troubleshooting

- Project not found: provide the exact accessible Jira project key; the workflow will not guess.
- Reference ticket unavailable: retry with a valid Jira key or choose the built-in templates.
- Required custom field missing: choose a Jira-supported value before approval.
- Atlassian MCP unavailable or read-only: drafting can continue, but Jira creation cannot.
- Possible duplicate: review the candidate and explicitly choose create, revise, or cancel.
- Partial creation: use the retained external draft to resume after Jira state and duplicates are re-checked.

## Design Sources

The workflow independently adapts useful review-before-push, type-specific template, code-grounding, and testable-criteria concepts from the [Flagrare ticket-creator skill](https://github.com/Flagrare/agent-skills/blob/main/plugins/flagrare/skills/ticket-creator/SKILL.md). Repository-specific behavior replaces multi-tracker detection, Git-derived ticket examples, repository backlog files, fixed duration sizing, and cross-skill calls.
