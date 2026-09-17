// Caché de resultados exitosos por clave de ejecución (D8 de ai-gateway-core, ADR-018 §6). Solo tipos.

/** Lo único que se guarda: nunca el input ni el prompt. */
export interface CachedResult {
  output: unknown;
  providerId: string;
  model: string;
  promptVersion: string;
}

export interface ResultCache {
  /** `null` si no hay entrada. Un fallo del almacén se trata como ausencia. */
  get(key: string): Promise<CachedResult | null>;
  set(key: string, value: CachedResult): Promise<void>;
}
