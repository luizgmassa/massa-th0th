# Context Firewall

Use this reference before loading raw artifacts >200 lines, >20 KB, >50 search hits, generated reports, logs, screenshots, browser snapshots, CSVs, external research, or any source batch likely to exceed the next decision's needs.

## Principle

Keep verbose data outside the main reasoning window. Bring back only the facts needed for the next decision.

## Think In Code

For high-volume analysis:

- Prefer focused commands, small scripts, or structured parsers over reading large raw files into context.
- Return counts, paths, summaries, failing cases, and representative snippets.
- Include context pressure, queue/delegation state, sync or memory outcome, and
  skipped-check reasons only as compact fields when they affect the next
  decision.
- Keep temporary analysis outside repo-tracked files unless the task explicitly needs a reusable script.
- Use project map, summary search, targeted enriched search, symbol/file tools,
  `th0th_optimized_context`, and compression before broad shell reads when
  useful.
- Prefer `responseMode: "enriched"` only for a small targeted result set; it
  includes full content and should not become a broad dump.

## Thresholds

Apply the firewall before bringing any of these raw artifacts into the main context:

- Source, docs, logs, CSV, or reports over 200 lines or 20 KB.
- Search, grep, MCP, or external research output over 50 hits.
- Generated audit reports, screenshots, browser snapshots, crash/device logs, or raw NotebookLM/web research dumps.
- Any subagent output, tool transcript, or diff where only counts, paths, representative snippets, or failing cases are needed for the next decision.

## Tool Output Discipline

- Do not paste raw logs, snapshots, huge diffs, CSVs, or long command output into the main conversation.
- Summarize the result and include exact source pointers, commands, line numbers, or artifact paths.
- Artifact, memory, and search output is metadata-and-summary by default: include keys, paths, versions, checksums, statuses, counts, short summaries, and exact next steps only.
- Do not bring raw full artifact JSON, all-version artifact dumps, raw memory dumps, raw `th0th_search` result bodies, or long command transcripts into working context unless diagnosing corruption and no smaller proof can answer the question.
- Summarize raw subagent output, raw diffs, raw search output, raw logs, raw transcripts, and external research before they reach the main context.
- If conversation feedback is active, status lines may say what is being loaded, checked, blocked, or verified, but must not include raw tool output or private reasoning.
- Re-open only the smallest raw segment needed to verify a claim.
- If output is too large to inspect safely, delegate to a subagent or run a local summarizing command.

## Subagent Firewall

Use `references/agent-orchestration.md` for context-heavy research, verbose log inspection, or independent verification when delegation gates are met.

The main agent receives only:

- evidence
- findings
- risks and skipped checks
- exact next step

Subagents should not return raw dumps. The main agent still owns memory recall, persistence, synthesis, and the final Evidence Gate.

## Persistence Boundary

`th0th` remains the canonical memory layer for massa-th0th workflows. Do not introduce `.notebook/`, SQLite, generated state files, or new persistence systems unless a separate workflow explicitly requires them.

`references/conversation-feedback.md` is chat-visible progress only. It must not be treated as durable state, memory, or an event store.
