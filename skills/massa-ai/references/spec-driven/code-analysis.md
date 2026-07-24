# Spec-Driven Code Analysis

Use this reference when Specify, Design, Tasks, Execute, or Validate needs source inspection or structural code search.

<!-- validator anchors: current repository source and approved .specs/ artifacts override stale memory -->

## Tool Priority

Use graceful degradation, starting from massa-ai indexed tooling and falling back to structural, then text, search:

1. `list_projects` (or equivalent index metadata) before indexed reads, to verify project ID, path, status, and freshness.
2. `search` (or indexed symbol reads) when available and fresh for the current repository path and worktree state. Prefer `search_definitions`, `get_references`, or `optimized_context` for symbol- and reference-shaped queries.
3. `sg` / ast-grep for structural pattern-based search when installed.
4. `rg` (ripgrep) for fast context-aware text and file search.
5. `grep` or direct file reads as the final, always-available fallback.

## Freshness And Source Precedence

- Current repository source and approved `.specs/` artifacts override stale memory, old search results, external summaries, debug exports, and generated plans.
- `project_map`, `search`, and `optimized_context` are discovery evidence, not proof, until confirmed against source files read in this session or returned with current freshness evidence.
- If indexed results conflict with current files, or the index is stale, incomplete, missing the target path, or older than relevant local changes, trust current files and record the stale-index observation when it affects decisions.
- Use massa-ai durable memory for prior decisions, rejected approaches, reusable patterns, and verification recipes; do not use it as codebase evidence without current-source confirmation.

## Rules

- Inspect current codebase and project docs before external docs.
- Prefer structural or symbol search for definitions, call sites, schemas, routes, test files, and public contract fields.
- Limit search scope to affected modules, source sets, tests, fixtures, schemas, and docs that define behavior.
- Record source evidence as files, symbols, line numbers, and commands in `design.md`, `tasks.md`, or `validation.md`.
- If a tool is unavailable, use the next fallback and state the skipped tool only when it affects confidence.

## Detection

Check tool availability before use. Run the massa-ai tier first; only probe `sg` / `rg` when you are about to rely on them:

```bash
# Check for ast-grep
if command -v sg >/dev/null 2>&1; then
  # Use ast-grep for structural search
elif command -v rg >/dev/null 2>&1; then
  # Fall back to ripgrep
else
  # Use standard grep as final fallback
fi
```

## Usage Examples

**Finding function definitions:**

```bash
# ast-grep (best - structural)
sg -p 'function $NAME($$$) { $$$ }'

# ripgrep (fallback - fast text)
rg '^function\s+\w+\(' --type-add 'source:*.[extension]' -t source

# grep (last resort - basic)
grep -r '^function ' --include="*.[extension]"
```

**Finding imports/requires:**

```bash
# ast-grep
sg -p 'import { $$$ } from "$MODULE"'

# ripgrep
rg '^import .* from' --type-add 'source:*.[extension]' -t source

# grep
grep -r '^import ' --include="*.[extension]"
```

**Finding class/component definitions:**

```bash
# ast-grep
sg -p 'class $NAME { $$$ }'

# ripgrep
rg '^(class|export class)\s+\w+' --type-add 'source:*.[extension]' -t source

# grep
grep -r '^class ' --include="*.[extension]"
```

## Search Scope

**Best practices:**

- Limit to source file extensions relevant to project
- Exclude directories: `node_modules`, `vendor`, `dist`, `build`, `.git`
- Focus on source directories: `src`, `lib`, `app`
- Use file type filters when available

**Performance tips:**

- Use specific patterns over broad searches
- Limit directory depth with `--max-depth` (ripgrep/grep)
- Cache results for repeated queries

## Fallback Notice

If ast-grep is unavailable, display once per session:

```
⚠️ ast-grep not detected. Install for more precise structural code analysis.
   https://ast-grep.github.io/guide/quick-start.html
```

## When To Use

- Finding usage patterns across the codebase
- Identifying code structure and organization
- Locating function/class/component definitions
- Analyzing import/dependency patterns
- Refactoring impact analysis
- Code navigation in unfamiliar codebases
