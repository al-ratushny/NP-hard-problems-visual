#!/usr/bin/env python3
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TASKS_PATH = ROOT / "data/tasks/tasks.json"
REDUCTIONS_PATH = ROOT / "data/reductions/reductions.json"


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def has_nonempty_reference_list(entity: dict) -> bool:
    refs = entity.get("references")
    if not isinstance(refs, list) or not refs:
        return False
    for ref in refs:
        if not isinstance(ref, dict):
            return False
        if not ref.get("label") or not ref.get("url"):
            return False
    return True


def main() -> int:
    tasks = load_json(TASKS_PATH).get("tasks", [])
    reductions = load_json(REDUCTIONS_PATH).get("reductions", [])

    errors = []

    task_ids = [task.get("id") for task in tasks]
    task_id_set = set(task_ids)
    if len(task_ids) != len(task_id_set):
        errors.append("Duplicate Task.id values found.")

    for task in tasks:
        if not has_nonempty_reference_list(task):
            errors.append(f"Task '{task.get('id')}' has invalid or empty references.")

    reduction_ids = [red.get("id") for red in reductions]
    if len(reduction_ids) != len(set(reduction_ids)):
        errors.append("Duplicate Reduction.id values found.")

    edge_keys = set()
    for red in reductions:
        rid = red.get("id")
        src = red.get("from")
        dst = red.get("to")
        rtype = red.get("type")

        if src == dst:
            errors.append(f"Reduction '{rid}' has self-loop: from == to == '{src}'.")
        if src not in task_id_set:
            errors.append(f"Reduction '{rid}' references missing source task '{src}'.")
        if dst not in task_id_set:
            errors.append(f"Reduction '{rid}' references missing target task '{dst}'.")
        if not has_nonempty_reference_list(red):
            errors.append(f"Reduction '{rid}' has invalid or empty references.")

        edge_key = (src, dst, rtype)
        if edge_key in edge_keys:
            errors.append(
                f"Duplicate reduction edge found for (from='{src}', to='{dst}', type='{rtype}')."
            )
        edge_keys.add(edge_key)

    if errors:
        for err in errors:
            print(f"[integrity] {err}")
        return 1

    print("Integrity check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
