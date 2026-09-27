/**
 * Prefijo de lo que crea la suite (design D10): los grupos del recorrido se llaman `e2e-…` y los CV, `e2e-*`, para que
 * la limpieza previa y final de la cuenta remota (tarea 4.2) sepa qué es suyo.
 */
export const SUITE_PREFIX = 'e2e-';

/**
 * Guardias de la cuenta remota por `GET /api/users/me` (design D10): email sin verificar, permiso de IA externa apagado
 * y email con `+e2e`. **Los aporta la tarea 4.3a** (grupo 4, después de la 5.1), que fija también su firma. Hasta
 * entonces el paso 0 **falla** aquí: sin guardias, el perfil `remote` no puede tocar la cuenta, y un guardia que no
 * comprueba nada daría un verde falso.
 */
export function assertRemoteAccountGuards(): Promise<void> {
  return Promise.reject(
    new Error('the remote account guards (design D10) arrive with task 4.3a of e2e-suite; step 0 cannot go on without them'),
  );
}

/**
 * Limpieza previa de lo que dejó una corrida interrumpida (grupos con `SUITE_PREFIX`, CV `e2e-*`, postulaciones sobre
 * esos links), **después** de los guardias. **La aporta la tarea 4.2.** Hasta entonces, falla.
 */
export function sweepSuiteLeftovers(): Promise<void> {
  return Promise.reject(
    new Error('the sweep of suite leftovers (design D10) arrives with task 4.2 of e2e-suite; step 0 cannot go on without it'),
  );
}
