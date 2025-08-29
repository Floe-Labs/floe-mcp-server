from mcp.server.fastmcp import FastMCP
from src.config import Config


mcp = FastMCP(
    name=Config.MCP_SERVER_NAME,
    debug=True,
    host=Config.HOST,
    port=Config.PORT,
)
