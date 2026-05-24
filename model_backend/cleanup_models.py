"""Cleanup old model artifacts for model_backend.

Default mode is dry-run (no deletion). Use --execute to delete files.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable


XGB_RE = re.compile(r"^(xgb_[A-Za-z0-9_.-]+_[A-Za-z0-9_.-]+_\d+m_\d{8}_\d{6})\.(model|meta)\.json$")
TFT_BASE_RE = re.compile(r"^(tft_device\d+_[A-Za-z0-9_]+_\d{8}_\d{6})")


@dataclass
class Artifact:
    kind: str
    group: str
    base_id: str
    files: list[Path]
    mtime: float


def _collect_xgb_artifacts(root: Path) -> list[Artifact]:
    by_base: dict[str, list[Path]] = {}
    for path in root.glob("*.json"):
        match = XGB_RE.match(path.name)
        if not match:
            continue
        base_id = match.group(1)
        by_base.setdefault(base_id, []).append(path)

    artifacts: list[Artifact] = []
    for base_id, files in by_base.items():
        # Group key strips timestamp tail so we keep latest per model family.
        group = re.sub(r"_\d{8}_\d{6}$", "", base_id)
        model_file = root / f"{base_id}.model.json"
        if model_file.exists() and model_file not in files:
            files.append(model_file)
        mtime = max(p.stat().st_mtime for p in files)
        artifacts.append(Artifact(kind="xgb", group=group, base_id=base_id, files=sorted(files), mtime=mtime))
    return artifacts


def _collect_tft_artifacts(root: Path) -> list[Artifact]:
    by_base: dict[str, list[Path]] = {}
    for path in root.iterdir():
        if not path.is_file():
            continue
        base_match = TFT_BASE_RE.match(path.name)
        if not base_match:
            continue
        base_id = base_match.group(1)
        if path.suffix not in {".json", ".ckpt"}:
            continue
        by_base.setdefault(base_id, []).append(path)

    artifacts: list[Artifact] = []
    for base_id, files in by_base.items():
        # Group key strips timestamp tail so we keep latest per device+target.
        group = re.sub(r"_\d{8}_\d{6}$", "", base_id)
        mtime = max(p.stat().st_mtime for p in files)
        artifacts.append(Artifact(kind="tft", group=group, base_id=base_id, files=sorted(files), mtime=mtime))
    return artifacts


def _prune_candidates(
    artifacts: Iterable[Artifact],
    keep_latest: int,
    max_age_days: int,
) -> tuple[list[Artifact], list[Artifact]]:
    now = datetime.now()
    age_cutoff = now - timedelta(days=max_age_days)

    keep: list[Artifact] = []
    delete: list[Artifact] = []

    grouped: dict[str, list[Artifact]] = {}
    for item in artifacts:
        grouped.setdefault(item.group, []).append(item)

    for _, group_items in grouped.items():
        sorted_items = sorted(group_items, key=lambda x: x.mtime, reverse=True)
        for idx, item in enumerate(sorted_items):
            item_age = datetime.fromtimestamp(item.mtime)
            is_old = item_age < age_cutoff
            beyond_keep = idx >= keep_latest
            if beyond_keep or is_old:
                delete.append(item)
            else:
                keep.append(item)

    return keep, delete


def _format_artifact(item: Artifact) -> str:
    stamp = datetime.fromtimestamp(item.mtime).isoformat(timespec="seconds")
    file_names = ", ".join(p.name for p in item.files)
    return f"[{item.kind}] {item.base_id} | mtime={stamp} | files={file_names}"


def _delete_files(artifacts: Iterable[Artifact]) -> int:
    removed = 0
    for item in artifacts:
        for path in item.files:
            if path.exists():
                path.unlink()
                removed += 1
    return removed


def main() -> None:
    parser = argparse.ArgumentParser(description="Cleanup old XGBoost/TFT model artifacts")
    parser.add_argument("--models-root", default="models", help="Root folder containing xgboost_iot and tft_dashboard")
    parser.add_argument("--keep-xgb", type=int, default=5, help="Keep latest XGBoost artifacts per source+metric+step")
    parser.add_argument("--keep-tft", type=int, default=3, help="Keep latest TFT artifacts per device+target")
    parser.add_argument("--max-age-days", type=int, default=60, help="Delete artifacts older than this age")
    parser.add_argument("--execute", action="store_true", help="Actually delete files (default is dry-run)")
    args = parser.parse_args()

    models_root = Path(args.models_root)
    if not models_root.is_absolute():
        models_root = Path(__file__).resolve().parent / models_root
    xgb_dir = models_root / "xgboost_iot"
    tft_dir = models_root / "tft_dashboard"

    xgb_artifacts = _collect_xgb_artifacts(xgb_dir) if xgb_dir.exists() else []
    tft_artifacts = _collect_tft_artifacts(tft_dir) if tft_dir.exists() else []

    _, xgb_delete = _prune_candidates(xgb_artifacts, keep_latest=max(1, args.keep_xgb), max_age_days=max(1, args.max_age_days))
    _, tft_delete = _prune_candidates(tft_artifacts, keep_latest=max(1, args.keep_tft), max_age_days=max(1, args.max_age_days))

    to_delete = sorted([*xgb_delete, *tft_delete], key=lambda x: x.mtime)

    mode = "EXECUTE" if args.execute else "DRY-RUN"
    print(f"Mode: {mode}")
    print(f"Models root: {models_root.resolve()}")
    print(f"Detected artifacts: xgb={len(xgb_artifacts)} tft={len(tft_artifacts)}")
    print(f"Delete candidates: {len(to_delete)}")

    for item in to_delete:
        print("- " + _format_artifact(item))

    if not args.execute:
        print("\nDry-run only. Re-run with --execute to delete files.")
        return

    removed_files = _delete_files(to_delete)
    print(f"\nDeleted artifacts: {len(to_delete)}")
    print(f"Deleted files: {removed_files}")


if __name__ == "__main__":
    main()
