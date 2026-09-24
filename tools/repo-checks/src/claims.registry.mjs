/**
 * **Registro declarado de afirmaciones** (requirement "Documentación del camino canónico compose+Traefik" de
 * `platform/production-deploy`, ADR-048 §5).
 *
 * Qué es: la lista, escrita a mano, de las afirmaciones que la documentación y los comentarios del código hacen
 * sobre el producto y que **el propio código puede desmentir**. Cada entrada asocia tres cosas:
 *
 *  1. unos **patrones** que reconocen la afirmación en el texto;
 *  2. el **alcance**: qué archivos se leen buscándolos;
 *  3. los **símbolos del código que la desmienten**: si existen, la afirmación es falsa.
 *
 * Qué NO es: un analizador de prosa. Decidir leyendo todo el RUNBOOK si alguna frase afirma que algo no existe no es
 * implementable, y exigirlo habría producido una comprobación que finge una cobertura que no tiene. El precio de
 * atarse a patrones declarados está aceptado y escrito en ADR-048 §Riesgos: reescribir la frase con otras palabras
 * **rompe** la entrada —el patrón deja de casar y hay que actualizarlo— en vez de dejar la comprobación en verde
 * fingiendo que cubre lo que ya no cubre. Es el desenlace que se prefiere.
 *
 * Los patrones llevan `\s+` en vez de espacios literales **a propósito**: las frases de un `.md` con ancho de línea
 * acotado se parten entre dos líneas (en el RUNBOOK, "Hoy no / existe el borrado de cuenta" ocupaba `:467-468`; en
 * `group.mapper.ts`, "hoy no existe el borrado / de cuenta" ocupaba `:51-52`). Una búsqueda línea a línea pierde
 * justo esas dos.
 */

/**
 * @typedef {object} ClaimPattern
 * @property {RegExp} regex     Patrón que reconoce la afirmación. SIEMPRE con la bandera `g`.
 * @property {string} recognises Qué frase reconoce, en claro, para que el mensaje de fallo se entienda.
 *
 * @typedef {object} ClaimSymbol
 * @property {string} file    Ruta relativa a la raíz del workspace.
 * @property {RegExp} regex   Lo que tiene que aparecer dentro para dar el símbolo por presente.
 * @property {string} what    Qué es ese símbolo, en claro.
 *
 * @typedef {object} ClaimScope
 * @property {readonly string[]} roots            Directorios (relativos a la raíz) donde se busca.
 * @property {readonly string[]} extensions       Extensiones que se leen.
 * @property {readonly string[]} excludePrefixes  Prefijos de ruta que se saltan, con su motivo en el comentario.
 *
 * @typedef {object} ClaimEntry
 * @property {string} id
 * @property {string} claim                       La afirmación, en claro.
 * @property {readonly ClaimPattern[]} patterns
 * @property {ClaimScope} scope
 * @property {readonly ClaimSymbol[]} symbols
 * @property {string} fix                         Qué hacer cuando la comprobación falla.
 */

/** @type {readonly ClaimEntry[]} */
export const CLAIMS_REGISTRY = [
  {
    id: 'borrado-de-cuenta-no-existe',
    claim:
      'que el borrado de cuenta no existe, o que sigue pendiente de `deploy-prod`, y que por eso los datos de una persona se borran a mano con `mongosh`',
    patterns: [
      {
        regex: /no\s+existe\s+el\s+borrado\s+de\s+cuenta/gi,
        recognises: '"(hoy) no existe el borrado de cuenta"',
      },
      {
        regex: /resto\s+del\s+borrado\s+de\s+cuenta/gi,
        recognises:
          '"es el resto del borrado de cuenta de `deploy-prod`" (lo que el procedimiento manual deja fuera)',
      },
      {
        regex: /cascada\s+al\s+borrar\s+(?:una|la)\s+cuenta\s+est[aá]\s+pendiente/gi,
        recognises: '"la cascada al borrar una cuenta está pendiente"',
      },
      {
        regex: /borrado\s+de\s+cuenta\**\s+lo\s+hereda/gi,
        recognises: '"el borrado de cuenta lo hereda `deploy-prod`"',
      },
      {
        regex: /borrado\s+de\s+cuenta\s+con\s+sus\s+objetos/gi,
        recognises:
          '"el **borrado de cuenta** con sus objetos y sus contadores" listado entre lo que hereda `deploy-prod`',
      },
      {
        regex: /borrado\s+de\s+cuenta\s+necesitar[aá]/gi,
        recognises:
          '"lo que el borrado de cuenta necesitará" (la misma afirmación en futuro, que es como sobrevivió en `libs/shared`)',
      },
    ],
    scope: {
      // `apps/**` y `libs/**` además de `docs/**` porque la misma frase vivía en comentarios del código: tres en
      // `apps/api` y una más, en futuro, en `libs/shared/src/cv/cv-file-key.ts`. Dejarlos fuera del alcance es por
      // donde volvió la segunda después de corregir la primera.
      roots: ['docs', 'apps', 'libs'],
      extensions: ['.md', '.ts', '.html'],
      excludePrefixes: [
        // Un ADR es **historia** y no se reescribe: lo que decía era cierto el día que se decidió. La deuda cerrada
        // se anota con una nota fechada dentro del propio ADR (ADR-024, ADR-026 y ADR-028 la llevan), no borrando
        // el párrafo. Incluirlos aquí obligaría a falsear el registro histórico para pasar la comprobación.
        'docs/adr/',
      ],
    },
    symbols: [
      {
        file: 'apps/api/src/modules/users/presentation/account-deletion.controller.ts',
        regex: /@Delete\('me'\)/,
        what: "la ruta `DELETE /api/users/me` (`@Delete('me')` de `AccountDeletionController`)",
      },
      {
        file: 'apps/api/src/modules/users/infrastructure/mongo-account-deletion.cascade.ts',
        regex: /class\s+MongoAccountDeletionCascade/,
        what: 'la cascada `MongoAccountDeletionCascade`',
      },
      {
        file: 'apps/api/src/modules/users/presentation/account-deletion.cascade.spec.ts',
        regex: /describe\(/,
        what: 'la prueba de la cascada (`account-deletion.cascade.spec.ts`)',
      },
    ],
    fix: 'nombra `DELETE /api/users/me` como camino primero y deja el procedimiento manual con `mongosh` como excepcional, diciendo a qué operación sustituye',
  },
];
