// Contador de intentos por ventana fija, infraestructura de plataforma (D13 de link-enrichment, ADR-020 §5). Vive aquí
// y no dentro de `auth` porque lo usan dos módulos: `auth` para el login y el registro, y `links` para las
// importaciones y los reintentos de lectura. Así `links` no importa nada de `auth` y la regla de módulos se respeta.
//
// El contador NO decide qué hacer cuando el almacén no responde: devuelve `null` y **quien llama elige**. Esa elección
// es una decisión de producto distinta en cada caso: negar una importación por un Redis lento sería peor que dejarla
// pasar (falla abierto), mientras que lo que se permitiría sin contador en un reintento de lectura es volver a
// descargar de un sitio ajeno, y eso sí se niega (falla cerrado).

export const FIXED_WINDOW_COUNTER = Symbol('FIXED_WINDOW_COUNTER');

/** Cuántos intentos caben y cuánto dura la ventana. */
export interface WindowLimit {
  readonly limit: number;
  readonly windowMs: number;
}

/** Resultado de contar un intento. */
export interface AttemptOutcome {
  readonly allowed: boolean;
  /** Segundos hasta que se reinicia la ventana si no se permite (entero ≥ 1); 0 si se permite. */
  readonly retryAfterSeconds: number;
}

export interface FixedWindowCounter {
  /**
   * Cuenta un intento sobre esa clave y dice si cabe en la ventana actual. Atómico: N peticiones simultáneas no superan
   * el límite. Devuelve `null` si el almacén no respondió, para que quien llama decida si eso permite o niega.
   */
  consume(key: string, limit: WindowLimit): Promise<AttemptOutcome | null>;
  /** Pone a cero el contador. `false` si el almacén no respondió. */
  reset(key: string): Promise<boolean>;
  /**
   * Devuelve un intento al contador, borrándolo si con eso vuelve a cero o por debajo: así una clave no acumula crédito
   * ni queda viva para siempre cuando su ventana ya había caducado. `false` si el almacén no respondió.
   */
  giveBack(key: string): Promise<boolean>;
}
