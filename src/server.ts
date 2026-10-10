import { WebSocket, WebSocketServer } from "ws";
import { YouTubePlayerService } from "./player-service.js";
import type { PlayerCommandPacket, UpstreamPacket } from "./types.js";

export const DEFAULT_PORT = 7788;
export const DEFAULT_HOST = "127.0.0.1";

export class YouTubeWebSocketServer {
  private wss: WebSocketServer | null = null;
  private service: YouTubePlayerService;
  private port: number;
  private host: string;
  private activeSockets: Set<WebSocket> = new Set();

  constructor(port = DEFAULT_PORT, host = DEFAULT_HOST) {
    this.port = port;
    this.host = host;
    this.service = YouTubePlayerService.getInstance();

    // Conectar el despachador de comandos del servicio hacia los websockets abiertos
    this.service.registerCommandSender((packet) => this.broadcast(packet));
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port: this.port,
          host: this.host,
        });

        this.wss.on("listening", () => {
          resolve();
        });

        this.wss.on("error", (err: Error) => {
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
    this.activeSockets.add(socket);
    this.service.updateClientCount(this.activeSockets.size);

    socket.on("message", (rawMessage: Buffer | string) => {
      try {
        const text = typeof rawMessage === "string" ? rawMessage : rawMessage.toString("utf-8");
        const packet = JSON.parse(text) as UpstreamPacket;
        this.handleUpstreamPacket(packet);
      } catch {
        // Ignorar paquetes malformados silenciosamente
      }
    });

    socket.on("close", () => {
      this.activeSockets.delete(socket);
      this.service.updateClientCount(this.activeSockets.size);
    });

    socket.on("error", () => {
      this.activeSockets.delete(socket);
      this.service.updateClientCount(this.activeSockets.size);
    });
  }

  private handleUpstreamPacket(packet: UpstreamPacket): void {
    if (!packet || typeof packet.type !== "string") {
      return;
    }

    switch (packet.type) {
      case "CLIENT_CONNECTED": {
        // El cliente anuncia su conexión; podemos forzar estado idle si aún no hay tema
        if (this.service.getState().status === "disconnected") {
          this.service.updateState({ status: "idle" });
        }
        break;
      }
      case "PLAYER_STATE": {
        if (packet.data) {
          this.service.updateState(packet.data);
        }
        break;
      }
      case "HEARTBEAT": {
        // Keep-alive silencioso
        break;
      }
    }
  }

  public broadcast(packet: PlayerCommandPacket): void {
    const payload = JSON.stringify(packet);
    for (const socket of this.activeSockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }

      for (const socket of this.activeSockets) {
        socket.terminate();
      }
      this.activeSockets.clear();
      this.service.updateClientCount(0);

      this.wss.close(() => {
        this.wss = null;
        resolve();
      });
    });
  }
}
