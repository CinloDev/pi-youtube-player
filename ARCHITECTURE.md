# Arquitectura Técnica y Protocolo de Comunicación

Este documento define la arquitectura integral de **`pi-youtube-player`**, los componentes del sistema, el protocolo de mensajes sobre WebSocket y las directivas de seguridad.

---

## 1. Componentes del Sistema

El ecosistema se divide en tres capas desacopladas:

1. **Browser Bridge (Cliente en el Navegador):**
   - Un script mínimo inyectado únicamente en `music.youtube.com` o `youtube.com` (mediante Tampermonkey / Violentmonkey).
   - Se ejecuta en el contexto del navegador donde Cinlo tiene su cuenta **YouTube Premium**.
   - Escucha los eventos del elemento `<video>` nativo (`timeupdate`, `play`, `pause`, `ended`).
   - Lee los metadatos visuales del DOM (título del tema, artista, portada).
   - Se conecta como cliente WebSocket a `ws://127.0.0.1:7788`.

2. **Extension Core (Servidor en Pi):**
   - Corre dentro del runtime de Node.js de la sesión de Pi.
   - Levanta un servidor `ws.Server` escuchando exclusivamente en `127.0.0.1:7788`.
   - Mantiene en memoria el estado reactivo del reproductor (`YouTubePlayerState`).
   - Provee comandos slash para la consola de Pi:
     - `/yt` o `/yt play`: Alterna play/pause.
     - `/yt next`: Salta al siguiente tema.
     - `/yt prev`: Vuelve al tema anterior.
     - `/yt status`: Muestra la canción sonando.
   - Registra la API pública en `globalThis[Symbol.for('pi-youtube-player')]`.

3. **TUI Consumer (Consumidor en la Sidebar / Tema):**
   - Opcional y completamente desacoplado (por ejemplo, una tarjeta en `pi-cinlodev-cute`).
   - Consulta el estado desde el `Symbol` global.
   - Dibuja la tarjeta en la sidebar con los botones `[ ▶ Play ]`, `[ ❚❚ Pausa ]`, `[ ⏭ ]`, `[ ⏮ ]`.
   - Al hacer clic o usar la rueda del mouse, llama a los métodos de la API (`player.togglePlay()`, etc.).

---

## 2. Protocolo de Mensajes (WebSocket RFC)

Todos los mensajes que viajan por el socket son objetos JSON con la estructura:

```typescript
export interface BasePacket {
  type: string;
  timestamp: number;
}
```

### De Navegador a Extensión (Upstream / Estado)

#### `HEARTBEAT / HELLO`
Enviado apenas se conecta el navegador para anunciar que la pestaña de YouTube está lista.
```json
{
  "type": "CLIENT_CONNECTED",
  "client": "YouTube Music Web",
  "timestamp": 1791582000000
}
```

#### `PLAYER_STATE`
Enviado cuando cambia el estado de reproducción, cambia de canción o cada segundo para actualizar el tiempo transcurrido.
```json
{
  "type": "PLAYER_STATE",
  "data": {
    "status": "playing",          // "playing" | "paused" | "stopped" | "idle"
    "title": "Starboy",
    "artist": "The Weeknd ft. Daft Punk",
    "album": "Starboy",
    "currentTime": 74,            // Segundos actuales
    "duration": 230,              // Duración total en segundos
    "volume": 0.8,                // 0.0 a 1.0
    "isLiked": true,
    "thumbnailUrl": "https://..."
  },
  "timestamp": 1791582001000
}
```

---

### De Extensión a Navegador (Downstream / Comandos)

Enviado cuando el usuario ejecuta un comando en Pi o hace clic en un botón de la sidebar.

#### `COMMAND`
```json
{
  "type": "COMMAND",
  "action": "PLAY_PAUSE",        // "PLAY" | "PAUSE" | "PLAY_PAUSE" | "NEXT" | "PREV" | "SET_VOLUME" | "SEEK"
  "payload": {},                 // Opcional: { "value": 0.5 } para volumen o seek
  "timestamp": 1791582005000
}
```

---

## 3. Especificación del Browser Bridge (Userscript)

El script del navegador se define con permisos mínimos estrictos:

```javascript
// ==UserScript==
// @name         Pi YouTube Player Bridge
// @namespace    https://github.com/CinloDev/pi-youtube-player
// @version      1.0.0
// @description  Puente seguro y ultra liviano entre YouTube Music y el agente Pi
// @match        https://music.youtube.com/*
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
```

### Comportamiento del Bridge:
1. **Reconexión Automática con Backoff:** Si Pi no está abierto o se reinicia, el script reintenta la conexión a `ws://127.0.0.1:7788` cada 3 segundos de fondo sin tirar errores a la consola.
2. **Control Nativo del DOM:**
   - Para Play/Pause: Si existe `<video>`, ejecuta `video.play()` o `video.pause()`, o simula clic en el botón nativo `#play-pause-button`.
   - Para Siguiente: Clic en `.next-button` o `#next-button`.
   - Para Anterior: Clic en `.previous-button` o `#previous-button`.
3. **Extracción de Metadatos:**
   - En YouTube Music:
     - Título: `document.querySelector('.title.ytmusic-player-bar')?.textContent`
     - Artista: `document.querySelector('.byline.ytmusic-player-bar')?.textContent`

---

## 4. API Pública para Pi y Temas

La extensión publica su controlador en `globalThis`:

```typescript
export const YOUTUBE_PLAYER_SYMBOL = Symbol.for("pi-youtube-player");

export interface IYouTubePlayerService {
  getState(): YouTubePlayerState;
  on(event: "stateChange", listener: (state: YouTubePlayerState) => void): () => void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  next(): void;
  previous(): void;
  setVolume(volume: number): void;
}
```

### Ventaja de esta integración:
- En `pi-cinlodev-cute`, la tarjeta de la sidebar puede hacer:
  ```typescript
  const player = (globalThis as any)[Symbol.for("pi-youtube-player")];
  if (player && player.getState().status === "playing") {
    // Dibujar tarjeta interactiva
  }
  ```
- Si la extensión no está instalada, el tema simplemente no dibuja nada y sigue funcionando normalmente sin lanzar errores.

---

## 5. Análisis de Seguridad

1. **Aislamiento de Red:** El servidor WebSocket escucha **exclusivamente en `127.0.0.1` (localhost)**. Ninguna otra máquina de la red local puede acceder a la sesión.
2. **Cero Manipulación de Tokens ni Cookies:** El agente Pi jamás solicita ni almacena credenciales de Google, cookies de sesión ni tokens de autenticación.
3. **Respeto a las Políticas de YouTube:** No se realiza ingeniería inversa a los streams de audio ni se descarga contenido protegido; la reproducción ocurre 100% de manera oficial dentro del navegador con la suscripción del usuario.
