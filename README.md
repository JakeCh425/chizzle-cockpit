# Chizzle Wealth Engine

Mission-control swing-trading cockpit. Single Node 20 + Express server, Vite + React client, shared TypeScript types.

## Quick start

```bash
npm install
npm run dev                # local dev at http://localhost:5000
```

## Production

```bash
npm run build              # builds client → dist/public, server → dist/index.cjs
npm start                  # runs the built server
```

Health check: `curl http://localhost:5000/health`

## Deploy to Render

1. Push to your GitHub repo's `main` branch.
2. In Render dashboard → **New** → **Blueprint** → connect this repo.
3. Render reads `render.yaml`, builds, and starts. Done.

## Structure

```
client/           React + Vite app (entry: client/index.html → src/main.tsx)
server/           Express server (entry: server/index.ts)
shared/           Cross-cutting types and schemas
scripts/          One-off node scripts (migrate, smoke-test, rebuild)
dist/             Build output (gitignored)
  ├── public/     Built client (Vite output)
  └── index.cjs   Bundled server (esbuild output)
```

## Notes

- **Low-Credit Mode** is on by default — no polling, no background schedulers. Refresh modules manually from the UI.
- **SQLite** (`data.db`) lives at repo root. On Render's free tier the filesystem is ephemeral; for persistence either upgrade to a paid tier with a Render Disk, or migrate to Render Postgres (the `pg` driver is already in deps).
