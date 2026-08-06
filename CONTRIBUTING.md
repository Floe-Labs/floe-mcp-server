# Contributing to @floelabs/mcp-server

Thanks for your interest in contributing to Floe's MCP server.

## Getting Started

```bash
git clone https://github.com/Floe-Labs/floe-mcp-server.git
cd floe-mcp-server
npm install
npm run build
```

## Development

```bash
npm run dev        # Watch mode with tsx
npm run build      # Build with tsup
npm run typecheck  # Type check
npm start          # Run built server
```

## Testing with MCP Inspector

```bash
export FLOE_API_KEY=your_api_key_here
npx @modelcontextprotocol/inspector node dist/index.js
```

## Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added tools, document them in the README
3. Ensure `npm run build` and `npm run typecheck` pass
4. Write a clear PR description explaining the change

## Code Style

- TypeScript strict mode
- Zod schemas for all tool inputs
- Descriptive tool names and descriptions (agents read them)

## Reporting Bugs

Open a GitHub issue with:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and MCP client used

## Security Issues

See [SECURITY.md](SECURITY.md) — do **not** open a public issue for security vulnerabilities.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
