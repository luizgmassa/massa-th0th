# Architecture Coupling Lens

Use this detail reference when an architecture audit or execution task needs dependency health, dependency direction, integration cost, or coupling reduction.

## Contents

- Core Model
- Dependency Graph
- Strength Levels
- Symmetric Coupling
- Connascence Ladder
- Distance Levels
- Volatility Signals
- Balance Table
- Quantitative Anchors
- Pattern Strength Action Lookup
- Static Leads
- Positive Patterns
- Fix Direction

## Core Model

Analyze coupling through three dimensions:

- Strength: what knowledge or behavior is shared
- Distance: how far apart the coupled modules are
- Volatility: how likely either side is to change

High strength is not automatically bad. Strong coupling can be cohesive when modules are close and change together. Risk rises when strong coupling crosses distance and volatile business behavior.

## Dependency Graph

Map directed dependencies:

```text
A -> B means A depends on B.
B is upstream and exposes knowledge to A.
A is downstream and absorbs upstream changes.
```

For each relevant edge, record:

- caller/downstream module
- callee/upstream module
- dependency kind: import, DI, HTTP/gRPC, queue/event, shared DB, generated client, shared schema, test fixture
- exported surface or contract used
- whether the dependency crosses package, bounded context, service, team, or external-system distance

## Strength Levels

Classify by strongest evidence:

- Intrusive: downstream reads internals not designed for integration, such as private fields, another service DB, internal config/file shape, reflection, monkey patching, or undocumented generated artifacts.
- Functional: modules must coordinate behavior, order, transaction, duplicated business rule, deployment, or state transitions.
- Model: upstream exposes internal domain model, enum meanings, field names, value semantics, tuple positions, or persistence schema as integration surface.
- Contract: upstream exposes integration-specific DTO, event, schema, facade, published language, or versioned protocol that hides internals.

### Symmetric Coupling

A sub-degree of Functional coupling with no import edge: two modules
independently encode the same business rule, so changing the rule requires
editing both. It is the defect static import analysis most often misses.

Detection signals:

- the same predicate, threshold, mapping, or validation duplicated across modules
- comments like "update X when changing Y" or "keep in sync with"
- two validators, formatters, or mappers that must agree but share no type
- a bug fixed in one place that later recurs in the other

Treat as Functional strength regardless of distance. The fix is to extract the
shared rule to one owned location and reference it, not to add an import edge.

## Connascence Ladder

Map the shared knowledge to a rung, weakest (most tolerable) to strongest.
Lower rungs are cheaper to change; higher rungs amplify distance and volatility.

| Rung | Connascence | Meaning |
|---|---|---|
| 1 | Name | depends only on an identifier; a rename propagates |
| 2 | Type | depends on a type or shape |
| 3 | Meaning | depends on an agreed value, convention, or format (magic numbers, date formats) |
| 4 | Position | depends on argument, field, or tuple order |
| 5 | Algorithm | depends on call order, timing, transaction, or duplicated logic |

Rungs 4-5 map to Functional/Intrusive strength; rungs 1-2 map to Contract
strength. Use the rung to justify the Fix Direction: collapse higher rungs into
named contracts or shared owned logic before widening distance.

## Distance Levels

Use the closest common ownership point:

- same function or class
- same package or vertical slice
- same module/library
- different app/service
- external system or different team

Increase distance when deployment, ownership, or team coordination is separate.

### Distance Scorecard

| Layer pair | Distance |
|---|---|
| same function or class | 0 |
| same package or vertical slice | 1 |
| same module or library | 2 |
| different app or service | 3 |
| external system or different team | 4 |

Conway's-Law bump: when the two sides are owned by different teams (even inside
one service), add 1 to the distance — coordination cost makes the coupling
behave like the next distance tier.

## Volatility Signals

Prefer real evidence:

- Core or evolving business subdomain
- recent commits or co-change patterns
- TODO/FIXME clusters around behavior
- multiple API versions or migration code
- fragile tests, recurring regressions, or repeated audit findings
- user-provided roadmap pressure

If history is unavailable, mark volatility as inferred and lower confidence.

Turn "recent commits" into measured co-change (volatility by file):

```bash
git log --since='3 months ago' --name-only --pretty=format: \
  | grep -v '^$' | sort | uniq -c | sort -rn | head -30
```

Co-change is evidence: files that move together repeatedly are coupled even
with no import edge. Two files in the top co-change set with no declared
dependency are an undeclared functional-coupling finding.

