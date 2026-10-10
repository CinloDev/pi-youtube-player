// @ts-check
/**
 * Pi YouTube Music Bridge - Content Script para Chrome
 * Extrae metadata y controla el DOM de YouTube Music.
 * Se comunica con background.js mediante chrome.runtime.
 */

(function () {
  console.log("[Pi-YT Content] Bridge inicializado en music.youtube.com");

  let pollInterval = null;

  // --- 1. Lectura y Extracción del DOM de YouTube Music ---

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
    if (state && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "PLAYER_STATE",
        data: state,
      }).catch(() => {
        // Ignorar si background se está reconectando
      });
    }
  }

  // --- 2. Ejecución de Comandos Recibidos de background.js ---

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

  // Escuchar comandos enviados desde background.js
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((packet) => {
      handleIncomingCommand(packet);
    });
  }

  // --- 3. Loop de Ticks cada 1 segundo para telemetría viva ---

  sendFullState();

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    sendFullState();
  }, 1000);

  // Escuchar eventos nativos del elemento <video>
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
