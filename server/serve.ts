// The HTTP + WebSocket server: serves the client from a folder and the game over a WebSocket
// at /ws. Used by the standalone server (server/main.ts) and by the desktop app, which runs
// it on this computer only. All game logic lives in server/core.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { GameMap } from '../shared/map.ts';
import type { ServerMessage } from '../shared/protocol.ts';
import { TICK_MS } from '../shared/rules.ts';
import { GuestAuth } from './adapters/memory.ts';
import { GameServer } from './core/game-server.ts';
import type { ConnId } from './core/ports.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
/** Messages per second a client may send before being disconnected. */
const MAX_MSGS_PER_SEC = 60;
// Messages are small, except a save file being loaded (checked per message below).
const MAX_MESSAGE = 32 * 1024;
/** Open sockets per address: generous (players behind one proxy share an address), but one
 * script can't open hundreds. */
const MAX_SOCKETS_PER_IP = 32;

export interface ServeOptions {
  /** 0 picks a free port. */
  port: number;
  host: string;
  /** The folder with index.html, app.js and maps/. */
  publicDir: string;
  /** Snapshots every this many ticks (the shared default when unset). */
  snapshotEvery?: number;
  log?: (msg: string) => void;
}

export interface Served {
  port: number;
  game: GameServer;
  close(): Promise<void>;
}

export function startServer(opts: ServeOptions): Promise<Served> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const publicDir = opts.publicDir.endsWith(sep) ? opts.publicDir : opts.publicDir + sep;

  const maps = new Map<string, GameMap>();
  for (const f of readdirSync(join(publicDir, 'maps')).filter((f) => f.endsWith('.json'))) {
    const map: GameMap = JSON.parse(readFileSync(join(publicDir, 'maps', f), 'utf8'));
    maps.set(map.id, map);
  }

  const sockets = new Map<ConnId, WebSocket>();
  const game = new GameServer({
    transport: {
      send(conn: ConnId, msg: ServerMessage) {
        const ws = sockets.get(conn);
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      },
    },
    auth: new GuestAuth(),
    clock: { now: () => Date.now() },
    maps,
    snapshotEvery: opts.snapshotEvery,
    log,
  });

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    try {
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = normalize(join(publicDir, rel));
      if (!file.startsWith(publicDir)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    }
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 2_100_000, perMessageDeflate: { threshold: 1024 } });
  const alive = new WeakSet<WebSocket>();
  const perIp = new Map<string, number>();
  wss.on('error', (e) => log(`websocket server error ${e}`));

  wss.on('connection', (ws, req) => {
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?').split(',')[0].trim();
    if ((perIp.get(ip) ?? 0) >= MAX_SOCKETS_PER_IP) {
      ws.close(1008, 'too many connections');
      return;
    }
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    // A bad frame (too big, malformed) ends that connection only, never the server.
    ws.on('error', () => ws.terminate());
    const conn = randomUUID();
    sockets.set(conn, ws);
    alive.add(ws);
    game.handleConnect(conn);

    let windowStart = Date.now();
    let count = 0;
    ws.on('pong', () => alive.add(ws));
    ws.on('message', (data) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > MAX_MSGS_PER_SEC) {
        ws.close(1008, 'rate limit');
        return;
      }
      const text = data.toString();
      if (text.length > MAX_MESSAGE && !text.startsWith('{"t":"lobby.load"')) {
        ws.close(1009, 'message too big');
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return;
      }
      game.handleMessage(conn, raw).catch((e) => log(`handleMessage failed ${e?.stack ?? e}`));
    });
    ws.on('close', () => {
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
      sockets.delete(conn);
      game.handleDisconnect(conn);
    });
  });

  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, 15_000);
  const ticker = setInterval(() => game.tick(), TICK_MS);

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port, opts.host, () => {
      resolve({
        port: (http.address() as AddressInfo).port,
        game,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(pinger);
            clearInterval(ticker);
            for (const ws of wss.clients) ws.terminate();
            wss.close();
            http.close(() => done());
          }),
      });
    });
  });
}
