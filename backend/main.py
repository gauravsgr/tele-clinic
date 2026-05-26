"""
main.py — TeleClinic FastAPI application factory.

Lifespan:
  1. init_db()              — run migration SQL, seed weekly_schedule
  2. start_scheduler()      — start APScheduler AsyncIOScheduler
  3. reload_pending_jobs()  — re-register future jobs on restart
  4. (shutdown) close_db() + shutdown_scheduler()
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import get_settings
from database import init_db, close_db, get_db
from services.scheduler import start_scheduler, reload_pending_jobs, shutdown_scheduler

from routers import auth as auth_router
from routers import appointments as appt_router
from routers import schedule as sched_router
from routers import doctor as doctor_router
from routers import cancellation as cancel_router
from routers import setup as setup_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ────────────────────────────────────────────────────────────
    await init_db()

    start_scheduler()  # start before reload so jobs can be registered

    # reload_pending_jobs needs the DB connection; init_db must run first
    import database as _db_module
    db = await _db_module.get_db()
    await reload_pending_jobs(db)

    yield

    # ── Shutdown ───────────────────────────────────────────────────────────
    shutdown_scheduler()
    await close_db()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="TeleClinic API",
        version="1.0.0",
        description="Single-doctor appointment management system (WhatsApp channel only)",
        lifespan=lifespan,
    )

    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers
    app.include_router(auth_router.router)
    app.include_router(appt_router.router)
    app.include_router(sched_router.router)
    app.include_router(doctor_router.router)
    app.include_router(cancel_router.router)
    app.include_router(setup_router.router)

    # Generic 500 shaping
    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception):
        import logging
        logging.getLogger(__name__).exception("Unhandled exception")
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "message": "An unexpected error occurred."},
        )

    return app


app = create_app()
