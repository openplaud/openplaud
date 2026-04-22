from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from api.config import settings
from db.engine import engine, get_db
from db.base import Base
from api.routes import recordings, transcriptions, settings as settings_routes, plaud
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create tables
Base.metadata.create_all(bind=engine)

# Create FastAPI app
app = FastAPI(
    title="OpenPlaud Python API",
    description="Self-hosted AI transcription for Plaud devices",
    version="0.1.0",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(recordings.router)
app.include_router(transcriptions.router)
app.include_router(settings_routes.router)
app.include_router(plaud.router)


# Health check endpoint
@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    """Health check endpoint."""
    try:
        db.execute("SELECT 1")
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {"status": "unhealthy", "database": "disconnected"}, 503


# Startup event
@app.on_event("startup")
async def startup_event():
    logger.info("OpenPlaud API starting up")
    logger.info(f"Database: {settings.database_url}")
    logger.info(f"Storage type: {settings.storage_type}")


# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    logger.info("OpenPlaud API shutting down")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.api_reload,
    )
