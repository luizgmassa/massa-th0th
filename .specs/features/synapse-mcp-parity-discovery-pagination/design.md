# M20 + M54 — Design

Transport adds typed `PATCH` and `DELETE` methods behind the existing authenticated request primitive. A typed upstream HTTP error retains status and parsed JSON; the CallTool proxy serializes that body without string nesting and marks the result as an MCP tool error.

Synapse definitions remain declarative in the ordered registry. Path parameters continue to be removed from forwarded payloads. Existing REST routes and global authentication middleware remain authoritative; MCP adds exposure, not duplicate lifecycle logic.

Discovery logic moves to a pure `tool-discovery` module. It hashes the canonical ordered public definition surface, encodes `{v:1,fingerprint,offset}` as base64url JSON, validates exact shape and page-boundary offset, and slices 100 entries. The MCP handler delegates to this pure function and throws SDK `McpError(ErrorCode.InvalidParams, ...)` for invalid cursors.
