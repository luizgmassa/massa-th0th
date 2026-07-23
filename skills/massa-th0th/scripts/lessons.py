#!/usr/bin/env python3
"""
Deterministic bookkeeping for the massa-th0th spec-driven lessons layer.

The LLM supplies judgment (which failure happened, how to phrase the lesson, what
signal grounds it). This script owns everything mechanical: IDs, distinct-feature
recurrence counting, candidate->confirmed promotion, pruning, demotion, and
rendering the human/agent-readable playbook. Bookkeeping by hand is exactly what
rots a lessons file, so it lives here, not in a prompt.

Canonical state:  .specs/lessons.json   (machine-owned - do NOT hand-edit)
Rendered view:    .specs/LESSONS.md      (regenerated on every write)

Pure standard library. No dependencies. Pass --root with the target workspace
root so the package-local script writes that workspace's .specs directory.

Commands:
  add        Record a grounded lesson from a verification signal.
  list       Print lessons (default: confirmed) for loading at Specify/Design.
  penalize   Mark a confirmed lesson as having failed when applied (-> quarantine).
  prune      Drop stale uncorroborated candidates (also runs automatically on add/list).
  status     Print counts (used by the self-check in validate.md).
  init       Create empty store + rendered file.
  observe    Ingest a JSON observation into the gitignored observations buffer.
  export     Export the lessons store as JSON (round-trips with import).
  import     Import lessons from JSON (merge by dedup key; best-effort th0th memory).

Exit codes: 0 ok, 2 usage/validation error (e.g. missing grounding).
"""

import argparse
import datetime as _dt
import json
import os
import re
import sys
import urllib.request

STORE_REL = os.path.join(".specs", "lessons.json")
RENDER_REL = os.path.join(".specs", "LESSONS.md")
OBS_REL = os.path.join(".specs", "observations.json")

SIGNALS = {
    "ac_gap": "Acceptance criterion not covered / failed",
    "surviving_mutant": "Discrimination sensor mutant survived (weak test)",
    "spec_precision_gap": "Spec did not define a precise outcome",
    "spec_deviation": "Implementation diverged from spec/design (SPEC_DEVIATION)",
    "gate_fail": "Build-level gate check failed",
}

DEFAULTS = {"promote_threshold": 2, "window_days": 45, "quarantine_threshold": 2}

# th0th supported memory types (references/th0th-tools.md). `procedural` is a
# TAG, never a type. Lessons are procedural knowledge -> type `pattern`.
TH0TH_SUPPORTED_TYPES = ("critical", "conversation", "code", "decision", "pattern")
TH0TH_LESSON_TYPE = "pattern"


def _now():
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_date(s):
    try:
        return _dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=_dt.timezone.utc)
    except Exception:
        return _dt.datetime.now(_dt.timezone.utc)


def _store_path(root):
    return os.path.join(root, STORE_REL)


def _render_path(root):
    return os.path.join(root, RENDER_REL)


def _load(root):
    path = _store_path(root)
    if not os.path.exists(path):
        return {
            "schema": 1,
            "promote_threshold": DEFAULTS["promote_threshold"],
            "window_days": DEFAULTS["window_days"],
            "quarantine_threshold": DEFAULTS["quarantine_threshold"],
            "next_id": 1,
            "lessons": [],
        }
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    for k, v in DEFAULTS.items():
        data.setdefault(k, v)
    data.setdefault("schema", 1)
    data.setdefault("next_id", 1)
    data.setdefault("lessons", [])
    return data


