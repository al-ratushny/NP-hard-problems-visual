#!/usr/bin/env python3
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TASKS_PATH = ROOT / "data/tasks/tasks.json"
REDUCTIONS_PATH = ROOT / "data/reductions/reductions.json"


def load_refs(path: Path, key: str):
    data = json.loads(path.read_text(encoding="utf-8"))
    refs = []
    for item in data.get(key, []):
        item_id = item.get("id", "<unknown>")
        for ref in item.get("references", []):
            refs.append((item_id, ref.get("url", "")))
    return refs


def check_url(url: str, timeout: float = 10.0):
    request = urllib.request.Request(
        url,
        method="HEAD",
        headers={"User-Agent": "nphard-vis-link-check/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status < 400, response.status
    except urllib.error.HTTPError as err:
        if err.code in {403, 405}:
            pass
        else:
            return False, err.code
    except Exception:
        return False, None

    request = urllib.request.Request(
        url,
        method="GET",
        headers={"User-Agent": "nphard-vis-link-check/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status < 400, response.status
    except urllib.error.HTTPError as err:
        return False, err.code
    except Exception:
        return False, None


def main() -> int:
    refs = []
    refs.extend(load_refs(TASKS_PATH, "tasks"))
    refs.extend(load_refs(REDUCTIONS_PATH, "reductions"))

    unique_urls = sorted({url for _, url in refs})
    failures = []

    for url in unique_urls:
        ok, status = check_url(url)
        if not ok:
            failures.append((url, status))

    if failures:
        print("Link check failed:")
        for url, status in failures:
            status_str = str(status) if status is not None else "no-response"
            print(f"  - {url} [{status_str}]")
        return 1

    print(f"Link check passed for {len(unique_urls)} unique URLs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
