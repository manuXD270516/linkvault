## Why

La guía de uso (`docs/guia-de-uso/README.md`, capturas del 2026-09-28 sobre el commit `0f307c6`) recorrió la
plataforma entera como lo haría una persona nueva y dejó, en su sección «Hallazgos», siete defectos de producto
(H1-H7). Uno es de **privacidad** y rompe una promesa escrita en la propia interfaz; los otros seis son defectos de
pantalla que verá cualquiera de los primeros usuarios no-autor que invita 35b (`staging-host`):

- **H1 (el más grave).** Al guardar en un grupo que comparte en público, el formulario promete «Cualquiera con este
  enlace verá la oferta; no se verá el grupo ni tu nombre». La página pública cumple, pero Carla —que no es del grupo—
  guarda la oferta desde ese enlace y su tarjeta de «Solo para mí» dice «Escrito por Ana Guía de Uso» (captura 064).
  La causa no es la página pública: la procedencia por campo se guarda en el `JobLink` canónico, que comparten todos
  los que tienen esa vacante, y la API resuelve el nombre del autor **para cualquier lector**. Contradice
  `users/profile` («de otro usuario solo SHALL ser visible su `displayName`, y únicamente para los miembros de sus
  grupos») y lo exige, literalmente, `links/enrichment` («los orígenes `pasted` y `manual` SHALL decir el nombre
  visible de la persona»). Además de Carla, le ocurre a cualquiera que guarde la misma URL por su cuenta.
- **H2.** En Notificaciones, la ayuda de «Grupo para avisos de estado» se monta encima de «Preferencias guardadas» (076).
- **H3.** Guardar una clave de IA sin bóveda (`503 vault_unavailable`) muestra el genérico «Algo salió mal. Inténtalo de
  nuevo» (081).
- **H4.** El formulario de guardar sigue diciendo «Todavía estamos leyendo la oferta…» cuando la lectura ya terminó, y
  aunque la oferta se completó a mano (030, 033, 035).
- **H5.** Tras un guardado correcto, el campo «Pega el enlace de una oferta» queda vacío y pintado como error (028, 068).
- **H6.** El aviso «Compartido · Deshacer» sigue visible al navegar al tablero, a los insights y a «Mi CV» (037, 042 a 046).
- **H7.** «Publicada el» y «Cierra el» muestran `mm/dd/yyyy` en una interfaz en español (032).

**Excepción a la precedencia de la fila 35.** ADR-048 §Consecuencias (extendida a la fila entera por ADR-051 §1)
impide que un change de otra fila preceda a la fila 35 mientras `cd-staging` termine en «verificado sin destino», y la
fila no está cerrada: 35a está archivada y 35b (`staging-host`) y 35c (`verify-reusable-workflow`) siguen abiertas.
**El owner decidió el 2026-10-08 abrir este change como excepción a esa precedencia** («Abramos el change»). Queda
registrado en ADR-055 §1, con una anotación de una línea en ADR-048 §Consecuencias, igual que la excepción de
`e2e-suite` (ADR-053). La excepción no libera la precedencia para ningún otro change. Si cubre también aplicar y
fusionar antes del final de la fila es la pregunta **Q1** de `design.md` (bloqueante para `/opsx:apply`): la
recomendación es que sí y **antes de invitar en 35b**, porque H1 afecta precisamente a esos usuarios.

## What Changes

- **H1, procedencia sin nombres ajenos (API + SPA):** el nombre de quien escribió o pegó un campo solo sale para quien
  comparte al menos un grupo con esa persona (o es ella misma). A cualquier otro lector la API le devuelve el autor
  vacío (`by: null`, sin `userId` ni nombre), también en la entrada que el campo guarda para deshacerse y en los avisos
  en tiempo real. La tarjeta conserva el **tipo** de origen y dice «Escrito por otra persona», «Descripción pegada por
  otra persona» y «Deshacer lo que pegó otra persona». Una sola regla, aplicada en el mapeo único de la API, con el
  conjunto de autores visibles como parámetro obligatorio para que ningún caso de uso pueda olvidarlo (design D1-D4,
  ADR-055 §2).
- **H2:** la ayuda del selector de grupo crece con su texto y no se superpone a nada (design D5).
- **H3:** mensaje propio para `503 vault_unavailable` en la sección de claves, y el campo de la clave se vacía (D6).
- **H4:** el aviso de «todavía estamos leyendo» del formulario sale del estado **actual** del link en la lista, no de la
  foto de la respuesta, y desaparece en cuanto deja de estar `pending` (D7).