Override edge case: a Generic subdomain (auth, logging, storage plumbing) is
normally Low volatility. If that generic component is mid-migration or has
multiple in-repo versions, override it to High volatility for the duration —
generic-by-default never overrides measured churn.

## Balance Table

Use this diagnosis table. The Severity column is the reproducible priority:
critical edges first, watch edges only if unstable, the rest are healthy or
low-cost.

| Strength | Distance | Volatility | Severity | Diagnosis |
|---|---|---|---|---|
| High | High | High | 🔴 Critical | Costly global change pressure; prioritize |
| High | High | Low | 🟡 Watch | Often acceptable if stable and documented |
| High | Low | High | 🟢 Cohesive | Usually cohesive: keep close or merge |
| High | Low | Low | 🟢 Fine | Usually fine |
| Low | High | High | 🟢 Healthy | Healthy loose coupling |
| Low | High | Low | 🟢 Healthy | Healthy or low-cost |
| Low | Low | High | 🟠 Inspect | Local complexity; inspect cohesion |
| Low | Low | Low | 🟢 Low | Low priority unless noisy |

## Quantitative Anchors

Binary each dimension before reading the Balance Table so two auditors reach the
same cell.

| Dimension | 1 (High) | 0 (Low) |
|---|---|---|
| Strength (S) | Intrusive, Functional, or Model coupling | Contract coupling |
| Distance (D) | crosses service, team, or external boundary | same module or package |
| Volatility (V) | core/evolving subdomain or recent co-change | stable or generic |

Then:

```text
BALANCE = (S XOR D) OR (NOT V)
MAINTENANCE_EFFORT = S * D * V
```

- `BALANCE = 1` (balanced): the edge is acceptable — strength is local (S=0),
  distance is local (D=0), or the edge is stable (V=0).
- `BALANCE = 0` (unbalanced): strong, distant, AND volatile — the highest-cost
  edge; prioritize it.
- `MAINTENANCE_EFFORT` ranks unbalanced edges: it is 1 only in the single
  strong+distant+volatile cell. Use it to order fixes when several edges tie.

These are scoring aids, not proof. A `BALANCE = 1` edge still warrants a finding
when concrete evidence shows real change friction.

## Pattern Strength Action Lookup

Classify a concrete pattern, then act.

| # | Pattern | Strength | Action |
|---|---|---|---|
| 1 | downstream reads another module's private fields or internals | Intrusive | seal behind a contract; remove direct access |
| 2 | downstream queries another context's database | Intrusive | expose an owned API or anti-corruption layer |
| 3 | duplicated business predicate or rule in two modules | Functional (symmetric) | extract to one owned location |
| 4 | mandatory call ordering spread across callers | Functional | hide ordering behind one interface |
| 5 | shared transaction or state transitions across modules | Functional | co-locate or publish an explicit contract |
| 6 | upstream exposes persistence schema or enum as integration surface | Model | publish a versioned DTO or language |
| 7 | DTO mirrors a full domain object | Model | project to a use-case-specific DTO |
| 8 | dependency on field name, value, or tuple position | Model | wrap in a typed contract |
| 9 | versioned DTO, event, or schema hides internals | Contract | accept; document as stable |
| 10 | stable facade or anti-corruption layer translating vocabulary | Contract | accept; record as intentional |

## Static Leads

Look for:

- direct reads of another module's database, config, or internal files
- imports from `internal`, `private`, generated, or persistence model paths across contexts
- duplicate business predicates, thresholds, mappings, or validation
- comments like "update X when changing Y"
- DTOs that mirror full domain or persistence objects
- mandatory call ordering spread across callers
- cycles, bidirectional imports, or dependency inversion breaks
- tests that require constructing far-away internals to exercise local behavior

## Positive Patterns

Call out positive evidence when useful:

- use-case-specific DTOs or events
- versioned public contracts
- anti-corruption layers translating vocabulary
- stable facade that hides internal model churn
- dependency direction from volatile policy toward stable abstraction, not from stable core toward volatile detail

## Fix Direction

Reduce strength before increasing distance:

- replace intrusive/model coupling with explicit contracts
- move tightly coupled volatile modules closer when they change together
- extract shared duplicated rule only when it is a real domain rule, not trivial repetition
- document accepted strong-stable integration instead of refactoring it
- avoid introducing ports/adapters unless there is real variation, test substitution, external dependency, or direction pressure