def _save(root, data):
    os.makedirs(os.path.join(root, ".specs"), exist_ok=True)
    with open(_store_path(root), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    _render(root, data)


def _confidence(lesson, data):
    """Deterministic 0-1 confidence from recurrence + signal + scope presence."""
    rec_cap = min(lesson.get("recurrence", 1) / max(data["promote_threshold"], 1), 1.0)
    sig_weight = 0.15
    scope_weight = 0.10 if lesson.get("scope") else 0.0
    return round(min(rec_cap * 0.75 + sig_weight + scope_weight, 1.0), 2)


def _obs_path(root):
    return os.path.join(root, OBS_REL)


def _obs_load(root):
    path = _obs_path(root)
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (ValueError, OSError):
        return []


def _obs_append(root, item):
    os.makedirs(os.path.join(root, ".specs"), exist_ok=True)
    items = _obs_load(root)
    items.append(item)
    with open(_obs_path(root), "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)
        f.write("\n")


def _th0th_remember_best_effort(root, content, tags, project_id="", session_id=""):
    """Best-effort th0th memory write via REST (urllib, stdlib only).

    th0th MCP is agent-side only; a CLI subprocess cannot call MCP. th0th exposes
    REST at TH0TH_API_URL. Type is always `pattern` (lessons are procedural
    knowledge); `procedural` is a tag, not a type. Returns True on success,
    False (silent) when unavailable — the file store remains source of truth.
    """
    api_url = os.environ.get("UAS_TH0TH_API_URL") or os.environ.get("TH0TH_API_URL")
    if not api_url:
        return False
    path = os.environ.get("UAS_TH0TH_MEMORY_PATH", "/api/v1/memory")
    url = api_url.rstrip("/") + path
    body = json.dumps({
        "content": content, "type": TH0TH_LESSON_TYPE, "importance": 0.6,
        "projectId": project_id, "sessionId": session_id, "tags": list(tags),
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    key = os.environ.get("UAS_TH0TH_API_KEY") or os.environ.get("TH0TH_API_KEY")
    if key:
        req.add_header("x-api-key", key)
    try:
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


def _lesson_tags(lesson):
    """massa-th0th persistence tag contract for a lesson's th0th memory."""
    return [
        "project:%s" % lesson.get("project", ""),
        "session:%s" % lesson.get("session", ""),
        "workflow:%s" % (lesson.get("workflow", "") or "unset"),
        "entity:%s" % (lesson.get("entity", "") or "unset"),
        "memory:procedural",
    ]


def _norm(text):
    """Normalized dedup key: lowercase, strip punctuation, collapse whitespace.
    Exact-after-normalization only - no semantic matching (stdlib-only limitation).
    Phrase lessons tersely and canonically so recurrences actually merge."""
    t = text.lower().strip()
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _key(signal, text):
    return signal + "::" + _norm(text)


def _auto_prune(data):
    """Drop candidates that never recurred within the window. Mutates data."""
    threshold = data["promote_threshold"]
    window = data["window_days"]
    now = _dt.datetime.now(_dt.timezone.utc)
    kept = []
    dropped = []
    for l in data["lessons"]:
        if l["status"] == "candidate" and l["recurrence"] < threshold:
            age_days = (now - _parse_date(l.get("last_seen", l.get("created", _now())))).days
            if age_days > window:
                dropped.append(l["id"])
                continue
        kept.append(l)
    data["lessons"] = kept
    return dropped


def _find(data, signal, text):
    k = _key(signal, text)
    for l in data["lessons"]:
        if l.get("key") == k:
            return l
    return None


def _render(root, data):
    lines = []
    lines.append("# LESSONS - auto-maintained by skills/massa-th0th/scripts/lessons.py")
    lines.append("")
    lines.append("> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.")
    lines.append("> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.")
    lines.append(f"> promote_threshold={data['promote_threshold']} distinct features | window_days={data['window_days']} | quarantine_threshold={data['quarantine_threshold']}")
    lines.append("")

    by_status = {"confirmed": [], "candidate": [], "quarantined": []}
    for l in data["lessons"]:
        by_status.get(l["status"], by_status["candidate"]).append(l)

    def block(title, items, note):
        out = [f"## {title}", ""]
        if note:
            out.append(note)
            out.append("")
        if not items:
            out.append("_none_")
            out.append("")
            return out
        for l in sorted(items, key=lambda x: x["id"]):
            scope = f" | scope: `{l['scope']}`" if l.get("scope") else ""
            conf = l.get("confidence", _confidence(l, data))
            out.append(f"### {l['id']} - {l['text']}")
            out.append(
                f"- signal: `{l['signal']}` | recurrence: {l['recurrence']} feature(s){scope} | harmful: {l.get('harmful', 0)} | confidence: {conf}"
            )
            feats = ", ".join(l.get("features", [])) or "-"
            out.append(f"- features: {feats}")
            ctx = []
            for k in ("project", "session", "workflow", "entity"):
                if l.get(k):
                    ctx.append(f"{k}={l[k]}")
            if ctx:
                out.append(f"- context: {' '.join(ctx)}")
            ev = l.get("evidence", [])
            if ev:
                out.append(f"- evidence: {ev[0]}" + (f" (+{len(ev) - 1} more)" if len(ev) > 1 else ""))
            out.append(f"- last seen: {l.get('last_seen', '-')}")
            out.append("")
        return out

    lines += block(
        "Confirmed (load these at Specify/Design)",
        by_status["confirmed"],
        "Corroborated across multiple features. Safe to apply as guidance.",
    )
    lines += block(
        "Candidates (under observation - do NOT load as guidance yet)",
        by_status["candidate"],
        "Seen once or not yet corroborated. Tracked, not trusted.",
    )
    lines += block(
        "Quarantined (failed when applied - ignore)",
        by_status["quarantined"],
        "A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.",
    )

    with open(_render_path(root), "w", encoding="utf-8") as f:
        f.write("\n".join(lines).rstrip() + "\n")


# ----------------------------- commands -----------------------------

def cmd_init(root, args):
    data = _load(root)
    _save(root, data)
    print(f"Initialized lessons store at {_store_path(root)} and {_render_path(root)}")
    return 0


def cmd_add(root, args):
    signal = args.signal
    source = (args.source or "").strip()
    text = (args.text or "").strip()
    feature = (args.feature or "").strip()

    # Grounding is enforced here, deterministically - not left to the prompt.
    if signal not in SIGNALS:
        print(f"ERROR: --signal must be one of {sorted(SIGNALS)}", file=sys.stderr)
        return 2
    if not feature:
        print("ERROR: --feature is required (the feature the signal came from).", file=sys.stderr)
        return 2
    if not source:
        print("ERROR: --source is required (file:line / AC id / mutant id / SPEC_DEVIATION ref).", file=sys.stderr)
        print("       A lesson with no grounding in validation.md is an opinion, not a lesson. Refused.", file=sys.stderr)
        return 2
    if len(text) < 12:
        print("ERROR: --text too short. State the actionable lesson in one terse sentence.", file=sys.stderr)
        return 2

    data = _load(root)
    _auto_prune(data)
    existing = _find(data, signal, text)
    now = _now()
    project = (getattr(args, "project", "") or "").strip()
    session = (getattr(args, "session", "") or "").strip()
    workflow = (getattr(args, "workflow", "") or "").strip()
    entity = (getattr(args, "entity", "") or "").strip()

    def _ctx(lesson):
        if project:
            lesson["project"] = project
        if session:
            lesson["session"] = session
        if workflow:
            lesson["workflow"] = workflow
        if entity:
            lesson["entity"] = entity

    if existing:
        if feature not in existing["features"]:
            existing["features"].append(feature)
        existing["recurrence"] = len(existing["features"])
        existing["last_seen"] = now
        _ctx(existing)
        existing["confidence"] = _confidence(existing, data)
        ev = source if not args.scope else f"{source} ({args.scope})"
        if ev not in existing["evidence"]:
            existing["evidence"].append(ev)
        promoted = False
        if existing["status"] == "candidate" and existing["recurrence"] >= data["promote_threshold"]:
            existing["status"] = "confirmed"
            promoted = True
        _save(root, data)
        _th0th_remember_best_effort(root, "%s [%s] %s" % (existing["id"], signal, text),
                                    _lesson_tags(existing), project, session)
        msg = f"UPDATED {existing['id']} (recurrence={existing['recurrence']}, status={existing['status']}, confidence={existing['confidence']})"
        if promoted:
            msg += " - PROMOTED to confirmed"
        print(msg)
    else:
        lid = f"L-{data['next_id']:03d}"
        data["next_id"] += 1
        lesson = {
            "id": lid,
            "key": _key(signal, text),
            "text": text,
            "signal": signal,
            "scope": (args.scope or "").strip(),
            "status": "candidate",
            "features": [feature],
            "recurrence": 1,
            "harmful": 0,
            "evidence": [source if not args.scope else f"{source} ({args.scope})"],
            "created": now,
            "last_seen": now,
        }
        _ctx(lesson)
        lesson["confidence"] = _confidence(lesson, data)
        data["lessons"].append(lesson)
        _save(root, data)
        _th0th_remember_best_effort(root, "%s [%s] %s" % (lid, signal, text),
                                    _lesson_tags(lesson), project, session)
        print(f"ADDED {lid} (status=candidate, recurrence=1, confidence={lesson['confidence']})")
    return 0


def cmd_penalize(root, args):
    data = _load(root)
    target = None
    for l in data["lessons"]:
        if l["id"].lower() == args.id.lower():
            target = l
            break
    if not target:
        print(f"ERROR: no lesson with id {args.id}", file=sys.stderr)
        return 2
    target["harmful"] = target.get("harmful", 0) + 1
    target["last_seen"] = _now()
    if target["harmful"] >= data["quarantine_threshold"]:
        target["status"] = "quarantined"
    _save(root, data)
    print(f"PENALIZED {target['id']} (harmful={target['harmful']}, status={target['status']})")
    return 0


def cmd_list(root, args):
    data = _load(root)
    if _auto_prune(data):
        _save(root, data)
    want = args.status
    q = (args.query or "").lower().strip()
    scope = (args.scope or "").lower().strip()
    project = (getattr(args, "project", "") or "").lower().strip()
    rows = []
    for l in data["lessons"]:
        if want != "all" and l["status"] != want:
            continue
        if q and q not in l["text"].lower():
            continue
        if scope and scope not in (l.get("scope", "").lower()):
            continue
        if project and project not in (l.get("project", "").lower()):
            continue
        rows.append(l)
    if not rows:
        flt = " ".join(f for f in (q, scope, project) if f)
        print(f"(no {want} lessons" + (f" matching '{flt}'" if flt else "") + ")")
        return 0
    for l in sorted(rows, key=lambda x: x["id"]):
        sc = f" [scope:{l['scope']}]" if l.get("scope") else ""
        conf = l.get("confidence", _confidence(l, data))
        print(f"{l['id']} ({l['status']}, x{l['recurrence']}, conf={conf}){sc}: {l['text']}")
    return 0


def cmd_observe(root, args):
    """Ingest a JSON observation into the gitignored observations buffer.

    Grounding is NOT enforced here; it is enforced when `add` consumes the
    buffer. Observation fields: signal, text, source, feature, scope, project,
    session, workflow, entity.
    """
    raw = args.json if args.json else sys.stdin.read()
    try:
        item = json.loads(raw)
    except (ValueError, TypeError) as exc:
        print(f"ERROR: observation is not valid JSON: {exc}", file=sys.stderr)
        return 2
    if not isinstance(item, dict):
        print("ERROR: observation must be a JSON object", file=sys.stderr)
        return 2
    item.setdefault("observed_at", _now())
    _obs_append(root, item)
    print(f"OBSERVED buffer=1 (total={len(_obs_load(root))})")
    return 0


def cmd_export(root, args):
    """Export the lessons store as JSON (stdout or --out). Round-trips with import."""
    data = _load(root)
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"EXPORTED {len(data['lessons'])} lessons -> {args.out}")
    else:
        sys.stdout.write(text)
    return 0


def cmd_import(root, args):
    """Import lessons from JSON (stdin or --in), merging by dedup key.

    Re-emits th0th memory best-effort (type `pattern`, tag `memory:procedural`)
    for each imported lesson so the file store and th0th memory stay consistent.
    """
    raw = sys.stdin.read() if args.in_ is None else open(args.in_, "r", encoding="utf-8").read()
    try:
        incoming = json.loads(raw)
    except (ValueError, TypeError) as exc:
        print(f"ERROR: import payload is not valid JSON: {exc}", file=sys.stderr)
        return 2
    if not isinstance(incoming, dict) or not isinstance(incoming.get("lessons"), list):
        print("ERROR: import payload must be a lessons store object with `lessons`", file=sys.stderr)
        return 2
    data = _load(root)
    _auto_prune(data)
    now = _now()
    added = merged = 0
    for l in incoming["lessons"]:
        key = l.get("key") or _key(l.get("signal", ""), l.get("text", ""))
        existing = next((x for x in data["lessons"] if x.get("key") == key), None)
        if existing:
            for f in l.get("features", []):
                if f not in existing["features"]:
                    existing["features"].append(f)
            existing["recurrence"] = len(existing["features"])
            existing["last_seen"] = now
            existing["confidence"] = _confidence(existing, data)
            merged += 1
        else:
            lid = f"L-{data['next_id']:03d}"
            data["next_id"] += 1
            l.setdefault("id", lid)
            l["id"] = lid
            l["key"] = key
            l.setdefault("status", "candidate")
            l.setdefault("recurrence", len(l.get("features", [])) or 1)
            l.setdefault("harmful", 0)
            l.setdefault("created", now)
            l["last_seen"] = now
            l["confidence"] = _confidence(l, data)
            data["lessons"].append(l)
            added += 1
        target = existing or l
        _th0th_remember_best_effort(root, "%s [%s] %s" % (target.get("id"), target.get("signal", ""), target.get("text", "")),
                                    _lesson_tags(target), target.get("project", ""), target.get("session", ""))
    _save(root, data)
    print(f"IMPORTED added={added} merged={merged} th0th=best-effort")
    return 0


def cmd_prune(root, args):
    data = _load(root)
    dropped = _auto_prune(data)
    _save(root, data)
    print(f"Pruned {len(dropped)} stale candidate(s): {', '.join(dropped) if dropped else '-'}")
    return 0


def cmd_status(root, args):
    data = _load(root)
    counts = {"confirmed": 0, "candidate": 0, "quarantined": 0}
    for l in data["lessons"]:
        counts[l["status"]] = counts.get(l["status"], 0) + 1
    total = len(data["lessons"])
    print(f"lessons: {total} total | confirmed={counts['confirmed']} candidate={counts['candidate']} quarantined={counts['quarantined']}")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(prog="lessons.py", description="Deterministic lessons bookkeeping for massa-th0th spec-driven.")
    p.add_argument("--root", default=".", help="Project root containing .specs/ (default: current dir)")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("init", help="Create empty store + rendered file")
    sp.set_defaults(fn=cmd_init)

    sp = sub.add_parser("add", help="Record a grounded lesson")
    sp.add_argument("--feature", required=True)
    sp.add_argument("--signal", required=True, choices=sorted(SIGNALS))
    sp.add_argument("--source", required=True, help="file:line / AC id / mutant id / SPEC_DEVIATION ref")
    sp.add_argument("--text", required=True, help="One terse, actionable sentence")
    sp.add_argument("--scope", default="", help="Optional: path/layer/tag for retrieval filtering")
    sp.add_argument("--project", default="", help="massa-th0th projectId context")
    sp.add_argument("--session", default="", help="massa-th0th workflowSessionId context")
    sp.add_argument("--workflow", default="", help="active massa-th0th workflow type")
    sp.add_argument("--entity", default="", help="active massa-th0th entity")
    sp.set_defaults(fn=cmd_add)

    sp = sub.add_parser("penalize", help="Mark a confirmed lesson as failed-when-applied")
    sp.add_argument("--id", required=True)
    sp.set_defaults(fn=cmd_penalize)

    sp = sub.add_parser("list", help="Print lessons for loading")
    sp.add_argument("--status", default="confirmed", choices=["confirmed", "candidate", "quarantined", "all"])
    sp.add_argument("--query", default="", help="Substring filter on lesson text")
    sp.add_argument("--scope", default="", help="Substring filter on scope")
    sp.add_argument("--project", default="", help="Substring filter on project")
    sp.set_defaults(fn=cmd_list)

    sp = sub.add_parser("observe", help="Ingest a JSON observation into the buffer")
    sp.add_argument("--json", default="", help="Observation JSON (else read stdin)")
    sp.set_defaults(fn=cmd_observe)

    sp = sub.add_parser("export", help="Export lessons store as JSON")
    sp.add_argument("--out", default="", help="Write to file (else stdout)")
    sp.set_defaults(fn=cmd_export)

    sp = sub.add_parser("import", help="Import lessons from JSON (merge by dedup key)")
    sp.add_argument("--in", dest="in_", default=None, help="Read from file (else stdin)")
    sp.set_defaults(fn=cmd_import)

    sp = sub.add_parser("prune", help="Drop stale uncorroborated candidates")
    sp.set_defaults(fn=cmd_prune)

    sp = sub.add_parser("status", help="Print counts")
    sp.set_defaults(fn=cmd_status)

    args = p.parse_args(argv)
    root = os.path.abspath(args.root)
    return args.fn(root, args)


if __name__ == "__main__":
    raise SystemExit(main())
