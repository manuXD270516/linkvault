import type { PreviewSourceKind } from '../schemas/preview.schema';

// Precedencia de los orígenes de un campo del preview (D3 de paste-job-description): **escrito a mano > pegado > leído
// de la página**. Vive aquí una sola vez y la usan el merge del worker y el pegado de `api`: si alguien cambia el orden,
// cambia para los dos, que es lo que impide que las dos copias del merge diverjan.
//
// Es solo el orden entre orígenes. Que un valor vacío no sustituya a uno lleno es otra regla, la de `saysSomething`
// en `preview-draft.ts`, y vale para lo automático y lo pegado pero no para lo escrito a mano.

/** Rango de cada origen: cuanto más alto, más pesa. Es un orden total, así que no hay empates entre orígenes. */
const RANK: Readonly<Record<PreviewSourceKind, number>> = {
  auto: 0,
  pasted: 1,
  manual: 2,
};

/**
 * Si un valor que llega con origen `incoming` puede sustituir al que el campo ya tiene con origen `previous`. Un campo
 * sin entrada (`undefined`) lo puede escribir cualquiera.
 *
 * Un origen sustituye a otro de su mismo rango: una relectura trae la página tal como está hoy, alguien pega una versión
 * mejor de la oferta, o alguien corrige lo que otra persona escribió. Lo que no hace nunca es sustituir a uno de rango
 * superior: una relectura no pisa lo pegado ni lo escrito a mano, y pegar no pisa lo escrito a mano.
 */
export function mayOverwrite(
  previous: PreviewSourceKind | undefined,
  incoming: PreviewSourceKind,
): boolean {
  if (previous === undefined) return true;
  return RANK[incoming] >= RANK[previous];
}