- **H5:** tras un guardado correcto el formulario vuelve a su estado inicial sin marca de error (D8).
- **H6:** el aviso de compartir se cierra al salir de la página del grupo donde se abrió, con el mismo desenlace que si
  se hubiera dejado ir; y se comprueba que el cierre a los 10 s sin foco ocurre de verdad (D9).
- **H7:** los tres campos de fecha del SPA usan el selector de Angular Material con un adaptador que muestra y acepta
  `dd/mm/aaaa` en español, sea cual sea el idioma del navegador (D10).
- Textos nuevos en español (por defecto) y en inglés; `messages.xlf` se regenera con `pnpm nx run web:extract-i18n`,
  nunca a mano, y las traducciones van en `messages.en.xlf` (ADR-050).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `links/enrichment`: **MODIFIED** «Preview con procedencia por campo» (H1: nombre del autor solo para quien comparte
  grupo con él).
- `web/links`: **MODIFIED** «Guardar un link desde el SPA» (H4, H5), «Editar la oferta a mano» y «Pegar la descripción
  de una oferta» (H1, textos sin nombre).
- `web/public-preview`: **MODIFIED** «La oferta importada cae en la lista privada» (H1, el caso de la guía).
- `web/notifications`: **MODIFIED** «Preferencias en el perfil» (H2).
- `web/byok`: **MODIFIED** «Gestión de claves en perfil» (H3).
- `web/applications`: **MODIFIED** «Invitación a compartir tras el gesto» (H6).
- `web/i18n`: **ADDED** «Fechas en el formato del idioma de la interfaz» (H7).

## Impact

- **Código:** `apps/api/src/modules/links` (mapeo de la procedencia y los casos de uso que lo llaman, reparto de
  avisos en tiempo real); `libs/shared/src/schemas/preview.schema.ts` (autor resuelto anulable); `apps/web` (procedencia,
  formulario de guardar, notificaciones, perfil BYOK, aviso de compartir, campos de fecha y un adaptador de fechas).
  `apps/worker` no cambia: la procedencia se guarda igual, solo cambia cómo se lee.
- **Contrato de la API:** `previewSources.<campo>.by` y `previewSources.<campo>.replaced.by` pasan a admitir `null`.
  Los clientes son el SPA y la extensión; la extensión no lee `previewSources` (`apps/extension/src/lib/save-link.ts`
  solo usa `sharedBy.displayName`, que no cambia), así que no se ve afectada.
- **Datos:** ninguna migración. Nada se borra ni se reescribe en Mongo.
- **Dependencias:** ninguna nueva (el adaptador extiende `NativeDateAdapter` de Angular Material).
- **Documentación:** `docs/adr/ADR-055.md`, anotaciones de una línea en `docs/adr/ADR-048.md` y `docs/adr/ADR-010.md`,
  entrada en `openspec-changes.yaml` y fila en `docs/design-v0.2.md` §6.
- **Relación con la fila 35:** no toca ningún fichero de despliegue, ningún workflow ni ningún requirement que 35b o
  35c modifiquen (sus deltas están todos en `platform/*`).

## Fuera de alcance

- **H8-H13 (no se pudo probar en local)** no son defectos de producto, sino de la pila de pruebas o de su
  configuración: el fixture de encaje que no deja ver el plan de estudio (H8), los flags apagados de búsqueda y
  descubrimiento y un `search.spec.ts` que pasa con la búsqueda no disponible (H9), las claves VAPID y `AI_VAULT_KEY`
  vacías en `e2e.env` (H10, H11; la parte de producto de H11 es H3), el fixture de `critique-suggestions` que falta en
  `replay` (H12) y lo que no corre en esta pila (H13). Su sitio natural es `e2e-suite-lot-2` o un change de fixtures.
- **H14-H17 (pruebas):** orígenes escritos a mano en `home.spec.ts` y `groups.spec.ts`, el orden de `match.spec.ts`,
  las capturas en `reports/smoke/` y las URLs de `linkedin.com` en los specs antiguos. Son del lote 2 de la suite
  (`e2e-suite-lot-2` ya enumera la limpieza de esos specs).
- El selector «Grupo para avisos de estado» que aparece vacío con «Todos mis grupos» elegido (visto en la captura 076,
  no listado como hallazgo) queda como pregunta **Q2**; no entra sin decisión.
- Publicar la interfaz en inglés (fila 37 candidata): los textos nuevos llevan su traducción, pero el build sigue
  generando solo ES.
