/**
 * massa-th0th Web UI — app.js (read-only memory/search browser).
 *
 * Single source for the pure helpers (markdownToHtml, view renderers, theme
 * helpers). The browser-init block is guarded by `typeof document !==
 * "undefined"` so the same file can be imported under bun:test without a DOM.
 *
 * READ-ONLY: this file contains NO call to any mutating endpoint. The
 * ALLOWED_MUTATING_PATHS list below is the exhaustive list of mutating paths;
 * web-ui-readonly.test.ts asserts none of them appear as a fetch target in this
 * source.
 */

// ── Constants ──────────────────────────────────────────────────────────────

/** Exhaustive list of mutating API paths the UI must NEVER call. */
export const FORBIDDEN_MUTATING_PATHS = [
  "/memory/store",
  "/memory/update",
  "/memory/delete",
  "/handoff/begin",
  "/handoff/accept",
  "/handoff/cancel",
  "/checkpoints/create",
  "/checkpoints/restore",
  "/proposal/approve",
  "/proposal/reject",
  "/project/reset",
  "/project/index",
  "/project/upload-and-index",
  "/hook",
  "/hook/batch",
  "/bootstrap",
];

export const MEMORY_TYPES = ["critical", "conversation", "code", "decision", "pattern"];

export const MEMORY_LEVELS = [
  { value: 1, label: "1 — Project" },
  { value: 2, label: "2 — User" },
  { value: 3, label: "3 — Session" },
];

const THEME_STORAGE_KEY = "massa-th0th-ui-theme";

// ── HTML escaping ──────────────────────────────────────────────────────────

export function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Minimal markdown renderer ──────────────────────────────────────────────

/**
 * Render a small, safe subset of markdown to HTML. Escapes all raw text first
 * so injected HTML/tags cannot execute. Supported: ATX headings, bold, italic,
 * inline code, fenced code blocks, unordered/ordered lists, links, paragraphs.
 * Returns "" for falsy input.
 */
