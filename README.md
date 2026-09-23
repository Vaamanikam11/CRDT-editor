# CRDT Editor

A phased real-time collaborative text editor built with TypeScript, React, Express, Socket.io, and PostgreSQL.

## Phase 0: Project setup

Phase 0 provides the monorepo wiring only:

- `client`: React + Vite + TypeScript browser application
- `server`: Express + TypeScript HTTP server
- `shared`: shared TypeScript contracts
- `docker-compose.yml`: local PostgreSQL service for later persistence work

The client displays the server health status through the Vite development proxy at `/health`.

## Phase 1: Pure sequence CRDT

The shared package now contains an RGA-style `SequenceCrdt` in `shared/src/crdt.ts`:

- Elements use a site ID and logical clock as their unique ID.
- Insert operations reference a predecessor element.
- Concurrent inserts after the same predecessor are ordered deterministically by ID.
- Deletes create tombstones, preserving the structure for later inserts.
- Operations are idempotent and can arrive in any order.

The Vitest suite checks convergence across every delivery permutation in its concurrent-operation scenario.

## Phase 2: WebSocket synchronization

Phase 2 adds an in-memory Socket.io collaboration layer:

- Clients join a document room and receive the current operation log.
- New operations are merged into the server-side CRDT and broadcast to every room member.
- Duplicate operation IDs are ignored by the server.
- Presence events track connected client IDs in each room.
- The client applies the initial log and remote operations through `SequenceCrdt`.

The operation log is intentionally process-local in this phase. PostgreSQL persistence and replay across server restarts arrive in Phase 3.

## Phase 3: Persistence

Phase 3 adds a PostgreSQL operation log and snapshot compaction:

- The server initializes `document_snapshots` and `document_operations` tables on startup.
- A new room loads its snapshot and replays the operations written since that snapshot.
- Accepted operations are persisted before being broadcast to connected clients.
- Every 100 operations by default, the current CRDT state replaces the replay tail in a transaction.
- Tests use the same store contract with an in-memory implementation, so synchronization tests remain deterministic without requiring a running database.

Set `DATABASE_URL` to override the local Docker default. Start PostgreSQL with `docker compose up -d postgres` before running the server.

## Phase 4: Editor UI

Phase 4 adds the first usable editor experience:

- A textarea converts local contiguous edits into CRDT insert/delete operations.
- Remote operations update the rendered document through the same CRDT instance.
- Room presence shows connected collaborators and their cursor positions.
- The client restores persisted snapshots and operation tails before rendering the document.

Offline queuing and reconnect reconciliation remain deferred to Phase 5.

## Phase 5: Resilience

Phase 5 adds reconnect-safe editing:

- Local operations are applied immediately and retained in a pending-operation map while disconnected or before room bootstrap completes.
- The server acknowledges operation IDs only after accepting or deduplicating them.
- On reconnect, the client rebuilds from the server snapshot and operation tail, reapplies pending local operations, and resends them.
- Duplicate resends are harmless because operation IDs are deduplicated by the server and CRDT.

The queue is intentionally memory-backed for this phase. Browser persistence for edits that survive a full page reload can be added alongside the deployment work in Phase 6.

## Phase 6: Production packaging

Phase 6 adds deployment-ready packaging:

- `server/Dockerfile` builds and runs the Node/Express service with production dependencies.
- `client/Dockerfile` builds the Vite app and serves it through nginx.
- nginx proxies `/health` and `/socket.io` to the server so the browser uses one origin in production.
- `docker compose up --build` starts PostgreSQL, the server, and the client at <http://localhost:8080>.
- `.github/workflows/ci.yml` runs formatting, lint, typecheck, tests, and builds on every push and pull request.

The cloud target is intentionally not selected yet. AWS ECS, Render, and Fly.io need different deployment manifests and secrets configuration; choose one before adding provider-specific infrastructure.

### Render

The repository includes `render.yaml` for a Render Blueprint. It creates a private Docker server, a public nginx client, and a managed PostgreSQL database. Deploy it from the Render dashboard by selecting **New > Blueprint**, connecting this repository, and choosing `render.yaml`. Render will provide the database connection string and private server host to the services automatically.

The `starter` service plans and `basic-256mb` database plan are conservative defaults; adjust them in `render.yaml` to match the account and portfolio budget.

## Requirements

- Node.js 18.20 or newer
- npm 10 or newer
- Docker Desktop, for PostgreSQL

## Setup

```sh
npm install
docker compose up -d postgres
```

Start the server and client in separate terminals:

```sh
npm run dev:server
npm run dev:client
```

Open <http://localhost:5173>. The page should report `Server status: ok`.

For the production-shaped local stack, use:

```sh
docker compose up --build
```

Then open <http://localhost:8080>.

## Checks

```sh
npm run typecheck
npm run lint
npm run test
npm run build
npm run format:check
```

PostgreSQL is provisioned by Docker Compose and initialized by the server on startup.
