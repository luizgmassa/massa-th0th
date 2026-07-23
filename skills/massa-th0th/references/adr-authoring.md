# ADR Authoring

Use this reference from `workflows/adr.md`. It defines how massa-th0th creates Architecture Decision Records without delegating orchestration to another ADR skill.

## Core Rule

An ADR records a significant architecture decision that is already made or being finalized. If the user is still choosing among options, route to `workflows/rfc.md`. If the user needs implementation design after the decision, route to `workflows/tdd.md`.

Route matrix:

| User state | Route |
|---|---|
| One architecture decision is selected and needs durable consequences recorded | ADR |
| Two or more options remain open, or stakeholders must review before choosing | RFC |
| Direction is selected and implementation architecture/contracts/rollout need a blueprint | TDD |
| Requirements, design, tasks, and execution all need staged approval | Spec-driven |

Source relevance requires the source to name at least one target, constraint, risk, dependency, public contract, rejected option, decision owner, or rollout/rollback consequence for this ADR. Sources that provide only style or adjacent context are examples, not facts.

Do not guess. Missing source facts become questions, source gaps, or a workflow route change.

## Source Order

Prefer sources in this order:

1. User prompt and explicitly provided Markdown files.
2. ADR template from Markdown or Atlassian MCP. If absent, ask fallback ADR format/status/supersession questions.
3. PRD from Markdown or Atlassian MCP when provided. If needed but absent, ask for missing context instead of inventing.
4. RFC from Markdown or Atlassian MCP when provided. If needed but absent, ask for missing context instead of inventing. If the user does not know, assume the decision is not made and route to `workflows/rfc.md`.
5. Complementary ADR from Markdown or Atlassian MCP when provided. Use it as factual context only for cross-stack constraints, contracts, dependencies, risks, and links.
6. Same-Stack Example ADR from Markdown or Atlassian MCP when provided. Use it only for format, structure, tone, naming, metadata, and placement conventions; do not use its decision context, rationale, constraints, consequences, or claims as facts for the new ADR.
7. UI/UX context from Figma MCP when provided and relevant. If Figma is absent, use PRD, RFC, or NotebookLM context. If none exists, ignore UI/UX.
8. NotebookLM when the user provides one or more notebook IDs. Query each relevant notebook separately, preserve source attribution by notebook ID, dedupe overlapping facts, and never assume or hard-code a default notebook ID.
9. `recall`, `search`, current repo docs, existing ADRs, and source code for corroboration.

Load `references/context-firewall.md` before bringing large Markdown, Atlassian, NotebookLM, Figma, broad research, or verbose source output into the main context. Bring back source pointers and compact facts, not raw dumps.

Load `references/mobile-context.md` only when the ADR context touches KMP, iOS, Android, native bridges, mobile lifecycle, offline sync, permissions, push/background behavior, local persistence, or backend-mobile contracts. Mobile is context-only here; do not add runtime mobile lazy-loading policy unless the user separately asks for that decision.

## Stack ADR Inputs

Classify optional ADR inputs before using them:

- `target-stack`: the stack of the ADR being created, such as mobile, backend, frontend, data, infrastructure, or platform.
- `complementary-stack`: another stack that integrates with the target stack, such as backend for a mobile ADR or mobile for a backend ADR.
- `same-stack example`: an ADR from the same stack as the target, provided as an example/base.

Use explicit user labels first. Infer stack role from source names, page titles, paths, or content only when obvious. Ask when ambiguity affects whether the ADR is complementary context or same-stack example.

Complementary ADR rules:

- Accept from Markdown files or Atlassian MCP.
- Use as real context only for cross-stack API contracts, schemas, auth flows, data ownership, compatibility constraints, rollout dependencies, operational risks, security boundaries, and links.
- Do not copy unrelated rationale or consequences from the complementary ADR into the new ADR.

Same-Stack Example ADR rules:

- Accept from Markdown files or Atlassian MCP.
- Use as style and structure guidance only: headings, metadata shape, status wording, numbering pattern, title style, tone, level of detail, and link formatting.
- The same-stack example context is not factual context for the new ADR.
- The example ADR facts must not be copied into context, rationale, constraints, consequences, links, or source confidence for the new ADR unless separately confirmed by another valid source.

## NotebookLM Inputs

Accept multiple NotebookLM notebook IDs when the user provides them. For each relevant notebook ID:

- Query the notebook separately for ADR-relevant facts.
- Preserve attribution by notebook ID in the source notes.
- Dedupe overlapping facts across notebooks without losing source coverage.
- Treat NotebookLM summaries as source-backed context only when the answer ties facts to notebook sources.
- Never hard-code a notebook ID or assume a default notebook.

If a notebook cannot be queried, state the failure and continue with available sources instead of inventing notebook facts.

