// @ts-check
/**
 * Pi YouTube Bridge - Content Script para Chrome
 * Soporte Universal: detecta si corre en music.youtube.com o www.youtube.com
 * y activa el adaptador correspondiente de manera desacoplada.
 */

(function () {
  const isMusic = window.location.hostname.includes("music.youtube.com");
  const platform = isMusic ? "YouTube Music" : "YouTube Standard";
  console.log(`[Pi-YT Content] Bridge inicializado en ${window.location.hostname} (${platform})`);

  let pollInterval = null;

  // --- Funciones de utilidad comunes ---

  function getVideoElement() {
    return document.querySelector("video");
  }

  function isPipActive() {
    return Boolean(document.pictureInPictureElement);
  }

  async function togglePipMode() {
    if (document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
      } catch (_) {}
      sendFullState();
      return;
    }

    const video = getVideoElement();
    if (video && typeof video.requestPictureInPicture === "function" && video.videoWidth > 0) {
      try {
        video.removeAttribute("disablepictureinpicture");
        await video.requestPictureInPicture();
      } catch (_) {}
      sendFullState();
    }
  }

  function sendToMainWorld(action, payload) {
    try {
      window.postMessage({ source: "PI_YT_CONTENT", action, payload }, "*");
    } catch (_) {}
  }

  function normalizeSongTitle(title) {
    if (!title) return "";
    return title
      .toLowerCase()
      .replace(/\s*[\(\[](?:official\s*(?:video|audio|music\s*video)?|video\s*oficial|audio|video|live|en\s*vivo|from\s+[^)\]]+|bonus\s*track|radio\s*edit|remaster(?:ed)?(?:\s*\d{4})?|deluxe|version\s*[^)\]]*|acoustic|lyric\s*video)[\)\]]/gi, "")
      .replace(/\s*-\s*(?:official\s*(?:video|audio)?|video\s*oficial|live|en\s*vivo|remaster(?:ed)?(?:\s*\d{4})?).*$/gi, "")
      .trim();
  }

  function normalizeArtist(artist) {
    if (!artist) return "";
    return artist
      .toLowerCase()
      .split(/•|feat\.|ft\.|con\s|&|,/)[0]
      .trim();
  }

  function parseClock(str) {
    if (!str) return 0;
    const p = str.trim().split(":").map(Number);
    if (p.length === 2) return p[0] * 60 + p[1];
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    return 0;
  }

  // ==========================================
  // ADAPTADOR: YouTube Music (music.youtube.com)
  // ==========================================

  const MusicAdapter = {
    getHighResThumbnailUrl(rawUrl) {
      if (!rawUrl) return "";
      let clean = rawUrl;
      if (/=w\d+-h\d+/i.test(clean)) {
        clean = clean.replace(/=w\d+-h\d+/gi, "=w544-h544");
      } else if (/=s\d+/i.test(clean)) {
        clean = clean.replace(/=s\d+/gi, "=s544");
      }
      return clean;
    },

    extractRepeatMode() {
      const playerBar = document.querySelector("ytmusic-player-bar");
      const attrMode = playerBar?.getAttribute("repeat-mode") || playerBar?.getAttribute("repeat-mode_");
      if (attrMode === "ONE" || attrMode === "ALL" || attrMode === "NONE") {
        return attrMode;
      }

      const repeatBtn = document.querySelector(
        ".repeat.ytmusic-player-bar, #right-controls .repeat, button[aria-label*='Repetir' i], button[aria-label*='Repeat' i]"
      );
      if (repeatBtn) {
        const title = (repeatBtn.getAttribute("title") || repeatBtn.getAttribute("aria-label") || "").toLowerCase();
        if (title.includes("uno") || title.includes("one") || title.includes("canción") || title.includes("track")) {
          return "ONE";
        }
        if (title.includes("todo") || title.includes("all") || title.includes("lista") || title.includes("playlist")) {
          return "ALL";
        }
        const pressed = repeatBtn.getAttribute("aria-pressed");
        if (pressed === "true") return "ALL";
      }

      return "NONE";
    },

    extractShuffleState() {
      const playerBar = document.querySelector("ytmusic-player-bar");
      if (playerBar && (playerBar.hasAttribute("shuffle-on") || playerBar.getAttribute("shuffle-on") !== null)) {
        return true;
      }

      const shuffleBtn = document.querySelector(
        ".shuffle.ytmusic-player-bar, #right-controls .shuffle, button[aria-label*='Aleatorio' i], button[aria-label*='Shuffle' i]"
      );
      if (shuffleBtn) {
        const pressed = shuffleBtn.getAttribute("aria-pressed");
        if (pressed === "true") return true;
        if (shuffleBtn.classList.contains("active")) return true;
      }

      return false;
    },

    extractQueue() {
      const container = document.querySelector("#queue ytmusic-player-queue, #items.ytmusic-player-queue") || document;
      const queueItems = Array.from(container.querySelectorAll("ytmusic-player-queue-item"));
      if (!queueItems || queueItems.length === 0) {
        return [];
      }

      const barTitle = document.querySelector(".title.ytmusic-player-bar")?.textContent?.trim() || "";
      const barArtist = document.querySelector(".byline.ytmusic-player-bar")?.textContent?.trim() || "";
      const normBarTitle = normalizeSongTitle(barTitle);
      const normBarArtist = normalizeArtist(barArtist);

      let activeIndex = queueItems.findIndex((item) => {
        const t = item.querySelector(".song-title")?.textContent?.trim() || "";
        const a = item.querySelector(".byline")?.textContent?.trim() || "";
        if (!t) return false;
        return (
          normalizeSongTitle(t) === normBarTitle &&
          (!normBarArtist || normalizeArtist(a).includes(normBarArtist) || normBarArtist.includes(normalizeArtist(a)))
        );
      });

      if (activeIndex < 0) {
        activeIndex = queueItems.findIndex((item) => {
          return (
            item.hasAttribute("selected") ||
            item.getAttribute("selected") !== null ||
            item.classList.contains("selected") ||
            Boolean(item.querySelector("[aria-current='true'], [play-button-state='playing'], .playing"))
          );
        });
      }

      const startIndex = activeIndex >= 0 ? activeIndex : 0;
      const tracks = [];
      const seen = new Set();

      for (let i = startIndex; i < queueItems.length; i++) {
        const item = queueItems[i];
        if (item.offsetParent === null && item.style.display === "none") continue;

        const titleEl = item.querySelector(".song-title");
        const bylineEl = item.querySelector(".byline");
        const durationEl = item.querySelector(".duration");

        const title = titleEl?.textContent?.trim() || "";
        const artist = bylineEl?.textContent?.trim() || "";
        if (!title) continue;

        const normTitle = normalizeSongTitle(title);
        const normArtist = normalizeArtist(artist);
        const key = `${normTitle}:::${normArtist}`;

        if (seen.has(key)) continue;
        seen.add(key);

        const isCurrent = i === activeIndex;

        tracks.push({
          index: i,
          title,
          artist,
          duration: durationEl?.textContent?.trim() || "",
          isCurrent,
        });

        if (tracks.length >= 15) break;
      }

      return tracks;
    },

    extractMetadata() {
      const video = getVideoElement();
      if (!video) return null;

      const titleEl = document.querySelector(".title.ytmusic-player-bar");
      const bylineEl = document.querySelector(".byline.ytmusic-player-bar");
      const thumbEl = document.querySelector(".thumbnail-image-wrapper img.ytmusic-player-bar");

      const title = titleEl?.textContent?.trim() || "Desconocido";
      const artist = bylineEl?.textContent?.trim() || "YouTube Music";
      const rawThumb = thumbEl?.getAttribute("src") || "";
      const thumbnailUrl = MusicAdapter.getHighResThumbnailUrl(rawThumb);

      const isPlaying = !video.paused && !video.ended && video.readyState > 2;

      const timeInfoEl = document.querySelector(".time-info.ytmusic-player-bar, #time-info");
      let currentTime = Math.floor(video.currentTime || 0);
      let duration = Math.floor(video.duration || 0);

      if (timeInfoEl && timeInfoEl.textContent) {
        const parts = timeInfoEl.textContent.split("/").map((s) => s.trim());
        if (parts.length === 2) {
          currentTime = parseClock(parts[0]);
          duration = parseClock(parts[1]);
        }
      }

      const slider = document.querySelector("#volume-slider, ytmusic-player-bar #volume-slider");
      // @ts-ignore
      const currentVol = slider && typeof slider.value === "number" && !isNaN(slider.value) ? slider.value / 100 : (video.volume ?? 1.0);

      return {
        status: isPlaying ? "playing" : "paused",
        platform: "music",
        title,
        artist,
        currentTime,
        duration,
        volume: currentVol,
        repeatMode: MusicAdapter.extractRepeatMode(),
        shuffle: MusicAdapter.extractShuffleState(),
        isPip: isPipActive(),
        thumbnailUrl,
        queue: MusicAdapter.extractQueue(),
      };
    },

    applyVolume(volPercent) {
      if (typeof volPercent !== "number" || isNaN(volPercent)) return;
      const clamped = Math.max(0, Math.min(100, Math.round(volPercent)));
      const volFraction = clamped / 100;

      const video = getVideoElement();
      if (video) video.volume = volFraction;

      const slider = document.querySelector("#volume-slider, ytmusic-player-bar #volume-slider");
      if (slider) {
        // @ts-ignore
        slider.value = clamped;
        slider.dispatchEvent(new Event("change", { bubbles: true }));
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      }

      sendToMainWorld("SET_VOLUME", { value: clamped });
    },

    play() {
      const video = getVideoElement();
      const playPauseBtn = document.querySelector("#play-pause-button");
      if (video && video.paused) {
        if (playPauseBtn) (/** @type {HTMLElement} */ (playPauseBtn)).click();
        else video.play();
      }
    },

    pause() {
      const video = getVideoElement();
      const playPauseBtn = document.querySelector("#play-pause-button");
      if (video && !video.paused) {
        if (playPauseBtn) (/** @type {HTMLElement} */ (playPauseBtn)).click();
        else video.pause();
      }
    },

    playPause() {
      const playPauseBtn = document.querySelector("#play-pause-button");
      const video = getVideoElement();
      if (playPauseBtn) {
        (/** @type {HTMLElement} */ (playPauseBtn)).click();
      } else if (video) {
        if (video.paused) video.play();
        else video.pause();
      }
    },

    next() {
      const nextBtn = document.querySelector(".next-button, #next-button");
      if (nextBtn) (/** @type {HTMLElement} */ (nextBtn)).click();
    },

    prev() {
      const prevBtn = document.querySelector(".previous-button, #previous-button");
      if (prevBtn) (/** @type {HTMLElement} */ (prevBtn)).click();
    },

    playIndex(index) {
      const container = document.querySelector("#queue ytmusic-player-queue, #items.ytmusic-player-queue") || document;
      const items = Array.from(container.querySelectorAll("ytmusic-player-queue-item")).filter((el) => el.offsetParent !== null);
      const target = items[index];
      if (target) {
        const playBtn = target.querySelector(".play-button, ytmusic-play-button-renderer, .song-title, .title") || target;
        playBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        if (typeof (/** @type {any} */ (playBtn)).click === "function") (/** @type {any} */ (playBtn)).click();
      }
    },

    clearQueue() {
      const clearBtn = document.querySelector(
        "#clear-queue-button, button.clear-queue-button, [aria-label*='Clear queue' i], [aria-label*='Borrar cola' i], [aria-label*='Limpiar cola' i], #clear-button"
      );
      if (clearBtn) {
        (/** @type {HTMLElement} */ (clearBtn)).click();
      } else {
        const video = getVideoElement();
        if (video) video.pause();
      }
    },

    removeIndex(index) {
      const container = document.querySelector("#queue ytmusic-player-queue, #items.ytmusic-player-queue") || document;
      const items = Array.from(container.querySelectorAll("ytmusic-player-queue-item")).filter((el) => el.offsetParent !== null);
      const target = items[index];
      if (target) {
        const menuBtn = target.querySelector("ytmusic-menu-renderer, #menu, button[aria-label*='Action' i], button[aria-label*='Acciones' i]");
        if (menuBtn) {
          (/** @type {HTMLElement} */ (menuBtn)).click();
          setTimeout(() => {
            const menuItems = Array.from(document.querySelectorAll("ytmusic-menu-service-item-renderer, tp-yt-paper-item"));
            const removeOption = menuItems.find((el) => {
              const txt = (el.textContent || "").toLowerCase();
              return txt.includes("quitar de la cola") || txt.includes("remove from queue") || txt.includes("eliminar de la cola");
            });
            if (removeOption) {
              (/** @type {HTMLElement} */ (removeOption)).click();
            }
          }, 150);
        }
      }
    },

    search(query) {
      sessionStorage.setItem("pi_auto_play_top", "true");
      window.location.href = `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
    },

    playLikes() {
      sessionStorage.setItem("pi_auto_play_top", "true");
      window.location.href = "https://music.youtube.com/playlist?list=LM";
    },
  };

  // ==========================================
  // ADAPTADOR: YouTube Standard (www.youtube.com)
  // ==========================================

  const StandardAdapter = {
    getVideoId() {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get("v") || "";
    },

    getHighResThumbnailUrl() {
      const vid = StandardAdapter.getVideoId();
      if (vid) {
        return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      }
      return "";
    },

    extractRepeatMode() {
      const loopBtn = document.querySelector("ytd-playlist-panel-renderer [aria-label*='Bucle' i], ytd-playlist-panel-renderer [aria-label*='Loop' i]");
      if (loopBtn) {
        const pressed = loopBtn.getAttribute("aria-pressed");
        if (pressed === "true") return "ALL";
      }
      const video = getVideoElement();
      if (video?.loop) return "ONE";
      return "NONE";
    },

    extractShuffleState() {
      const shuffleBtn = document.querySelector("ytd-playlist-panel-renderer [aria-label*='Aleatorio' i], ytd-playlist-panel-renderer [aria-label*='Shuffle' i]");
      if (shuffleBtn) {
        return shuffleBtn.getAttribute("aria-pressed") === "true";
      }
      return false;
    },

    extractQueue() {
      // 1. Si está en una playlist activa en pantalla
      const playlistPanel = document.querySelector("ytd-playlist-panel-renderer");
      if (playlistPanel) {
        const items = Array.from(playlistPanel.querySelectorAll("ytd-playlist-panel-video-renderer"));
        if (items.length > 0) {
          const activeIndex = items.findIndex((el) => el.hasAttribute("selected") || el.getAttribute("selected") !== null);
          const startIndex = activeIndex >= 0 ? activeIndex : 0;
          const tracks = [];

          for (let i = startIndex; i < items.length; i++) {
            const item = items[i];
            const titleEl = item.querySelector("#video-title");
            const bylineEl = item.querySelector("#byline");
            const durationEl = item.querySelector(".badge-shape-wiz__text, #thumbnail-overlay-time-status-renderer, span.ytd-thumbnail-overlay-time-status-renderer");

            const title = titleEl?.textContent?.trim() || "";
            const artist = bylineEl?.textContent?.trim() || "";
            if (!title) continue;

            tracks.push({
              index: i,
              title,
              artist,
              duration: durationEl?.textContent?.trim() || "",
              isCurrent: i === activeIndex,
            });

            if (tracks.length >= 15) break;
          }
          if (tracks.length > 0) return tracks;
        }
      }

      // 2. Si no hay playlist, tomar los videos sugeridos / Up Next de la barra lateral (#related)
      const relatedItems = Array.from(document.querySelectorAll("#related ytd-compact-video-renderer, #related ytd-rich-item-renderer"));
      const currentTitle = document.querySelector("#title h1, h1.ytd-watch-metadata")?.textContent?.trim() || "";
      const currentArtist = document.querySelector("#channel-name #text, #upload-info #channel-name a")?.textContent?.trim() || "YouTube";
      const video = getVideoElement();

      const tracks = [];
      if (currentTitle) {
        tracks.push({
          index: 0,
          title: currentTitle,
          artist: currentArtist,
          duration: "",
          isCurrent: true,
        });
      }

      for (let i = 0; i < relatedItems.length; i++) {
        const item = relatedItems[i];
        const titleEl = item.querySelector("#video-title");
        const artistEl = item.querySelector("#channel-name #text, #byline");
        const durationEl = item.querySelector("ytd-thumbnail-overlay-time-status-renderer, span.badge-shape-wiz__text");

        const title = titleEl?.textContent?.trim() || "";
        const artist = artistEl?.textContent?.trim() || "";
        if (!title) continue;

        tracks.push({
          index: tracks.length,
          title,
          artist,
          duration: durationEl?.textContent?.trim() || "",
          isCurrent: false,
        });

        if (tracks.length >= 15) break;
      }

      return tracks;
    },

    extractMetadata() {
      const video = getVideoElement();
      if (!video) return null;

      // Extraer título
      const titleEl = document.querySelector("#title h1, h1.ytd-watch-metadata, #container > h1");
      const title = titleEl?.textContent?.trim() || document.title.replace(/ - YouTube$/, "") || "YouTube Video";

      // Extraer canal/autor
      const artistEl = document.querySelector("#channel-name #text, #upload-info #channel-name a, #owner-name a");
      const artist = artistEl?.textContent?.trim() || "YouTube";

      const thumbnailUrl = StandardAdapter.getHighResThumbnailUrl();
      const isPlaying = !video.paused && !video.ended && video.readyState > 2;

      // Tiempo y duración
      const currentTime = Math.floor(video.currentTime || 0);
      const duration = Math.floor(video.duration || 0);
      const currentVol = video.volume ?? 1.0;

      return {
        status: isPlaying ? "playing" : "paused",
        platform: "youtube",
        title,
        artist,
        currentTime,
        duration,
        volume: currentVol,
        repeatMode: StandardAdapter.extractRepeatMode(),
        shuffle: StandardAdapter.extractShuffleState(),
        isPip: isPipActive(),
        thumbnailUrl,
        queue: StandardAdapter.extractQueue(),
      };
    },

    applyVolume(volPercent) {
      if (typeof volPercent !== "number" || isNaN(volPercent)) return;
      const clamped = Math.max(0, Math.min(100, Math.round(volPercent)));
      const volFraction = clamped / 100;

      const video = getVideoElement();
      if (video) video.volume = volFraction;

      sendToMainWorld("SET_VOLUME", { value: clamped });
    },

    play() {
      sendToMainWorld("PLAY");
    },

    pause() {
      sendToMainWorld("PAUSE");
    },

    playPause() {
      const video = getVideoElement();
      if (video) {
        if (video.paused) {
          this.play();
        } else {
          this.pause();
        }
      } else {
        sendToMainWorld("PLAY_PAUSE");
      }
    },

    next() {
      const nextBtn = document.querySelector(".ytp-next-button");
      if (nextBtn && (/** @type {HTMLElement} */ (nextBtn)).getAttribute("aria-disabled") !== "true") {
        (/** @type {HTMLElement} */ (nextBtn)).click();
      } else {
        sendToMainWorld("NEXT");
      }
    },

    prev() {
      const prevBtn = document.querySelector(".ytp-prev-button");
      const isPrevDisabled = !prevBtn || (/** @type {HTMLElement} */ (prevBtn)).getAttribute("aria-disabled") === "true";
      if (!isPrevDisabled) {
        (/** @type {HTMLElement} */ (prevBtn)).click();
      } else {
        const video = getVideoElement();
        if (video) {
          video.currentTime = 0;
        }
        sendToMainWorld("PREV");
      }
    },

    playIndex(index) {
      const playlistPanel = document.querySelector("ytd-playlist-panel-renderer");
      if (playlistPanel) {
        const items = Array.from(playlistPanel.querySelectorAll("ytd-playlist-panel-video-renderer"));
        const target = items[index];
        if (target) {
          const link = target.querySelector("a#wc-endpoint, a");
          if (link) (/** @type {HTMLElement} */ (link)).click();
          return;
        }
      }

      // Si fue un click en recomendaciones
      const relatedItems = Array.from(document.querySelectorAll("#related ytd-compact-video-renderer, #related ytd-rich-item-renderer"));
      const target = relatedItems[index - 1]; // restar el actual
      if (target) {
        const link = target.querySelector("a#thumbnail, a");
        if (link) (/** @type {HTMLElement} */ (link)).click();
      }
    },

    clearQueue() {
      const video = getVideoElement();
      if (video) video.pause();
    },

    removeIndex(_index) {
      // En YouTube tradicional los videos recomendados no se eliminan vía menú simple
    },

    search(query) {
      sessionStorage.setItem("pi_auto_play_top", "true");
      window.location.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    },

    playLikes() {
      sessionStorage.setItem("pi_auto_play_top", "true");
      window.location.href = "https://www.youtube.com/playlist?list=LL&playnext=1";
    },
  };

  // Seleccionar adapter activo
  const adapter = isMusic ? MusicAdapter : StandardAdapter;

  function sendFullState() {
    const state = adapter.extractMetadata();
    if (state && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "PLAYER_STATE",
        data: state,
      }).catch(() => {
        // Ignorar si background se está reconectando
      });
    }
  }

  // --- Manejo de comandos ---

  function handleIncomingCommand(packet) {
    if (!packet || packet.type !== "COMMAND") return;

    const video = getVideoElement();

    switch (packet.action) {
      case "PLAY":
        adapter.play();
        break;

      case "PAUSE":
        adapter.pause();
        break;

      case "PLAY_PAUSE":
        adapter.playPause();
        break;

      case "NEXT":
        adapter.next();
        break;

      case "PREV":
        adapter.prev();
        break;

      case "SET_VOLUME":
        if (typeof packet.payload?.value === "number") {
          adapter.applyVolume(packet.payload.value);
          sendFullState();
        }
        break;

      case "REPEAT": {
        sendToMainWorld("REPEAT");
        setTimeout(sendFullState, 250);
        break;
      }

      case "SHUFFLE": {
        sendToMainWorld("SHUFFLE");
        setTimeout(sendFullState, 250);
        break;
      }

      case "TOGGLE_PIP": {
        togglePipMode();
        break;
      }

      case "MUTE":
        if (video) {
          video.muted = !video.muted;
          sendFullState();
        }
        break;

      case "PLAY_INDEX":
        if (typeof packet.payload?.index === "number") {
          adapter.playIndex(packet.payload.index);
        }
        break;

      case "CLEAR_QUEUE":
        adapter.clearQueue();
        break;

      case "REMOVE_INDEX":
        if (typeof packet.payload?.index === "number") {
          adapter.removeIndex(packet.payload.index);
        }
        break;

      case "SEARCH": {
        const query = packet.payload?.query;
        if (query) adapter.search(query);
        break;
      }

      case "PLAY_LIKES":
        adapter.playLikes();
        break;
    }

    setTimeout(sendFullState, 250);
  }

  // Escuchar mensajes desde background.js
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((packet) => {
      console.log("[Pi-YT Content] Mensaje recibido:", packet?.type, packet?.action);
      if (packet?.type === "REQUEST_STATE") {
        sendFullState();
        return;
      }
      handleIncomingCommand(packet);
    });
  }

  // --- Auto-play tras búsqueda ---

  if (sessionStorage.getItem("pi_auto_play_top") === "true") {
    sessionStorage.removeItem("pi_auto_play_top");
    let attempts = 0;
    const autoPlayInterval = setInterval(() => {
      attempts++;
      if (isMusic) {
        const playTarget = document.querySelector(
          "ytmusic-responsive-list-item-renderer ytmusic-play-button-renderer, .play-button.ytmusic-responsive-list-item-renderer, #play-button, ytmusic-play-button-renderer[slot='play-button']"
        );
        if (playTarget) {
          clearInterval(autoPlayInterval);
          playTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          if (typeof (/** @type {any} */ (playTarget)).click === "function") (/** @type {any} */ (playTarget)).click();
        } else if (attempts > 15) {
          clearInterval(autoPlayInterval);
        }
      } else {
        // En YouTube normal: primer video del resultado de búsqueda
        const firstVideo = document.querySelector("ytd-video-renderer a#thumbnail, ytd-video-renderer a#video-title");
        if (firstVideo) {
          clearInterval(autoPlayInterval);
          (/** @type {HTMLElement} */ (firstVideo)).click();
        } else if (attempts > 15) {
          clearInterval(autoPlayInterval);
        }
      }
    }, 400);
  }

  // --- Telemetría viva y observadores ---

  sendFullState();

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    sendFullState();
  }, 1000);

  document.addEventListener(
    "play",
    (e) => {
      if (e.target && (/** @type {HTMLElement} */ (e.target)).tagName === "VIDEO") sendFullState();
    },
    true
  );

  document.addEventListener(
    "pause",
    (e) => {
      if (e.target && (/** @type {HTMLElement} */ (e.target)).tagName === "VIDEO") sendFullState();
    },
    true
  );

  // En YouTube normal, la navegación SPA (yt-navigate-finish) cambia de video sin recargar la página
  window.addEventListener("yt-navigate-finish", () => {
    setTimeout(sendFullState, 500);
  });
})();