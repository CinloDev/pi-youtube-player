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
        client: "Chrome Extension Background (YouTube Music)",
        timestamp: Date.now(),
      });

      // Pedir a las pestañas de YouTube Music que envíen su estado de inmediato
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
  chrome.tabs.query({ url: "https://music.youtube.com/*" }, (tabs) => {
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

// Despachar comandos desde Pi hacia la pestaña de YouTube Music
function handleIncomingCommand(packet) {
  if (!packet || packet.type !== "COMMAND") return;

  chrome.tabs.query({ url: "https://music.youtube.com/*" }, (tabs) => {
    if (!tabs || tabs.length === 0) return;

    for (const tab of tabs) {
      if (tab.id !== undefined) {
        chrome.tabs.sendMessage(tab.id, packet).catch(() => {
          // Ignorar pestañas en proceso de carga
        });
      }
    }
  });
}
