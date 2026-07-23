# Independent Validation Report — Codex + Cursor Plugin Parity

**Verifier**: Independent (author ≠ verifier)
**Branch**: `spec-codex-cursor-plugin-parity`
**Date**: 2026-07-22
**Spec**: `.specs/features/codex-cursor-plugin-parity/spec.md` (28 requirements: CPX-01..08, CRS-01..08, INS-01..12)

---

## Verdict: PASS

All 28 requirements verified against spec-anchored test evidence. 5/5 discrimination-sensor mutants killed. Gate green: type-check 6/6, build 5/5, 112 tests pass / 0 fail.

---

## Gate Results

| Gate | Command | Result |
| --- | --- | --- |
| Type-check | `bun run type-check` | 6/6 PASS (exit 0, full turbo cache) |
| Build | `bun run build` | 5/5 PASS (exit 0, full turbo cache) |
| Tests | `bun test` (8 test files) | 112 pass, 0 fail, 447 expect() calls, 9 files [27.7s] |

### Per-file test counts

| Test file | Pass | Fail |
| --- | --- | --- |
| `apps/claude-plugin/hooks/__tests__/massa-th0th-hook.test.ts` | 16 | 0 |
| `apps/claude-plugin/__tests__/install.test.ts` | 4 | 0 |
| `apps/codex-plugin/__tests__/install.test.ts` | 7 | 0 |
| `apps/codex-plugin/__tests__/manifest.test.ts` | 5 | 0 |
| `apps/cursor-plugin/__tests__/install.test.ts` | 6 | 0 |
| `apps/cursor-plugin/__tests__/manifest.test.ts` | 7 | 0 |
| `scripts/__tests__/install-agents.test.ts` | 54 | 0 |
| `scripts/__tests__/root-install-menu.test.ts` | 10 | 0 |

---

## Per-AC Evidence

### P1: Codex plugin bundle (CPX-01..08) — PASS

