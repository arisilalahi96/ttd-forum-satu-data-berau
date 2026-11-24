'use strict';

const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const LOCK_TTL_MS = 120_000; // 2 minutes auto-release

class RealtimeHub {
  constructor(server, store) {
    this.store = store;
    this.clients = new Map(); // ws -> { clientId, name, isAlive, connectedAt }
    this.locks = new Map(); // signatoryId -> { clientId, holderName, acquiredAt, expiresAt }

    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => this._handleConnection(ws));

    // Heartbeat & lock expiry cleanup
    this.interval = setInterval(() => {
      const now = Date.now();
      let locksChanged = false;
      for (const [sigId, lock] of this.locks.entries()) {
        if (lock.expiresAt <= now) {
          this.locks.delete(sigId);
          locksChanged = true;
        }
      }
      if (locksChanged) {
        this.broadcastLocks();
      }

      for (const [ws, meta] of this.clients.entries()) {
        if (!meta.isAlive) {
          ws.terminate();
          continue;
        }
        meta.isAlive = false;
        try {
          ws.ping();
        } catch {
          ws.terminate();
        }
      }
    }, 25_000);
  }

  _handleConnection(ws) {
    const clientId = crypto.randomBytes(6).toString('hex');
    const meta = {
      clientId,
      name: 'Peserta',
      isAlive: true,
      connectedAt: Date.now(),
    };
    this.clients.set(ws, meta);

    ws.on('pong', () => {
      meta.isAlive = true;
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      this._handleMessage(ws, meta, msg);
    });

    ws.on('close', () => {
      this._releaseAllByClient(meta.clientId);
      this.clients.delete(ws);
      this.broadcastPresence();
    });

    ws.on('error', () => {
      this._releaseAllByClient(meta.clientId);
      this.clients.delete(ws);
    });

    // Send initial identity, presence, and locks
    this._send(ws, {
      type: 'welcome',
      clientId,
      onlineCount: this.clients.size,
      locks: this.getSerializableLocks(),
    });
    this.broadcastPresence();
  }

  _handleMessage(ws, meta, msg) {
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'hello': {
        if (typeof msg.name === 'string' && msg.name.trim()) {
          meta.name = msg.name.trim().slice(0, 60);
          this.broadcastPresence();
        }
        break;
      }
      case 'lock_acquire': {
        const sigId = String(msg.signatoryId || '');
        if (!sigId) return;
        const existing = this.locks.get(sigId);
        const now = Date.now();
        if (existing && existing.clientId !== meta.clientId && existing.expiresAt > now) {
          this._send(ws, {
            type: 'lock_denied',
            signatoryId: sigId,
            holderName: existing.holderName,
          });
          return;
        }
        // Release any previous lock held by this same client
        this._releaseAllByClient(meta.clientId, false);
        this.locks.set(sigId, {
          clientId: meta.clientId,
          holderName: meta.name || 'Peserta lain',
          acquiredAt: now,
          expiresAt: now + LOCK_TTL_MS,
        });
        this.broadcastLocks();
        break;
      }
      case 'lock_renew': {
        const sigId = String(msg.signatoryId || '');
        const existing = this.locks.get(sigId);
        if (existing && existing.clientId === meta.clientId) {
          existing.expiresAt = Date.now() + LOCK_TTL_MS;
        }
        break;
      }
      case 'lock_release': {
        const sigId = String(msg.signatoryId || '');
        const existing = this.locks.get(sigId);
        if (existing && existing.clientId === meta.clientId) {
          this.locks.delete(sigId);
          this.broadcastLocks();
        }
        break;
      }
      case 'ping': {
        this._send(ws, { type: 'pong', ts: Date.now() });
        break;
      }
      default:
        break;
    }
  }

  _releaseAllByClient(clientId, shouldBroadcast = true) {
    let changed = false;
    for (const [sigId, lock] of this.locks.entries()) {
      if (lock.clientId === clientId) {
        this.locks.delete(sigId);
        changed = true;
      }
    }
    if (changed && shouldBroadcast) {
      this.broadcastLocks();
    }
  }

  releaseLockForSignatory(signatoryId) {
    if (this.locks.delete(signatoryId)) {
      this.broadcastLocks();
    }
  }

  getSerializableLocks() {
    const out = {};
    const now = Date.now();
    for (const [sigId, lock] of this.locks.entries()) {
      if (lock.expiresAt > now) {
        out[sigId] = {
          clientId: lock.clientId,
          holderName: lock.holderName,
          expiresAt: lock.expiresAt,
        };
      }
    }
    return out;
  }

  _send(ws, payload) {
    if (ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        // ignore broken pipe
      }
    }
  }

  broadcast(payload) {
    const serialized = JSON.stringify(payload);
    for (const ws of this.clients.keys()) {
      if (ws.readyState === 1) {
        try {
          ws.send(serialized);
        } catch {
          // ignore
        }
      }
    }
  }

  broadcastPresence() {
    this.broadcast({
      type: 'presence',
      onlineCount: this.clients.size,
    });
  }

  broadcastLocks() {
    this.broadcast({
      type: 'locks',
      locks: this.getSerializableLocks(),
    });
  }

  close() {
    clearInterval(this.interval);
    this.wss.close();
  }
}

module.exports = { RealtimeHub };
