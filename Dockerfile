# Container image for the Floe MCP server (stdio transport).
# Lets Glama's directory (and any MCP client) build + start the server to run
# introspection: https://glama.ai/mcp/servers/Floe-Labs/floe-mcp-server
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# MCP over stdio — the transport Glama uses for introspection. Pass a key via
# FLOE_API_KEY for the full toolset; the keyless tier responds without one.
ENTRYPOINT ["node", "dist/index.js", "--stdio"]
