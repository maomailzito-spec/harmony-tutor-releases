#!/usr/bin/env python3

import argparse
import json
import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class Snapshot:
    rel_path: str
    timestamp_ms: int
    entry_id: str
    source: str
    from_path: Path


def _safe_rel_from_resource(resource: str, repo_root: Path) -> str | None:
    prefix = f"file://{repo_root.as_posix().rstrip('/')}/"
    if not resource.startswith(prefix):
        return None
    return resource[len(prefix) :]


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _iter_entries_files(vscode_history_dir: Path) -> Iterable[Path]:
    yield from vscode_history_dir.rglob("entries.json")


def collect_snapshots(
    *,
    repo_root: Path,
    vscode_history_dir: Path,
    cutoff_ms: int,
    include_paths: set[str] | None,
    max_per_file: int,
) -> list[Snapshot]:
    snapshots: list[Snapshot] = []

    for entries_json in _iter_entries_files(vscode_history_dir):
        data = _read_json(entries_json)
        if not data:
            continue

        resource = data.get("resource")
        if not isinstance(resource, str):
            continue

        rel = _safe_rel_from_resource(resource, repo_root)
        if not rel:
            continue

        if include_paths is not None and rel not in include_paths:
            continue

        entries = data.get("entries")
        if not isinstance(entries, list):
            continue

        # Entries.json can contain a lot of chat text; keep only recent and cap.
        recent = [
            e
            for e in entries
            if isinstance(e, dict)
            and isinstance(e.get("id"), str)
            and isinstance(e.get("timestamp"), (int, float))
            and int(e.get("timestamp")) >= cutoff_ms
        ]

        if not recent:
            # If nothing since cutoff, still keep a small tail for safety.
            recent = [
                e
                for e in entries
                if isinstance(e, dict)
                and isinstance(e.get("id"), str)
                and isinstance(e.get("timestamp"), (int, float))
            ]
            recent.sort(key=lambda e: int(e.get("timestamp", 0)), reverse=True)
            recent = recent[: min(5, max_per_file)]
        else:
            recent.sort(key=lambda e: int(e.get("timestamp", 0)), reverse=True)
            recent = recent[:max_per_file]

        folder = entries_json.parent
        for e in recent:
            entry_id = str(e.get("id"))
            ts = int(e.get("timestamp", 0))
            source = str(e.get("source", ""))
            src = folder / entry_id
            if not src.exists():
                continue
            snapshots.append(
                Snapshot(
                    rel_path=rel,
                    timestamp_ms=ts,
                    entry_id=entry_id,
                    source=source,
                    from_path=src,
                )
            )

    # Stable order: by file then time.
    snapshots.sort(key=lambda s: (s.rel_path, s.timestamp_ms, s.entry_id))
    return snapshots


def export_snapshots(*, repo_root: Path, snapshots: list[Snapshot], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    exported: list[dict[str, Any]] = []
    for s in snapshots:
        dt = datetime.fromtimestamp(s.timestamp_ms / 1000).strftime("%Y-%m-%d_%H%M%S")
        dest_dir = out_dir / s.rel_path
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{dt}__{s.entry_id}"
        if dest.exists():
            continue
        shutil.copy2(s.from_path, dest)
        exported.append(
            {
                "rel": s.rel_path,
                "timestamp_ms": s.timestamp_ms,
                "datetime": dt,
                "id": s.entry_id,
                "source": s.source,
                "from": str(s.from_path),
                "to": str(dest),
            }
        )

    (out_dir / "index.json").write_text(json.dumps(exported, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export VS Code Local History snapshots into ./recovered/ (non-destructive)."
    )
    parser.add_argument(
        "--repo",
        default=os.getcwd(),
        help="Path to the repo root (default: current working directory)",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=2,
        help="Export snapshots from the last N days (default: 2)",
    )
    parser.add_argument(
        "--max-per-file",
        type=int,
        default=25,
        help="Max snapshots per file (default: 25)",
    )
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        help="Repeatable: export only this repo-relative path (e.g. src/App.tsx)",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo).resolve()
    vscode_history_dir = Path.home() / "Library/Application Support/Code/User/History"
    if not vscode_history_dir.is_dir():
        raise SystemExit(f"VS Code History directory not found: {vscode_history_dir}")

    cutoff = datetime.now() - timedelta(days=args.days)
    cutoff_ms = int(cutoff.timestamp() * 1000)

    include_paths = set(args.only) if args.only else None

    snapshots = collect_snapshots(
        repo_root=repo_root,
        vscode_history_dir=vscode_history_dir,
        cutoff_ms=cutoff_ms,
        include_paths=include_paths,
        max_per_file=args.max_per_file,
    )

    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    out_dir = repo_root / "recovered" / "vscode-localhistory-export" / stamp
    export_snapshots(repo_root=repo_root, snapshots=snapshots, out_dir=out_dir)

    print(f"Exported {len(snapshots)} snapshot candidates to: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
