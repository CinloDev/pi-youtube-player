// @ts-check
/**
 * Pi YouTube Music Bridge - Background Service Worker (Manifest V3)
 * Mantiene la conexión WebSocket con Pi en ws://127.0.0.1:7788
 * Evita el bloqueo de Mixed Content de HTTPS al correr bajo chrome-extension://
 */

const WS_URL = "ws://127.0.0.1:7788";
let socket = null;
let isConnecting = false;
let heartbeatTimer = null;

console.log("[Pi-YT Background] Service Worker iniciado.");

// --- 1. WebSocket hacia Pi (Node runtime) ---

function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  isConnecting = true;
  try {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      isConnecting = false;
      console.log("[Pi-YT Background] Conectado exitosamente con Pi en", WS_URL);
      sendToPi({
        type: "CLIENT_CONNECTED",
        client: "Chrome Extension Background (YouTube & Music Universal)",
        timestamp: Date.now(),
      });

      // Pedir a las pestañas de YouTube / YouTube Music que envíen su estado de inmediato
      requestStateFromTabs();
    };

    socket.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        handleIncomingCommand(packet);
      } catch {
        // Ignorar mensajes malformados
      }
    };

    socket.onclose = () => {
      socket = null;
      isConnecting = false;
      setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = () => {
      if (socket) {
        socket.close();
      }
    };
  } catch {
    isConnecting = false;
    setTimeout(connectWebSocket, 3000);
  }
}

function sendToPi(data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

// Keep-alive para evitar que Chrome congele el Service Worker tras 30 segundos
function setupKeepAlive() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      sendToPi({ type: "HEARTBEAT", timestamp: Date.now() });
    } else {
      connectWebSocket();
    }
  }, 5000);
}

// Iniciar conexión y keep-alive
connectWebSocket();
setupKeepAlive();

function requestStateFromTabs() {
  chrome.tabs.query({ url: ["https://music.youtube.com/*", "https://www.youtube.com/*"] }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    for (const tab of tabs) {
      if (tab.id !== undefined) {
        chrome.tabs.sendMessage(tab.id, { type: "REQUEST_STATE" }).catch(() => {});
      }
    }
  });
}

// --- 2. Mensajería con content-script.js (Pestaña de YouTube Music) ---

// Recibir estado extraído del DOM desde content-script.js y enviarlo a Pi
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message && message.type === "PLAYER_STATE") {
    sendToPi({
      type: "PLAYER_STATE",
      data: message.data,
      timestamp: Date.now(),
    });
  }
  return true;
});

/**
 * Abre o cierra la ventana nativa Picture-in-Picture de Chrome inyectando
 * un userGesture real mediante chrome.debugger (Runtime.evaluate con userGesture: true).
 * De esta manera Chrome abre únicamente el reproductor de video limpio sin bordes
 * y sin tocar ni mover la ventana principal del navegador.
 */
async function toggleNativePipWithGesture(tabId) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (_) {
    // Si ya estaba adjunto, continuar
  }

  try {
    // Paso 1: Si ya está en PiP nativo, cerrarlo. Si está en modo Canción (videoWidth === 0), cambiar a pestaña Video y esperar frames.
    const step1 = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: `(async () => {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
          return { action: "exited", isPip: false };
        }

        let video = document.querySelector("video");
        if (!video) return { action: "no-video", isPip: false };

        if (video.videoWidth === 0) {
          const candidates = Array.from(
            document.querySelectorAll(
              "ytmusic-av-toggle button, .av-toggle button, ytmusic-av-toggle tp-yt-paper-button, .video-button.ytmusic-av-toggle, [aria-label*='Video' i], [aria-label*='Vídeo' i]"
            )
          );
          const videoBtn = candidates.find((el) => {
            const t = (el.textContent || el.getAttribute("aria-label") || "").trim().toLowerCase();
            return t === "video" || t === "vídeo" || t.includes("cambiar a video") || t.includes("switch to video");
          });
          if (videoBtn && typeof videoBtn.click === "function") {
            videoBtn.click();
          }

          for (let i = 0; i < 35; i++) {
            await new Promise((r) => setTimeout(r, 100));
            video = document.querySelector("video");
            if (video && video.videoWidth > 0 && video.readyState >= 1) {
              break;
            }
          }
        }

        return { action: "ready", videoWidth: video ? video.videoWidth : 0 };
      })()`,
      userGesture: true,
      awaitPromise: true,
      returnByValue: true,
    });

    const step1Val = step1?.result?.value;
    if (step1Val?.action === "exited") {
      sendToPi({
        type: "PLAYER_STATE",
        data: { isPip: false },
        timestamp: Date.now(),
      });
      return;
    }

    // Paso 2: Disparar requestPictureInPicture() con un userGesture: true fresco y directo
    const step2 = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: `(async () => {
        const video = document.querySelector("video");
        if (!video || video.videoWidth === 0) {
          return { isPip: false, reason: "no-video-stream" };
        }
        video.removeAttribute("disablepictureinpicture");
        await video.requestPictureInPicture();
        return { isPip: Boolean(document.pictureInPictureElement) };
      })()`,
      userGesture: true,
      awaitPromise: true,
      returnByValue: true,
    });

    const isPipNow = Boolean(step2?.result?.value?.isPip);
    sendToPi({
      type: "PLAYER_STATE",
      data: { isPip: isPipNow },
      timestamp: Date.now(),
    });
  } catch (err) {
    console.warn("[Pi-YT Background] Error al alternar Picture-in-Picture nativo:", err);
  } finally {
    try {
      await chrome.debugger.detach(target);
    } catch (_) {}
    requestStateFromTabs();
  }
}

function sendMessageWithAutoReinject(tabId, packet) {
  chrome.tabs.sendMessage(tabId, packet).catch(() => {
    if (chrome.scripting && chrome.scripting.executeScript) {
      chrome.scripting
        .executeScript({
          target: { tabId },
          files: ["content-script.js"],
        })
        .then(() => {
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, packet).catch(() => {});
          }, 150);
        })
        .catch(() => {});
    }
  });
}

// Despachar comandos desde Pi hacia la pestaña de YouTube / YouTube Music
function handleIncomingCommand(packet) {
  if (!packet || packet.type !== "COMMAND") return;

  chrome.tabs.query({ url: ["https://music.youtube.com/*", "https://www.youtube.com/*"] }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      console.warn("[Pi-YT Background] No se encontraron pestañas de YouTube abiertas para despachar comando:", packet.action);
      return;
    }

    // Priorizar pestañas: primero la que esté sonando activamente (audible), sino la activa en ventana, sino la primera
    const targetTabs = [...tabs].sort((a, b) => {
      if (a.audible && !b.audible) return -1;
      if (!a.audible && b.audible) return 1;
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      return 0;
    });

    if (packet.action === "TOGGLE_PIP") {
      const targetTab = targetTabs[0];
      if (targetTab && targetTab.id !== undefined) {
        toggleNativePipWithGesture(targetTab.id);
      }
      return;
    }

    // Para comandos de reproducción, enviar a la pestaña prioritaria si hay varias abiertas
    const bestTab = targetTabs[0];
    if (bestTab && bestTab.id !== undefined) {
      console.log("[Pi-YT Background] Enviando comando a pestaña:", packet.action, bestTab.url);
      sendMessageWithAutoReinject(bestTab.id, packet);
    }
  });
}
