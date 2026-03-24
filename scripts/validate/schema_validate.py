#!/usr/bin/env python3
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
TASKS_PATH = ROOT / "data/tasks/tasks.json"
REDUCTIONS_PATH = ROOT / "data/reductions/reductions.json"

ALLOWED_CLASSES = {"P", "NP", "NP-complete", "NP-hard"}
ALLOWED_REDUCTION_TYPES = {"karp"}


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def is_semver(value: str) -> bool:
    parts = value.split(".")
    return len(parts) == 3 and all(p.isdigit() for p in parts)


def validate_references(refs, prefix, errors):
    if not isinstance(refs, list) or len(refs) == 0:
        errors.append(f"{prefix}.references must be a non-empty array")
        return
    for i, ref in enumerate(refs):
        rp = f"{prefix}.references[{i}]"
        if not isinstance(ref, dict):
            errors.append(f"{rp} must be an object")
            continue
        if not isinstance(ref.get("label"), str) or not ref.get("label").strip():
            errors.append(f"{rp}.label must be a non-empty string")
        if not isinstance(ref.get("url"), str) or not ref.get("url").strip():
            errors.append(f"{rp}.url must be a non-empty string")
        else:
            parsed = urlparse(ref["url"])
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                errors.append(f"{rp}.url must be an absolute http(s) URL")


def validate_tasks_dataset(data, errors):
    if not isinstance(data, dict):
        errors.append("tasks root must be an object")
        return

    if (
        "schema_version" not in data
        or not isinstance(data["schema_version"], str)
        or not is_semver(data["schema_version"])
    ):
        errors.append("tasks.schema_version must be semver string (e.g. 1.0.0)")

    tasks = data.get("tasks")
    if not isinstance(tasks, list):
        errors.append("tasks.tasks must be an array")
        return

    for i, task in enumerate(tasks):
        p = f"tasks[{i}]"
        if not isinstance(task, dict):
            errors.append(f"{p} must be an object")
            continue

        for field in ["id", "title", "class", "year", "statement", "references"]:
            if field not in task:
                errors.append(f"{p}.{field} is required")

        if not isinstance(task.get("id"), str) or not task.get("id", "").strip():
            errors.append(f"{p}.id must be a non-empty string")
        if not isinstance(task.get("title"), str) or not task.get("title", "").strip():
            errors.append(f"{p}.title must be a non-empty string")
        if task.get("class") not in ALLOWED_CLASSES:
            errors.append(f"{p}.class must be one of {sorted(ALLOWED_CLASSES)}")
        if not isinstance(task.get("year"), int) or not (1900 <= task["year"] <= 2100):
            errors.append(f"{p}.year must be an integer in [1900, 2100]")
        if not isinstance(task.get("statement"), str) or not task.get("statement", "").strip():
            errors.append(f"{p}.statement must be a non-empty string")

        aliases = task.get("aliases")
        if aliases is not None:
            if not isinstance(aliases, list):
                errors.append(f"{p}.aliases must be an array if present")
            elif any((not isinstance(a, str) or not a.strip()) for a in aliases):
                errors.append(f"{p}.aliases must contain only non-empty strings")

        validate_references(task.get("references"), p, errors)


def validate_reductions_dataset(data, errors):
    if not isinstance(data, dict):
        errors.append("reductions root must be an object")
        return

    if (
        "schema_version" not in data
        or not isinstance(data["schema_version"], str)
        or not is_semver(data["schema_version"])
    ):
        errors.append("reductions.schema_version must be semver string (e.g. 1.0.0)")

    reductions = data.get("reductions")
    if not isinstance(reductions, list):
        errors.append("reductions.reductions must be an array")
        return

    for i, red in enumerate(reductions):
        p = f"reductions[{i}]"
        if not isinstance(red, dict):
            errors.append(f"{p} must be an object")
            continue

        for field in ["id", "from", "to", "type", "idea", "references"]:
            if field not in red:
                errors.append(f"{p}.{field} is required")

        for key in ["id", "from", "to", "idea"]:
            if not isinstance(red.get(key), str) or not red.get(key, "").strip():
                errors.append(f"{p}.{key} must be a non-empty string")

        if red.get("type") not in ALLOWED_REDUCTION_TYPES:
            errors.append(f"{p}.type must be one of {sorted(ALLOWED_REDUCTION_TYPES)}")

        validate_references(red.get("references"), p, errors)


def main() -> int:
    errors = []

    try:
        tasks_data = load_json(TASKS_PATH)
    except Exception as e:  # noqa: BLE001
        print(f"Failed to read {TASKS_PATH}: {e}")
        return 1

    try:
        reductions_data = load_json(REDUCTIONS_PATH)
    except Exception as e:  # noqa: BLE001
        print(f"Failed to read {REDUCTIONS_PATH}: {e}")
        return 1

    validate_tasks_dataset(tasks_data, errors)
    validate_reductions_dataset(reductions_data, errors)

    if errors:
        for err in errors:
            print(f"[schema] {err}")
        return 1

    print("Schema validation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
