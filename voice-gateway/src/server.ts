import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { NonceStore } from "./crypto.js";
import { consoleLogger, type Logger } from "./log.js";
import { CallSession, type SessionDeps } from "./session.js";

/** On SIGTERM, wait this long for live calls to finish (Fly kill_timeout must be longer). */
export const DRAIN_MS = 280_000;

export interface GatewayConfig {
  appUrl: string;
  secret: string;
  port: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const secret = env.VOICE_GATEWAY_SECRET;
  if (!secret) throw new Error("VOICE_GATEWAY_SECRET is required; refusing to start");
  const appUrl = env.APP_URL;
  if (!appUrl) throw new Error("APP_URL is required; refusing to start");
  return { appUrl, secret, port: Number(env.PORT ?? 8080) };
}

export function createGateway(
  cfg: GatewayConfig,
  extra: Partial<
    Pick<SessionDeps, "fetchImpl" | "now" | "log" | "firstByteTimeoutMs" | "totalTimeoutMs" | "idleMs" | "charsPerSec">
  > = {},
): {
  server: Server;
  listen: (port?: number) => Promise<number>;
  close: () => Promise<void>;
  drain: (maxMs?: number) => Promise<void>;
  activeCalls: () => number;
} {
  if (!cfg.secret) throw new Error("VOICE_GATEWAY_SECRET is required; refusing to start");
  const log: Logger = extra.log ?? consoleLogger;
  const nonces = new NonceStore();
  let draining = false;
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      // Draining: fail the check so the platform routes new calls elsewhere.
      res.writeHead(draining ? 503 : 200, { "content-type": "application/json" });
      res.end(draining ? '{"ok":false,"draining":true}' : '{"ok":true}');
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== "/relay") {
      socket.destroy();
      return;
    }
    if (draining) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const session = new CallSession(ws, { appUrl: cfg.appUrl, secret: cfg.secret, log, nonces, ...extra });
      // No setup (hence no valid ticket) within 10 s: drop.
      const setupTimer = setTimeout(() => ws.close(1008, "no setup"), 10_000);
      ws.on("message", (d) => {
        clearTimeout(setupTimer);
        session.onMessage(d.toString());
      });
      ws.on("close", () => {
        clearTimeout(setupTimer);
        void session.onClose();
      });
      ws.on("error", () => {});
    });
  });
  return {
    server,
    listen: (port = cfg.port) =>
      new Promise((resolve) => {
        server.listen(port, () => {
          const a = server.address();
          resolve(typeof a === "object" && a ? a.port : port);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => resolve());
      }),
    // Stop taking calls, let the live ones finish (a deploy must not hang up on anyone).
    drain: async (maxMs = DRAIN_MS) => {
      draining = true;
      log("draining", { activeCalls: wss.clients.size });
      const until = Date.now() + maxMs;
      while (wss.clients.size > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
    },
    activeCalls: () => wss.clients.size,
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  try {
    const cfg = loadConfig();
    const gw = createGateway(cfg);
    void gw.listen().then((p) => consoleLogger("listening", { port: p }));
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void gw
        .drain()
        .then(() => gw.close())
        .then(() => process.exit(0));
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
