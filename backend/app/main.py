from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes.alert_routes import router as alert_router
from app.api.routes.auth_routes import router as auth_router
from app.api.routes.employee_face_routes import router as employee_face_router
from app.api.routes.employee_routes import router as employee_router
from app.api.routes.fire_routes import router as fire_router
from app.api.routes.fall_routes import router as fall_router
from app.api.routes.health_routes import router as health_router
from app.api.routes.monitoring_routes import router as monitoring_router
from app.api.routes.monitoring_session_routes import router as monitoring_session_router
from app.api.routes.ppe_routes import router as ppe_router
from app.api.routes.regulation_routes import router as regulation_router
from app.api.routes.user_routes import router as user_router
from app.core.config import get_settings
from app.core.database import close_mongo_connection, connect_to_mongo
from app.core.exceptions import AppError

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await connect_to_mongo()
    try:
        yield
    finally:
        await close_mongo_connection()


settings = get_settings()

app = FastAPI(
    title=settings.APP_NAME,
    debug=settings.DEBUG,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    logger.warning("AppError on %s %s: %s", request.method, request.url.path, exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


app.include_router(health_router, prefix="/api", tags=["Health"])
app.include_router(alert_router)
app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])
app.include_router(user_router, prefix="/api/users", tags=["Users"])
app.include_router(regulation_router, prefix="/api/regulations", tags=["Regulations"])
app.include_router(employee_router, prefix="/api/employees", tags=["Employees"])
app.include_router(employee_face_router, prefix="/api/employee-faces", tags=["Employee Faces"])
app.include_router(monitoring_router)
app.include_router(monitoring_session_router)
app.include_router(ppe_router)
app.include_router(fall_router)
app.include_router(fire_router)

app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

