// Puerto de lectura y borrado del archivo de un CV en el almacén de objetos (D8 de cv-upload-extract). El worker es el
// **único** lector de esos bytes: no hay ninguna ruta de la API que los devuelva.

export const CV_FILE_READER = Symbol('CV_FILE_READER');

export interface CvFileReader {
  /**
   * Bytes del objeto, o `null` si **no existe**. Esa distinción es el tercer corte de idempotencia (D8): un objeto que
   * no está no aparece a los cinco segundos, así que el job termina sin reintentos y el CV queda en `failed`. Que el
   * almacén **no responda**, o que **su bucket** no exista, es otra cosa y se reintenta: eso **lanza**, y la cola lo
   * reintenta (design D15 de `object-store`).
   */
  read(key: string): Promise<Uint8Array | null>;

  /**
   * Borra el objeto. Borrar uno que ya no está es un **acierto**, no un error: por eso consumir dos veces el evento de
   * borrado es inofensivo. Un fallo del almacén, o su bucket ausente, lanza y la cola lo reintenta: nunca se da por
   * borrado un objeto de un bucket que no existe.
   */
  remove(key: string): Promise<void>;
}
