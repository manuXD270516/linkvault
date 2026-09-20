import ogImage from '../../../../public/assets/og-default.png' with { loader: 'binary' };

/**
 * La imagen Open Graph de marca (D5, ADR-027 §4). Es fija, la misma para la página que sirve la api y para el
 * `index.html` del SPA, y vive en `apps/web/public/assets/`, que es la carpeta que el build copia a la raíz: por eso
 * `WEB_BASE_URL/assets/og-default.png` la resuelve.
 */
describe('og-default.png', () => {
  /** Cabecera de un PNG: firma de 8 bytes, luego el `IHDR` con el ancho y el alto en big endian. */
  function header(): { signature: number[]; width: number; height: number } {
    const view = new DataView(ogImage.buffer, ogImage.byteOffset, ogImage.byteLength);
    return {
      signature: Array.from(ogImage.slice(0, 8)),
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  }

  it('is a 1200x630 PNG, the size every chat expects of a card', () => {
    const { signature, width, height } = header();

    expect(signature).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(width).toBe(1200);
    expect(height).toBe(630);
  });

  it('is small enough for a crawler to fetch it without thinking', () => {
    expect(ogImage.byteLength).toBeGreaterThan(0);
    expect(ogImage.byteLength).toBeLessThan(300_000);
  });
});
