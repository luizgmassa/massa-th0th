# Decision Engine Reference

Load this when scoring memories, making a trade-off decision, or debugging with
prior attempts. Do not load for simple edits where no memory write or design
decision is needed.

## Importance Calibration

Use named levels, then pass only `importance` to `remember`.

| Level | Float | Use when |
|---|---:|---|
| CRITICAL | 0.95 | Forgetting causes data loss, security holes, outage, or system-wide breakage. |
| HIGH | 0.8 | Forgetting causes bugs, architectural drift, or repeated wrong choices. |
| MEDIUM | 0.7 | Forgetting causes wasted effort or rediscovery. |
| LOW | 0.6 | Useful acceleration context, not essential. |
| SKIP | - | Trivial, local, duplicate, or not durable. |

Score from base 0.5:

| Question | Weight |
|---|---:|
| Would forgetting this cause a production bug/outage? | +0.15 |
| Does it affect more than one module/service/feature? | +0.10 |
| Would a future agent choose wrongly without it? | +0.15 |
| Did it take meaningful effort to discover/decide? | +0.10 |
| Is it a hard constraint rather than a preference? | +0.10 |

Map score: 0.95 CRITICAL, 0.8 HIGH, 0.7 MEDIUM, 0.6 LOW, otherwise SKIP.

## Memory Examples

- CRITICAL: auth token algorithm constraint after a security incident.
- HIGH: project architecture pattern future agents must follow.
- MEDIUM: ruled-out hypothesis that took real investigation.
- LOW: useful but nonessential local workflow context.
- SKIP: user formatting preference or already-captured fact.

## Trade-Off Template

```text
Decision: <what changed>
Optimizing for: <benefit>
Sacrificing: <cost>
Reversibility: easy | hard | irreversible
Confidence: high | medium | low
Evidence: <source-backed facts>
```

## Product And System Checks

Before a non-trivial change, ask:

- What user problem does this solve?
- Is it core flow or edge case?
- What is the simplest solution that works?
- What coupling, maintainability, observability, or scaling tradeoff changes?

## Debugging Heuristics

Most bugs come from state inconsistency, async/race issues, wrong data-shape
assumptions, or environment differences.

Debug loop:

1. Recall prior attempts and known patterns.
2. Define expected vs actual behavior.
3. Trace input -> transformation -> output.
4. Check recent changes first.
5. Test one falsifiable hypothesis at a time.
6. Persist durable lessons only after scoring.

Avoid blind whole-repo scans when a targeted recall/search path exists.
