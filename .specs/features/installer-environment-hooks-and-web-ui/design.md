# Pure Hedgehog — Design and Execution Record

## Source plan

`/Users/luizmassa/.claude/plans/create-a-plan-to-pure-hedgehog-agent-add38afc34ffec7d9.md` — “Execution Plan: Items 2–4 (install.sh FULL + .env.example + package.json dev:ui)”.

## Intent and scope

Document Phase 0–8 configuration defaults in fresh-install output and the environment template; expose the Tools API Web UI URL; offer a non-writing Claude Code passive-capture hooks guide; remove obsolete standalone UI development scripts. Scope excluded changing Dockerfile’s stale `ui-client` comment and adding another UI serve command.

## Implemented outcome

Fresh `install.sh` output gained LLM, hooks, handoff, bootstrap, auto-improve, search, and Web UI configuration keys. The installer prints a Web UI URL unless `WEB_UI_ENABLED` is `false` or `0`, and an LLM configuration pointer. Its optional `c)` menu action prints hook configuration without editing user settings; `NO_START=1` still bypasses the menu.

`.env.example` gained annotated Phase 0–8 settings. `package.json` no longer defines `predev:ui` or `dev:ui`; the Web UI remains served through the Tools API at `/ui`.

## Commit evidence

### Installer and environment surface

- `f657a369546d4a8abf6904b11b1c18c04430ffdc` — `feat(install): emit full env surface + passive-capture hook guide`
  - Modified only `install.sh` and `.env.example`.
  - Added installer defaults, hooks guide/menu entry, `/ui` integration output, and LLM pointer.

### Package cleanup

- `cd5c2649ecf91af0a5c57a897f98cb7d78ee22f2` — `chore(pkg): remove dead dev:ui and predev:ui scripts`
  - Removed the two obsolete UI scripts from `package.json`.

## Spec/acceptance facts now worth preserving

- Existing `.env` files are preserved: `write_env` returns early when the target exists; added values affect fresh installs only.
- Passive capture is opt-in at installer-menu time and the guide only prints a JSONc snippet or direct-ingestion guidance; it must not overwrite `.claude/settings.json`.
- Hook observation capture remains non-blocking; raw observations can persist while LLM-dependent consolidation is disabled.
- `WEB_UI_ENABLED=false` or `0` suppresses the installer’s `/ui` URL, matching the route’s disabled behavior; absent/other values keep the default-on link.
- No standalone UI development command is required for this surface: the supported UI is Tools API-hosted at `/ui`.

## Deviations or unresolved gaps

- Plan specified every newly appended `.env.example` key should remain commented. Commit `f657a36` added active (uncommented) key/value lines with annotations instead.
- Plan described raw hook-script URLs as a no-local-clone fallback based on hook-file existence. Implementation selects that guidance for `docker` mode and emits absolute paths for non-docker modes; it does not implement the proposed existence check.
- `Dockerfile:33` stale `ui-client` comment remains intentionally untouched. No code-path impact was claimed by `cd5c264`.
- No executed `bash -n`, type-check, or install smoke result was found in the inspected commit evidence; do not infer those checks passed.

## Cross-references to existing specs

- [Phase 3 hook capture](../../phase-3-hook-capture/spec.md) — hook ingestion and raw-observation behavior.
- [Phase 4 bootstrap](../../phase-4-bootstrap/spec.md), [Phase 5 auto-improve](../../phase-5-auto-improve/spec.md), [Phase 6 handoffs](../../phase-6-handoffs/spec.md), and [Phase 7 retrieval polish](../../phase-7-retrieval-polish/spec.md) — exposed configuration groups.
- [Phase 8 Web UI](../../phase-8-web-ui/spec.md) — Tools API-hosted, read-only Web UI contract.

## Verification evidence used

- Read source plan scope and its stated verification recipe.
- Inspected commit metadata, changed-file lists, and diffs for `f657a36` and `cd5c264` within `c1d37b8120025a69e2de0e5fd054ca8177e205de..81d33606fb6826e1759a073006b165419d0e3ba4`.
- Confirmed later in-range history touching these paths did not add plan-relevant changes after those commits.
