# Quell MCP Chat

A Python-based chat application that integrates with MCP (Message Control Protocol) and Quell backend services.

## Prerequisites

- Python 3.11 or higher
- pip (Python package manager)

## Getting Started

1. Clone the repository:

```bash
git clone <repository-url>
cd quell_mcp_chat
```

2. Install Dependencies:

```bash
pip install -r requirements.txt
```

3. Configure environment variables:

   - Copy `.env-example` to `.env`
   - Fill in the required environment variables:

     ```
     # Logging configuration
     LOG_LEVEL=info

     # Server configuration
     HOST=localhost
     PORT=9000

     # MCP server configuration
     MCP_SERVER_NAME=your_mcp_server
     MCP_CLIENT_ID=your_client_id | MCP SERVER ID
     MCP_CLIENT_URL=your_mcp_client_url | Clients website URL

     # Quell backend configuration
     QUALL_BE_URL=your_quell_backend_url
     QUALL_BE_MCP_API_KEY=your_api_key
     ```

4. Configure MCP Server:
   Create a configuration file with the following content:

   ```json
   {
     "mcpServers": {
       "quell_assistant": {
         "command": "npx",
         "args": ["mcp-remote", "http://localhost:9000/sse", "--allow-http"]
       }
     }
   }
   ```

5. Start the application:

```bash
python main.py
```

## Environment Variables

- `LOG_LEVEL`: Logging level (debug, info, warn, error)
- `HOST`: Server host address
- `PORT`: Server port number
- `MCP_SERVER_NAME`: Name of the MCP server
- `MCP_CLIENT_ID`: Client ID for MCP authentication
- `MCP_CLIENT_URL`: URL for MCP client connection
- `QUELL_BE_URL`: URL for Quell backend service
- `QUELL_BE_MCP_API_KEY`: API key for Quell backend authentication
