# Architecture Domain Lens

Use this detail reference when an architecture audit or execution task needs domain boundaries, bounded contexts, subdomain classification, ubiquitous language, or cohesion analysis.

## Contents

- Inputs
- Concept Inventory
- Language Grouping
- Subdomain Classification
- Cohesion Score
- Rubric Anchors
- Worked Examples
- Low-Cohesion Rules
- Bounded Context Size
- Findings To Report
- Integration Pattern Selection
- Anti-Patterns
- Guardrails

## Inputs

Prefer current project evidence in this order:

- `CONTEXT.md`, glossary files, product docs, issue/spec text, and user-provided business context
- ADRs and architecture docs for accepted boundaries or rejected refactors
- code names, route names, schemas, tests, fixtures, and use-case names
- git history only as supporting evidence for change cohesion

Code vocabulary is evidence, not truth. Mark conclusions as `suspect` when business intent is inferred only from names.

## Concept Inventory

Extract business concepts, not technical plumbing:

- Entities: domain models with identity or lifecycle
- Services: business operations, not generic helpers
- Use cases: workflows, commands, handlers, jobs, or policies
- Entry points: routes, resolvers, CLIs, events, screens, or cron jobs that expose business capabilities
- Contracts: DTOs, events, schemas, published language, or anti-corruption layers

Skip pure infrastructure unless it is mixed into core business behavior.

## Language Grouping

Group concepts by ubiquitous language:

- same terms with the same meaning usually belong together
- same term with different meanings signals separate bounded contexts
- different vocabularies in one module signal a possible boundary mismatch
- generic terms such as `User`, `Account`, `Customer`, `Order`, or `Policy` need local definitions before judging

When a domain term is unclear, report the ambiguity instead of inventing a context.

## Subdomain Classification

Use this decision rule:

```text
Competitive advantage or fast-evolving proprietary business logic -> Core
Business-specific but not differentiating -> Supporting
Commodity or replaceable capability -> Generic
```

Static indicators:

- Core: complex business rules, frequent domain changes, domain expert language, differentiating algorithms
- Supporting: CRUD or workflow support with business-specific vocabulary
- Generic: auth, logging, email, storage, payment gateway plumbing, metrics, generic notification transport

Do not classify something as Core just because it is central in the import graph.

## Cohesion Score

Use scoring only when enough evidence exists:

```text
Linguistic cohesion: 0-3
Usage cohesion: 0-3
Data cohesion: 0-2
Change cohesion: 0-2
Total: 0-10
```

Interpretation:

- 8-10: strong subdomain candidate
- 5-7: mixed or evolving boundary
- 0-4: likely wrong grouping or generic utility cluster

If git history is absent or too expensive, score change cohesion as `unknown` and explain the gap.

### Rubric Anchors

Score each axis against these anchors (highest row that fits):

| Axis | 3 | 2 | 1 | 0 |
|---|---|---|---|---|
| Linguistic | one shared ubiquitous term, one meaning | mostly shared terms | some shared terms | unrelated vocabularies |
| Usage | all concepts used in the same use cases | most concepts co-used | partly co-used | rarely co-used |
| Data | shared identity or aggregate root | shared attributes | read-only overlap | no shared data |
| Change | always change together | usually change together | sometimes change together | change independently |

Data and Change max at 2; Linguistic and Usage max at 3. The anchors make the
0-10 total reproducible across auditors.

### Worked Examples

- Same term, three contexts: `Patient` in scheduling (availability), billing
  (invoice line), and clinical (record) is three bounded contexts sharing a
  published language — not one `Patient` model. Score linguistic 1 (shared term)
  but usage 0 and change 0; the total flags a boundary, not a single aggregate.
- Identity-leak fix: an order DTO field `user: User` leaks the auth context's
  model into billing. Replace it with `customerId: CustomerId`, a value object
  owned by billing, so billing no longer depends on `User`'s shape or lifecycle.

## Low-Cohesion Rules

A grouping is likely wrong when:

1. Mixed vocabulary: one module speaks two or more ubiquitous languages (for
   example `Invoice` beside `RenderFrame`). Action: split by language.
2. Shotgun change: one business change edits many modules that share no domain
   term. Action: find the missing boundary, or merge the co-changing parts.
3. God aggregate: one root owns unrelated data (orders + notifications + audit).
   Action: split into per-language aggregates.
4. Technical grouping: modules clustered by layer ("all controllers", "all
   repositories") instead of by language. Action: re-group vertically.
5. Cross-context ownership: one context reads or writes another's tables or
   invariants directly. Action: expose an owned contract or anti-corruption layer.

## Bounded Context Size

| Signal | Meaning |
|---|---|
| 1-2 aggregates, single use-case family | too small — likely a layer, not a context; merge or drop |
| coherent language, 3-8 aggregates, clear integration contract | right-sized |
| 12+ aggregates or multiple unrelated languages | too large — split along the next language boundary |

## Findings To Report

Report domain findings when evidence shows:

- mixed vocabularies in one module create change friction
- one context directly owns another context's model, persistence, or invariants
- generic/supporting infrastructure is embedded in core business logic
- a bounded context lacks an explicit integration contract
- a term has colliding meanings across modules and causes bugs or coordination cost

Useful integration directions:

- Published Language: documented DTO/event/schema shared across contexts
- Anti-Corruption Layer: translation when upstream language should not leak downstream
- Open Host Service: stable public interface for multiple consumers
- Shared Kernel: shared model only when ownership is explicit and scope is tiny
- Customer/Supplier or Conformist: acceptable only when dependency direction and ownership are intentional

## Integration Pattern Selection

Pick the integration pattern from the need, not from familiarity:

| Need | Pattern |
|---|---|
| upstream is legacy or external; its language must not leak downstream | Anti-Corruption Layer |
| upstream publishes a stable API many consumers depend on | Open Host Service / Published Language |
| many consumers need the same domain occurrence | Domain Events (published language) |
| two contexts must share a tiny, co-owned slice | Shared Kernel (only with explicit shared ownership) |
| downstream must conform to an upstream it cannot influence | Conformist |

## Anti-Patterns

- ❌ Grouping by technical layer ("all controllers", "all services", "all
  repositories") instead of by ubiquitous language — hides boundaries and
  causes shotgun change.
- ❌ One bounded context per directory — boundaries follow language, not folders.
- ❌ Service extraction from language evidence alone — requires change and
  ownership evidence.
- ❌ Re-litigating an ADR-backed boundary without new concrete friction.

## Guardrails

- Do not force one bounded context per directory.
- Do not propose service extraction from language evidence alone.
- Do not relitigate ADR-backed boundaries unless current friction is concrete.
- Do not mutate `CONTEXT.md`, ADRs, or docs during an audit.
- Prefer move, rename, or contract clarification before new layers.
