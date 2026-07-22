#!/usr/bin/env python3
"""Update SHA-256 hashes in the qwen E2E fixture manifest.

Reads `packages/core/src/__tests__/e2e/fixtures/qwen-profile.json`, recomputes
the SHA-256 for every file listed in `needleTargets`, `distractors`, and
`supportFiles`, and writes the manifest back when any hash changed.

Run this before committing changes that touch files tracked by the qwen
fixture manifest so `qwen-e2e-fixture.test.ts` does not fail with a hash
mismatch. The recommended wiring is the `update-qwen-hashes` package.json
script:

    bun run update-qwen-hashes          # update stale hashes in place
    bun run update-qwen-hashes -- --check  # dry-run: report mismatches only
    python3 scripts/update-qwen-fixture-hashes.py --root /path/to/repo

Exit codes:
    0  at least one hash was updated (or, in --check mode, a mismatch found)
    1  all hashes were already current (or, in --check mode, no mismatches)
    2  manifest missing or unreadable / file listed in manifest missing
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

MANIFEST_REL = Path("packages/core/src/__tests__/e2e/fixtures/qwen-profile.json")
SECTIONS = ("needleTargets", "distractors", "supportFiles")


def default_root() -> Path:
    return Path(__file__).resolve().parent.parent


def load_manifest(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def iter_entries(manifest: dict[str, Any]):
    for section in SECTIONS:
        for entry in manifest.get(section, []):
            yield section, entry


def update_manifest(
    manifest_path: Path,
    root: Path,
    *,
    check: bool,
) -> tuple[int, list[str]]:
    manifest = load_manifest(manifest_path)
    changed: list[str] = []
    missing: list[str] = []

    for section, entry in iter_entries(manifest):
        rel = entry["path"]
        target = root / rel
        if not target.exists():
            missing.append(rel)
            print(f"error: missing file: {rel}", file=sys.stderr)
            continue
        actual = sha256_file(target)
        expected = entry.get("sha256", "")
        if actual != expected:
            changed.append(rel)
            if check:
                print(f"mismatch: {rel}\n  expected {expected}\n  got      {actual}")
            else:
                entry["sha256"] = actual
                print(f"updated:  {rel}\n  was {expected}\n  now {actual}")

    if missing:
        return 2, changed

    if changed and not check:
        with manifest_path.open("w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"\n{len(changed)} hash(es) updated in {manifest_path.relative_to(root)}")
        return 0, changed

    if changed and check:
        print(f"\n{len(changed)} mismatch(es) found (dry-run, no writes)")
        return 0, changed

    print("all hashes current")
    return 1, changed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Update SHA-256 hashes in the qwen E2E fixture manifest.",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=default_root(),
        help="repository root (default: script parent's parent)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="dry-run: report mismatches without updating the manifest",
    )
    args = parser.parse_args(argv)

    manifest_path = (args.root / MANIFEST_REL).resolve()
    if not manifest_path.exists():
        print(f"error: manifest not found: {manifest_path}", file=sys.stderr)
        return 2

    code, _ = update_manifest(manifest_path, args.root.resolve(), check=args.check)
    return code


if __name__ == "__main__":
    sys.exit(main())