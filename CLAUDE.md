# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code Change Policy

- Keep all changes as minimal as possible unless explicitly asked for more.
- Never change behavior that was not explicitly requested.
- Apply DRY principles where possible.
- Python files must not exceed 400 lines.
- Never run git commands — only the user does.

## Project Overview

IceGraph is an interactive Apache Iceberg debugging and visualization platform. It provides a hierarchical, graph-based view of Iceberg table metadata to help engineers debug complex table states and trace metadata evolution. It is **read-only** and built exclusively for **Spark Connect** backends targeting **Iceberg Table Version 2**.

## Commands

### Backend (Python + UV)

```bash
cd backend
uv sync                    # Install dependencies
uv run python main.py      # Start Flask server on port 5000
```

### Frontend (Node/React)

```bash
cd frontend
npm i                      # Install dependencies
npm run dev                # Start Vite dev server on port 3000 (proxies /api to port 5000)
npm run build              # Production build to /dist
```

### Docker

```bash
docker build -t icegraph .                                          # Multi-stage build
docker run -e SPARK_REMOTE=sc://<ip>:15002 -p 5000:5000 icegraph   # Run container

cd docker_demo && docker compose up   # Full demo stack with mock Iceberg tables
```

## Architecture

**Backend** (`/backend/`) — Flask API that reads Iceberg metadata via Spark Connect:

- `main.py` — Flask app with 3 routes; uses `ThreadPoolExecutor` for async job processing
- `collectors/` — Pull Iceberg metadata via Spark: snapshots → metadata files → manifests → data files
- `table_inventory/` — Orchestrates collection into a unified inventory structure
- `search_cutoff/` — Optimizes snapshot iteration range to avoid full scans
- `graph_normalizer/` — Transforms inventory data into graph nodes/links for the frontend
- `extractors/` — Extract useful information from specific file types (manifests, data files) via Spark Connect
- `base_classes/` — Abstractions for files and Spark actions

**Frontend** (`/frontend/src/`) — React SPA:

- Pages: `GraphPage` (force-graph visualization), `MetadataPage`, `TimelinePage`, `FileTreePage`, `SnapshotSelectionPage`
- `TableLayout.jsx` wraps all table-specific pages; `TableSpecsContext.jsx` shares table state
- `graphConstants.js` defines node/link visual constants
- `mocks/` — MSW handlers used in the GitHub Pages demo (no real backend)

**API flow:**
1. `GET /api/v1/snapshot-map/<table>` — load snapshot history for UI selection
2. `POST /api/v1/graph-data` — submit async job with table name + snapshot range
3. `GET /api/v1/graph-data/<job_id>` — poll until complete, returns graph JSON

## Key Configuration

Backend environment variables (set in `backend/.env`):

| Variable | Default | Purpose |
|---|---|---|
| `SPARK_REMOTE` | `sc://localhost:15002` | Spark Connect endpoint |
| `MAX_SNAPSHOTS_TO_COMPUTE` | 50 | Max snapshots processed per job |
| `MAX_DATA_FILES_TO_COLLECT` | 5000 | Data file iteration limit |
| `MAX_NUMBER_OF_GRAPHS_TO_COMPUTE` | 15 | Concurrent job limit |
| `MAX_SNAPSHOTS_TO_SHOW` | 2000 | Snapshot selection UI limit |

## Deployment Notes

- CI publishes Docker image to Docker Hub and deploys frontend to GitHub Pages on version tags (`v*`)
- GitHub Pages demo uses MSW to mock API responses (no backend); enabled via `VITE_ENABLE_MSW=true` in the deploy workflow
- The Vite `base` path is `/IceGraph/` for GitHub Pages but `/` for Docker