export function markdownToHtml(md) {
  if (!md) return "";
  const lines = String(md).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let inUl = false;
  let inOl = false;
  let para = [];

  const flushLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };
  const flushPara = () => {
    if (para.length > 0) {
      out.push("<p>" + inline(para.join(" ")) + "</p>");
      para = [];
    }
  };

  // inline formatting applied AFTER escaping
  function inline(text) {
    let t = escapeHtml(text);
    // inline code first to protect its content from further substitution
    const codeStash = [];
    t = t.replace(/`([^`]+)`/g, (_m, c) => {
      codeStash.push(c);
      return "@@MASSA_TH0THCODE" + (codeStash.length - 1) + "@@";
    });
    // links [text](url) — url must be http(s)/mailto; escape text already done
    t = t.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
      (_m, label, url) =>
        '<a href="' + url + '" rel="noopener noreferrer" target="_blank">' + label + "</a>",
    );
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    // restore inline code
    t = t.replace(/@@MASSA_TH0THCODE(\d+)@@/g, (_m, idx) => "<code>" + codeStash[Number(idx)] + "</code>");
    return t;
  }

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushPara();
      flushLists();
      const lang = fence[1] || "";
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (or eof)
      const cls = lang ? ' class="language-' + escapeHtml(lang) + '"' : "";
      out.push("<pre><code" + cls + ">" + escapeHtml(codeLines.join("\n")) + "</code></pre>");
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      flushLists();
      const level = h[1].length;
      out.push("<h" + level + ">" + inline(h[2]) + "</h" + level + ">");
      i++;
      continue;
    }

    // unordered list item
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push("<li>" + inline(line.replace(/^\s*[-*]\s+/, "")) + "</li>");
      i++;
      continue;
    }

    // ordered list item
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push("<li>" + inline(line.replace(/^\s*\d+\.\s+/, "")) + "</li>");
      i++;
      continue;
    }

    // blank line → paragraph break
    if (line.trim() === "") {
      flushPara();
      flushLists();
      i++;
      continue;
    }

    // default: accumulate paragraph line
    flushLists();
    para.push(line);
    i++;
  }
  flushPara();
  flushLists();
  return out.join("\n");
}

// ── View renderers (pure: ({ data, state }) => htmlString) ─────────────────

export function renderProjects(data) {
  const projects = (data && data.projects) || [];
  if (projects.length === 0) {
    return '<p class="empty">No indexed projects.</p>';
  }
  const rows = projects
    .map((p) => {
      const id = escapeHtml(p.projectId || p.id || "");
      const count = p.documentCount ?? p.docCount ?? "";
      const meta =
        count !== "" ? ' <span class="muted">(' + escapeHtml(String(count)) + " docs)</span>" : "";
      return "<li>" + escapeHtml(id) + meta + "</li>";
    })
    .join("");
  return (
    '<section class="view"><h2>Projects</h2><ul class="project-list">' +
    rows +
    "</ul></section>"
  );
}

export function renderMemoryBrowser(data, state) {
  state = state || {};
  if (!data || data.success === false) {
    return errorBlock(data);
  }
  const payload = data.data || data;
  const memories = (payload && payload.memories) || [];
  const total = (payload && payload.total) || 0;
  const limit = (payload && payload.limit) || 50;
  const offset = (payload && payload.offset) || 0;
  const f = state.filters || {};

  const typeOpts = MEMORY_TYPES.map(
    (t) =>
      '<option value="' +
      t +
      '"' +
      (f.type === t ? " selected" : "") +
      ">" +
      t +
      "</option>",
  ).join("");
  const levelOpts = MEMORY_LEVELS.map(
    (l) =>
      '<option value="' +
      l.value +
      '"' +
      (String(f.level) === String(l.value) ? " selected" : "") +
      ">" +
      l.label +
      "</option>",
  ).join("");

  const filterBar =
    '<div class="filters">' +
    '<label>type <select data-filter="type"><option value="">(any)</option>' +
    typeOpts +
    "</select></label>" +
    '<label>level <select data-filter="level"><option value="">(any)</option>' +
    levelOpts +
    "</select></label>" +
    '<label>min importance <input type="number" min="0" max="1" step="0.1" data-filter="minImportance" value="' +
    escapeHtml(f.minImportance != null ? String(f.minImportance) : "") +
    '"/></label>' +
    '<button type="button" data-action="memory-refresh">apply</button>' +
    "</div>";

  let body;
  if (memories.length === 0) {
    body = '<p class="empty">No memories match these filters.</p>';
  } else {
    body =
      '<table class="grid"><thead><tr><th>type</th><th>level</th><th>imp.</th><th>content</th></tr></thead><tbody>' +
      memories
        .map((m) => {
          const content = truncate(m.content || "", 200);
          return (
            "<tr>" +
            "<td>" +
            escapeHtml(m.type || "") +
            "</td>" +
            "<td>" +
            escapeHtml(String(m.level ?? "")) +
            "</td>" +
            "<td>" +
            escapeHtml(String(m.importance ?? "")) +
            "</td>" +
            '<td class="content-cell">' +
            markdownToHtml(content) +
            "</td>" +
            "</tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  const pager =
    '<div class="pager muted">' +
    escapeHtml(String(offset + 1)) +
    "–" +
    escapeHtml(String(Math.min(offset + limit, total))) +
    " of " +
    escapeHtml(String(total)) +
    ' <button type="button" data-action="memory-prev"' +
    (offset === 0 ? " disabled" : "") +
    ">prev</button>" +
    '<button type="button" data-action="memory-next"' +
    (offset + limit >= total ? " disabled" : "") +
    ">next</button></div>";

  return (
    '<section class="view"><h2>Memory</h2>' +
    filterBar +
    body +
    pager +
    "</section>"
  );
}

export function renderSearch(data, state) {
  state = state || {};
  const query = (state.query || "").trim();
  const input =
    '<div class="filters"><input type="search" data-bind="query" placeholder="search memories…" value="' +
    escapeHtml(query) +
    '"/> <button type="button" data-action="search-run">search</button></div>';
  if (!query) {
    return (
      '<section class="view"><h2>Search</h2>' +
      input +
      '<p class="muted">Enter a query to search memories (FTS5 + semantic).</p></section>'
    );
  }
  if (!data || data.success === false) {
    return '<section class="view"><h2>Search</h2>' + input + errorBlock(data) + "</section>";
  }
  const results = extractSearchResults(data);
  let body;
  if (results.length === 0) {
    body = '<p class="empty">No results for "' + escapeHtml(query) + '".</p>';
  } else {
    body =
      '<ul class="result-list">' +
      results
        .map((r) => {
          const content = r.content || r.text || "";
          const score = r.score != null ? ' <span class="muted">(' + escapeHtml(String(r.score)) + ")</span>" : "";
          return (
            '<li><div class="result-content">' +
            markdownToHtml(content) +
            "</div>" +
            score +
            "</li>"
          );
        })
        .join("") +
      "</ul>";
  }
  return '<section class="view"><h2>Search</h2>' + input + body + "</section>";
}

export function renderHandoffs(data, state) {
  state = state || {};
  const project = state.project || "";
  if (!project) {
    return (
      '<section class="view"><h2>Handoffs</h2>' +
      '<p class="muted">Select a project to list pending handoffs.</p></section>'
    );
  }
  if (!data || data.success === false) {
    return '<section class="view"><h2>Handoffs</h2>' + errorBlock(data) + "</section>";
  }
  const payload = data.data || data;
  const pending = (payload && payload.pending) || [];
  if (pending.length === 0) {
    return '<section class="view"><h2>Handoffs</h2><p class="empty">No pending handoffs.</p></section>';
  }
  const rows = pending
    .map((h) => {
      return (
        '<div class="card">' +
        "<div><strong>" +
        escapeHtml(h.targetAgent || "(any agent)") +
        "</strong> <span class=\"muted\">" +
        escapeHtml(h.status || "") +
        "</span></div>" +
        '<div class="card-body">' +
        markdownToHtml(h.summary || "(no summary)") +
        "</div>" +
        "<div class=\"muted\">" +
        escapeHtml(h.id || "") +
        "</div>" +
        "</div>"
      );
    })
    .join("");
  return '<section class="view"><h2>Handoffs</h2>' + rows + "</section>";
}

export function renderCheckpoints(data) {
  if (!data || data.success === false) {
    return '<section class="view"><h2>Checkpoints</h2>' + errorBlock(data) + "</section>";
  }
  const rows = extractCheckpointRows(data);
  if (rows.length === 0) {
    return '<section class="view"><h2>Checkpoints</h2><p class="empty">No checkpoints.</p></section>';
  }
  const body =
    '<table class="grid"><thead><tr><th>task</th><th>type</th><th>status</th><th>description</th></tr></thead><tbody>' +
    rows
      .map((c) => {
        return (
          "<tr>" +
          "<td>" +
          escapeHtml(c.taskId || "") +
          "</td>" +
          "<td>" +
          escapeHtml(c.checkpointType || "") +
          "</td>" +
          "<td>" +
          escapeHtml(c.status || "") +
          "</td>" +
          '<td class="content-cell">' +
          escapeHtml(c.description || "") +
          "</td>" +
          "</tr>"
        );
      })
      .join("") +
    "</tbody></table>";
  return '<section class="view"><h2>Checkpoints</h2>' + body + "</section>";
}

// ── Helpers used by renderers ──────────────────────────────────────────────

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

function errorBlock(data) {
  const msg = (data && data.error) || "Request failed.";
  return '<div class="error">' + escapeHtml(msg) + "</div>";
}

/** Normalize the SearchMemoriesTool response shape into a flat result list. */
function extractSearchResults(data) {
  const payload = data && (data.data || data);
  if (Array.isArray(payload && payload.results)) return payload.results;
  if (Array.isArray(payload && payload.memories)) return payload.memories;
  if (Array.isArray(payload)) return payload;
  return [];
}

/** Normalize the ListCheckpointsTool response shape into a flat row list. */
function extractCheckpointRows(data) {
  const payload = data && (data.data || data);
  if (Array.isArray(payload && payload.checkpoints)) return payload.checkpoints;
  if (Array.isArray(payload && payload.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

// ── Theme helpers ──────────────────────────────────────────────────────────

export function initTheme(doc, store) {
  doc = doc || (typeof document !== "undefined" ? document : null);
  store = store || (typeof localStorage !== "undefined" ? localStorage : null);
  let theme = "light";
  try {
    if (store) {
      const t = store.getItem(THEME_STORAGE_KEY);
      if (t === "dark" || t === "light") theme = t;
    }
  } catch (_) {}
  if (doc && doc.documentElement) {
    doc.documentElement.setAttribute("data-theme", theme);
  }
  return theme;
}

export function toggleTheme(doc, store) {
  doc = doc || (typeof document !== "undefined" ? document : null);
  store = store || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!doc || !doc.documentElement) return "light";
  const current = doc.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  doc.documentElement.setAttribute("data-theme", next);
  try {
    if (store) store.setItem(THEME_STORAGE_KEY, next);
  } catch (_) {}
  return next;
}

// ── Browser bootstrap (guarded; skipped under test/Node) ───────────────────

function createApiClient(opts) {
  opts = opts || {};
  const base = opts.base != null ? opts.base : "";
  const fetchImpl = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
  async function request(path, init) {
    init = init || {};
    if (!fetchImpl) throw new Error("fetch unavailable");
    const url = base + path;
    const res = await fetchImpl(url, {
      method: init.method || "GET",
      headers: init.body
        ? { "content-type": "application/json" }
        : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      return await res.json();
    }
    return await res.text();
  }
  return { request };
}

function startApp(opts) {
  opts = opts || {};
  const doc = opts.document || (typeof document !== "undefined" ? document : null);
  if (!doc) return;
  const root = doc.getElementById("app");
  const projectSelect = doc.getElementById("project-select");
  const themeToggle = doc.getElementById("theme-toggle");
  const api = createApiClient({ base: opts.base });

  const state = {
    view: "projects",
    project: "",
    memoryFilters: { type: "", level: "", minImportance: "" },
    memoryOffset: 0,
    searchQuery: "",
  };

  initTheme(doc);

  function setNavActive() {
    doc.querySelectorAll(".nav a").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("href") === "#" + hashFor(state.view));
    });
  }
  function hashFor(view) {
    return "/" + view;
  }
  function viewFromHash(h) {
    const name = (h || "").replace(/^#\/?/, "");
    return ["projects", "memory", "search", "handoffs", "checkpoints"].includes(name)
      ? name
      : "projects";
  }

  async function refreshProjectsForSelect() {
    try {
      const data = await api.request("/api/v1/project/list");
      const projects = ((data && data.data) || {}).projects || [];
      projectSelect.innerHTML =
        '<option value="">(select)</option>' +
        projects
          .map((p) => {
            const id = p.projectId || p.id || "";
            return '<option value="' + escapeHtml(id) + '">' + escapeHtml(id) + "</option>";
          })
          .join("");
    } catch (_) {}
  }

  async function render() {
    setNavActive();
    try {
      if (state.view === "projects") {
        const data = await api.request("/api/v1/project/list");
        root.innerHTML = renderProjects((data && data.data) || { projects: [] });
      } else if (state.view === "memory") {
        const body = {
          limit: 50,
          offset: state.memoryOffset,
        };
        if (state.memoryFilters.type) body.type = state.memoryFilters.type;
        if (state.memoryFilters.level) body.level = Number(state.memoryFilters.level);
        if (state.memoryFilters.minImportance !== "")
          body.minImportance = Number(state.memoryFilters.minImportance);
        if (state.project) body.projectId = state.project;
        const data = await api.request("/api/v1/memory/list", { method: "POST", body });
        root.innerHTML = renderMemoryBrowser(data, { filters: state.memoryFilters });
      } else if (state.view === "search") {
        let data = null;
        if (state.searchQuery.trim()) {
          const body = { query: state.searchQuery, format: "json", limit: 20 };
          if (state.project) body.projectId = state.project;
          data = await api.request("/api/v1/memory/search", { method: "POST", body });
        }
        root.innerHTML = renderSearch(data, { query: state.searchQuery });
      } else if (state.view === "handoffs") {
        let data = null;
        if (state.project) {
          data = await api.request("/api/v1/handoff/list", {
            method: "POST",
            body: { projectId: state.project },
          });
        }
        root.innerHTML = renderHandoffs(data, { project: state.project });
      } else if (state.view === "checkpoints") {
        const body = { limit: 50 };
        if (state.project) body.projectId = state.project;
        const data = await api.request("/api/v1/checkpoints/list", { method: "POST", body });
        root.innerHTML = renderCheckpoints(data);
      }
    } catch (e) {
      root.innerHTML = '<div class="error">Connection error: ' + escapeHtml(String(e.message || e)) + "</div>";
    }
    wireViewHandlers();
  }

  function wireViewHandlers() {
    // memory filters
    root.querySelectorAll("[data-filter]").forEach((el) => {
      el.addEventListener("change", () => {
        state.memoryFilters[el.dataset.filter] = el.value;
      });
    });
    root.querySelector('[data-action="memory-refresh"]')?.addEventListener("click", () => {
      state.memoryOffset = 0;
      render();
    });
    root.querySelector('[data-action="memory-prev"]')?.addEventListener("click", () => {
      state.memoryOffset = Math.max(0, state.memoryOffset - 50);
      render();
    });
    root.querySelector('[data-action="memory-next"]')?.addEventListener("click", () => {
      state.memoryOffset += 50;
      render();
    });
    // search
    const q = root.querySelector('[data-bind="query"]');
    if (q) {
      q.addEventListener("input", () => {
        state.searchQuery = q.value;
      });
    }
    root.querySelector('[data-action="search-run"]')?.addEventListener("click", () => {
      render();
    });
  }

  // global controls
  themeToggle?.addEventListener("click", () => toggleTheme(doc));
  projectSelect?.addEventListener("change", () => {
    state.project = projectSelect.value;
    render();
  });
  doc.querySelectorAll(".nav a").forEach((a) => {
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      state.view = viewFromHash(a.getAttribute("href"));
      if (globalThis.location) globalThis.location.hash = hashFor(state.view);
      render();
    });
  });
  if (globalThis.location) {
    state.view = viewFromHash(globalThis.location.hash);
    globalThis.addEventListener?.("hashchange", () => {
      state.view = viewFromHash(globalThis.location.hash);
      render();
    });
  }

  refreshProjectsForSelect().finally(render);
}

// Export pure helpers + bootstrap on globalThis for both browser and Node import.
const MASSA_TH0TH_UI = {
  markdownToHtml,
  escapeHtml,
  renderProjects,
  renderMemoryBrowser,
  renderSearch,
  renderHandoffs,
  renderCheckpoints,
  initTheme,
  toggleTheme,
  createApiClient,
  startApp,
  FORBIDDEN_MUTATING_PATHS,
  MEMORY_TYPES,
  MEMORY_LEVELS,
};
if (typeof globalThis !== "undefined") {
  globalThis.MASSA_TH0TH_UI = MASSA_TH0TH_UI;
}

// Auto-start in a browser environment.
if (typeof document !== "undefined") {
  // defer until DOMContentLoaded if needed
  const ready = document.readyState;
  if (ready === "loading") {
    document.addEventListener("DOMContentLoaded", () => startApp());
  } else {
    startApp();
  }
}
