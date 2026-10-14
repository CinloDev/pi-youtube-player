// @ts-check
/**
 * Pi YouTube Bridge - Main World Script
 * Corre en el contexto global de la página (MAIN world) de music.youtube.com y www.youtube.com.
 * Tiene acceso directo al objeto DOM de Polymer (ytmusic-player-bar), al reproductor (#movie_player)
 * y a los stores internos, sin restricciones de Isolated World ni de CSP.
 */

(function () {
  const isMusic = window.location.hostname.includes("music.youtube.com");
  console.log(`[Pi-YT MainWorld] Script cargado en el contexto de ${window.location.hostname} (modo: ${isMusic ? "Music" : "Standard"})`);

  function getPlayerBar() {
    return document.querySelector("ytmusic-player-bar");
  }

  function getMoviePlayer() {
    return document.querySelector("#movie_player") || document.getElementById("movie_player");
  }

  // Escuchar mensajes provenientes de content-script.js (Isolated World)
  window.addEventListener("message", (event) => {
    // Filtrar mensajes que no sean del puente
    if (!event.data || event.data.source !== "PI_YT_CONTENT") return;

    const { action, payload } = event.data;
    const bar = getPlayerBar();
    const mp = getMoviePlayer();

    switch (action) {
      case "SET_VOLUME": {
        if (typeof payload?.value === "number") {
          const vol = Math.max(0, Math.min(100, Math.round(payload.value)));

          // 1. YouTube Music Polymer bar
          // @ts-ignore
          if (bar && typeof bar.updateVolume === "function") {
            // @ts-ignore
            bar.updateVolume(vol);
          } else if (
            bar &&
            // @ts-ignore
            bar.playerController &&
            // @ts-ignore
            bar.playerController.store &&
            // @ts-ignore
            bar.playerController.store.dispatch
          ) {
            // @ts-ignore
            bar.playerController.store.dispatch({ type: "SET_VOLUME", payload: vol });
          }

          // 2. YouTube Movie Player API (disponible en ambos)
          // @ts-ignore
          if (mp && typeof mp.setVolume === "function") {
            // @ts-ignore
            mp.setVolume(vol);
            // @ts-ignore
            if (vol > 0 && typeof mp.unMute === "function") mp.unMute();
          }

          // 3. Slider en el DOM
          const slider = document.querySelector("#volume-slider, .ytp-volume-slider");
          if (slider) {
            // @ts-ignore
            slider.value = vol;
          }

          // 4. Elemento de video HTML5
          const video = document.querySelector("video");
          if (video) {
            video.volume = vol / 100;
          }
        }
        break;
      }

      case "REPEAT": {
        if (isMusic) {
          // En YouTube Music onRepeatButtonClick cicla: NONE -> ALL -> ONE -> NONE
          // @ts-ignore
          if (bar && typeof bar.onRepeatButtonClick === "function") {
            // @ts-ignore
            bar.onRepeatButtonClick();
          } else {
            const btn = document.querySelector(".repeat.ytmusic-player-bar, #right-controls .repeat");
            if (btn && typeof (/** @type {any} */ (btn)).click === "function") {
              (/** @type {any} */ (btn)).click();
            }
          }
        } else {
          // En YouTube normal: si hay playlist, botón loop o video.loop
          const loopBtn = document.querySelector(
            "ytd-playlist-panel-renderer [aria-label*='Bucle' i], ytd-playlist-panel-renderer [aria-label*='Loop' i], ytd-playlist-panel-renderer ytd-menu-renderer button"
          );
          if (loopBtn && typeof (/** @type {any} */ (loopBtn)).click === "function") {
            (/** @type {any} */ (loopBtn)).click();
          } else {
            const video = document.querySelector("video");
            if (video) video.loop = !video.loop;
          }
        }
        break;
      }

      case "SHUFFLE": {
        if (isMusic) {
          // @ts-ignore
          if (bar && bar.queue && typeof bar.queue.shuffle === "function") {
            // @ts-ignore
            bar.queue.shuffle();
          } else {
            const btn = document.querySelector(".shuffle.ytmusic-player-bar, #right-controls .shuffle");
            if (btn && typeof (/** @type {any} */ (btn)).click === "function") {
              (/** @type {any} */ (btn)).click();
            }
          }
        } else {
          // En YouTube normal: botón shuffle en panel de playlist
          const shuffleBtn = document.querySelector(
            "ytd-playlist-panel-renderer [aria-label*='Aleatorio' i], ytd-playlist-panel-renderer [aria-label*='Shuffle' i], ytd-playlist-panel-renderer #playlist-actions button"
          );
          if (shuffleBtn && typeof (/** @type {any} */ (shuffleBtn)).click === "function") {
            (/** @type {any} */ (shuffleBtn)).click();
          }
        }
        break;
      }

      case "NEXT": {
        if (!isMusic && mp) {
          // @ts-ignore
          if (typeof mp.nextVideo === "function") mp.nextVideo();
        }
        break;
      }

      case "PREV": {
        if (!isMusic && mp) {
          // @ts-ignore
          if (typeof mp.previousVideo === "function") mp.previousVideo();
        }
        break;
      }

      case "PLAY": {
        if (!isMusic && mp) {
          // @ts-ignore
          if (typeof mp.playVideo === "function") mp.playVideo();
        } else {
          const video = document.querySelector("video");
          if (video) video.play().catch(() => {});
        }
        break;
      }

      case "PAUSE": {
        if (!isMusic && mp) {
          // @ts-ignore
          if (typeof mp.pauseVideo === "function") mp.pauseVideo();
        } else {
          const video = document.querySelector("video");
          if (video) video.pause();
        }
        break;
      }

      case "PLAY_PAUSE": {
        const video = document.querySelector("video");
        if (video) {
          if (!video.paused) {
            if (!isMusic && mp && typeof mp.pauseVideo === "function") {
              // @ts-ignore
              mp.pauseVideo();
            }
            video.pause();
          } else {
            if (!isMusic && mp && typeof mp.playVideo === "function") {
              // @ts-ignore
              mp.playVideo();
            }
            video.play().catch(() => {});
          }
        } else if (!isMusic && mp) {
          // @ts-ignore
          const playerState = typeof mp.getPlayerState === "function" ? mp.getPlayerState() : -1;
          if (playerState === 1 || playerState === 3) {
            // @ts-ignore
            if (typeof mp.pauseVideo === "function") mp.pauseVideo();
          } else {
            // @ts-ignore
            if (typeof mp.playVideo === "function") mp.playVideo();
          }
        }
        break;
      }
    }
  });
})();
