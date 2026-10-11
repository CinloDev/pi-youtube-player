import { YouTubePlayerClient } from "./client.js";
import { YouTubePlayerService } from "./player-service.js";
import { type YouTubePlayerState, YOUTUBE_PLAYER_SYMBOL } from "./types.js";

// Re-exportar contratos para consumidores
export * from "./client.js";
export * from "./cover-art.js";
export { YouTubeDaemon } from "./daemon.js";
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
 * Instancia singleton global del cliente WebSocket en este proceso de Pi
 */
let globalClient: YouTubePlayerClient | null = null;

/**
 * Entrypoint principal de la extensión para Pi
 */
export default function activate(pi: any): void {
  const service = YouTubePlayerService.getInstance();

  // Cada terminal de Pi se conecta como cliente WebSocket ligero al daemon centralizado
  if (!globalClient) {
    globalClient = new YouTubePlayerClient();
    globalClient.connect();
  }

  // Registrar comando slash /yt con la API nativa de Pi
  if (pi?.registerCommand) {
    pi.registerCommand("yt", {
      description: "Controla YouTube Music (/yt [play|pause|next|prev|vol|status|queue])",
      handler: async (args: string, ctx: any) => {
        const parts = (args || "").trim().split(/\s+/).filter(Boolean);
        const sub = (parts[0] || "").toLowerCase();
        const state = service.getState();

        const reply = (msg: string) => {
          if (ctx?.ui?.notify) {
            ctx.ui.notify(msg, "info");
          }
          return msg;
        };

        if (state.connectedClients === 0 && sub !== "status") {
          return reply("⚠️ YouTube Music no está conectado. Abrí music.youtube.com con la extensión cargada en Chrome.");
        }

        switch (sub) {
          case "":
          case "play":
          case "pause":
          case "toggle": {
            service.togglePlay();
            return reply(formatStatusOneLiner(service.getState()));
          }

          case "next":
          case "skip": {
            service.next();
            return reply(`⏭ Siguiente tema | ${formatStatusOneLiner(service.getState())}`);
          }

          case "prev":
          case "back": {
            service.previous();
            return reply(`⏮ Tema anterior | ${formatStatusOneLiner(service.getState())}`);
          }

          case "status": {
            return reply(formatStatusOneLiner(state));
          }

          case "mute": {
            service.toggleMute();
            return reply("🔇 Volumen muteado / restaurado");
          }

          case "vol":
          case "volume": {
            const rawVal = parts[1];
            if (!rawVal) {
              return reply(`🔊 Volumen actual: ${Math.round(state.volume * 100)}%`);
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
            return reply(`🔊 Volumen ajustado a ${Math.max(0, Math.min(100, newVol))}%`);
          }

          case "queue": {
            if (!state.queue || state.queue.length === 0) {
              return reply("📜 La cola de reproducción está vacía.");
            }

            const lines = state.queue.slice(0, 15).map((t, i) => {
              const dur = t.duration ? ` (${t.duration})` : "";
              return `  ${(i + 1).toString().padStart(2, "0")}. ${t.artist} - ${t.title}${dur}`;
            });

            return reply([`📜 Próximos temas en cola:`, ...lines].join("\n"));
          }

          default: {
            // Si pasan un número directo, intentar saltar a ese track de la cola
            const targetIndex = parseInt(sub, 10);
            if (!isNaN(targetIndex) && targetIndex > 0) {
              service.playQueueIndex(targetIndex - 1);
              return reply(`▶ Saltando al tema #${targetIndex} de la cola...`);
            }

            return reply("Uso: /yt [play | pause | next | prev | vol <0-100> | status | queue | <número>]");
          }
        }
      },
    });
  }
}
