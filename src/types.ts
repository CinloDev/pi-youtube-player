/**
 * Estados de reproducción posibles del reproductor de YouTube Music
 */
export type PlayerPlaybackStatus = "playing" | "paused" | "stopped" | "idle" | "disconnected";

/**
 * Representa un tema en la cola de reproducción (Up Next)
 */
export interface QueueTrack {
  index: number;
  title: string;
  artist: string;
  duration?: string; // Formato "03:45"
  thumbnailUrl?: string;
  isCurrent?: boolean; // Si es el tema en reproducción activa
}

/**
 * Modos de repetición soportados por YouTube Music
 */
export type RepeatMode = "NONE" | "ALL" | "ONE";

export type PlatformSource = "youtube" | "music";

/**
 * Estado completo del reproductor de YouTube / YouTube Music
 */
export interface YouTubePlayerState {
  status: PlayerPlaybackStatus;
  platform?: PlatformSource;
  title: string;
  artist: string;
  album?: string;
  currentTime: number; // Segundos actuales
  duration: number; // Duración total en segundos
  volume: number; // 0.0 a 1.0 (o 0 a 100 según porcentaje)
  repeatMode?: RepeatMode;
  shuffle?: boolean;
  isPip?: boolean;
  isLiked?: boolean;
  thumbnailUrl?: string;
  thumbnailPath?: string; // Ruta local al archivo de portada en disco (/tmp) para renderizado en TUI/Kitty
  thumbnailBase64?: string; // Portada en base64 para renderizado inmediato en TUI sin I/O continuo
  queue: QueueTrack[];
  connectedClients: number;
  lastUpdated: number;
}

/**
 * Acciones soportadas por el protocolo de comandos
 */
export type PlayerCommandAction =
  | "PLAY"
  | "PAUSE"
  | "PLAY_PAUSE"
  | "NEXT"
  | "PREV"
  | "SET_VOLUME"
  | "MUTE"
  | "SEEK"
  | "PLAY_INDEX"
  | "CLEAR_QUEUE"
  | "REMOVE_INDEX"
  | "SEARCH"
  | "PLAY_LIKES"
  | "REPEAT"
  | "SHUFFLE"
  | "TOGGLE_PIP";

/**
 * Paquete de comando enviado de Pi hacia el navegador
 */
export interface PlayerCommandPacket {
  type: "COMMAND";
  action: PlayerCommandAction;
  payload?: {
    value?: number; // Para volumen (0-100) o seek (segundos)
    index?: number; // Para PLAY_INDEX o REMOVE_INDEX en la cola
    query?: string; // Para SEARCH
  };
  timestamp: number;
}

/**
 * Paquetes enviados desde el navegador hacia Pi
 */
export type UpstreamPacket =
  | {
      type: "CLIENT_CONNECTED";
      client: string;
      timestamp: number;
    }
  | {
      type: "PLAYER_STATE";
      data: Partial<YouTubePlayerState>;
      timestamp: number;
    }
  | {
      type: "HEARTBEAT";
      timestamp: number;
    };

/**
 * Símbolo global canónico para la interoperabilidad con temas y la sidebar de Pi
 */
export const YOUTUBE_PLAYER_SYMBOL = Symbol.for("pi-youtube-player");

/**
 * Contrato de la API pública expuesta en globalThis
 */
export interface IYouTubePlayerService {
  getState(): YouTubePlayerState;
  on(event: "stateChange", listener: (state: YouTubePlayerState) => void): () => void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  next(): void;
  previous(): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  toggleRepeat(): void;
  toggleShuffle(): void;
  togglePip(): void;
  playQueueIndex(index: number): void;
  clearQueue(): void;
  removeQueueIndex(index: number): void;
  search(query: string): void;
  playLikes(): void;
  isConnected(): boolean;
}
