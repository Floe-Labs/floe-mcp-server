import requests
from src.config import Config


class QuellBE:
    def __init__(self):
        self.url = Config.QUELL_BE_URL
        self.api_key = Config.QUELL_BE_MCP_API_KEY
        self.client_id = Config.MCP_CLIENT_ID
        self.headers = {
            "x-mcp-client-id": self.client_id,
            "x-mcp-api-key": self.api_key,
        }

    def get_site_api_capabilities(self, query: str) -> str:
        try:
            response = requests.post(
                f"{self.url}/mcp-server/{self.client_id}/capabilities",
                headers=self.headers,
                json={"query": query},
            )
            response.raise_for_status()
            response_json = response.json()
            return response_json.get("search_results", "No capabilities found")
        except Exception as e:
            return "No capabilities found"
