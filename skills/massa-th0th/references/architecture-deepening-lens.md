# Architecture Deepening Lens

Use this detail reference when an architecture audit or execution task needs module depth, seams, adapters, testability, locality, or AI-navigability analysis.

## Contents

- Vocabulary
- Deepening Signals
- Deletion Test
- Dependency Categories
- Recommendation Template
- Interface Design Method
- Rejected Framings
- Seam Discipline
- Test Surface
- Fix Direction

## Vocabulary

Use these terms exactly:

- Module: anything with an interface and an implementation.
- Interface: everything a caller must know, including types, invariants, ordering, errors, configuration, and performance.
- Implementation: code inside the module.
- Seam: where an interface lives and behavior can be varied without editing callers.
- Adapter: concrete thing satisfying an interface at a seam.
- Depth: leverage at the interface.
- Leverage: capability callers get per unit of interface learned.
- Locality: change, bugs, knowledge, and verification concentrated in one place.

Avoid using `boundary` for module seams; reserve bounded context language for the domain lens.

## Deepening Signals

Flag candidates when evidence shows:

- module interface is nearly as complex as its implementation
- pass-through wrappers or one-use helpers add navigation cost
- one concept is split across many files without leverage
- callers must know ordering, invariants, config, or error modes that should be hidden
- tests reach past the interface into internals because the interface is the wrong shape
- extracted pure functions improve unit-test access but lose locality for real bugs
- seams exist only for hypothetical future adapters

## Deletion Test

Ask what happens if the module is deleted:

- If complexity disappears, the module was likely shallow.
- If complexity spreads across callers, the module was probably earning its keep.
- If behavior becomes harder to verify through one surface, the module likely has useful depth.

Use this as evidence, not as a mechanical rule.

## Dependency Categories

Classify dependencies before recommending seams:

- In-process: pure computation or in-memory state. Usually deepen by merging and testing through the new interface.
- Local-substitutable: dependency has a local test stand-in. Keep seam internal when possible and test the deep module with the stand-in.
- Remote but owned: own service across network. Define a port only when it keeps domain logic local and production/test adapters are both real.
- True external: third-party dependency. Inject a port and use mock/fake adapters for tests when behavior cannot be run locally.

### Recommendation Template

For each dependency, state: Category → recommended seam → stand-in used in tests.

| Category | Recommended seam | Stand-in example |
|---|---|---|
| In-process | deepen by merging | none — test through the new interface |
| Local-substitutable | keep seam internal | in-memory fake |
| Remote but owned | port only if domain stays local | owned-service test adapter |
| True external | inject a port | PGLite (database), Stripe test mode (payment) |

A stand-in is required evidence before introducing a port: "inject a port for
Stripe, with the Stripe test-mode adapter as the production-shape stand-in" —
not "add a port because it is cleaner."

## Interface Design Method

When a deepening candidate has two or more viable interface shapes, do not pick
one by instinct. Design it twice: draft two parallel implementations (two
sub-agents, or two sides authored yourself), each behind a different interface
against the same caller need, then choose by leverage and locality.

Four canned design constraints force distinct shapes:

1. Minimal surface: hide every field and ordering the caller does not name.
2. Batchable: one call serves many items, not one call per item.
3. Policy-free: the interface states what, not how; no strategy leaks out.
4. Substitutable: a second adapter can satisfy it without caller edits.

Load this method from `architecture-fix.md` or `refactor.md` only when a
candidate has >= 2 viable interface shapes; otherwise deepen directly.

## Rejected Framings

Avoid these misreadings of depth; record the rejection so it is not re-litigated:

- Depth is NOT a lines-of-code ratio. A deep module can be tiny; a shallow
  wrapper can be long. Padding an implementation to raise a "depth" metric is
  exactly the anti-pattern this lens exists to find.
- Interface is NOT a language keyword (`interface`, `protocol`, `trait`). It is
  everything a caller must know — types, invariants, ordering, errors.
- Seam is NOT a class boundary. Reserve `seam` for where behavior can vary
  without editing callers; reserve bounded-context language for the domain lens.

## Seam Discipline

- One adapter means a hypothetical seam. Two adapters means a real seam.
- Production plus test adapter can justify a seam when the dependency is remote or external.
- Internal seams can exist inside the implementation without becoming part of the module interface.
- Do not expose internal seams just because tests use them.
- Do not introduce ports/adapters to decorate one local concrete call.

## Test Surface

The interface is the test surface:

- prefer behavior tests through the module interface
- delete or replace shallow-module tests once deep-module tests cover observable behavior
- tests should survive implementation refactors
- if tests must change for implementation-only movement, they are probably testing past the interface

## Fix Direction

Prefer:

- delete shallow pass-through modules
- inline one-use abstractions
- merge split concepts when locality improves
- deepen a useful module by hiding invariants and ordering
- move validation and transformation behind the interface when callers should not know it
- add a seam only where variation, dependency direction, external I/O, or test substitution is real

Avoid broad rewrites, VSA migrations, or new service boundaries unless audit evidence shows current module shape blocks change or verification.
