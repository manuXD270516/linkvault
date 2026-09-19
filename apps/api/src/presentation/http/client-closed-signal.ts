/**
 * Lo que hace falta de la respuesta HTTP en crudo para saber si el cliente se fue: la de Node (`ServerResponse`) lo
 * cumple, y un doble de test también.
 */
export interface RawResponse {
  /** `true` una vez que la respuesta se terminó de escribir. */
  readonly writableEnded: boolean;
  once(event: 'close', listener: () => void): unknown;
}

/**
 * Señal que se aborta si el cliente cierra la conexión **antes** de recibir la respuesta (D1 de paste-job-description):
 * quien pega cierra el diálogo o la pestaña, y la IA deja de leer para nadie. Se mira la respuesta y no la petición
 * porque en Node la petición emite `close` también al terminar de leer el cuerpo, y eso abortaría todas.
 *
 * Una respuesta que ya se escribió entera también emite `close`: eso no es un abandono y no aborta nada.
 */
export function clientClosedSignal(response: RawResponse): AbortSignal {
  const controller = new AbortController();
  response.once('close', () => {
    if (!response.writableEnded) {
      controller.abort();
    }
  });
  return controller.signal;
}
