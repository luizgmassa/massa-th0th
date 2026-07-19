# M20 + M54 — Synapse MCP Parity and Discovery Pagination

## Requirements

- SMCP-R1: MCP API transport supports GET, POST, PATCH, and DELETE with identical authentication, path substitution, JSON body, and parsed REST envelope handling.
- SMCP-R2: Non-2xx proxy responses preserve the sanitized parsed REST error envelope and return MCP `isError: true`; REST status codes remain unchanged.
- SMCP-R3: Retain `synapse_session`, `synapse_prime`, and `synapse_access`; add `synapse_get`, `synapse_update`, `synapse_end`, `synapse_prefetch`, and `synapse_list` with schemas matching existing REST routes.
- SMCP-R4: `tools/list` pages the ordered public registry at exactly 100 tools using a versioned base64url cursor containing registry fingerprint and offset.
- SMCP-R5: Cursor fingerprint covers ordered name, description, and input schema. Malformed, unsupported, misaligned, out-of-range, or stale cursors raise protocol `InvalidParams` (`-32602`).
- SMCP-R6: Empty registry returns exactly `{tools: []}`. `nextCursor` appears only when another page exists.

## Acceptance Criteria

- AC1: GET/POST/PATCH/DELETE proxy tests prove path, body, auth, success, and non-2xx envelope behavior.
- AC2: REST and MCP lifecycle operations match for create/get/update/prime/access/prefetch/list/end, including missing and expired sessions.
- AC3: Registries sized 0, 1, 99, 100, 101, and over 200 traverse in stable order with no gaps or duplicates.
- AC4: Malformed and stale cursors return `InvalidParams`; changing a public definition invalidates a cursor.
- AC5: Current 47-tool roster remains fully visible to one-shot clients; documentation states registries over 100 require cursor-aware clients.

## Out of Scope

- Changing Synapse REST lifecycle semantics.
- Compatibility for future clients that ignore cursors after the roster exceeds 100.
- M50 search corruption taxonomy beyond reusable proxy error preservation.
