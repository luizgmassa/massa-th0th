# TOON Compact Output Specification (M36)

## Problem Statement

massa-ai's MCP tools return rich JSON `data` payloads that bloat agent context. A TOON (Token-Oriented Object Notation) encoder (`@toon-format/toon`) is already pinned and wired into 9 tools via a duplicated inline `format === "toon" ? {success,data:toTOON(x)} : {success,data:x}` switch — one copy per tool, no shared seam. Three high-value graph/context tools (`get_optimized_context`, `trace_path`, `impact_analysis`) have no `format` support at all, and no tool supports field projection (`fields`), which is the larger token lever for heavy graph payloads (e.g. `trace_path.nodes`/`edges`, `impact_analysis.impacted[]`).

## Goals

- [ ] One shared serializer owns the format + projection logic; all data-returning tools route through it.
- [ ] `format:"json"|"toon"` available on the 3 missing tools, MCP-parity in both schema layers.
- [ ] `fields:string[]` projection available on all 12 tools, composing with both formats.
- [ ] Zero behavior change for the 9 existing tools and for callers of the 3 new tools at default params.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Flipping the 9 existing tools' default away from `"toon"` | Already shipped; changing defaults is a separate compat decision |
| TOON-encoding error responses | Errors stay `{success:false,error}`; format/fields apply to success `data` only |
| Row/count caps, deadline-based truncation | Separate items (M7 query deadline, M26 JSON extraction) |
| `query-pack` "tool" | It is a DB column, not an MCP tool (false lead) |
| De-duplicating the two schema layers into one source | Architecture work tracked as M32; M36 must keep both layers in parity manually |
| Non-success `data` hints (e.g. trace_path not-found `hint`) | Projection/encode applies only to success-path `data` |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Default `format` for the 3 newly-enabled tools | `"json"` | Pure additive — preserves exact current wire shape (raw object); zero break for any caller. TOON stays opt-in. | n (logged; safe default — flip to `"toon"` later once callers audited) |
| Default `format` for the 9 existing tools | `"toon"` (unchanged) | Already shipped in production; in-tree MCP client already handles toon-string `data` | y (status quo) |
| `fields` semantics | Shallow + dotted-path pick over `data`; arrays projected element-wise | Covers the real cases (`["nodes"]`, `["impacted.symbol","impacted.risk"]`) without a query-language | n (design choice) |
| `fields` empty/absent | Full `data` (no projection) | Avoids accidental emptying | y |
| Unknown field requested | Silently omitted (no error) | Graceful; matches projection utility norms | y |
| Schema parity | Add params to BOTH tool-class `inputSchema` AND `apps/mcp-client/src/tool-definitions.ts` | MCP client uses static duplicated schemas, not class schemas | y (verified) |

**Open questions:** none unresolved — all logged as accepted assumptions above.

---

## User Stories

### P1: Shared serializer + behavior-preserving migration ⭐ MVP

**User Story**: As a maintainer, I want one serializer for tool responses so format/projection logic lives in one tested place instead of 9 duplicated switches.

**Why P1**: Eliminates the duplication that would otherwise multiply (9→18) once `fields` lands; is the prerequisite for every other story.

**Acceptance Criteria**:
1. WHEN a tool success path returns THEN it SHALL route through `serializeToolResponse(result, {format, fields})` returning a `ToolResponse`.
2. WHEN `format="json"` THEN `data` SHALL be the raw object (byte-identical shape to pre-refactor for the 9 existing tools).
3. WHEN `format="toon"` THEN `data` SHALL be a TOON-encoded string.
4. WHEN `fields` is unset THEN no projection SHALL occur.

**Independent Test**: Refactor the 9 tools to the helper; existing tool tests + a serializer unit suite pass with no shape change.

### P2: `format` on the 3 missing tools

**User Story**: As an agent, I want `format:"toon"` on `get_optimized_context`, `trace_path`, `impact_analysis` so I can cut context tokens like the other 9 tools.

**Acceptance Criteria**:
1. WHEN I call any of the 3 tools with `format="toon"` THEN `data` SHALL be a TOON string.
2. WHEN I call any of the 3 tools without `format` THEN `data` SHALL be the raw object (default `"json"`).
3. WHEN the MCP client lists the tool THEN its `inputSchema` SHALL advertise `format` (enum json|toon, default json) — parity with class schema.

**Independent Test**: Call each tool with `format:"toon"` and assert `typeof data === "string"`; call without and assert object.

### P3: `fields` projection on all 12 tools

**User Story**: As an agent, I want to request only specific fields so heavy graph payloads shrink without losing the keys I need.

**Acceptance Criteria**:
1. WHEN `fields=["a","b"]` THEN `data` SHALL contain only keys `a`,`b` (others omitted), in both json and toon modes.
2. WHEN `fields=["nodes.symbol"]` (dotted) THEN each element of `data.nodes` SHALL contain only `{symbol}`.
3. WHEN `fields=[]` or absent THEN full `data` SHALL be returned.
4. WHEN `fields` names a non-existent key THEN that key SHALL be silently absent (no error).
5. WHEN the MCP client lists any of the 12 tools THEN `inputSchema` SHALL advertise `fields` (array of string).

**Independent Test**: Call `trace_path` with `fields:["nodes.symbol","edges.type"]` and assert each projected element has only the requested keys.

---

## Edge Cases

- WHEN `data` is an array (not object) THEN `fields` SHALL project element-wise; top-level scalar `data` SHALL be returned unchanged.
- WHEN `fields` requests a nested path whose midpoint is not an object/array THEN that path SHALL be silently dropped.
- WHEN `format="toon"` and projected `data` is `{}` THEN `data` SHALL be a valid empty TOON string.
- WHEN the tool errors THEN response SHALL be `{success:false, error}` regardless of `format`/`fields` (no projection/encode of error path; existing `hint` `data` on not-found is on the error branch and excluded).
- WHEN a dotted `fields` entry has no dot THEN treated as a top-level key.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| TOON-01 | P1 | Design | Pending — shared `serializeToolResponse` helper |
| TOON-02 | P1 | Tasks | Pending — route 9 existing tools through helper (behavior-preserving) |
| TOON-03 | P2 | Tasks | Pending — add `format` to 3 tools (class + MCP defs, default json) |
| TOON-04 | P3 | Tasks | Pending — add `fields` to all 12 tools (class + MCP defs) |
| TOON-05 | P3 | Design | Pending — projection semantics (shallow + dotted, element-wise arrays) |
| TOON-06 | P2/P3 | Tasks | Pending — MCP `tool-definitions.ts` parity for new params |
| TOON-07 | P1 | Tasks | Pending — error path unchanged |

**Coverage:** 7 requirements, all mapped to tasks.

---

## Success Criteria

- [ ] One serializer, 9 duplicated switches removed, 3 tools gain `format`, all 12 gain `fields`.
- [ ] Existing tool tests green with no shape change; new serializer + projection unit tests cover the format×fields matrix.
- [ ] `bun test` (focused) + type-check + build green; independent verifier PASS.

## Sizing

Medium (public MCP-contract additive + reusable-pattern refactor across ~14 files: 1 new helper, 12 tool files, 1 MCP definitions file). Includes Design (public contract + reusable serializer pattern) and Tasks (>3 steps, two-layer parity sequencing).
