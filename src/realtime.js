'use strict';

const { WebSocketServer } = require('ws');

class RealtimeHub {
  constructor(server) {
    this.clients = new Map(); // ws -> { isAlive }
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => this._handleConnection(ws));

    this.interval = setInterval(() => {
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
    const meta = { isAlive: true };
    this.clients.set(ws, meta);

    ws.on('pong', () => {
      meta.isAlive = true;
    });

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    ws.on('error', () => {
      this.clients.delete(ws);
    });
  }

  broadcast(payload) {
    const serialized = JSON.stringify(payload);
    for (const ws of this.clients.keys()) {
      if (ws.readyState === 1) {
        try {
          ws.send(serialized);
        } catch {
          // ignore closed socket
        }
      }
    }
  }

  close() {
    clearInterval(this.interval);
    this.wss.close();
  }
}

module.exports = { RealtimeHub };
