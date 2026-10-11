import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface CoverArtData {
  path: string;
  base64: string;
  mimeType: string;
}

/**
 * Administrador de caché y descarga en segundo plano para las portadas de YouTube Music.
 * Garantiza descarga asíncrona no bloqueante con timeout y almacenamiento temporal seguro.
 */
export class CoverArtManager {
  private lastUrl = "";
  private currentCover: CoverArtData | null = null;
  private isDownloading = false;
  private tempCoverPath = join(tmpdir(), "pi-yt-current-cover.png");

  /**
   * Obtiene o descarga la portada desde la URL provista.
   * Si la URL no cambió y ya existe en caché, retorna inmediatamente la versión en memoria.
   */
  public async getCoverArt(url?: string): Promise<CoverArtData | null> {
    if (!url || !url.startsWith("http")) {
      this.lastUrl = "";
      this.currentCover = null;
      return null;
    }

    if (url === this.lastUrl && this.currentCover) {
      return this.currentCover;
    }

    if (this.isDownloading) {
      return this.currentCover;
    }

    this.isDownloading = true;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return this.currentCover;
      }

      const mimeType = res.headers.get("content-type") || "image/png";
      const buffer = Buffer.from(await res.arrayBuffer());

      if (buffer.length === 0) {
        return this.currentCover;
      }

      await fs.writeFile(this.tempCoverPath, buffer);

      this.lastUrl = url;
      this.currentCover = {
        path: this.tempCoverPath,
        base64: buffer.toString("base64"),
        mimeType,
      };

      return this.currentCover;
    } catch {
      // Silenciar errores de red o timeouts para evitar degradar el loop principal
      return this.currentCover;
    } finally {
      this.isDownloading = false;
    }
  }

  public getCachedCover(): CoverArtData | null {
    return this.currentCover;
  }
}
