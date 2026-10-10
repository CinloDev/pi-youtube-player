import { EventEmitter } from "node:events";
import {
  type IYouTubePlayerService,
  type PlayerCommandAction,
  type PlayerCommandPacket,
  type YouTubePlayerState,
  YOUTUBE_PLAYER_SYMBOL,
} from "./types.js";

/**
 * Estado inicial por defecto cuando no hay clientes conectados
 */
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

export class YouTubePlayerService implements IYouTubePlayerService {
  private static instance: YouTubePlayerService | null = null;
  private state: YouTubePlayerState = { ...INITIAL_STATE };
  private emitter = new EventEmitter();
  private sendCommandCallback: ((packet: PlayerCommandPacket) => void) | null = null;

  private constructor() {
    this.emitter.setMaxListeners(50);
  }

  public static getInstance(): YouTubePlayerService {
    if (!YouTubePlayerService.instance) {
      YouTubePlayerService.instance = new YouTubePlayerService();
      // Publicar en globalThis para consumo transparente en temas y sidebar
      (globalThis as Record<symbol, unknown>)[YOUTUBE_PLAYER_SYMBOL] = YouTubePlayerService.instance;
    }
    return YouTubePlayerService.instance;
  }

  /**
   * Vincula la función de transporte (WebSocket) para despachar comandos al navegador
   */
  public registerCommandSender(sender: (packet: PlayerCommandPacket) => void): void {
    this.sendCommandCallback = sender;
  }

  public getState(): YouTubePlayerState {
    return { ...this.state };
  }

  public isConnected(): boolean {
    return this.state.connectedClients > 0 && this.state.status !== "disconnected";
  }

  public on(event: "stateChange", listener: (state: YouTubePlayerState) => void): () => void {
    this.emitter.on(event, listener);
    return () => {
      this.emitter.off(event, listener);
    };
  }

  /**
   * Actualiza el estado reactivo proveniente del navegador y notifica a los oyentes (ej. sidebar)
   */
  public updateState(partialState: Partial<YouTubePlayerState>): void {
    this.state = {
      ...this.state,
      ...partialState,
      lastUpdated: Date.now(),
    };
    this.emitter.emit("stateChange", this.getState());
  }

  /**
   * Maneja el cambio en el número de clientes conectados
   */
  public updateClientCount(count: number): void {
    const wasConnected = this.state.connectedClients > 0;
    const isNowConnected = count > 0;

    this.state.connectedClients = count;

    if (!isNowConnected && wasConnected) {
      this.state.status = "disconnected";
    }

    this.emitter.emit("stateChange", this.getState());
  }

  // --- API de Comandos ---

  public dispatchCommand(action: PlayerCommandAction, payload?: { value?: number; index?: number }): void {
    if (!this.sendCommandCallback) {
      return;
    }

    const packet: PlayerCommandPacket = {
      type: "COMMAND",
      action,
      payload,
      timestamp: Date.now(),
    };

    this.sendCommandCallback(packet);
  }

  public play(): void {
    this.dispatchCommand("PLAY");
  }

  public pause(): void {
    this.dispatchCommand("PAUSE");
  }

  public togglePlay(): void {
    this.dispatchCommand("PLAY_PAUSE");
  }

  public next(): void {
    this.dispatchCommand("NEXT");
  }

  public previous(): void {
    this.dispatchCommand("PREV");
  }

  public setVolume(volume: number): void {
    // Clamping 0 a 100
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    this.dispatchCommand("SET_VOLUME", { value: clamped });
  }

  public toggleMute(): void {
    this.dispatchCommand("MUTE");
  }

  public playQueueIndex(index: number): void {
    this.dispatchCommand("PLAY_INDEX", { index });
  }
}
