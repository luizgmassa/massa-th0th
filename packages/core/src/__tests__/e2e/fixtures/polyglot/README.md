# Polyglot E2E Fixture

This deterministic fixture covers every extension in `DEFAULT_ALLOWED_EXTENSIONS`.
Each extension contains a declaration or structural key asserted through the
active PostgreSQL graph and both public transports.

## PolyglotContract

The fixture also retains one unresolved TypeScript import and overloaded Java
methods to exercise unresolved-edge retention and legacy-FQN ambiguity without
causing activation failure.
