import os
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


class Config:
    PROJECT_NAME: str = "MCP Server"
    PROJECT_VERSION: str = "0.0.1"

    LOG_LEVEL: str = os.environ["LOG_LEVEL"]

    HOST: str = os.environ["HOST"]
    PORT: int = int(os.environ["PORT"])

    MCP_SERVER_NAME: str = os.environ["MCP_SERVER_NAME"]
    MCP_SERVER_VERSION: str = "0.0.1"

    MCP_CLIENT_ID: str = os.environ["MCP_CLIENT_ID"]
    MCP_CLIENT_URL: str = os.environ["MCP_CLIENT_URL"]

    # ===================================== API Key Authentication =============================================
    MCP_AUTH_API_KEY: str = os.environ["MCP_AUTH_API_KEY"]
    # ===================================== API Key Authentication =============================================

    ##############################################################################################
    # Basic Config is done here, now onwards we will add more config for different domains.
    ##############################################################################################

    # ===================================== Quell BE =============================================
    QUELL_BE_URL: str = os.environ["QUELL_BE_URL"]
    QUELL_BE_MCP_API_KEY: str = os.environ["QUELL_BE_MCP_API_KEY"]
    # ===================================== Quell BE =============================================