## Source Confidence

Label each material claim before finalizing:

- `confirmed`: verified against current source, docs, ADRs, or MCP-backed context.
- `user-provided`: supplied directly by the user.
- `recalled`: recovered from th0th memory and not contradicted by current evidence.
- `inferred`: derived from evidence; state the inference and why it follows.
- `unresolved`: not sufficiently supported; ask or omit.

Do not include unresolved claims as ADR facts.

## Readiness Gate

Proceed only when all mandatory fields are source-backed or user-confirmed:

- Decision title: noun phrase, not a question.
- Decision date: use the user's date or current date when no other date is provided.
- Status: Accepted, Proposed, Deprecated, or Superseded.
- Context: forces, constraints, and situation that made the decision necessary.
- Decision: what was chosen and why this option wins.
- Consequences: positive and negative trade-offs.
- Supersession: whether this supersedes or is superseded by another ADR.
- Links: related ADRs, RFCs, PRDs, tickets, docs, Figma files, NotebookLM notes, or code references when available.

Recommended fields:

- Decision drivers.
- Options considered.
- Pros and cons per option.
- Outcome rationale tied to the drivers.
- Rollback, migration, or reversibility notes when decision risk warrants them.

Ask before drafting when a mandatory field is missing. If the user cannot confirm that a decision has been made, route to RFC.

## Fallback Questions

When no project template or sufficient context is provided, ask only for missing high-impact details. Use these ADR-authoring questions as the fallback set:

- What decision should this ADR record?
- Which format should be used: MADR, Nygard, or Y-Statement? Default to MADR for structured trade-offs.
- What is the status: Accepted, Proposed, Deprecated, or Superseded?
- Does this ADR supersede a previous decision? If yes, which ADR?
- What context, constraints, or product forces made the decision necessary?
- Which alternatives were seriously considered, and why were they rejected?
- What positive and negative consequences should future engineers know?

If the user provides a project ADR template, follow it instead of these fallback questions.

## Format Guidance

Use the project's existing ADR style first. If no template or prior convention exists:

- MADR: default for most decisions, especially when alternatives were compared.
- Nygard: use for small, obvious decisions that only need Context, Decision, and Consequences.
- Y-Statement: use for very compact inline records.

Preserve the user's language for section headers and content. Keep technical terms in English when that is the local convention.

## Numbering And Placement

Find the ADR directory before assigning a number. Check common locations in order:

1. `docs/adr/`
2. `docs/decisions/`
3. `adr/`
4. `.adr/`

Scan existing ADR filenames for the highest zero-padded number and assign the next number. Use `NNN-kebab-case-title.md`. If no directory exists, propose `docs/adr/001-kebab-case-title.md` unless the user or project docs specify a different location.

In Default mode, save the ADR when the user asked for execution. In Plan Mode, propose the path and content without writing.

## Output Targets

Default output is local Markdown in the project's standard ADR directory.

Confluence output:

- Use only when the user requests Confluence output.
- If the user provides a parent Confluence page link, write the generated ADR as a child page through Atlassian MCP.
- Include the resulting Confluence page link in completion evidence and ADR links when available.
- If the parent page link is missing, ask for the parent link or ask whether to write the ADR Markdown under `.adr/` instead.
- If Atlassian MCP is unavailable, state that Confluence writing is unavailable and ask whether to write a local `.adr/` Markdown file.

Local `.adr/` fallback:

- Use `.adr/` when the user chooses local fallback after missing Confluence parent context or unavailable Atlassian MCP, even if another standard ADR directory exists.
- Preserve the same ADR numbering and filename rules unless the project has a stronger convention.
- Do not silently switch from requested Confluence output to local files without user confirmation.

## Quality Checklist

Before finalizing:

- Title records the decision, not the question.
- Date and status are present.
- Context explains forces and constraints, not just the implementation outcome.
- Decision is direct and tied to source-backed rationale.
- Consequences include honest downsides.
- Alternatives include at least two real options when using MADR.
- Links and supersession relationships are included when applicable.
- File path and number match project convention.
- Every non-obvious claim has source confidence.

## Anti-Patterns

- Creating an ADR for an undecided proposal instead of routing to RFC.
- Writing implementation details that belong in a TDD.
- Editing the meaning of old ADRs instead of superseding them.
- Omitting "why not" rationale for rejected alternatives.
- Treating th0th memory as current truth without corroboration when accuracy matters.
- Fabricating PRD, RFC, UI/UX, Atlassian, Figma, or NotebookLM facts because a source was unavailable.
- Treating same-stack example ADR facts as context for the new ADR.
- Copying complementary ADR rationale outside cross-stack contracts, constraints, dependencies, risks, or links.
- Silently writing local `.adr/` Markdown when the user requested Confluence output.
