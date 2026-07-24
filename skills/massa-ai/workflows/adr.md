### 📜 ADR (Architecture Decision Record)

Use this workflow to record a finalized or being-finalized architecture decision. Do not use it to decide among open options; route undecided proposals to `workflows/rfc.md`. Do not use it for implementation planning; route that to `workflows/tdd.md`.

1. Resolve/reuse `projectId` and `workflowSessionId`: `adr-[entity]`.
2. Load shared references:
   - `references/adr-authoring.md` always.
   - `references/context-firewall.md` before reading large Markdown files, Atlassian pages, NotebookLM outputs, Figma exports, broad research, or verbose source output.
   - `references/mobile-context.md` only when ADR context touches KMP, iOS, Android, native bridges, mobile lifecycle, offline sync, permissions, push/background behavior, local persistence, or backend-mobile contracts.
3. `recall` -> load previous decisions, related RFCs, PRDs, discussions, superseded ADRs, accepted constraints, rejected options, and project-specific ADR conventions for the entity.
4. Gather source context using `references/adr-authoring.md`:
   - Use explicitly provided Markdown files and prompt context first.
   - Use ADR templates, PRDs, and RFCs from Markdown or Atlassian MCP when provided.
   - Use optional complementary-stack ADRs from Markdown or Atlassian MCP as cross-stack context only when they affect contracts, constraints, dependencies, risks, or links.
   - Use optional same-stack example ADRs from Markdown or Atlassian MCP as format/style references only; do not treat their decision context as facts for the new ADR.
   - Use Figma MCP for UI/UX context only when provided and relevant; otherwise use PRD/RFC/NotebookLM context, or ignore UI/UX when absent.
   - When supplied Figma links, nodes, desktop selections, or screenshots materially affect the decision, use `workflows/design.md` as optional child context for mobile UI implications only; the ADR still owns the decision record. Screenshots are context-only unless paired with structured Figma evidence.
   - Use NotebookLM only when the user provides one or more notebook IDs; query each relevant notebook separately, preserve attribution, and do not assume a default notebook.
   - Corroborate with massa-ai search, current repo docs, existing ADRs, and code when the decision depends on current project reality.
5. Run the ADR readiness gate from `references/adr-authoring.md`:
   - If a needed PRD, RFC, template, decision detail, or source fact is absent, ask for the missing context instead of inventing it.
   - If an RFC is needed but absent and the user does not know the missing context, assume the decision is not made and route to `workflows/rfc.md`.
   - Require a source-backed or user-confirmed title, date, status, context, decision, consequences, links, and supersession status before drafting.
6. Draft the ADR using the project's provided template when available; otherwise use the format selected through the `references/adr-authoring.md` fallback questions. Keep claims tied to source confidence: confirmed, user-provided, recalled, inferred, or unresolved.
7. Save the generated ADR using the selected output target:
   - Default: write to the project's standard ADR directory in Default mode. In Plan Mode, propose the path and content without writing.
   - Confluence: when requested and a parent page link is provided, write a child page through Atlassian MCP and report the resulting page link.
   - Fallback: if Confluence was requested without a parent link or Atlassian MCP is unavailable, ask for the parent link or permission to write local Markdown under `.adr/`.
   - Use sequential numbering from the selected local ADR directory when writing Markdown.
8. At completion, persist the decision via `remember` as a scored `decision` memory with `memory:semantic`, explicitly linking the ADR file path and source context used.
9. Complete the Evidence Gate from `references/evidence-gate.md`.
