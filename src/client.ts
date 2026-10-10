import { WebSocket } from "ws";
import { YouTubePlayerService } from "./player-service.js";
import type { PlayerCommandPacket, UpstreamPacket } from "./types.js";

export const DEFAULT_WS_URL = "ws://127.0.0.1:7788";

export class YouTubePlayerClient {
  private wsUrl: string;
  private socket: WebSocket | null = null;
  private isConnecting = false;
  private service: YouTubePlayerService;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(wsUrl = DEFAULT_WS_URL) {
    this.wsUrl = wsUrl;
    this.service = YouTubePlayerService.getInstance();

    // Registrar el despachador de comandos del servicio para enviarlos por este socket al daemon
    this.service.registerCommandSender((packet) => this.sendCommand(packet));
  }

  public connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;

    try {
      this.socket = new WebSocket(this.wsUrl);

      this.socket.on("open", () => {
        this.isConnecting = false;
        // Anunciar que una terminal de Pi se conectó
        this.socket?.send(
          JSON.stringify({
            type: "CLIENT_CONNECTED",
            client: `Pi Terminal (PID ${process.pid})`,
            timestamp: Date.now(),
          })
        );
        this.service.updateClientCount(1);
      });

      this.socket.on("message", (raw: Buffer | string) => {
        try {
          const text = typeof raw === "string" ? raw : raw.toString("utf-8");
          const packet = JSON.parse(text) as UpstreamPacket;
          this.handlePacket(packet);
        } catch {
          // Ignorar mensajes malformados
        }
      });

      this.socket.on("close", () => {
        this.socket = null;
        this.isConnecting = false;
        this.service.updateClientCount(0);
        this.scheduleReconnect();
      });

      this.socket.on("error", () => {
        if (this.socket) {
          this.socket.terminate();
          this.socket = null;
        }
        this.isConnecting = false;
        this.service.updateClientCount(0);
        this.scheduleReconnect();
      });
    } catch {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private handlePacket(packet: UpstreamPacket): void {
    if (!packet || typeof packet.type !== "string") return;

    if (packet.type === "PLAYER_STATE" && packet.data) {
      this.service.updateState(packet.data);
    } else if (packet.type === "CLIENT_CONNECTED") {
      if (this.service.getState().status === "disconnected") {
        this.service.updateState({ status: "idle" });
      }
    }
  }

  public sendCommand(packet: PlayerCommandPacket): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(packet));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.terminate();
      this.socket = null;
    }
    this.service.updateClientCount(0);
  }
}
