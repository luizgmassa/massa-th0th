# Contributing to massa-ai — Managed Harness Protocol

This document defines the 7-step managed-harness contribution protocol for
adding or modifying agent harness components (skills, workflows, references,
agents, subagents, plugins, MCP servers, permission rules) in massa-ai.

Every contribution MUST complete all 7 steps in order. Each step has a
concrete acceptance gate.

---

## Step 1: Contract — define the behavioral contract

Before writing any code, define the behavioral contract: what the component
does, what inputs it accepts, what outputs it produces, and what invariants it
maintains.

**Acceptance gate**: a written contract (in the PR description or a linked
spec) specifies:
- Component name and type (skill, workflow, agent, etc.)
- Inputs (parameters, env vars, stdin, file paths)
- Outputs (return values, side effects, stdout, file writes)
- Invariants that must always hold

---

## Step 2: Register — register the component in the harness registry

Every harness component MUST be registered so the harness can discover and
load it. Registration is explicit — no magic auto-discovery.

**Acceptance gate**: the component is registered in the appropriate registry
file (e.g., `available_skills` list, `workflows/` directory, agent catalog,
or MCP server config) and the harness can discover it by name.

---

## Step 3: Preserve argv — preserve the caller's argument vector

Harness components that wrap or delegate to external commands MUST preserve
the caller's argument vector. The component may add, filter, or transform
arguments, but it MUST NOT silently drop arguments the caller passed.

**Acceptance gate**: a test verifies that arguments passed by the caller reach
the underlying command (or are explicitly documented as filtered with a
rationale).

---

## Step 4: Read-only export — export state for inspection without mutation

Harness components that maintain internal state (session state, working memory,
cached context) MUST export that state in a read-only format for inspection by
other components or debugging tools. The export MUST NOT mutate state.

**Acceptance gate**: a read-only export function exists, returns a serializable
representation of the state, and a test verifies it does not mutate the
internal state.

---

## Step 5: Deliver-before-ack — deliver the result before acknowledging

When a harness component is invoked asynchronously, it MUST deliver the
result (write the output, complete the side effect) BEFORE acknowledging
completion to the caller. Acknowledgment before delivery is a protocol
violation.

**Acceptance gate**: a test verifies that the caller receives the result
before the component's completion acknowledgment resolves.

---

## Step 6: Invariants — maintain documented invariants under all conditions

Every component has invariants (documented in Step 1). The component MUST
maintain those invariants under all conditions, including error paths,
timeouts, and partial failures. If an invariant cannot be maintained, the
component MUST fail loudly (throw, return an error, log at error level) —
never silently violate an invariant.

**Acceptance gate**: tests cover the happy path, error path, timeout path, and
partial-failure path for each invariant. No invariant is silently violated.

---

## Step 7: Tests — write tests that discriminate (kill mutations)

Every harness component MUST have tests that discriminate — meaning they fail
if the component's behavior is subtly wrong, not just if it crashes. Use
mutation-style reasoning: if you changed one line of the component, would the
test catch it?

**Acceptance gate**:
- Tests exist for every public function/branch
- Tests cover error paths, not just happy paths
- A mutation test (or manual mutation review) confirms the tests catch
  behavioral changes
- Tests run in the deterministic gate (`_DETERMINISTIC_ONLY=1`) when possible

---

## Summary Checklist

| Step | Gate |
|------|------|
| 1. Contract | Written contract with inputs/outputs/invariants |
| 2. Register | Component discoverable by name in the registry |
| 3. Preserve argv | Test: caller args reach the command |
| 4. Read-only export | Test: export does not mutate state |
| 5. Deliver-before-ack | Test: result delivered before ack resolves |
| 6. Invariants | Tests: happy + error + timeout + partial-failure |
| 7. Tests | Discriminating tests that kill mutations |