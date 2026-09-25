/**
 * **Registro declarado de recursos desmentidos y de los sitios donde vive un valor por defecto**
 * (requirement "Configuración por entorno documentada" de `platform/local-environment`, ADR-048 §6).
 *
 * Un valor por defecto no puede ser uno que el propio repositorio documente como inservible. No falla ruidosamente:
 * abre el breaker y degrada en silencio, que es la avería más cara de diagnosticar. Y el valor por defecto no vive
 * en un sitio, vive en **tres**: el ejemplo, el compose de producción y el default del **código** —el que gana
 * cuando la variable no está o está vacía—. Corregir solo el ejemplo deja la avería donde más cuesta verla.
 */

/**
 * Recursos externos que el repositorio documenta como muertos. `value` es el literal exacto: se compara por
 * igualdad, no por subcadena, para que la comprobación no se dispare con un texto que lo **nombre**.
 *
 * @typedef {object} DeadResource
 * @property {string} value
 * @property {string} kind
 * @property {string} evidence     Dónde consta que está muerto.
 * @property {string} replacement  Qué se usa en su lugar, y por qué es válido.
 */

/** @type {readonly DeadResource[]} */
export const DEAD_RESOURCES = [
  {
    value: 'meta-llama/llama-3.3-70b-instruct:free',
    kind: 'modelo de OpenRouter',
    evidence:
      'docs/RUNBOOK.md, Paso 6 nonies, «Pasada manual OpenRouter (tarea 17.8)»: el modelo responde 404, ya no existe',
    replacement:
      'cohere/north-mini-code:free — disponible en esa misma pasada y terminado en `:free`, que es lo único con lo que OpenRouter fuerza `data_collection: deny` (ADR-032 §4). Las dos condiciones son necesarias: un modelo vivo que no sea `:free` haría viajar el texto del CV sin la política, en silencio',
  },
];

/**
 * Espacios de nombres de imagen que el proyecto **no controla**. No se afirma que estén libres —no se ha
 * comprobado—: basta con que su control no dependa del proyecto. Un valor por defecto hacia territorio ajeno es una
 * vía de suministro (ADR-048 §4-bis).
 */
export const FOREIGN_IMAGE_NAMESPACES = [
  {
    prefix: 'ghcr.io/linkvault/',
    reason:
      'organización ajena que nadie del proyecto controla; nunca se ejercitó porque los workflows siempre exportan API_IMAGE/WORKER_IMAGE/WEB_IMAGE',
  },
];

/** Espacio de nombres real del repositorio (`git remote`: github.com/manuXD270516/linkvault). */
export const OWN_IMAGE_NAMESPACE = 'ghcr.io/manuxd270516/';

/**
 * **Alcance de la comprobación, declarado aquí y no deducido.** Se inspeccionan **solo** estos tres sitios, que son
 * los que deciden qué valor recibe un proceso cuando nadie configura nada:
 *
 *  1. `.env.example`     — lo que alguien copia sin leerlo entero;
 *  2. compose de prod    — los `${VAR:-…}` de los servicios `api` y `worker`, y los `image:`;
 *  3. el default del código — `AI_CONFIG_DEFAULTS`, el que gana cuando la variable falta o está vacía.
 *
 * **Exclusiones, con su motivo:**
 *
 * - `infra/ci/verify.env`: relleno declarado para la verificación en el corredor. Su propia cabecera dice que no
 *   sirve para ningún despliegue, así que no es el valor por defecto de nadie.
 * - **Los ficheros de test.** Unos veinte ficheros de `libs/ai` usan el literal del modelo muerto como valor de
 *   ejemplo de un proveedor offline —`openrouter.provider.spec.ts`, `parse-ai-config.spec.ts`,
 *   `record-fixtures.openrouter.spec.ts`…—, sin leer ningún default. No son valores por defecto de nada, y sin esta
 *   exclusión la comprobación fallaría en veinte sitios que no son el defecto y se desactivaría a la primera. La
 *   exclusión es **estructural**: la comprobación no lee ningún fichero de test, solo los tres sitios de arriba.
 * - **Los comentarios.** `.env.example` **nombra** el modelo muerto para decir que lo es y a qué se sustituyó; lo
 *   mismo hace el RUNBOOK. Solo se inspeccionan asignaciones `VARIABLE=valor`, no prosa.
 */
export const DEFAULT_VALUE_SITES = Object.freeze({
  envExample: '.env.example',
  compose: 'docker-compose.prod.yml',
  composeServices: ['api', 'worker'],
  codeDefaults: {
    file: 'libs/ai/src/infrastructure/config/ai-config.schema.ts',
    constant: 'AI_CONFIG_DEFAULTS',
  },
});
