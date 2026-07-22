#!/usr/bin/env python3
"""Update SHA-256 hashes in every fixture/manifest file that pins source hashes.

The repo has more than one manifest that pins SHA-256 hashes of source files.
This script is the single entry point for refreshing all of them so the
corresponding integrity checks stop failing after a source change.

Currently handled manifests:

  qwen     packages/core/src/__tests__/e2e/fixtures/qwen-profile.json
            Sections `needleTargets`, `distractors`, `supportFiles`.
            Each entry: {"path": <repo-relative>, "sha256": <hex>}.

  corpus   benchmarks/parser/corpus/corpus-manifest.json
            Top-level `files` array of {"name", "extension", "bytes", "sha256"}.
            Files are rooted at benchmarks/parser/corpus/. Also refreshes the
            derived top-level `corpusChecksum` (SHA-256 of the manifest payload
            with the checksum field removed) and the `fileCount` / `totalBytes`
            counters, exactly like benchmarks/parser/generate-corpus.ts does.

Usage:

    bun run update-fixture-hashes             # update stale hashes in place
    bun run update-fixture-hashes -- --check  # dry-run: report mismatches only
    python3 scripts/update-fixture-hashes.py --root /path/to/repo
    python3 scripts/update-fixture-hashes.py --manifest qwen
    python3 scripts/update-fixture-hashes.py --manifest corpus --check

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
from typing import Any, Callable, Protocol


def default_root() -> Path:
    return Path(__file__).resolve().parent.parent


def load_manifest(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_manifest(path: Path, manifest: dict[str, Any], root: Path) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class ManifestHandler(Protocol):
    """A handler knows how to read, update, and verify one manifest shape."""

    name: str
    rel_path: str

    def update(self, manifest_path: Path, root: Path, *, check: bool) -> tuple[int, list[str]]:
        ...


class QwenFixtureHandler:
    """Handler for packages/core/src/__tests__/e2e/fixtures/qwen-profile.json."""

    name = "qwen"
    rel_path = "packages/core/src/__tests__/e2e/fixtures/qwen-profile.json"
    sections = ("needleTargets", "distractors", "supportFiles")

    def update(self, manifest_path: Path, root: Path, *, check: bool) -> tuple[int, list[str]]:
        manifest = load_manifest(manifest_path)
        changed: list[str] = []
        missing: list[str] = []

        for section in self.sections:
            for entry in manifest.get(section, []):
                rel = entry["path"]
                target = root / rel
                if not target.exists():
                    missing.append(rel)
                    print(f"[qwen] error: missing file: {rel}", file=sys.stderr)
                    continue
                actual = sha256_file(target)
                expected = entry.get("sha256", "")
                if actual != expected:
                    changed.append(rel)
                    if check:
                        print(f"[qwen] mismatch: {rel}\n  expected {expected}\n  got      {actual}")
                    else:
                        entry["sha256"] = actual
                        print(f"[qwen] updated:  {rel}\n  was {expected}\n  now {actual}")

        if missing:
            return 2, changed

        if changed and not check:
            write_manifest(manifest_path, manifest, root)
            print(f"[qwen] {len(changed)} hash(es) updated in {manifest_path.relative_to(root)}")
            return 0, changed

        if changed and check:
            print(f"[qwen] {len(changed)} mismatch(es) found (dry-run, no writes)")
            return 0, changed

        print("[qwen] all hashes current")
        return 1, changed


class CorpusManifestHandler:
    """Handler for benchmarks/parser/corpus/corpus-manifest.json.

    Mirrors the deterministic scheme in benchmarks/parser/generate-corpus.ts:
    file entries live under benchmarks/parser/corpus/, and the top-level
    `corpusChecksum` is SHA-256 of the manifest payload with the checksum
    field removed (JSON.stringify with indent=2).
    """

    name = "corpus"
    rel_path = "benchmarks/parser/corpus/corpus-manifest.json"
    corpus_dir_rel = "benchmarks/parser/corpus"

    def update(self, manifest_path: Path, root: Path, *, check: bool) -> tuple[int, list[str]]:
        manifest = load_manifest(manifest_path)
        corpus_dir = root / self.corpus_dir_rel
        changed: list[str] = []
        missing: list[str] = []

        total_bytes = 0
        for entry in manifest.get("files", []):
            name = entry["name"]
            target = corpus_dir / name
            if not target.exists():
                missing.append(name)
                print(f"[corpus] error: missing file: {name}", file=sys.stderr)
                continue
            stat = target.stat()
            actual_sha = sha256_file(target)
            actual_bytes = stat.st_size

            file_changed = False
            old_sha = entry.get("sha256", "")
            old_bytes = entry.get("bytes")
            if old_sha != actual_sha:
                file_changed = True
                if check:
                    print(
                        f"[corpus] mismatch: {name}\n  expected {old_sha}\n  got      {actual_sha}"
                    )
                else:
                    entry["sha256"] = actual_sha
                    print(
                        f"[corpus] updated:  {name}\n  was {old_sha}\n  now {actual_sha}"
                    )
            if old_bytes != actual_bytes:
                file_changed = True
                if check:
                    print(
                        f"[corpus] bytes mismatch: {name}\n  expected {old_bytes}\n  got      {actual_bytes}"
                    )
                else:
                    entry["bytes"] = actual_bytes
                    print(
                        f"[corpus] bytes updated: {name}\n  was {old_bytes}\n  now {actual_bytes}"
                    )

            if file_changed:
                changed.append(name)

            total_bytes += actual_bytes

        if missing:
            return 2, changed

        # Refresh derived counters + corpusChecksum exactly like the generator.
        manifest["fileCount"] = len(manifest.get("files", []))
        manifest["totalBytes"] = total_bytes
        manifest["version"] = manifest.get("version", 1)
        manifest["generatedBy"] = manifest.get(
            "generatedBy", "benchmarks/parser/generate-corpus.ts"
        )

        # Compute checksum over the payload with the checksum field removed,
        # matching computeCorpusChecksum() in benchmarks/parser/harness.ts.
        payload = {k: v for k, v in manifest.items() if k != "corpusChecksum"}
        payload_json = json.dumps(payload, indent=2, ensure_ascii=False)
        computed_checksum = sha256_text(payload_json)
        recorded_checksum = manifest.get("corpusChecksum", "")

        checksum_changed = computed_checksum != recorded_checksum
        if checksum_changed:
            if check:
                print(
                    f"[corpus] checksum mismatch:\n  expected {recorded_checksum}\n  got      {computed_checksum}"
                )
            else:
                manifest["corpusChecksum"] = computed_checksum
                print(
                    f"[corpus] checksum updated:\n  was {recorded_checksum}\n  now {computed_checksum}"
                )
            if not changed:
                changed.append("corpusChecksum")

        if changed and not check:
            write_manifest(manifest_path, manifest, root)
            print(f"[corpus] {len(changed)} field(s) updated in {manifest_path.relative_to(root)}")
            return 0, changed

        if changed and check:
            print(f"[corpus] {len(changed)} mismatch(es) found (dry-run, no writes)")
            return 0, changed

        print("[corpus] all hashes current")
        return 1, changed


HANDLERS: dict[str, ManifestHandler] = {
    QwenFixtureHandler.name: QwenFixtureHandler(),
    CorpusManifestHandler.name: CorpusManifestHandler(),
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Update SHA-256 hashes in every fixture/manifest file that pins source hashes.",
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
        help="dry-run: report mismatches without updating manifests",
    )
    parser.add_argument(
        "--manifest",
        choices=sorted(HANDLERS.keys()),
        help="update only the named manifest (default: all)",
    )
    args = parser.parse_args(argv)

    root = args.root.resolve()
    selected = (
        [HANDLERS[args.manifest]]
        if args.manifest
        else list(HANDLERS.values())
    )

    overall_exit = 1  # start as "all current"
    summary: list[str] = []

    for handler in selected:
        manifest_path = (root / handler.rel_path).resolve()
        if not manifest_path.exists():
            print(f"error: manifest not found: {manifest_path}", file=sys.stderr)
            return 2

        code, changed = handler.update(manifest_path, root, check=args.check)
        summary.append(f"{handler.name}: {len(changed)} changed")
        # Exit code precedence: hard error (2) > updated/mismatch (0) > current (1)
        if code == 2:
            overall_exit = 2
        elif code == 0 and overall_exit != 2:
            overall_exit = 0
        elif overall_exit == 1:
            overall_exit = 1

    print("\nSummary: " + ", ".join(summary))
    return overall_exit


if __name__ == "__main__":
    sys.exit(main())