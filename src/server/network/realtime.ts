/**
 * WebSocket layer for LAN multiplayer — Agent A (feat/core).
 *
 * Foundation status: accepts connections on /ws, validates every inbound message with
 * the shared protocol schema, answers `hello` -> `welcome` and `ping` -> `pong`.
 * Intent relay, authoritative simulation on the host and snapshot broadcast are the
 * multiplayer slice and are NOT implemented yet (the server replies `error`).
 */
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL_VERSION, decodeClientMessage, encodeMessage, type ServerMessage } from '../../shared/protocol';
import { randomId } from '../../shared/ids';

export interface RealtimeHandle {
  clientCount(): number;
  close(): Promise<void>;
}

interface ClientRecord {
  socket: WebSocket;
  playerId: string | null;
  isHost: boolean;
}

export function attachRealtime(server: Server, options: { path?: string; log?: (m: string) => void } = {}): RealtimeHandle {
  const path = options.path ?? '/ws';
  const log = options.log ?? ((m: string) => console.log(`[realtime] ${m}`));
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientRecord>();

  const send = (socket: WebSocket, message: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(encodeMessage(message));
  };

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== path) {
      // Not ours (e.g. Vite HMR when proxied). Let other handlers or the default close it.
      if (server.listenerCount('upgrade') === 1) socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (socket: WebSocket) => {
    const record: ClientRecord = { socket, playerId: null, isHost: false };
    clients.add(record);
    log(`client connected (${clients.size} total)`);

    socket.on('message', (data) => {
      const message = decodeClientMessage(typeof data === 'string' ? data : data.toString());
      if (!message) {
        send(socket, { type: 'error', message: 'Invalid message (failed protocol validation).' });
        return;
      }
      switch (message.type) {
        case 'hello': {
          record.playerId = message.playerId ?? randomId('player');
          record.isHost = ![...clients].some((c) => c !== record && c.isHost);
          send(socket, {
            type: 'welcome',
            protocolVersion: PROTOCOL_VERSION,
            playerId: record.playerId,
            serverTimeMs: Date.now(),
            isHost: record.isHost,
          });
          break;
        }
        case 'ping':
          send(socket, { type: 'pong', sentAt: message.sentAt, serverTimeMs: Date.now() });
          break;
        default:
          send(socket, { type: 'error', message: `'${message.type}' is not implemented in the foundation (Agent A, feat/core).` });
      }
    });

    socket.on('close', () => {
      clients.delete(record);
      log(`client disconnected (${clients.size} total)`);
    });
    socket.on('error', (err) => log(`socket error: ${err.message}`));
  });

  return {
    clientCount: () => clients.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of clients) c.socket.close();
        wss.close(() => resolve());
      }),
  };
}
