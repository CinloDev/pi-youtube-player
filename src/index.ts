import { YouTubePlayerService } from "./player-service.js";
import { DEFAULT_HOST, DEFAULT_PORT, YouTubeWebSocketServer } from "./server.js";
import { type YouTubePlayerState, YOUTUBE_PLAYER_SYMBOL } from "./types.js";

// Re-exportar contratos para consumidores
export * from "./player-service.js";
export * from "./server.js";
export * from "./types.js";

/**
 * Formatea segundos a string mm:ss (ej: 75 -> 01:15)
 */
function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Retorna el status one-liner minimalista acordado
 * Ejemplo: ▶ The Weeknd - Starboy (01:15/03:40) [Vol: 80%]
 */
function formatStatusOneLiner(state: YouTubePlayerState): string {
  if (state.status === "disconnected" || state.connectedClients === 0) {
    return "⏸ YouTube Music: Desconectado (abrí music.youtube.com en Chrome)";
  }

  const icon = state.status === "playing" ? "▶" : "⏸";
  const time = `${formatTime(state.currentTime)}/${formatTime(state.duration)}`;
  const vol = Math.round(state.volume * 100);

  return `${icon} ${state.artist} - ${state.title} (${time}) [Vol: ${vol}%]`;
}

/**
 * Instancia singleton global del servidor WebSocket
 */
let globalServer: YouTubeWebSocketServer | null = null;

/**
 * Entrypoint principal de la extensión para Pi
 */
export default function activate(pi: any): void {
  const service = YouTubePlayerService.getInstance();

  // Iniciar el servidor WebSocket de fondo si aún no fue instanciado
  if (!globalServer) {
    globalServer = new YouTubeWebSocketServer(DEFAULT_PORT, DEFAULT_HOST);
    globalServer.start().catch((err) => {
      if (pi?.ui?.notify) {
        pi.ui.notify(`[yt-player] Error iniciando socket: ${err.message}`, "error");
      }
    });
  }

  // Si Pi soporta registrar comandos slash:
  if (pi?.registerCommand) {
    pi.registerCommand({
      name: "yt",
      description: "Controla YouTube Music (/yt [play|pause|next|prev|vol|status|queue])",
      execute: async (args: string[]) => {
        const sub = (args[0] || "").toLowerCase().trim();
        const state = service.getState();

        if (state.connectedClients === 0 && sub !== "status") {
          return "⚠️ YouTube Music no está conectado. Abrí music.youtube.com con la extensión cargada en Chrome.";
        }

        switch (sub) {
          case "":
          case "play":
          case "pause":
          case "toggle": {
            service.togglePlay();
            return formatStatusOneLiner(service.getState());
          }

          case "next":
          case "skip": {
            service.next();
            return `⏭ Siguiente tema | ${formatStatusOneLiner(service.getState())}`;
          }

          case "prev":
          case "back": {
            service.previous();
            return `⏮ Tema anterior | ${formatStatusOneLiner(service.getState())}`;
          }

          case "status": {
            return formatStatusOneLiner(state);
          }

          case "mute": {
            service.toggleMute();
            return "🔇 Volumen muteado / restaurado";
          }

          case "vol":
          case "volume": {
            const rawVal = args[1];
            if (!rawVal) {
              return `🔊 Volumen actual: ${Math.round(state.volume * 100)}%`;
            }

            let newVol = Math.round(state.volume * 100);
            if (rawVal.startsWith("+")) {
              newVol += parseInt(rawVal.slice(1), 10) || 10;
            } else if (rawVal.startsWith("-")) {
              newVol -= parseInt(rawVal.slice(1), 10) || 10;
            } else {
              newVol = parseInt(rawVal, 10);
            }

            service.setVolume(newVol);
            return `🔊 Volumen ajustado a ${Math.max(0, Math.min(100, newVol))}%`;
          }

          case "queue": {
            if (!state.queue || state.queue.length === 0) {
              return "📜 La cola de reproducción está vacía.";
            }

            const lines = state.queue.slice(0, 10).map((t, i) => {
              const dur = t.duration ? ` (${t.duration})` : "";
              return `  ${(i + 1).toString().padStart(2, "0")}. ${t.artist} - ${t.title}${dur}`;
            });

            return [`📜 Próximos temas en cola:`, ...lines].join("\n");
          }

          default: {
            // Si pasan un número directo, intentar saltar a ese track de la cola
            const targetIndex = parseInt(sub, 10);
            if (!isNaN(targetIndex) && targetIndex > 0) {
              service.playQueueIndex(targetIndex - 1);
              return `▶ Saltando al tema #${targetIndex} de la cola...`;
            }

            return "Uso: /yt [play | pause | next | prev | vol <0-100> | status | queue | <número>]";
          }
        }
      },
    });
  }
}
