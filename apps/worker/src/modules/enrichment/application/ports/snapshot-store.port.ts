// Puerto de la copia de la página descargada (D12 de link-enrichment). Solo tipos y el token: se inyecta con
// `{ provide: SNAPSHOT_STORE, useClass: S3SnapshotStore }`.
//
// El snapshot existe por una razón concreta y acotada: poder construir después el golden real de `extract-job` sin
// volver a pedirle nada al sitio (D8). Por eso el bucket expira a 30 días: esa razón no necesita historia infinita.

export const SNAPSHOT_STORE = Symbol('SNAPSHOT_STORE');

export interface SnapshotStore {
  /**
   * Guarda la copia comprimida del HTML y devuelve **su clave**, que es lo que se guarda en el link. Devuelve `null`
   * si no se pudo guardar: un almacenamiento caído no puede impedir que el preview se escriba, así que el fallo se
   * registra y el link se queda sin clave de snapshot.
   *
   * Se llama **después** de ganar la escritura condicionada, de modo que el snapshot siempre corresponde al preview
   * que lo acompaña y la ejecución perdedora no deja ningún objeto.
   */
  save(
    linkId: string,
    previewVersion: number,
    html: string,
  ): Promise<string | null>;
}
