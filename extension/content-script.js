// @ts-check
/**
 * Pi YouTube Music Bridge - Content Script para Chrome
 * Conexión WebSocket ultra-liviana con Pi en ws://127.0.0.1:7788
 */

(function () {
  const WS_URL = "ws://127.0.0.1:7788";
  let socket = null;
  let isConnecting = false;
  let pollInterval = null;

  console.log("[Pi-YT] Bridge inicializado en music.youtube.com");

  // --- 1. WebSocket y Reconexión Silenciosa ---

  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    isConnecting = true;
    try {
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        isConnecting = false;
        console.log("[Pi-YT] Conectado exitosamente con Pi en", WS_URL);
        send({
          type: "CLIENT_CONNECTED",
          client: "Chrome Extension (YouTube Music)",
          timestamp: Date.now(),
        });
        sendFullState();
      };

      socket.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          handleIncomingCommand(packet);
        } catch (e) {
          // Ignorar mensajes malformados
        }
      };

      socket.onclose = () => {
        socket = null;
        isConnecting = false;
        // Reintentar silenciosamente cada 3 segundos
        setTimeout(connect, 3000);
      };

      socket.onerror = () => {
        if (socket) {
          socket.close();
        }
      };
    } catch {
      isConnecting = false;
      setTimeout(connect, 3000);
    }
  }

  function send(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  }

  // --- 2. Lectura y Extracción del DOM de YouTube Music ---

  function getVideoElement() {
    return document.querySelector("video");
  }

  function extractMetadata() {
    const video = getVideoElement();
    if (!video) {
      return null;
    }

    // Título y artista de la barra inferior de YouTube Music
    const titleEl = document.querySelector(".title.ytmusic-player-bar");
    const bylineEl = document.querySelector(".byline.ytmusic-player-bar");
    const thumbEl = document.querySelector(".thumbnail-image-wrapper img.ytmusic-player-bar");

    const title = titleEl?.textContent?.trim() || "Desconocido";
    const artist = bylineEl?.textContent?.trim() || "YouTube Music";
    const thumbnailUrl = thumbEl?.getAttribute("src") || "";

    const isPlaying = !video.paused && !video.ended && video.readyState > 2;

    return {
      status: isPlaying ? "playing" : "paused",
      title,
      artist,
      currentTime: Math.floor(video.currentTime || 0),
      duration: Math.floor(video.duration || 0),
      volume: video.volume ?? 1.0,
      thumbnailUrl,
      queue: extractQueue(),
    };
  }

  /**
   * Extrae los próximos 10 temas de la pestaña "A continuación" (Queue)
   */
  function extractQueue() {
    const queueItems = Array.from(document.querySelectorAll("ytmusic-player-queue-item"));
    if (!queueItems || queueItems.length === 0) {
      return [];
    }

    const tracks = [];
    const maxItems = Math.min(queueItems.length, 10);

    for (let i = 0; i < maxItems; i++) {
      const item = queueItems[i];
      const titleEl = item.querySelector(".song-title");
      const bylineEl = item.querySelector(".byline");
      const durationEl = item.querySelector(".duration");

      tracks.push({
        index: i,
        title: titleEl?.textContent?.trim() || `Tema ${i + 1}`,
        artist: bylineEl?.textContent?.trim() || "",
        duration: durationEl?.textContent?.trim() || "",
      });
    }

    return tracks;
  }

  function sendFullState() {
    const state = extractMetadata();
    if (state) {
      send({
        type: "PLAYER_STATE",
        data: state,
        timestamp: Date.now(),
      });
    }
  }

  // --- 3. Ejecución de Comandos desde Pi ---

  function handleIncomingCommand(packet) {
    if (!packet || packet.type !== "COMMAND") return;

    const video = getVideoElement();
    const playPauseBtn = document.querySelector("#play-pause-button");
    const nextBtn = document.querySelector(".next-button, #next-button");
    const prevBtn = document.querySelector(".previous-button, #previous-button");

    switch (packet.action) {
      case "PLAY":
        if (video && video.paused) {
          if (playPauseBtn) playPauseBtn.click();
          else video.play();
        }
        break;

      case "PAUSE":
        if (video && !video.paused) {
          if (playPauseBtn) playPauseBtn.click();
          else video.pause();
        }
        break;

      case "PLAY_PAUSE":
        if (playPauseBtn) {
          playPauseBtn.click();
        } else if (video) {
          if (video.paused) video.play();
          else video.pause();
        }
        break;

      case "NEXT":
        if (nextBtn) {
          nextBtn.click();
        }
        break;

      case "PREV":
        if (prevBtn) {
          prevBtn.click();
        }
        break;

      case "SET_VOLUME":
        if (video && typeof packet.payload?.value === "number") {
          // valor de 0 a 100 convertido a 0.0 - 1.0
          const vol = Math.max(0, Math.min(1, packet.payload.value / 100));
          video.volume = vol;
          sendFullState();
        }
        break;

      case "MUTE":
        if (video) {
          video.muted = !video.muted;
          sendFullState();
        }
        break;

      case "PLAY_INDEX":
        if (typeof packet.payload?.index === "number") {
          const items = Array.from(document.querySelectorAll("ytmusic-player-queue-item"));
          const target = items[packet.payload.index];
          if (target) {
            target.click();
          }
        }
        break;
    }

    // Reaccionar inmediatamente tras el comando
    setTimeout(sendFullState, 250);
  }

  // --- 4. Loop de Ticks cada 1 segundo (Q6 - Opción A) ---

  connect();

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    sendFullState();
  }, 1000);

  // Escuchar también eventos nativos del elemento video si se carga dinámicamente
  document.addEventListener(
    "play",
    (e) => {
      if (e.target && e.target.tagName === "VIDEO") sendFullState();
    },
    true
  );

  document.addEventListener(
    "pause",
    (e) => {
      if (e.target && e.target.tagName === "VIDEO") sendFullState();
    },
    true
  );
})();
