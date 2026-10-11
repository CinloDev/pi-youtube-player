import { WebSocket, WebSocketServer } from "ws";
import { CoverArtManager } from "./cover-art.js";
import type { PlayerCommandPacket, UpstreamPacket, YouTubePlayerState } from "./types.js";

export const DEFAULT_PORT = 7788;
export const DEFAULT_HOST = "127.0.0.1";

const INITIAL_STATE: YouTubePlayerState = {
  status: "disconnected",
  title: "Sin reproducción",
  artist: "YouTube Music",
  album: "",
  currentTime: 0,
  duration: 0,
  volume: 1.0,
  isLiked: false,
  thumbnailUrl: "",
  queue: [],
  connectedClients: 0,
  lastUpdated: Date.now(),
};

export class YouTubeDaemon {
  private wss: WebSocketServer | null = null;
  private port: number;
  private host: string;
  private sockets: Set<WebSocket> = new Set();
  private lastState: YouTubePlayerState = { ...INITIAL_STATE };
  private browserSocket: WebSocket | null = null;
  private coverArtManager = new CoverArtManager();

  constructor(port = DEFAULT_PORT, host = DEFAULT_HOST) {
    this.port = port;
    this.host = host;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port: this.port,
          host: this.host,
        });

        this.wss.on("listening", () => {
          console.log(`[pi-youtube-daemon] Escuchando en ws://${this.host}:${this.port}`);
          resolve();
        });

        this.wss.on("error", (err: Error) => {
          console.error("[pi-youtube-daemon] Error en WebSocketServer:", err.message);
          reject(err);
        });

        this.wss.on("connection", (socket: WebSocket) => {
          this.handleConnection(socket);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleConnection(socket: WebSocket): void {
    this.sockets.add(socket);

    // Enviar inmediatamente el último estado conocido al cliente recién conectado
    if (this.lastState.status !== "disconnected") {
      const initPacket: UpstreamPacket = {
        type: "PLAYER_STATE",
        data: {
          ...this.lastState,
          connectedClients: this.browserSocket ? 1 : 0,
        },
        timestamp: Date.now(),
      };
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(initPacket));
      }
    }

    socket.on("message", (raw: Buffer | string) => {
      try {
        const text = typeof raw === "string" ? raw : raw.toString("utf-8");
        const packet = JSON.parse(text);

        if (!packet || typeof packet.type !== "string") return;

        // Caso 1: Mensaje proveniente de Chrome o de Pi
        if (packet.type === "CLIENT_CONNECTED") {
          // Si es Chrome, marcar como browserSocket
          this.browserSocket = socket;
          console.log(`[pi-youtube-daemon] Cliente conectado: ${packet.client || "Desconocido"}`);
          if (this.lastState.status === "disconnected") {
            this.lastState.status = "idle";
          }
          this.broadcast(packet, socket);
        } else if (packet.type === "PLAYER_STATE") {
          // Actualización de estado (proviene de Chrome)
          this.browserSocket = socket;
          const previousThumbUrl = this.lastState.thumbnailUrl;
          this.lastState = {
            ...this.lastState,
            ...packet.data,
            connectedClients: 1,
            lastUpdated: Date.now(),
          };

          // Si vino una portada y cambió, gestionar descarga asíncrona centralizada
          if (packet.data?.thumbnailUrl && packet.data.thumbnailUrl !== previousThumbUrl) {
            this.coverArtManager
              .getCoverArt(packet.data.thumbnailUrl)
              .then((cover) => {
                if (cover) {
                  this.lastState.thumbnailPath = cover.path;
                  this.lastState.thumbnailBase64 = cover.base64;
                  this.broadcast({
                    type: "PLAYER_STATE",
                    data: {
                      ...this.lastState,
                      connectedClients: 1,
                    },
                    timestamp: Date.now(),
                  });
                }
              })
              .catch(() => {});
          }

          // Reenviar a todas las terminales de Pi
          this.broadcast({
            ...packet,
            data: {
              ...this.lastState,
              connectedClients: 1,
            },
          });
        } else if (packet.type === "COMMAND") {
          // Comando enviado desde cualquier terminal de Pi
          console.log(`[pi-youtube-daemon] Comando recibido: ${packet.action}`);
          // Reenviar a Chrome y a los demás clientes
          this.broadcast(packet, socket);
          // Si tenemos referencia directa a Chrome, asegurar envío
          if (this.browserSocket && this.browserSocket.readyState === WebSocket.OPEN && this.browserSocket !== socket) {
            this.browserSocket.send(JSON.stringify(packet));
          }
        } else if (packet.type === "HEARTBEAT") {
          // Keep-alive silencioso
        }
      } catch {
        // Ignorar paquetes malformados
      }
    });

    socket.on("close", () => {
      this.sockets.delete(socket);
      if (this.browserSocket === socket) {
        this.browserSocket = null;
        console.log("[pi-youtube-daemon] Navegador desconectado.");
        this.lastState.status = "disconnected";
        this.broadcast({
          type: "PLAYER_STATE",
          data: { status: "disconnected" },
          timestamp: Date.now(),
        });
      }
    });

    socket.on("error", () => {
      this.sockets.delete(socket);
      if (this.browserSocket === socket) {
        this.browserSocket = null;
      }
    });
  }

  public broadcast(packet: unknown, sender?: WebSocket): void {
    const payload = JSON.stringify(packet);
    for (const socket of this.sockets) {
      if (socket !== sender && socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) return resolve();
      for (const socket of this.sockets) socket.terminate();
      this.sockets.clear();
      this.wss.close(() => resolve());
    });
  }
}

// Si se ejecuta directamente como script de Node.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const daemon = new YouTubeDaemon();
  daemon.start().catch((err) => {
    console.error("[pi-youtube-daemon] Error fatal:", err);
    process.exit(1);
  });

  process.on("SIGINT", async () => {
    console.log("\n[pi-youtube-daemon] Deteniendo servicio...");
    await daemon.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await daemon.stop();
    process.exit(0);
  });
}
