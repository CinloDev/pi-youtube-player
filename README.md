# pi-youtube-player 🎵

> Extensión modular ultra-liviana para el arnés de agentes **Pi** (`@earendil-works/pi-coding-agent`) que permite controlar tu sesión nativa de **YouTube Music / YouTube** (con tu cuenta **Premium**, cero anuncios y máxima fidelidad) directamente desde la terminal y la sidebar, sin consumir memoria extra y con total aislamiento de medios.

---

## 🎯 Visión y Filosofía

1. **YouTube Premium Nativo:** No utiliza librerías de scraping ni APIs externas dudosas. Se enlaza de forma segura con la pestaña que ya tenés abierta en tu navegador con tu sesión iniciada.
2. **Cero Consumo Adicional de Recursos:** No levanta navegadores headless ni instancias de Electron extra. La extensión se comunica mediante un WebSocket local minúsculo (<1 MB RAM, 0% CPU).
3. **Aislamiento Estricto de Medios:** A diferencia del protocolo genérico D-Bus/MPRIS de Linux (que mezcla Disney+, Netflix, Twitter o llamadas), este reproductor se conecta **única y exclusivamente** con tu pestaña de YouTube seleccionada.
4. **Desacoplado y Extensible:** La lógica vive en esta extensión independiente. Expone su estado y API a través de un `Symbol` global (`Symbol.for('pi-youtube-player')`), lo que permite que cualquier tema (como `pi-cinlodev-cute`) o componente TUI dibuje controles interactivos sin acoplar código.

---

## 🏗️ Arquitectura General

```
┌────────────────────────────────────────┐
│  Navegador Web (Chrome / Brave / FF)   │
│  Pestaña: music.youtube.com (Premium)  │
│  └─ Userscript / Bridge                │
└───────────────────▲────────────────────┘
                    │ WebSocket Local
                    │ ws://127.0.0.1:7788
┌───────────────────▼────────────────────┐
│  pi-youtube-player (Extensión de Pi)   │
│  - Servidor WebSocket local            │
│  - Gestor de estado (Play/Pause/Track) │
│  - Comandos Pi (/yt play, /yt next)    │
│  - API pública via Symbol global       │
└───────────────────▲────────────────────┘
                    │ Symbol.for('pi-youtube-player')
┌───────────────────▼────────────────────┐
│  Sidebar TUI (ej. pi-cinlodev-cute)    │
│  - Card interactiva en sidebar         │
│  - [ ▶ ] [ ⏸ ] [ ⏭ ] [ ⏮ ]          │
└────────────────────────────────────────┘
```

---

## 🚀 Requisitos

- **Entorno:** Linux / macOS / Windows con Node.js 20+.
- **Agente Pi:** Versión 0.85+ / 1.0+.
- **Navegador:** Cualquier navegador moderno con extensión de Userscripts (Tampermonkey, Violentmonkey) o una mini extensión local.

---

## 📚 Documentación Técnica

- [Arquitectura y Protocolo de Comunicación (ARCHITECTURE.md)](./ARCHITECTURE.md)
- [Roadmap de Implementación (ROADMAP.md)](./ROADMAP.md)

---

## 📄 Licencia

MIT © CinloDev
