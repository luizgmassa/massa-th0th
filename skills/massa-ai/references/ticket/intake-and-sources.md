# Ticket Intake And Sources

Use this reference from `workflows/ticket.md` before drafting. Gather only missing decisions, keep source roles explicit, and avoid repository-derived ticket conventions.

## Ordered Intake

Resolve inputs in this order:

1. **Jira project key**: require an explicit key such as `MOBILE`, `SA`, or `EXP`. Use Atlassian MCP to confirm exact accessibility and project identity. Do not infer a project from repository names, Git history, existing branch names, or arbitrary issue references.
2. **Hierarchy**: require one of these exact modes:
   - `epic-tickets`: create a new Epic and standard child issues.
   - `epic-tickets-subtasks`: create a new Epic, standard child issues, and sub-tasks.
   - `tickets-subtasks`: create standard issues and optional sub-tasks without creating an Epic. Ask for an existing Epic key only when the user wants those standard issues attached and Jira supports that relationship.
3. **Ticket template source**: ask whether to use a Jira reference issue, an explicitly supplied local file or pasted template, or the built-in templates. A Jira reference may be supplied as a key or URL.
4. **Definition of Ready and Definition of Done**: ask whether the user wants to provide either source. Accept Jira or Confluence content through Atlassian MCP, explicitly supplied local files, or pasted text. Use built-in checklists when omitted.
5. **Jira-required choices**: after metadata inspection, ask only for unresolved issue types, priorities, components, labels, ownership, versions, or custom fields that are required by Jira or material to the user's intent.

Group related choices into at most three concise questions at a time. Reuse answers across the draft unless the user scopes a different value to a specific issue.

## Source Roles

Use each source only for its declared role:

- User prompt, supplied requirements, specs, TDDs, and approved project documents provide business and technical facts.
- Jira or pasted reference tickets provide headings, field conventions, tone, naming style, and expected detail.
- DoR/DoD sources provide readiness and completion checks.
- Current Jira metadata provides authoritative project, issue-type, field, option, and hierarchy constraints.
- Current source code provides verified implementation context when exploration is enabled.
- th0th memory provides leads and prior conventions, not current Jira truth.

Never copy a reference ticket's business context, customer names, issue keys, owners, components, labels, dates, estimates, links, acceptance criteria, or implementation claims unless another valid source confirms they apply.

If a reference and current Jira metadata conflict, current Jira metadata wins for fields and hierarchy. Surface meaningful format conflicts instead of silently blending them.

## Bounded Code Exploration

Run the massa-ai exploration workflow as a read-only child pass when ticket quality depends on current implementation context, reusable utilities, ownership boundaries, or likely affected modules.

Skip exploration when:

- The user explicitly opts out.
- No codebase is available.
- Work is process-only and source inspection would not improve scope or verification.
- Supplied authoritative design material already resolves the relevant implementation boundaries.

Exploration must:

- Start from the closest code entry point to the requested behavior.
- Return exact current-source paths or symbols plus confirmed patterns and constraints.
- Separate confirmed facts from inferences.
- Use one consolidated pass by default.
- Parallelize only genuinely independent code areas when agent orchestration is available and context packets remain isolated.

Exploration must not:

- Search Git history, branches, commits, pull requests, or repository ticket references for ticket examples or template conventions.
- Invent file paths or prescribe implementation details unsupported by current source.
- Turn repository observations into Jira project conventions.

## Missing Sources

- Unreadable Jira reference: ask whether to retry with a valid key or use built-in templates.
- Unreadable DoR/DoD source: report which source failed and ask whether to retry or use the corresponding default.
- Ambiguous pasted content: ask whether it is a template, factual requirements, DoR, or DoD before using it.
- Large source set: apply `references/context-firewall.md` and retain compact facts with source pointers instead of raw copies.
