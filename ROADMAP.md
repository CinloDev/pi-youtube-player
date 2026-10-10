# Roadmap de Implementación

Este documento detalla las fases de desarrollo atómicas para construir e integrar **`pi-youtube-player`**.

---

## 📅 Fases de Trabajo

### Fase 1: Scaffolding y Estructura Base del Proyecto
- [ ] Configuración de `package.json` con dependencias mínimas (librería `ws` o servidor WebSocket nativo de Node.js).
- [ ] Configuración de `tsconfig.json` para compilación limpia a ESM compatible con Pi.
- [ ] Definición de tipos TypeScript compartidos (`types.ts`).

### Fase 2: Servidor WebSocket de la Extensión
- [ ] Implementación de `src/server.ts`:
  - Inicio del servidor en `127.0.0.1:7788`.
  - Manejo de conexiones, reconexiones y desconexiones de clientes.
  - Heartbeat y detección de clientes inactivos.
- [ ] Implementación del gestor de estado en memoria `src/player-service.ts`.
- [ ] Publicación del singleton en `globalThis[Symbol.for('pi-youtube-player')]`.

### Fase 3: Comandos Slash de Pi e Integración
- [ ] Implementación del punto de entrada `index.ts`.
- [ ] Registro de comandos:
  - `/yt` o `/yt play`
  - `/yt pause`
  - `/yt next`
  - `/yt prev`
  - `/yt status`
- [ ] Pruebas unitarias con mocks de clientes WebSocket (`test/server.test.ts`).

### Fase 4: Userscript para el Navegador (Browser Bridge)
- [ ] Creación de `browser/bridge.user.js`:
  - Detección reactiva del tag `<video>` y barra de reproducción de YouTube Music / YouTube.
  - Envío de `PLAYER_STATE` al conectar y al cambiar de tema.
  - Recepción de `COMMAND` para invocar play, pause, next y previous.
  - Reconexión silenciosa resiliente con backoff exponencial.

### Fase 5: Integración con la Sidebar de Pi (TUI)
- [ ] Verificación de estabilidad del reproductor mediante comandos de terminal.
- [ ] Creación de la tarjeta TUI interactiva en `pi-cinlodev-cute` (consumiendo el Symbol sin acoplamiento).
- [ ] Hitboxes para clic del mouse y atajos opcionales.
