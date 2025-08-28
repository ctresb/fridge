// Simple real-time server for The Fridge
// - Serves static files
// - Maintains shared fridge state in memory
// - Persists state to JSON hourly and on changes/exit

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const CLICK_COOLDOWN_MS = Number(process.env.COOLDOWN_MS || 1000);

/** @typedef {{
 *  isOpen: boolean,
 *  clicks: number,
 *  totalOpenMs: number,
 *  openedAt: number | null
 * }} FridgeState
 */

/** @type {FridgeState} */
let state = {
  isOpen: false,
  clicks: 0,
  totalOpenMs: 0,
  openedAt: null,
};

function loadFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        state.isOpen = !!data.isOpen;
        state.clicks = Number.isFinite(data.clicks) ? data.clicks : 0;
        state.totalOpenMs = Number.isFinite(data.totalOpenMs) ? data.totalOpenMs : 0;
        state.openedAt = data.openedAt == null ? null : Number(data.openedAt);
        // If openedAt is not a valid number, reset it
        if (state.openedAt != null && !Number.isFinite(state.openedAt)) state.openedAt = null;
        console.log('[fridge] Loaded state from disk:', state);
      }
    }
  } catch (err) {
    console.warn('[fridge] Failed to load state from disk:', err.message);
  }
}

function saveToDisk() {
  try {
    const out = JSON.stringify(state, null, 2);
    fs.writeFileSync(DATA_FILE, out, 'utf8');
    console.log('[fridge] State saved to', DATA_FILE);
  } catch (err) {
    console.warn('[fridge] Failed to save state:', err.message);
  }
}

function publicState() {
  // Shallow clone to avoid accidental mutation outside
  return {
    isOpen: state.isOpen,
    clicks: state.clicks,
    totalOpenMs: state.totalOpenMs,
    openedAt: state.openedAt,
  };
}

function broadcastState() {
  io.emit('state', publicState());
}

function openFridge() {
  if (state.isOpen) return false; // invalid: already open
  state.isOpen = true;
  state.openedAt = Date.now();
  state.clicks += 1; // count successful transitions
  broadcastState();
  saveSoon();
  return true;
}

function closeFridge() {
  if (!state.isOpen) return false; // invalid: already closed
  if (state.openedAt) {
    state.totalOpenMs += (Date.now() - state.openedAt);
  }
  state.isOpen = false;
  state.openedAt = null;
  state.clicks += 1; // count successful transitions
  broadcastState();
  saveSoon();
  return true;
}

// Debounced immediate save on changes to avoid excessive writes
let saveTimer = null;
function saveSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveToDisk();
  }, 500);
}

// Load initial state
loadFromDisk();

// Serve static assets (HTML, images, audio)
app.use(express.static(__dirname, { extensions: ['html'] }));

// Optional: simple state endpoint
app.get('/api/state', (_req, res) => {
  res.json(publicState());
});

io.on('connection', (socket) => {
  console.log('[fridge] client connected', socket.id);
  // Send current state to the new client
  socket.emit('state', publicState());

  // simple per-socket cooldown
  function checkCooldown() {
    const now = Date.now();
    const last = socket.data.lastRequestAt || 0;
    const elapsed = now - last;
    const remaining = CLICK_COOLDOWN_MS - elapsed;
    if (remaining > 0) {
      return remaining;
    }
    socket.data.lastRequestAt = now;
    return 0;
  }

  // Client requests to toggle
  socket.on('requestToggle', () => {
    const remaining = checkCooldown();
    if (remaining > 0) {
      socket.emit('actionRejected', { reason: 'cooldown', retryAfter: remaining });
      return;
    }
    if (state.isOpen) {
      const ok = closeFridge();
      if (!ok) socket.emit('actionRejected', { reason: 'already-closed' });
    } else {
      const ok = openFridge();
      if (!ok) socket.emit('actionRejected', { reason: 'already-open' });
    }
  });

  // Explicit open/close APIs if the client wants to be explicit
  socket.on('requestOpen', () => {
    const remaining = checkCooldown();
    if (remaining > 0) {
      socket.emit('actionRejected', { reason: 'cooldown', retryAfter: remaining });
      return;
    }
    const ok = openFridge();
    if (!ok) socket.emit('actionRejected', { reason: 'already-open' });
  });
  socket.on('requestClose', () => {
    const remaining = checkCooldown();
    if (remaining > 0) {
      socket.emit('actionRejected', { reason: 'cooldown', retryAfter: remaining });
      return;
    }
    const ok = closeFridge();
    if (!ok) socket.emit('actionRejected', { reason: 'already-closed' });
  });

  socket.on('disconnect', () => {
    console.log('[fridge] client disconnected', socket.id);
  });
});

// Hourly persistence
setInterval(() => {
  saveToDisk();
}, 60 * 60 * 1000); // every 1 hour

// Persist cleanly on exit
const shutdown = (sig) => {
  console.log(`\n[fridge] Caught ${sig}, persisting state...`);
  try { saveToDisk(); } catch (_) {}
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(PORT, () => {
  console.log(`[fridge] Server listening on http://localhost:${PORT}`);
});
