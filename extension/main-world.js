// @ts-check
/**
 * Pi YouTube Music Bridge - Main World Script
 * Corre en el contexto global de la página (MAIN world) de music.youtube.com.
 * Tiene acceso directo al objeto DOM de Polymer (ytmusic-player-bar), al reproductor (#movie_player)
 * y a los stores internos de Redux de YouTube Music, sin restricciones de Isolated World ni de CSP.
 */

(function () {
  console.log("[Pi-YT MainWorld] Script cargado en el contexto de music.youtube.com");

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

          // 1. Llamar al método oficial de la barra de YouTube Music
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

          // 2. Llamar a la API de movie_player de YouTube
          // @ts-ignore
          if (mp && typeof mp.setVolume === "function") {
            // @ts-ignore
            mp.setVolume(vol);
          }

          // 3. Slider en el DOM
          const slider = document.querySelector("#volume-slider");
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
        // En YouTube Music onRepeatButtonClick cicla: NONE -> ALL -> ONE -> NONE
        // @ts-ignore
        if (bar && typeof bar.onRepeatButtonClick === "function") {
          // @ts-ignore
          bar.onRepeatButtonClick();
        } else {
          // Fallback a click en el botón del DOM
          const btn = document.querySelector(".repeat.ytmusic-player-bar, #right-controls .repeat");
          if (btn && typeof (/** @type {any} */ (btn)).click === "function") {
            (/** @type {any} */ (btn)).click();
          }
        }
        break;
      }

      case "SHUFFLE": {
        // En YouTube Music queue.shuffle() mezcla o activa/desactiva aleatorio
        // @ts-ignore
        if (bar && bar.queue && typeof bar.queue.shuffle === "function") {
          // @ts-ignore
          bar.queue.shuffle();
        } else {
          // Fallback a click en el botón del DOM
          const btn = document.querySelector(".shuffle.ytmusic-player-bar, #right-controls .shuffle");
          if (btn && typeof (/** @type {any} */ (btn)).click === "function") {
            (/** @type {any} */ (btn)).click();
          }
        }
        break;
      }
    }
  });
})();
