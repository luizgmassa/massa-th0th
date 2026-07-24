### Ticket

Use this workflow when the user wants to draft, review, create, or resume creation of Jira Epics, standard issues, or sub-tasks. Jira through Atlassian MCP is the only tracker and mutation path. Do not use Jira CLI, browser automation, another tracker, or repository backlog files as fallbacks.

## Workflow

1. Resolve or reuse `projectId` and `workflowSessionId=ticket-<entity>`.
2. Recall durable project conventions, prior Jira constraints, and ticket-writing decisions through `recall`. Treat recalled facts as leads until confirmed by the user or current Jira metadata.
3. Load the focused contracts:
   - `references/ticket/intake-and-sources.md` for ordered questions, reference-ticket isolation, DoR/DoD inputs, and bounded code exploration.
   - `references/ticket/templates-and-quality.md` for title prefixes, built-in templates, decomposition, and draft validation.
   - `references/ticket/atlassian-fix.md` before tool discovery, preflight, approval, Jira creation, resume, or cleanup.
   - `references/context-firewall.md` when Jira, Confluence, supplied files, or exploration output could flood context.
4. Discover Atlassian MCP capabilities dynamically. Require readable Jira project metadata and issue-creation capability before promising creation. If Atlassian MCP is missing or read-only, drafting may continue, but stop before approval-to-create and report the unavailable capability. Never substitute a CLI or tracker.
5. Run ordered intake from `intake-and-sources.md`. Ask only for information not already supplied or discoverable from Atlassian metadata. Validate the exact project key without silently correcting it.
6. When code grounding is useful, run a bounded read-only child pass using `workflows/exploration.md`, then return to the ticket session. Never search Git history, branches, commits, or repository ticket references for ticket examples or templates.
7. Inspect the selected Jira project's issue types, required fields, parent rules, and relevant field options before finalizing the draft. A reference ticket controls format and tone only; it does not authorize copying project facts.
8. Draft the requested hierarchy using `templates-and-quality.md`. Keep each standard issue independently understandable, use sub-tasks only for atomic work owned by one parent, and make dependencies explicit.
9. Search the selected Jira project for potential duplicates using the proposed summary and distinctive scope terms. Record candidates in the review artifact; do not silently merge, skip, or close work.
10. Resolve the agent-native external plans directory and create one temporary review file named `ticket-<project>-<slug>-<YYYYMMDDTHHMMSSZ>.md`. The artifact must be outside the repository and contain stable draft IDs, draft revision, approval status, creation order, Jira fields, full descriptions, duplicate candidates, open questions, and created keys or URLs when present.
11. Run every deterministic quality gate from `templates-and-quality.md`. Present the current artifact for review. Any content or field revision increments `Draft Revision` and resets `Approval Status` to `NOT APPROVED`.
12. Require explicit user approval for the current draft revision before any Jira mutation. Approval of an older revision, generic encouragement, or approval given before the final quality and duplicate checks is invalid.
13. Execute the top-down creation contract from `atlassian-fix.md`: Epic first when requested, then standard issues, then sub-tasks. Persist each successful key and URL into the external review artifact before the next create call.
14. On partial failure, stop immediately. Retain the artifact, report created and pending draft IDs, and do not delete, transition, comment on, or otherwise compensate Jira issues automatically. Resume only with fresh explicit approval after Jira state and duplicate candidates are re-fetched.
15. After complete success, report all created keys and URLs, then delete the temporary review artifact. A cleanup failure does not invalidate Jira creation; report the retained path.
16. Persist only durable conventions or reusable Jira constraints after scoring and deduplication. Do not persist raw ticket bodies, customer data, temporary draft state, or one-run creation results to massa-ai.
17. Complete `references/evidence-gate.md`, including Atlassian capability used, artifact cleanup result, created issue links, skipped checks, memory outcome, and residual risk.

## Failure Handling

- Invalid or inaccessible project key: stop intake at project validation and ask for a valid key; never guess a nearby project.
- Missing reference ticket or source document: report the failed source and ask whether to retry or use built-in templates.
- Unsupported requested issue type or required custom field: show the Jira-supported choices and ask only for the blocking selection or value.
- Missing external plans path or write permission: ask for an external writable path; never write the draft into the repository.
- Duplicate candidate: present the candidate and require a create, revise, or cancel decision before approval.
- Jira create ambiguity or timeout: search Jira before retrying. Treat an unknown result as potentially created until disproved.

## Stop Conditions

Stop when the user leaves a reviewed draft without approval, cancels the run, Atlassian MCP cannot perform the required action, a blocking field remains unresolved, a partial failure needs a resume decision, or all approved issues are created and the temporary artifact cleanup has been attempted.
