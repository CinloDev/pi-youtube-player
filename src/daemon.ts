import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocket, WebSocketServer } from "ws";
import { CoverArtManager } from "./cover-art.js";
import type { PlayerCommandPacket, UpstreamPacket, YouTubePlayerState } from "./types.js";

const execFileAsync = promisify(execFile);

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
  repeatMode: "NONE",
  shuffle: false,
  isPip: false,
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
  private hyprPipState: {
    active: boolean;
    originalWorkspaceId: number | null;
    windowAddress: string | null;
  } = {
    active: false,
    originalWorkspaceId: null,
    windowAddress: null,
  };

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
          if (packet.action === "TOGGLE_PIP") {
            this.handleHyprlandPipToggle().catch((err) => {
              console.error("[pi-youtube-daemon] Error en Hyprland PiP:", err);
            });
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

  private async runHyprJson<T>(subcmd: string): Promise<T | null> {
    try {
      const { stdout } = await execFileAsync("hyprctl", [subcmd, "-j"], { timeout: 2000 });
      return JSON.parse(stdout) as T;
    } catch {
      return null;
    }
  }

  private async hyprDispatch(luaExpr: string): Promise<void> {
    try {
      await execFileAsync("hyprctl", ["dispatch", luaExpr], { timeout: 2000 });
    } catch {
      // Ignorar si la ventana aún no mapeó
    }
  }

  private findPipWindow(clients: any[]): any | null {
    if (!Array.isArray(clients)) return null;
    // ÚNICAMENTE buscar la ventana nativa de Picture-in-Picture (jamás tocar la ventana del navegador o PWA)
    return (
      clients.find(
        (c) =>
          /Picture.?in.?Picture/i.test(c.title || "") ||
          /Picture.?in.?Picture/i.test(c.initialTitle || "") ||
          /Imagen en imagen/i.test(c.title || "") ||
          /Imagen en imagen/i.test(c.initialTitle || "")
      ) || null
    );
  }

  private async handleHyprlandPipToggle(): Promise<void> {
    const activeWin = await this.runHyprJson<any>("activewindow");
    const monitors = await this.runHyprJson<any[]>("monitors");
    const focusedMon =
      (Array.isArray(monitors) && (monitors.find((m) => m.focused) || monitors[0])) || {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        scale: 1,
        activeWorkspace: { id: 1 },
      };

    const pipW = 384;
    const pipH = 216;
    const scale = focusedMon.scale || 1;
    const monW = Math.round((focusedMon.width || 1920) / scale);
    const targetX = (focusedMon.x || 0) + monW - pipW - 28;
    const targetY = (focusedMon.y || 0) + 52;
    const targetWsId = focusedMon.activeWorkspace?.id || 1;

    // Si Chrome abre la ventana nativa Picture-in-Picture, asegurarnos de traerla al monitor activo donde está trabajando el usuario
    for (const delay of [200, 450, 900, 1500]) {
      await new Promise((r) => setTimeout(r, delay));
      const clients = await this.runHyprJson<any[]>("clients");
      if (!clients) continue;
      const pipWin = this.findPipWindow(clients);
      if (!pipWin) continue;

      const wRef = `address:${pipWin.address}`;
      if (pipWin.workspace?.id !== targetWsId) {
        await this.hyprDispatch(`hl.dsp.window.move({ window = "${wRef}", workspace = "${targetWsId}", follow = false })`);
      }
      if (!pipWin.floating) {
        await this.hyprDispatch(`hl.dsp.window.float({ window = "${wRef}", action = "set" })`);
      }
      await this.hyprDispatch(`hl.dsp.window.resize({ window = "${wRef}", x = ${pipW}, y = ${pipH} })`);
      await this.hyprDispatch(`hl.dsp.window.move({ window = "${wRef}", x = ${targetX}, y = ${targetY} })`);
      if (!pipWin.pinned) {
        await this.hyprDispatch(`hl.dsp.window.pin({ window = "${wRef}" })`);
      }
      if (activeWin?.address && activeWin.address !== pipWin.address) {
        await this.hyprDispatch(`hl.dsp.focus({ window = "address:${activeWin.address}" })`);
      }
      break;
    }
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
