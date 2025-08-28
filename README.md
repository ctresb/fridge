# The Fridge — Realtime

Shared fridge state with Node.js, Express and Socket.IO. Tracks total clicks and time spent open across all users. State is persisted hourly and on change to `data.json` so restarts don't lose data.

## Run

1. Install dependencies
   - macOS (zsh)
```
npm install
```
2. Start the server
```
npm start
```
3. Open http://localhost:3000 in multiple browsers to test realtime sync.

## Behavior

- Server is the source of truth. It enforces valid transitions: only Open→Close or Close→Open, never open→open or close→close.
- `clicks` counts successful transitions.
- `totalOpenMs` sums milliseconds the fridge stayed open. While open, clients show a live counter based on `openedAt` from the server.
- State is broadcast to all clients on every change and on connect.
- Data persists to `data.json` hourly and shortly after each change; on restart the server loads from that file.

## Dev

Use hot reload while developing:
```
npm run dev
```
