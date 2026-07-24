### The Fool

Use this workflow for direct requests to challenge ideas, plans, decisions, proposals, architectures, evidence, or assumptions. Also use it as the configured post-plan challenge gate after other massa-ai workflows construct a plan.

Do not use this workflow to build the initial plan, make the decision, or execute implementation work. It critiques and strengthens existing thinking.

## Configuration

Read the canonical **Plan Challenge Policy** from root `AGENTS.md`. If that
file is unavailable, use the deterministic runtime fallback: run the lite gate
with `pre_mortem` mode (do not judgment-select the gate or mode), and revise
the parent plan when critical or high findings are valid.

User prompt overrides take precedence for the current turn only, such as "skip the Fool gate", "use red-team mode", or "append critique without revising the plan".

## Workflow

1. Resolve/reuse context:
   - Direct challenge request: use `workflowSessionId=fool-[entity]`.
   - Post-plan gate: inherit the parent workflow's exact `projectId`,
     `workflowSessionId`, workflow name, entity, and memory context.
2. `recall` -> load prior decisions, rejected approaches, constraints, accepted risks, and relevant evidence for the target entity.
3. Require a concrete proposed plan before critique. If there is no plan, return to the parent workflow and construct the plan first. After a concrete plan exists, always attempt a read-only `plan-critic` subagent when subagent tooling is available.
4. Resolve gate depth:
   - Post-plan lite gate: keep parent identifiers and dispatch a bounded lite checklist packet without loading The Fool mode references.
   - Post-plan full gate or direct challenge: continue to mode selection and full critique.
   - Direct challenge requests use `workflowSessionId=fool-[entity]`; post-plan gates keep the parent identifiers and send only a bounded packet.
5. Lite `plan-critic` packet:
   - Inputs: proposed plan, scope, constraints, parent workflow, compact recalled facts/evidence, known risks, verification recipe, context-firewall limits, and lite checklist.
   - Output must include the strongest low-risk challenges plus `escalate_to_full: true|false` and reason.
   - If `escalate_to_full: false`, synthesize the lite critique, revise or accept risk according to policy, and complete the gate without loading The Fool mode references.
   - If `escalate_to_full: true`, the main agent selects full mode, loads the relevant references, and dispatches a full `plan-critic` pass.
6. Select The Fool mode for full gates:
   - `mode: auto`: read `references/the-fool/mode-selection-guide.md` and choose the best mode from plan content and domain.
   - `mode: ask`: ask the user only when interactive input is available; otherwise fall back to `auto` and report the fallback.
   - Concrete mode values map to The Fool references: `pre_mortem`, `red_team`, `evidence_audit`, `socratic`, or `dialectic`.
   - Mode reference map:
     - `pre_mortem` -> `references/the-fool/pre-mortem-analysis.md`
     - `red_team` -> `references/the-fool/red-team-adversarial.md`
     - `evidence_audit` -> `references/the-fool/evidence-audit.md`
     - `socratic` -> `references/the-fool/socratic-questioning.md`
     - `dialectic` -> `references/the-fool/dialectic-synthesis.md`
7. Load only the selected The Fool reference plus `references/the-fool/cognitive-bias-inventory.md`.
8. Dispatch the full critique:
   - Load `references/agent-orchestration.md`.
   - Use the `plan-critic` contract and capability-packet shape from `references/agent-orchestration.md`.
   - Send only the proposed plan, scope, constraints, parent workflow, recalled facts, verification recipe, known risks, selected mode, context-firewall limits, and output contract.
   - If subagents are unavailable or platform policy forbids spawning, run a strict standalone fresh-eyes local critique and record the skipped delegation reason.
   - Normal delegation gates in `references/agent-orchestration.md` still apply to other roles, but Plan Challenge `plan-critic` is a standing policy exception after a concrete plan exists.
9. Critique output must include:
   - selected mode
   - steelmanned thesis
   - 3-5 strongest challenges
   - severity: `critical`, `high`, `medium`, or `low`
   - affected plan section
   - evidence gap or assumption at risk
   - required revision or accepted-risk framing
   - confidence impact
   - exact next step
10. Synthesize using `references/decision-engine.md`:
   - `serious_findings: revise_plan`: revise valid `critical` or `high` findings before presenting the final plan.
   - `serious_findings: append_critique`: keep the plan and attach the critique for user decision.
   - `serious_findings: warn_only`: mention serious risks briefly without restructuring the plan.
11. Persist only durable outcomes after recall and scoring:
   - accepted architecture constraints, rejected approaches, durable risk decisions, or reusable critique patterns
   - required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:the-fool` or parent workflow for post-plan gates, `entity:<entity>`, and one `memory:<tier>`
   - skip one-off critique notes and subagent chatter
12. Complete the Evidence Gate from `references/evidence-gate.md`.

## Post-Plan Gate Output

When used as a gate, the final user-facing plan should not expose raw subagent chatter. Include only the revised plan and a compact note such as:

```md
Plan Challenge: ran The Fool in pre-mortem mode; revised verification and rollout risks before finalizing.
```

If the gate is skipped, state why only when it affects confidence, user expectation, or configured behavior.
