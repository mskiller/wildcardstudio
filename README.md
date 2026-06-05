# WildcardStudio

WildcardStudio is a local-first web app for managing wildcard files, prompt
libraries, tag metadata, prompt diffs, and image-generation history for SDXL,
Illustrious, NoobAI, ComfyUI, and SD Forge workflows.

It is designed to run locally with Docker. Your wildcard libraries, SQLite
database, backups, generated images, and `.env` file are intentionally ignored
by Git so the source code can be shared without publishing private prompt data.

## Features

- Wildcard file explorer with editing and preview support
- Prompt comparator with token-level diff views
- CodeMirror/Monaco-based wildcard editor helpers
- Booru-style tag taxonomy and metadata management
- Duplicate detection with fuzzy matching
- TAG/NL scanner and prompt library views
- Wildcard generator, merge tools, syntax conversion, backup, and Git helpers
- Optional ComfyUI / SD Forge image generation connectors

## Requirements

- Docker and Docker Compose
- Node.js 20+ for local frontend development
- Python 3.12+ for local backend development

## Quick Start

```bash
cp .env.example .env
docker compose up -d --build
```

Open the app at [http://localhost](http://localhost).

| Service | URL |
| --- | --- |
| Web app | http://localhost |
| API through nginx | http://localhost/api/docs |
| API direct | http://localhost:8001/docs |
| Frontend direct | http://localhost:8800 |

## Local Data

Place your wildcard libraries in `./wildcards/` when running the app. The
directory contents are ignored by Git by default, except for
`wildcards/README.md` and `wildcards/.gitkeep`.

Runtime data is stored in:

- `wildcards/` for local wildcard files
- `db/` for SQLite data
- `backups/` for backup archives and generated images
- `.env` for local configuration

These paths are intentionally excluded from public commits.

## Development

Backend:

```bash
cd backend
python -m pip install -r requirements.txt
python -m pytest
uvicorn main:app --reload
```

Frontend:

```bash
cd frontend
npm ci
npm run dev
npm run build
```

The Vite dev server proxies `/api` to the backend service when running through
Docker. For non-Docker local development, set `VITE_API_URL` if your backend is
not available at the proxied address.

## Useful Commands

```bash
# Start all services
docker compose up -d

# Rebuild after source changes
docker compose up -d --build

# Follow backend logs
docker compose logs -f backend

# Run backend tests in the container
docker compose exec backend pytest -v

# Stop services without deleting local data
docker compose down
```

## Project Layout

```text
backend/      FastAPI application, SQLModel models, routers, services, tests
frontend/     React + Vite + TypeScript application
nginx/        Local reverse proxy for the web app and API
docs/         Project design notes
wildcards/    Local wildcard libraries, ignored by Git
db/           Local SQLite files, ignored by Git
backups/      Backup archives and generated images, ignored by Git
```

## GitHub Publishing Checklist

Before pushing a public repository:

1. Confirm `.env`, `db/`, `backups/`, and personal `wildcards/` files are not staged.
2. Run `npm run build` in `frontend/`.
3. Run `python -m pytest` in `backend/`.
4. Review whether your wildcard libraries are licensed or private before changing the ignore rules.
