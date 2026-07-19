# M50 — Design

One core error taxonomy owns sanitized codes, HTTP status, optional degradation records, and diagnostic redaction/bounds. Mandatory failures propagate through the real RLM path; optional calls use explicit narrow catch boundaries that append one bounded degradation and ring entry. Empty result arrays are reserved for successful no-hit behavior.

Search routes throw typed failures so global HTTP handling sets 5xx. The MCP client reuses its typed upstream error preservation from M20. Local health snapshots the process-local 100-entry ring without raw payloads or stack traces.

Handoff and Proposal stores move from fire-and-forget mirrors to awaited Promise contracts. PostgreSQL hydration parses strict shapes and either completes once or rejects. Mutations execute DB-first, then update in-memory mirrors. Existing text columns stay intact.
