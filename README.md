# NP-Completeness Visualizer

[check the graph yourself](https://al-ratushny.github.io/NP-hard-problems-visual/src)

## Project Idea
This is an interactive visualization of NP-complete problems and reductions between them.
The goal is simple: keep the graph in one place so it is easy to see how problems connect.
The project is static: data is stored in JSON, with no database and no API.

This project may contain inaccuracies or mistakes. Any corrections and contributions are welcome.

## What You Can Do in UI
- Browse the full reduction graph as labeled problem blocks.
- Click a node to see problem statement, references, and related reductions.
- Click an edge to see reduction details and sources.
- Use path explorer (`source -> target`) to find a reduction chain.
- Use zoom controls (`+`, `-`, `Reset`) and mouse drag to pan the graph.
- Use search to quickly jump to a task by id, title, or alias.

## Project Structure
- `src/` — frontend app:
  - `index.html` — page layout and controls.
  - `styles.css` — UI styles.
  - `app.js` — graph rendering, interactions, search, path explorer, zoom/pan.
- `assets/` — static assets (logos).
- `data/tasks/tasks.json` — list of tasks/problems.
- `data/reductions/reductions.json` — list of reductions between tasks.
- `schemas/` — JSON schemas:
  - `task.schema.json`
  - `reduction.schema.json`
- `scripts/validate/` — data quality checks:
  - `schema_validate.py` — shape/field validation.
  - `integrity_check.py` — graph integrity (ids, links, duplicates, self-loops).
  - `check_links.py` — verifies source links are reachable.
- `docs/` — product/architecture/planning documentation.

## Data Model (Short)

### Task
Each task contains:
- `id` (unique)
- `title`
- `aliases` (optional names)
- `class` (`P`, `NP`, `NP-complete`, `NP-hard`)
- `statement`
- `references` (at least one source link)

### Reduction
Each reduction contains:
- `id` (unique)
- `from`, `to` (task ids)
- `type` (`karp`)
- `idea`
- `references` (at least one source link)

## Working with Data
To add a new task/reduction:
1. Edit JSON in `data/tasks/tasks.json` and/or `data/reductions/reductions.json`.
2. Keep naming and references consistent.
3. Run validation before opening a PR.

## How to Run Validation
Main script:
```bash
./scripts/run_tests.sh
```

With source-link checks:
```bash
./scripts/run_tests.sh --with-links
```

Manual run (step by step):
```bash
python3 scripts/validate/schema_validate.py
python3 scripts/validate/integrity_check.py
python3 scripts/validate/check_links.py
```
