# Naming Standards

Use this reference when a workflow writes code, drafts implementation contracts, audits code quality, or executes findings that introduce, rename, or preserve identifiers.

## Goal

Names must explain the role, domain concept, or contract they represent without forcing a future agent to infer intent from surrounding code alone.

## Source Order

Prefer naming evidence in this order:

1. Current source and public contracts.
2. `CONTEXT.md`, glossary files, product docs, specs, tickets, ADRs, and TDDs.
3. Existing tests, fixtures, schemas, routes, events, commands, screens, and use-case names.
4. Local surrounding-code vocabulary when no stronger source exists.

Code vocabulary is evidence, not truth. When business intent is inferred only from names, mark it as an inference or keep the existing term until stronger evidence exists.

## Rules

- Use domain vocabulary for business concepts, state, policy, workflows, and persisted data.
- Name technical plumbing by exact role: parser, adapter, transport, serializer, cache, fixture, validator, resolver, mapper, projection, or report.
- Replace vague names such as `data`, `info`, `result`, `value`, `temp`, `obj`, `item`, `list`, `manager`, `handler`, and `helper` when a more specific role or concept is known.
- Keep short generic names only for narrow, conventional scopes where they increase clarity: loop indexes, tuple destructuring, common callback names, test placeholders, tiny local transforms, or framework-required signatures.
- Prefer naming the invariant over naming the implementation detail when that invariant is what callers depend on.
- Do not rename public contracts, persisted fields, event names, API parameters, CLI flags, fixture keys, or snapshot/test identifiers unless compatibility and migration impact are explicitly in scope.
- When a rename is the fix, update all call sites, docs, tests, fixtures, snapshots, and generated examples that form the contract; do not weaken validation assets to hide drift.
- Avoid fabricated domain terms. If no meaningful name is supported by evidence, choose the most precise technical role name and leave the domain uncertainty explicit in the plan, TDD, or audit.

## Workflow Use

- Feature, spec-driven execution, and implementation execution use this before writing or changing identifiers.
- TDD uses this when naming proposed components, modules, states, events, schemas, or data fields.
- Code-quality audit uses this to distinguish real vague-name findings from harmless conventional short names.
- Code-quality execution uses this to choose precise replacements and protect public compatibility during renames.

## Verification

Before completion, perform a focused diff review for touched identifiers:

- New or renamed identifiers use domain or role-specific vocabulary.
- Remaining generic names are narrow, conventional, or externally required.
- Public contracts and persisted names were preserved unless compatibility handling was part of the task.
- Tests, fixtures, snapshots, schemas, docs, and examples were not weakened to make a rename pass.

Report skipped naming checks when the task does not touch code or design identifiers.
