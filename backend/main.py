from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import asyncio

from config import get_settings
from database import create_db_and_tables
from routers import actions, comparator, duplicates, editor, explorer, files, generation, generator, library, merge, metadata, scanner, sync, tags, llm

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("wildcardstudio")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---------- startup ----------
    logger.info("Starting WildcardStudio backend …")
    create_db_and_tables()
    logger.info("Database initialised.")

    from services.tag_seeder import seed_default_categories
    seed_default_categories()

    # Initial full index + start async file watcher
    from services.file_watcher import scan_all, _watch_loop
    import threading
    threading.Thread(target=scan_all, daemon=True).start()
    asyncio.ensure_future(_watch_loop())

    yield

    # ---------- shutdown ----------
    logger.info("Shutting down WildcardStudio backend.")


app = FastAPI(
    title="WildcardStudio API",
    description=(
        "API locale de gestion de wildcards et prompts "
        "pour SDXL, Illustrious et NoobAI."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────
app.include_router(explorer.router,   prefix="/explorer",   tags=["F01 · Explorer"])
app.include_router(comparator.router, prefix="/comparator", tags=["F02 · Comparator"])
app.include_router(editor.router,     prefix="/editor",     tags=["F03 · Editor"])
app.include_router(tags.router,       prefix="/tags",       tags=["F04 · Tags"])
app.include_router(duplicates.router, prefix="/duplicates", tags=["F05 · Duplicates"])
app.include_router(scanner.router,    prefix="/scanner",    tags=["F06 · Scanner"])
app.include_router(library.router,    prefix="/library",    tags=["F07 · Library"])
app.include_router(generator.router,  prefix="/generator",  tags=["F08 · Generator"])
app.include_router(merge.router,      prefix="/merge",      tags=["F09 · Merge"])
app.include_router(sync.router,       prefix="/sync",       tags=["F10 · Sync"])
app.include_router(files.router,      prefix="/files",      tags=["F11 · Files"])
app.include_router(generation.router, prefix="/generation", tags=["F12 · Generation"])
app.include_router(metadata.router,   prefix="/metadata",   tags=["F13 · Metadata"])
app.include_router(actions.router,    prefix="/actions",    tags=["F14 · Actions"])
app.include_router(llm.router,        prefix="/llm",        tags=["Assistant LLM"])


@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "ok", "service": "wildcardstudio-api"}
