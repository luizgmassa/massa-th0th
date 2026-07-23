# Architecture Lenses

Use this reference for architecture audits, architecture-focused reviews, and refactor planning. It is the shared index and vocabulary guard; load the detail references only when a workflow needs that lens:

- `references/architecture-domain-lens.md` for bounded contexts, ubiquitous language, subdomain classification, cohesion, and integration patterns.
- `references/architecture-coupling-lens.md` for dependency graphs, strength/distance/volatility, dependency direction, and contract health.
- `references/architecture-deepening-lens.md` for module depth, seams, adapters, deletion tests, locality, and interface-as-test-surface analysis.

Do not load all detail references by default. Pick the smallest lens set that can prove or disprove the architecture claim.

## Domain Lens

Map problem-space boundaries before proposing structural changes.

Load `references/architecture-domain-lens.md` when the audit target includes domain language, bounded contexts, subdomain classification, cross-domain ownership, or integration pattern choices.

Check:

- subdomains: Core, Supporting, Generic
- bounded contexts and ubiquitous language
- concept cohesion: language, usage, data, change
- cross-domain dependencies
- generic functionality mixed into core logic

Report:

- domain or subdomain
- type: Core, Supporting, or Generic
- key terms and concepts
- cohesion score when useful
- dependency direction
- boundary or language mismatch
- simplest corrective direction
- mark as `suspect` when business intent is inferred only from code names

## Coupling Lens

Analyze dependency cost with strength, distance, and volatility.

Load `references/architecture-coupling-lens.md` when the audit target includes dependencies, imports, service calls, shared schemas/models, direct persistence access, co-change, or contract leakage.

Strength levels:

- Intrusive: downstream depends on internals not designed for integration.
- Functional: sequential, transactional, or duplicated symmetric business rules.
- Model: upstream exposes internal domain model to downstream.
- Contract: integration-specific DTO/protocol hides internals.

Distance levels:

- same function or class
- same package
- same module/library
- different service
- external system or team

Volatility signals:

- core business logic
- frequent git changes or co-change
- TODO/FIXME clusters
- evolving API versions
- fragile tests or recurring regressions

Flag highest risk when high strength, high distance, and high volatility combine.

Do not flag strong local coupling as bad when the modules change together and locality is better than separation.

## Deepening Lens

Use these terms exactly:

- Module: anything with an interface and implementation.
- Interface: everything a caller must know, including invariants, ordering, errors, config, and performance.
- Seam: where an interface lives.
- Adapter: concrete thing satisfying an interface at a seam.
- Depth: leverage at the interface.
- Leverage: capability callers get per unit of interface learned.
- Locality: change, bugs, and verification concentrated in one place.

Load `references/architecture-deepening-lens.md` when the audit target includes shallow modules, pass-through abstractions, seams, adapters, tests that reach past interfaces, or AI-navigability concerns.

Check:

- shallow modules whose interface is nearly as complex as implementation
- pass-through wrappers
- seams with only one adapter and no actual variation
- test-only extraction that loses locality
- concepts split across many files without leverage

Use the deletion test:

- If deleting a module removes complexity, it was probably shallow.
- If deleting it spreads complexity across callers, it was probably earning its keep.

Only recommend a new seam when variation, dependency direction, external I/O, or test substitution is real.

## Findings Format

```md
Severity: Critical | High | Medium | Low | Suspect
Lens: Domain | Coupling | Deepening
Location: path:line or module
Evidence: concrete source, dependency, or history signal
Impact: maintenance, change-risk, testability, or AI-navigability cost
Recommendation: simplest sufficient action
Tradeoff: what improves and what gets worse
```
