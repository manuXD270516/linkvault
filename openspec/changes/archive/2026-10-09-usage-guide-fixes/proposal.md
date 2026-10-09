## Why

La guía de uso (`docs/guia-de-uso/README.md`, capturas del 2026-09-28 sobre el commit `0f307c6`) recorrió la
plataforma entera como lo haría una persona nueva y dejó, en su sección «Hallazgos», siete defectos de producto
(H1-H7). Uno es de **privacidad** y rompe una promesa escrita en la propia interfaz; los otros seis son defectos de
pantalla que verá cualquiera de los primeros usuarios no-autor que invita 35b (`staging-host`). **Tras la iteración 1
del debate (2026-10-08) este change corrige H1, H2, H4, H5 y H6**; H3 y H7 se difieren (ver «Fuera de alcance»):

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
  aunque la oferta se completó a mano (030, 033, 035); y cuando la lectura falla sin datos, nada avisa de que la
  tarjeta saldrá vacía.
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
  conjunto de autores visibles como parámetro obligatorio de un tipo que solo construye un ayudante, para que ningún
  caso de uso pueda olvidarlo, y una consulta indexada por petición (design D1-D4, ADR-055 §2). Quien comparte algún
  grupo con el autor sí ve su nombre: si eso obliga a matizar el texto de la promesa es la **Q7** (bloqueante).
- **H2:** el subíndice del selector de grupo crece con su ayuda (`subscriptSizing="dynamic"`) y empuja lo que viene
  detrás (design D5).
- **H2, selector (Q2 = a):** «Grupo para avisos de estado» muestra «Todos mis grupos (unión del link)» cuando la
  preferencia es `null`, en vez de un campo vacío (D5).
- **H4:** el aviso de copiar el enlace de una oferta publicada depende solo de que la tarjeta **no tenga puesto**, no
  del nombre del estado, evaluado con la versión más reciente conocida del link —también con filtros activos—, en el
  formulario y en «Copiar enlace» de la tarjeta: mientras la tarjeta dice «Leyendo la oferta…», el aviso de lectura
  actual; si no parece una oferta, «Esto no parece una oferta: si lo envías, la tarjeta saldrá sin datos»; en
  cualquier otro caso sin puesto, «La tarjeta todavía no tiene el puesto: si lo envías ahora, saldrá sin datos.
  Complétala antes desde la tarjeta» (D6).
- **H5:** tras un guardado correcto el formulario vuelve a su estado inicial sin marca de error (D7).
- **H6:** el aviso de compartir se cierra al cambiar de path fuera de la página del grupo donde se abrió (los cambios de
  query no), con el mismo desenlace que si se hubiera dejado ir, y no se abre si la persona ya salió; se intenta
  reproducir el cierre a los 10 s sin foco, con una hora como límite (D8).
- **Verificación sin E2E no admitidos (D10):** H1 con pruebas de integración de la API; H2, H4, H5 y H6 con specs de
  componente con Angular Material real. Las E2E, si se añaden, son informativas.
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
- `web/public-preview`: **MODIFIED** «La oferta importada cae en la lista privada» (H1, el caso de la guía) e
  «Interruptor del enlace público en la tarjeta del grupo» (H4, «Copiar enlace» de una tarjeta sin datos).
- `web/notifications`: **MODIFIED** «Preferencias en el perfil» (H2 y el selector de Q2).
- `web/applications`: **MODIFIED** «Invitación a compartir tras el gesto» (H6).

## Impact

- **Código:** `apps/api/src/modules/links` (mapeo de la procedencia y los casos de uso que lo llaman, reparto de
  avisos en tiempo real, puerto `GroupMembership.peersAmong`); `apps/api/src/modules/groups` (método nuevo de
  `GroupsFacade` con una consulta indexada); `libs/shared/src/schemas/preview.schema.ts` (autor resuelto anulable);
  `apps/web` (procedencia, formulario de guardar, «Copiar enlace» de la tarjeta, notificaciones y aviso de compartir).
  `apps/worker` no cambia: la procedencia se guarda igual, solo cambia cómo se lee.
- **Contrato de la API:** `previewSources.<campo>.by` y `previewSources.<campo>.replaced.by` pasan a admitir `null`.
  Los clientes son el SPA y la extensión; la extensión no lee `previewSources` (`apps/extension/src/lib/save-link.ts`
  solo usa `sharedBy.displayName`, que no cambia), así que no se ve afectada.
- **Datos:** ninguna migración. Nada se borra ni se reescribe en Mongo, y no hace falta ningún índice nuevo: el de
  membresía `(groupId, userId)` ya existe (`MEMBERSHIP_KEY`, design D2).
- **Dependencias:** ninguna nueva.
- **Documentación:** `docs/adr/ADR-055.md`, anotaciones de una línea en `docs/adr/ADR-048.md` y `docs/adr/ADR-010.md`,
  entrada en `openspec-changes.yaml` y fila en `docs/design-v0.2.md` §6.
- **Relación con la fila 35:** no toca ningún fichero de despliegue, ningún workflow ni ningún requirement que 35b o
  35c modifiquen (sus deltas están todos en `platform/*`).

## Fuera de alcance

- **H3 (bóveda BYOK ausente → mensaje genérico), diferido a `e2e-suite-lot-2` junto con H11 (B2).** Con
  `AI_VAULT_KEY` obligatoria en producción, ninguna persona usuaria verá ese error: solo aparece en pilas de prueba sin
  bóveda, que es justo lo que H11 arregla. Sin H3, la antigua Q4 queda sin objeto.
- **H7 (fechas `mm/dd/yyyy` en español), diferido a un change futuro con datos reales de las 5 personas de 35b (B3).**
  Sustituir el control nativo es caro, empeora el selector nativo del móvil y el formato puede depender del idioma del
  sistema y no solo del navegador: conviene decidirlo con lo que vean esas personas.

- **H8-H13 (no se pudo probar en local)** no son defectos de producto, sino de la pila de pruebas o de su
  configuración: el fixture de encaje que no deja ver el plan de estudio (H8), los flags apagados de búsqueda y
  descubrimiento y un `search.spec.ts` que pasa con la búsqueda no disponible (H9), las claves VAPID y `AI_VAULT_KEY`
  vacías en `e2e.env` (H10, H11; la parte de producto de H11 es H3), el fixture de `critique-suggestions` que falta en
  `replay` (H12) y lo que no corre en esta pila (H13). Su sitio natural es `e2e-suite-lot-2` o un change de fixtures.
- **H14-H17 (pruebas):** orígenes escritos a mano en `home.spec.ts` y `groups.spec.ts`, el orden de `match.spec.ts`,
  las capturas en `reports/smoke/` y las URLs de `linkedin.com` en los specs antiguos. Son del lote 2 de la suite
  (`e2e-suite-lot-2` ya enumera la limpieza de esos specs).
- Si una persona de fuera de un grupo debe poder corregir el preview que ese grupo ve (anterior a este change; **Q8**,
  para un change posterior).
- Publicar la interfaz en inglés (fila 37 candidata): los textos nuevos llevan su traducción, pero el build sigue
  generando solo ES.
