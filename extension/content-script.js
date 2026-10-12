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

  /**
   * Obtiene la versión en alta resolución de una portada de Google / YouTube Music
   * Reemplaza parámetros como =w60-h60 o =s60 por =w544-h544 para máxima nitidez visual.
   */
  function getHighResThumbnailUrl(rawUrl) {
    if (!rawUrl) return "";
    let clean = rawUrl;
    if (/=w\d+-h\d+/i.test(clean)) {
      clean = clean.replace(/=w\d+-h\d+/gi, "=w544-h544");
    } else if (/=s\d+/i.test(clean)) {
      clean = clean.replace(/=s\d+/gi, "=s544");
    }
    return clean;
  }

  function getVideoElement() {
    return document.querySelector("video");
  }

  function extractRepeatMode() {
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
  }

  function extractShuffleState() {
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

  function applyVolume(volPercent) {
    if (typeof volPercent !== "number" || isNaN(volPercent)) return;
    const clamped = Math.max(0, Math.min(100, Math.round(volPercent)));
    const volFraction = clamped / 100;

    // 1. Elemento <video> nativo de HTML5
    const video = getVideoElement();
    if (video) {
      video.volume = volFraction;
    }

    // 2. Manipular slider nativo en el DOM de YouTube Music (tp-yt-paper-slider)
    const slider = document.querySelector("#volume-slider, ytmusic-player-bar #volume-slider");
    if (slider) {
      // @ts-ignore
      slider.value = clamped;
      slider.dispatchEvent(new Event("change", { bubbles: true }));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // 3. Despachar a main-world.js para llamar a updateVolume() y movie_player.setVolume() sin restricciones de CSP
    sendToMainWorld("SET_VOLUME", { value: clamped });
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
    const rawThumb = thumbEl?.getAttribute("src") || "";
    const thumbnailUrl = getHighResThumbnailUrl(rawThumb);

    const isPlaying = !video.paused && !video.ended && video.readyState > 2;

    // Reloj por canción leyendo el elemento visual .time-info (evita el stream acumulado del tag <video>)
    const timeInfoEl = document.querySelector(".time-info.ytmusic-player-bar, #time-info");
    let currentTime = Math.floor(video.currentTime || 0);
    let duration = Math.floor(video.duration || 0);

    if (timeInfoEl && timeInfoEl.textContent) {
      const parts = timeInfoEl.textContent.split("/").map((s) => s.trim());
      if (parts.length === 2) {
        const parseClock = (str) => {
          const p = str.split(":").map(Number);
          if (p.length === 2) return p[0] * 60 + p[1];
          if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
          return 0;
        };
        currentTime = parseClock(parts[0]);
        duration = parseClock(parts[1]);
      }
    }

    // Extraer volumen sincronizado (priorizar slider si está presente)
    const slider = document.querySelector("#volume-slider, ytmusic-player-bar #volume-slider");
    // @ts-ignore
    const currentVol = slider && typeof slider.value === "number" && !isNaN(slider.value) ? slider.value / 100 : (video.volume ?? 1.0);

    return {
      status: isPlaying ? "playing" : "paused",
      title,
      artist,
      currentTime,
      duration,
      volume: currentVol,
      repeatMode: extractRepeatMode(),
      shuffle: extractShuffleState(),
      isPip: isPipActive(),
      thumbnailUrl,
      queue: extractQueue(),
    };
  }

  /**
   * Limpia y normaliza el título de una canción para detectar variantes duplicadas
   * (elimina tags como '(Official Video)', '(Live)', '(From ...)', '(Bonus Track)', '(Radio Edit)', etc.)
   */
  function normalizeSongTitle(title) {
    if (!title) return "";
    return title
      .toLowerCase()
      // Elimina paréntesis o corchetes con etiquetas comunes de video/edición
      .replace(/\s*[\(\[](?:official\s*(?:video|audio|music\s*video)?|video\s*oficial|audio|video|live|en\s*vivo|from\s+[^)\]]+|bonus\s*track|radio\s*edit|remaster(?:ed)?(?:\s*\d{4})?|deluxe|version\s*[^)\]]*|acoustic|lyric\s*video)[\)\]]/gi, "")
      // Elimina sufijos tipo " - Live", " - Official Video", etc.
      .replace(/\s*-\s*(?:official\s*(?:video|audio)?|video\s*oficial|live|en\s*vivo|remaster(?:ed)?(?:\s*\d{4})?).*$/gi, "")
      .trim();
  }

  /**
   * Normaliza el artista principal ignorando acompañamientos secundarios
   */
  function normalizeArtist(artist) {
    if (!artist) return "";
    return artist
      .toLowerCase()
      .split(/•|feat\.|ft\.|con\s|&|,/)[0]
      .trim();
  }

  /**
   * Extrae los próximos 15 temas de la pestaña "A continuación" (Queue)
   * Deduplica temas y descarta los que ya pasaron, tomando siempre a partir del tema activo.
   */
  function extractQueue() {
    // Buscar en el contenedor principal de la cola
    const container = document.querySelector("#queue ytmusic-player-queue, #items.ytmusic-player-queue") || document;
    const queueItems = Array.from(container.querySelectorAll("ytmusic-player-queue-item"));
    if (!queueItems || queueItems.length === 0) {
      return [];
    }

    // 1. Título y artista de la canción que está sonando actualmente en la barra inferior
    const barTitle = document.querySelector(".title.ytmusic-player-bar")?.textContent?.trim() || "";
    const barArtist = document.querySelector(".byline.ytmusic-player-bar")?.textContent?.trim() || "";
    const normBarTitle = normalizeSongTitle(barTitle);
    const normBarArtist = normalizeArtist(barArtist);

    // 2. Detectar cuál es el elemento de la cola que corresponde a la canción actual
    // Prioridad 1: Coincidencia exacta o normalizada de título + artista con la barra
    let activeIndex = queueItems.findIndex((item) => {
      const t = item.querySelector(".song-title")?.textContent?.trim() || "";
      const a = item.querySelector(".byline")?.textContent?.trim() || "";
      if (!t) return false;
      return (
        normalizeSongTitle(t) === normBarTitle &&
        (!normBarArtist || normalizeArtist(a).includes(normBarArtist) || normBarArtist.includes(normalizeArtist(a)))
      );
    });

    // Prioridad 2: Atributos nativos del DOM de YouTube Music (selected o estado playing/paused)
    if (activeIndex === -1) {
      activeIndex = queueItems.findIndex((item) => {
        return (
          item.hasAttribute("selected") ||
          item.classList.contains("selected") ||
          item.querySelector("[play-button-state='playing'], [play-button-state='paused']") !== null
        );
      });
    }

    // 3. Empezar la lista SIEMPRE desde la canción activa para adelante (ventana deslizante real)
    const startIndex = activeIndex >= 0 ? activeIndex : 0;

    const tracks = [];
    const seen = new Set();

    for (let i = startIndex; i < queueItems.length; i++) {
      const item = queueItems[i];

      // Omitir elementos invisibles si el virtual scroller los oculta
      if (item.offsetParent === null && item.style.display === "none") {
        continue;
      }

      const titleEl = item.querySelector(".song-title");
      const bylineEl = item.querySelector(".byline");
      const durationEl = item.querySelector(".duration");

      const title = titleEl?.textContent?.trim() || "";
      const artist = bylineEl?.textContent?.trim() || "";
      if (!title) continue;

      // Normalizar título y artista para comparar canciones base
      const normTitle = normalizeSongTitle(title);
      const normArtist = normalizeArtist(artist);
      const key = `${normTitle}:::${normArtist}`;

      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const isCurrent = i === activeIndex;

      tracks.push({
        index: i,
        title,
        artist,
        duration: durationEl?.textContent?.trim() || "",
        isCurrent,
      });

      if (tracks.length >= 15) {
        break;
      }
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
        if (typeof packet.payload?.value === "number") {
          applyVolume(packet.payload.value);
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
          const container = document.querySelector("#queue ytmusic-player-queue, #items.ytmusic-player-queue") || document;
          const items = Array.from(container.querySelectorAll("ytmusic-player-queue-item")).filter((el) => el.offsetParent !== null);
          const target = items[packet.payload.index];
          if (target) {
            const playBtn = target.querySelector(".play-button, ytmusic-play-button-renderer, .song-title, .title") || target;
            playBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
            if (typeof playBtn.click === "function") playBtn.click();
          }
        }
        break;

      case "CLEAR_QUEUE": {
        const clearBtn = document.querySelector(
          "#clear-queue-button, button.clear-queue-button, [aria-label*='Clear queue' i], [aria-label*='Borrar cola' i], [aria-label*='Limpiar cola' i], #clear-button"
        );
        if (clearBtn) {
          clearBtn.click();
        } else if (video) {
          video.pause();
        }
        break;
      }

      case "REMOVE_INDEX": {
        if (typeof packet.payload?.index === "number") {
          const container = document.querySelector("#queue ytmusic-player-queue, #items.ytmusic-player-queue") || document;
          const items = Array.from(container.querySelectorAll("ytmusic-player-queue-item")).filter((el) => el.offsetParent !== null);
          const target = items[packet.payload.index];
          if (target) {
            const menuBtn = target.querySelector("ytmusic-menu-renderer, #menu, button[aria-label*='Action' i], button[aria-label*='Acciones' i]");
            if (menuBtn) {
              menuBtn.click();
              setTimeout(() => {
                const menuItems = Array.from(document.querySelectorAll("ytmusic-menu-service-item-renderer, tp-yt-paper-item"));
                const removeOption = menuItems.find((el) => {
                  const txt = (el.textContent || "").toLowerCase();
                  return txt.includes("quitar de la cola") || txt.includes("remove from queue") || txt.includes("eliminar de la cola");
                });
                if (removeOption) {
                  removeOption.click();
                }
              }, 150);
            }
          }
        }
        break;
      }

      case "SEARCH": {
        const query = packet.payload?.query;
        if (query) {
          sessionStorage.setItem("pi_auto_play_top", "true");
          window.location.href = `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
        }
        break;
      }

      case "PLAY_LIKES": {
        sessionStorage.setItem("pi_auto_play_top", "true");
        window.location.href = "https://music.youtube.com/playlist?list=LM";
        break;
      }
    }

    // Reaccionar inmediatamente tras el comando
    setTimeout(sendFullState, 250);
  }

  // Escuchar comandos enviados desde background.js
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((packet) => {
      if (packet?.type === "REQUEST_STATE") {
        sendFullState();
        return;
      }
      handleIncomingCommand(packet);
    });
  }

  // --- 3. Auto-play tras navegación de búsqueda o favoritos ---

  if (sessionStorage.getItem("pi_auto_play_top") === "true") {
    sessionStorage.removeItem("pi_auto_play_top");
    let attempts = 0;
    const autoPlayInterval = setInterval(() => {
      attempts++;
      // Buscar botón de play principal en el mejor resultado o en la cabecera de la lista
      const playTarget = document.querySelector(
        "ytmusic-responsive-list-item-renderer ytmusic-play-button-renderer, .play-button.ytmusic-responsive-list-item-renderer, #play-button, ytmusic-play-button-renderer[slot='play-button']"
      );
      if (playTarget) {
        clearInterval(autoPlayInterval);
        playTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        if (typeof playTarget.click === "function") playTarget.click();
      } else if (attempts > 15) {
        clearInterval(autoPlayInterval);
      }
    }, 400);
  }

  // --- 4. Loop de Ticks cada 1 segundo para telemetría viva ---

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

  document.addEventListener("enterpictureinpicture", () => sendFullState(), true);
  document.addEventListener("leavepictureinpicture", () => sendFullState(), true);
})();