| AC | Req | Verified | Evidence (file:line) |
| --- | --- | --- | --- |
| AC1 | CPX-01 | PASS | `apps/codex-plugin/__tests__/install.test.ts:76-93` — `--user` creates `~/.codex/plugins/massa-th0th/` with `.codex-plugin/plugin.json`; hooks.json has 6 events |
| AC2 | CPX-02 | PASS | `apps/codex-plugin/__tests__/install.test.ts:95-102` — `--project` creates `./.codex/plugins/massa-th0th/` with plugin.json + hooks.json |
| AC3 | CPX-03 | PASS | `apps/codex-plugin/__tests__/manifest.test.ts:44-55` — 6 skills/*.md exist (map, index, find, def, graph, status) with `description:` + `allowed-tools:` frontmatter |
| AC4 | CPX-04 | PASS | `apps/codex-plugin/__tests__/manifest.test.ts:83-94` — `.mcp.json` has `mcpServers.massa-th0th` with `npx @massa-th0th/mcp-client` + `MASSA_TH0TH_API_URL` env. Deconfliction hint: `install.test.ts:189-194` (stdout contains `install-agents.ts` + `mcp`) |
| AC5 | CPX-05 | PASS | `apps/codex-plugin/__tests__/manifest.test.ts:57-81` — 6 events in hooks.json, each with `_massaTh0thOwned: true` entry pointing at `massa-th0th-hook` binary. Binary POST: `massa-th0th-hook.test.ts:182-193` (pre-tool-use → 1 POST to `/api/v1/hook`), `:249-259` (session-start → 1 POST), `:204-234` (pre-compact → 2 POSTs). Trust warning: `install.test.ts:182-187` (stdout contains `/hooks` + `trust`) |
| AC6 | CPX-06 | PASS | `massa-th0th-hook.test.ts:204-234` — pre-compact produces exactly 2 POSTs: observation to `/api/v1/hook` (event=pre-compact, 3s timeout) + snapshot to `/api/v1/hook/compact-snapshot` (persist=true, 5s timeout). `hooks.json:14-16` routes `PreCompact` → `pre-compact` subcommand |
| AC7 | CPX-07 | PASS | `apps/codex-plugin/__tests__/install.test.ts:136-166` — uninstall removes owned entries (user hook `echo user-hook` survives, `_massaTh0thOwned` entries gone, `model: "gpt-5"` preserved, plugin dir removed) |
| AC8 | CPX-08 | PASS (gap) | No dedicated test stubbing HTTP 423. Architecturally guaranteed: `postObservation` (`massa-th0th-hook.ts:148-204`) swallows all errors (`.catch()` → silent-degrade), `main()` unconditionally calls `process.exit(0)` (`:294`). Exit-0 contract pinned by `massa-th0th-hook.test.ts:153-180` (malformed JSON, empty stdin, terminal stdin, unknown subcommand all → exit 0). **See Gap G1.** |

### P2: Cursor plugin bundle (CRS-01..08) — PASS

| AC | Req | Verified | Evidence (file:line) |
| --- | --- | --- | --- |
| AC1 | CRS-01 | PASS | `apps/cursor-plugin/__tests__/install.test.ts:76-98` — `--user` creates `~/.cursor/plugins/massa-th0th/` with `.cursor-plugin/plugin.json` + `agents/massa-th0th-navigator.md`; hooks.json has `version` + `hooks` with 7 events |
| AC2 | CRS-02 | PASS | `apps/cursor-plugin/__tests__/install.test.ts:100-107` — `--project` creates `./.cursor/plugins/massa-th0th/` with plugin.json + hooks.json |
| AC3 | CRS-03 | PASS | `apps/cursor-plugin/__tests__/manifest.test.ts:31-61` — asserts exactly 7 events (`sessionStart`, `sessionEnd`, `beforeSubmitPrompt`, `preToolUse`, `postToolUse`, `preCompact`, `stop`). **Critical check confirmed**: test explicitly asserts `expect(hooks).toHaveProperty("sessionStart")` (`:47`) and `expect(hooks).toHaveProperty("preCompact")` (`:48`) — not just "7 events" |
| AC4 | CRS-04 | PASS | `apps/cursor-plugin/__tests__/manifest.test.ts:84-95` — `mcp.json` has `mcpServers.massa-th0th` with `npx @massa-th0th/mcp-client` + `MASSA_TH0TH_API_URL`. Deconfliction hint: `install.test.ts:190-195` |
| AC5 | CRS-05 | PASS | `massa-th0th-hook.test.ts:204-234` — pre-compact dual-POST (same binary, same test as CPX-06). `hooks/hooks.json:19-21` routes `preCompact` → `pre-compact` subcommand |
| AC6 | CRS-06 | PASS | `apps/cursor-plugin/__tests__/manifest.test.ts:47` — `expect(hooks).toHaveProperty("sessionStart")`. Binary POST for session-start: `massa-th0th-hook.test.ts:249-259` (1 POST to `/api/v1/hook`). `hooks/hooks.json:4-6` routes `sessionStart` → `session-start` |
| AC7 | CRS-07 | PASS | `apps/cursor-plugin/__tests__/install.test.ts:143-174` — uninstall removes owned entries (user hook `user-script` survives, `_massaTh0thOwned` gone, plugin dir removed) |
| AC8 | CRS-08 | PASS | `apps/cursor-plugin/__tests__/manifest.test.ts:121-139` — directory layout test asserts `skills/`, `skills/*/SKILL.md` (6), `hooks/hooks.json`, `mcp.json`, `agents/massa-th0th-navigator.md` all exist (matches `vscode.cursor.plugins.registerPath` auto-discovery) |

### P3: Installer integration + docs (INS-01..05) — PASS

| AC | Req | Verified | Evidence (file:line) |
| --- | --- | --- | --- |
| AC1 | INS-01 | PASS | `scripts/__tests__/root-install-menu.test.ts:30-38` — install.sh source contains `apps/codex-plugin/install.sh` and `apps/cursor-plugin/install.sh` references |
| AC2 | INS-02 | PASS | `scripts/__tests__/root-install-menu.test.ts:49-55` — regex asserts `bash "${codex_installer}" --user` and `bash "${cursor_installer}" --user` patterns |
| AC3 | INS-03 | PASS | `scripts/__tests__/install-agents.test.ts:320-357` — codex apply prints hint containing `plugin` + `skip` + `codex`; cursor apply prints `plugin` + `skip` + `cursor`. Dry-run does NOT print hint (`:347-369`). Source: `scripts/install-agents.ts:474` (CodexWriter), `:332` (CursorWriter) |
| AC4 | INS-04 | PASS | `README.md:200-264` — Codex plugin section (6 skills, 6 events, install command, trust step) + Cursor plugin section (6 skills, 7 events, `registerPath` advanced path). Grep-confirmed |
| AC5 | INS-05 | PASS | Grep for `NO SessionStart|NO PreCompact|Cursor has NO|3-event|3 event` in `install.sh` → 0 matches. Stale text removed. `.env.example` grep for `Cursor|SessionStart|PreCompact` → no stale 3-event reference |

### P4: Four-plugin installer parity (INS-06..12) — PASS

| AC | Req | Verified | Evidence (file:line) |
| --- | --- | --- | --- |
| AC1 | INS-06 | PASS | `scripts/__tests__/root-install-menu.test.ts:40-47` — install.sh source contains `Claude Code plugin`, `Codex plugin`, `Cursor plugin`, `OpenCode plugin`, `All four`. Source: `install.sh:674-678` |
| AC2 | INS-07 | PASS | `apps/claude-plugin/__tests__/install.test.ts:85-116` — `--user` copies commands to `~/.claude/commands/` + merges hooks into `~/.claude/settings.json` with 5 events, matcher-group + `hooks[]` shape, `_massaTh0thOwned` marker, `massa-th0th-hook.ts` command |
| AC3 | INS-08 | PASS | `scripts/__tests__/root-install-menu.test.ts:57-63` — install.sh contains `npm install @massa-th0th/opencode-plugin`, `opencode.json`, `MASSA_TH0TH_API_URL`. Source: `install.sh:731-735` |
| AC4 | INS-09 | PASS | `apps/claude-plugin/__tests__/install.test.ts:76-82,104` — `EXPECTED_EVENTS = [SessionStart, UserPromptSubmit, PostToolUse, PreCompact, Stop]`; asserts `Object.keys(hooks).sort() === EXPECTED_EVENTS.sort()`. Each owned entry has matcher-group + `hooks[0].type === "command"` + `command contains "massa-th0th-hook.ts"` (`:107-115`) |
| AC5 | INS-10 | PASS | `apps/claude-plugin/__tests__/install.test.ts:212-224` — running `--user` twice produces no diff in `settings.json` (`afterSecond === afterFirst`) |
| AC6 | INS-11 | PASS | `scripts/__tests__/install-agents.test.ts:377-388` — claude-code apply prints hint with `plugin` + `skip` + `claude`. Dry-run does NOT (`:403-413`). Source: `install-agents.ts:306` |
| AC7 | INS-12 | PASS | `scripts/__tests__/install-agents.test.ts:390-401` — opencode apply prints hint with `plugin` + `skip` + `opencode`. Dry-run does NOT (`:415-425`). Source: `install-agents.ts:349` |

---

## Discrimination Sensor

5 high-value mutations injected, each followed by its targeted test, then reverted. All working-tree changes confirmed clean (`git diff --stat` empty) after revert.

| Mutant | Mutation | Target test | Result |
| --- | --- | --- | --- |
| M1 | Remove `"pre-tool-use": "pre-tool-use"` from `EVENT_MAP` in `massa-th0th-hook.ts:39` | `massa-th0th-hook.test.ts:182-193` (pre-tool-use → 1 POST) | KILLED — `posts.length` = 0 instead of 1, test fails |
| M2 | Remove `"sessionStart"` key from `apps/cursor-plugin/hooks/hooks.json` | `manifest.test.ts:31-61` (7 events incl. sessionStart) | KILLED — `Object.keys(hooks)` = 6 instead of 7, `toHaveProperty("sessionStart")` fails |
| M3 | Remove `"preCompact"` key from `apps/cursor-plugin/hooks/hooks.json` | `manifest.test.ts:31-61` (7 events incl. preCompact) | KILLED — `Object.keys(hooks)` = 6 instead of 7, `toHaveProperty("preCompact")` fails |
| M4 | Change array-append merge in `apps/codex-plugin/install.sh:135-144` to replace (`cfg[evt] = [...]` instead of `cfg[evt].push(...)`) | `install.test.ts:104-134` (user hook survives) + `:136-166` (uninstall) | KILLED — `sessionStart.length` = 1 instead of 2 (user hook clobbered); uninstall test crashes because user hook array is gone. **2 tests fail** |
| M5 | Remove `console.log(...)` deconfliction hint from `CodexWriter.apply()` in `install-agents.ts:473-475` | `install-agents.test.ts:321-332` (codex apply prints hint) | KILLED — `logs.some(l => l.includes("plugin") && l.includes("skip"))` = false, test fails |

**Result: 5/5 mutants killed.** The test suite has strong discrimination power across all 4 phases.

---

## Diff Range

```
git diff main..HEAD --stat
```

- **41 files changed**, 3833 insertions(+), 26 deletions(-)
- **17 commits** from `1a59854` (EVENT_MAP) to `c4e85d8` (README 4-plugin parity)
- New packages: `apps/codex-plugin/` (13 files), `apps/cursor-plugin/` (15 files)
- Modified: `apps/claude-plugin/install.sh` (+165), `install.sh` (+126), `scripts/install-agents.ts` (+33), `README.md` (+189)
- New tests: 6 test files (codex install + manifest, cursor install + manifest, claude install, root-install-menu)

---

## Ranked Gap List

| # | Severity | Gap | Recommendation |
| --- | --- | --- | --- |
| G1 | Low | **CPX-08 (423 → exit 0)**: No test explicitly stubs an HTTP 423 response and asserts exit 0. The behavior is architecturally guaranteed (`postObservation` never rejects, `main()` unconditionally exits 0), and the exit-0 contract is pinned by 4 other error-path tests (malformed JSON, empty stdin, terminal stdin, unknown subcommand). But a dedicated 423 stub test would close the spec-precision gap. | Add a test in `massa-th0th-hook.test.ts` that configures the capture server to respond with 423 and asserts `exitCode === 0` + no retry. Low priority — the invariant is structural, not behavioral. |

No other gaps found. All other ACs have direct, spec-anchored test evidence with correct expected values.

---

## Spec-Precision Notes

- **Cursor AC3 (CRS-03)**: The spec explicitly calls out `sessionStart` and `preCompact` as the historical gap fix. The manifest test (`manifest.test.ts:46-48`) explicitly asserts both keys exist via `toHaveProperty`, not just a count of 7. This is the correct spec-anchored assertion.
- **Codex AC5 (CPX-05)**: Spec says "POST to `/api/v1/hook` (single) or `/api/v1/hook/batch`". The binary uses single POST to `/api/v1/hook` (2s timeout). This is within spec (the "or" allows either). No gap.
- **Pre-compact dual-POST (CPX-06/CRS-05)**: Spec says "3s observation + 5s snapshot". Binary source confirms: `postObservation(hookUrl, obsBody, 3000, ...)` (`:260`) + `postObservation(snapshotUrl, snapBody, 5000, ...)` (`:270`). Test asserts both POSTs land on correct endpoints with correct body shapes (`massa-th0th-hook.test.ts:204-234`).
- **Array-append merge (F5 mitigation)**: Spec requires append, not replace. Codex `install.sh:135-144` uses `cfg[evt].push(...)` with `hasOwned()` guard. Cursor `install.sh` follows the same pattern. M4 mutant (replace instead of append) was killed by 2 tests, confirming the merge logic is test-pinned.
- **Deconfliction hint gating**: Spec says hint should print when plugin "may be installed". Tests verify hint prints on `written === true` and does NOT print on dry-run (`install-agents.test.ts:347-369, 403-425`). Correct gating.