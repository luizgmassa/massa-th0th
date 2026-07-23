# Evidence Gate

Read this before declaring a task complete, closing a session, or handing work to another agent.

For non-trivial edits or broad workflow work, load `references/verification-ladder.md` and report the highest verification level reached.

If Conversation Feedback Policy is active, emit a `Verified` status after deterministic evidence is collected and a `Finished` status only when the completion summary is ready. Feedback lines do not replace the evidence report.

## Required Completion Evidence

A completion report must include:

- Deterministic evidence: clean exit code, static check output, test result, build result, or concrete artifact inspection
- Verification ladder: level reached, validation assets protected, and skipped checks with reasons when applicable
- Changed artifacts: file paths changed, generated outputs, or state that no files changed
- Memory outcome: memories written, intentionally skipped with reason, duplicate skipped, forbidden payload skipped, or failed memory writes with recovery note
- Residual risk: unresolved errors, skipped checks, missing environment, or explicit `none found`

Completion reports must also state that tests, specs, fixtures, snapshots,
schemas, public contracts, and validator checks were not weakened unless the
user explicitly requested a validation-asset change.

## Acceptable Evidence

| Work type | Minimum evidence |
|-----------|------------------|
| Docs/skill changes | `rg` stale-reference checks and file existence checks |
| Code changes | Verification recipe, relevant tests/build/lint/focused command output, and file-integrity check when validation assets are in scope |
| Debug fix | Reproduction no longer fails or root-cause path is proven |
| Audit / Implementation Audit | Concrete findings tied to files/lines, plus skipped-check notes |
| Handoff | Session Guide with exact `workflowSessionId`, `projectId`, next step, and unresolved risks; ephemeral Synapse IDs are excluded |

## Example

Use this compact shape when closing docs or skill work:

```md
✅ [Verified] Skill validation and stale-reference scans passed.
🏁 [Finished] Updated massa-th0th references. Memory outcome: durable decision stored. Remaining risk: none found.

Evidence: `rtk python3 skills/skill-architect/scripts/validate_skill.py skills/massa-th0th --format json` passed; stale-reference and local-link scans passed.
Changed artifacts: `skills/massa-th0th/SKILL.md`, `workflows/spec-driven.md`, `references/spec-driven/`, and `references/memory-policy.md`.
Memory outcome: wrote decision memory `dec_...`; no failed memory writes.
Residual risk: none found.
```

## Failure Rules

- Do not claim done if the only evidence is model self-evaluation.
- Do not retry the same failing command more than twice unchanged; diagnose or instrument first.
- If deterministic checks cannot run, state exactly why and provide the strongest available manual check.
- Do not modify validation artifacts to make a check pass unless the user explicitly asked to update the validation itself.
- Treat judge, faithfulness, or semantic checks as optional higher-order evidence only when a concrete tool or command exists.
