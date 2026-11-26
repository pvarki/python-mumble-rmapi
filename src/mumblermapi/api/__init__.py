"""The integration's HTTP API, one module per router"""

from fastapi import APIRouter

from .admin_channels import router as admin_channels_router
from .admin_templates import router as admin_templates_router
from .admin_users import router as admin_users_router
from .clients import router as clients_router
from .description import router as description_router
from .description import router_v2 as description_router_v2
from .description import router_v2_admin as description_admin_router
from .healthcheck import router as healthcheck_router
from .murmur_agent import router as murmur_agent_router
from .usercrud import router as usercrud_router
from .voice import router as voice_router

all_routers = APIRouter()
all_routers.include_router(usercrud_router, prefix="/users", tags=["users"])
all_routers.include_router(murmur_agent_router, prefix="/agent", tags=["agent"])
all_routers.include_router(admin_channels_router, prefix="/admin", tags=["admin"])
all_routers.include_router(admin_templates_router, prefix="/admin", tags=["admin"])
all_routers.include_router(admin_users_router, prefix="/admin", tags=["admin"])
all_routers.include_router(voice_router, prefix="/voice", tags=["voice"])
all_routers.include_router(healthcheck_router, prefix="/healthcheck", tags=["healthcheck"])
all_routers.include_router(description_router, prefix="/description", tags=["description"])

all_routers_v2 = APIRouter()
all_routers_v2.include_router(description_router_v2, prefix="/description", tags=["description"])
all_routers_v2.include_router(description_admin_router, prefix="/admin/description", tags=["description"])
all_routers_v2.include_router(clients_router, prefix="/clients", tags=["clients"])
