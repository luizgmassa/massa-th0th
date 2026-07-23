# Atlassian Ticket Execution

Use this reference before any Atlassian tool call that reads creation metadata or mutates Jira.

## Capability Discovery

Inspect currently callable tools and dynamically identify Atlassian MCP operations by capability and schema, not by one provider-specific function name. Locate operations for:

- Accessible Atlassian sites or cloud resources.
- Jira project lookup.
- Issue-type, field, option, and hierarchy metadata.
- Jira issue search and issue retrieval.
- Jira issue creation.

Atlassian MCP is required. Do not use Jira CLI, REST calls assembled outside the MCP, browser automation, GitHub Issues, Linear, Trello, Asana, Shortcut, or local repository files as creation fallbacks.

If multiple accessible sites contain the same project key, ask the user to choose the site before drafting final fields.

## Preflight

Complete preflight before requesting creation approval:

1. Resolve the exact site or cloud resource and exact Jira project key.
2. Fetch supported Epic, standard, and sub-task issue types needed by the selected hierarchy.
3. Fetch required create fields and allowed values for each requested issue type, including parent-field behavior.
4. Confirm the create operation is callable with the required fields.
5. Validate every proposed parent relationship against Jira metadata.
6. Search the selected project for potential duplicates using the exact summary plus the top 3 domain terms from the acceptance criteria, component/surface, and primary user-visible outcome. If fewer than 3 domain terms exist, use all available non-prefix terms and record the reduced query.
7. Build the exact top-down creation order.

Never promise that a generic `Story`, `Task`, `Bug`, `Spike`, `Epic`, or `Sub-task` name exists. Use the project's returned issue-type IDs and names. When Jira lacks the requested semantic type, show supported choices and require user selection instead of silently mapping it.

## External Review Artifact

Resolve the temporary plans directory in this order:

- Codex: `$CODEX_HOME/plans/`; if `CODEX_HOME` is unset, use `~/.codex/plans/` only when that is the detected Codex home.
- Claude Code: `~/.claude/plans/`.
- Cursor: `~/.cursor/plans/`.
- OpenCode: `~/.config/opencode/plans/`.
- Other agents: the runtime-provided agent home plus `/plans/`.
- If no agent home is known or the directory cannot be written, ask for an external writable directory.

The path must resolve outside the active repository. Reject symlinks or relative paths that resolve inside it. Create one file named `ticket-<lowercase-project>-<kebab-slug>-<YYYYMMDDTHHMMSSZ>.md`.

Minimum artifact metadata:

```markdown
# Jira Ticket Draft

**Project:** EXAMPLE
**Hierarchy:** epic-tickets | epic-tickets-subtasks | tickets-subtasks
**Draft Revision:** 1
**Approval Status:** NOT APPROVED
**Approved Revision:** none
**Created:** 2026-06-15T12:00:00Z
```

For each stable draft ID, include issue type ID and name, summary, parent draft ID or Jira key, dependency draft IDs or Jira keys, required fields, complete description, duplicate candidates and disposition, creation status, Jira key, and Jira URL. Include source pointers, open questions, and the ordered creation list once for the batch.

Any revision to a summary, description, field, relationship, dependency, duplicate disposition, or creation order must increment `Draft Revision`, set `Approval Status: NOT APPROVED`, and clear `Approved Revision`.

## Approval Gate

After final metadata, quality, and duplicate checks, present the current artifact and ask for explicit approval to create the listed Jira issues for the named project and current revision.

Valid approval must clearly authorize Jira creation for that revision. Approval does not carry across revisions. Do not treat prior approval, silence, "looks close", or a request to keep editing as authorization.

Immediately before the first mutation, verify:

- Artifact revision still equals approved revision.
- Approval status is `APPROVED`.
- Project, site, issue metadata, and duplicate dispositions have not changed since approval.
- No unresolved blocking field or open question remains.

If any check changes the draft, invalidate approval and return to review.

## Creation Order And Checkpointing

Create strictly top-down:

1. New Epic, when selected. Capture its key and URL.
2. Standard issues in dependency-safe order. Set the Epic or parent relationship only through the current Jira-supported field shape.
3. Sub-tasks after each parent standard issue has a confirmed Jira key.

After each successful create call:

1. Verify the response contains a Jira key or stable identifier.
2. Fetch or construct the canonical URL only from returned site and issue data.
3. Update that draft ID in the external artifact to `CREATED` with key and URL before the next mutation.
4. If artifact update fails, stop before creating another issue and report the confirmed Jira result.

Do not add comments, transition statuses, assign owners, set optional fields, or link issues unless they are explicitly present in the approved draft.

## Ambiguous Results And Partial Failure

For timeout, connection loss, malformed response, or unknown create result:

1. Stop the batch.
2. Search the selected project using the approved summary plus the top 3 domain terms before retrying.
3. If one matching issue is confirmed, record it as created and require resume approval for remaining items.
4. If zero or multiple plausible matches remain, mark the draft ID `UNKNOWN`, report the ambiguity, and do not retry automatically.

For any partial failure:

- Retain the external artifact.
- Report created, unknown, failed, and pending draft IDs with known Jira links.
- Never auto-delete created issues.
- Never auto-transition, comment on, or mark a parent blocked as compensation.
- Never continue with dependent children after a parent failure.

## Resume

Resume only after explicit user approval of the retained artifact's current revision.

Before resuming:

1. Re-fetch every recorded Jira issue and parent relationship.
2. Re-run duplicate searches for `UNKNOWN`, `FAILED`, and `PENDING` items.
3. Re-fetch relevant issue metadata and required fields.
4. Recompute remaining creation order.
5. Update any changed facts in the artifact, increment revision, and invalidate old approval.

Create only items confirmed missing. Jira is authoritative for already-created issues; the artifact is the review and checkpoint record.

## Completion And Cleanup

Complete only when every approved draft ID is mapped to a confirmed Jira issue and parent relationships match the approved hierarchy.

Report all keys and URLs first. Then delete the temporary artifact. If deletion fails, report the path and error without changing the successful Jira outcome. Retain the artifact on cancellation, partial failure, or unresolved ambiguity.
