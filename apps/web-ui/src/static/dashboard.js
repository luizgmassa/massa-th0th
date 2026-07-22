/**
 * massa-th0th Web UI — dashboard.js (N28 observability).
 *
 * Read-only dashboard rendering: fetches scheduler status, hook queue,
 * Synapse sessions, and system metrics. Renders sections into HTML.
 *
 * READ-ONLY: no write operations. Degrades gracefully when endpoints are
 * unavailable (shows "unavailable" instead of crashing).
 *
 * Pure renderers are exported for unit testing (same pattern as app.js).
 */

// ── Dashboard data fetcher ──────────────────────────────────────────────────

/**
 * Fetch all dashboard sections in parallel. Each section is independent:
 * if one fails, the others still render. Returns an object with per-section
 * { data, error } pairs.
 */
export async function fetchDashboardData(api) {
  const [scheduler, hookQueue, synapse, metrics] = await Promise.allSettled([
    api.request("/api/v1/scheduler/status"),
    api.request("/api/v1/hooks/queue-status"),
    api.request("/api/v1/synapse/sessions"),
    api.request("/api/v1/system/metrics"),
  ]);

  function unwrap(result) {
    if (result.status === "fulfilled") return { data: result.value, error: null };
    return { data: null, error: String(result.reason?.message || result.reason || "unavailable") };
  }

  return {
    scheduler: unwrap(scheduler),
    hookQueue: unwrap(hookQueue),
    synapse: unwrap(synapse),
    metrics: unwrap(metrics),
  };
}

// ── Section renderers ───────────────────────────────────────────────────────

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(ts) {
  if (ts === null || ts === undefined || ts === 0) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function fmtBool(b) {
  return b ? "yes" : "no";
}

export function renderSchedulerSection(result) {
  if (result.error) {
    return '<section class="dashboard-section"><h2>Scheduler</h2><p class="muted">unavailable</p></section>';
  }
  const d = result.data;
  if (!d || d.unavailable) {
    return '<section class="dashboard-section"><h2>Scheduler</h2><p class="muted">unavailable</p></section>';
  }
  if (!d.running && (!d.jobs || d.jobs.length === 0)) {
    return '<section class="dashboard-section"><h2>Scheduler</h2><p class="muted">scheduler disabled</p></section>';
  }
  const jobs = (d.jobs || []).map((j) => {
    return `<tr>
      <td>${escapeHtml(j.id)}</td>
      <td>${escapeHtml(j.name)}</td>
      <td>${escapeHtml(j.jobKind)}</td>
      <td>${fmtBool(j.enabled)}</td>
      <td>${fmtTime(j.nextRunAt)}</td>
      <td>${fmtTime(j.lastRunAt)}</td>
      <td>${fmtBool(j.due)}</td>
      <td>${fmtBool(j.currentlyRunning)}</td>
    </tr>`;
  }).join("");
  return `<section class="dashboard-section">
    <h2>Scheduler</h2>
    <p><strong>Running:</strong> ${fmtBool(d.running)} · <strong>Tick interval:</strong> ${escapeHtml(d.tickIntervalMs)} ms</p>
    <table class="dashboard-table">
      <thead><tr><th>ID</th><th>Name</th><th>Kind</th><th>Enabled</th><th>Next run</th><th>Last run</th><th>Due</th><th>Running</th></tr></thead>
      <tbody>${jobs}</tbody>
    </table>
  </section>`;
}

export function renderHookQueueSection(result) {
  if (result.error) {
    return '<section class="dashboard-section"><h2>Hook Queue</h2><p class="muted">unavailable</p></section>';
  }
  const d = result.data;
  if (!d || d.unavailable) {
    return '<section class="dashboard-section"><h2>Hook Queue</h2><p class="muted">unavailable</p></section>';
  }
  const pct = d.maxPending > 0 ? Math.round((d.pendingCount / d.maxPending) * 100) : 0;
  return `<section class="dashboard-section">
    <h2>Hook Queue</h2>
    <p><strong>Pending:</strong> ${escapeHtml(d.pendingCount)} / ${escapeHtml(d.maxPending)} (${pct}%) · <strong>Saturated:</strong> ${fmtBool(d.saturated)}</p>
  </section>`;
}

export function renderSynapseSection(result) {
  if (result.error) {
    return '<section class="dashboard-section"><h2>Synapse Sessions</h2><p class="muted">unavailable</p></section>';
  }
  const d = result.data;
  if (!d || d.unavailable) {
    return '<section class="dashboard-section"><h2>Synapse Sessions</h2><p class="muted">unavailable</p></section>';
  }
  const sessions = (d.data?.sessions || d.sessions || []);
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return '<section class="dashboard-section"><h2>Synapse Sessions</h2><p class="muted">No active sessions</p></section>';
  }
  const rows = sessions.map((s) => {
    return `<tr>
      <td>${escapeHtml(s.sessionId)}</td>
      <td>${escapeHtml(s.agentId)}</td>
      <td>${escapeHtml(s.workspaceId || "—")}</td>
      <td>${escapeHtml(s.taskContext || "—")}</td>
      <td>${fmtTime(s.expiresAt)}</td>
    </tr>`;
  }).join("");
  return `<section class="dashboard-section">
    <h2>Synapse Sessions (${sessions.length})</h2>
    <table class="dashboard-table">
      <thead><tr><th>Session ID</th><th>Agent</th><th>Workspace</th><th>Task</th><th>Expires</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

export function renderMetricsSection(result) {
  if (result.error) {
    return '<section class="dashboard-section"><h2>System Metrics</h2><p class="muted">unavailable</p></section>';
  }
  const d = result.data;
  if (!d) {
    return '<section class="dashboard-section"><h2>System Metrics</h2><p class="muted">unavailable</p></section>';
  }
  const sys = d.system || {};
  const mem = sys.memory || {};
  return `<section class="dashboard-section">
    <h2>System Metrics</h2>
    <p><strong>Uptime:</strong> ${escapeHtml(sys.uptime || "—")}s · <strong>DB size:</strong> ${escapeHtml(sys.databaseSize || "—")}</p>
    <p><strong>Heap:</strong> ${escapeHtml(mem.heapUsed || "—")} / ${escapeHtml(mem.heapTotal || "—")} · <strong>RSS:</strong> ${escapeHtml(mem.rss || "—")}</p>
  </section>`;
}

/**
 * Top-level dashboard renderer. Takes the fetched data object and returns
 * an HTML string with all sections. Pure function (no DOM, no fetch).
 */
export function renderDashboard(data) {
  if (!data) return '<div class="error">Dashboard data unavailable</div>';
  return [
    '<div class="dashboard">',
    renderSchedulerSection(data.scheduler || { error: "no data" }),
    renderHookQueueSection(data.hookQueue || { error: "no data" }),
    renderSynapseSection(data.synapse || { error: "no data" }),
    renderMetricsSection(data.metrics || { error: "no data" }),
    '</div>',
  ].join("\n");
}