## Purpose

Tarjeta «La semana del grupo» del SPA: muestra en el detalle del grupo las viñetas verificadas de la semana, con sus
ofertas a un toque, sin mostrar nunca nada de lo que hace cada miembro.

## ADDED Requirements

### Requirement: Tarjeta «La semana del grupo» en el detalle del grupo

`/grupos/:id` SHALL mostrar, encima del listado de links y a todo el ancho, también en pantallas móviles, la tarjeta
«La semana del grupo» con la respuesta de `GET /api/groups/:id/weekly-brief`. Con `brief`, SHALL mostrar «Calculada el
{fecha} · N ofertas abiertas» (singular «1 oferta abierta»; con `scanTruncated`, seguido de « (de las 500 más
recientes)»), una línea por viñeta en el orden recibido y el pie «Solo cuenta datos de las ofertas, nunca lo que hace
cada miembro.». Las fechas (`asOf`, `until`) SHALL formatearse como fechas sin hora en UTC, con día de la semana, día y
mes en el idioma de la interfaz. La tarjeta SHALL tener estado de carga (con `aria-busy="true"`), estado vacío con
`brief` `null` («Todavía no hay resumen de esta semana.» y «Se arma solo una vez por semana cuando el grupo tiene
ofertas abiertas.») y estado de error («No pudimos cargar la semana del grupo.» con «Reintentar»). Un error de la
tarjeta NO SHALL impedir ver ni usar el detalle del grupo ni su listado. La tarjeta NO SHALL mostrar nombres, avatares,
estados de postulación, marcas, notas, etiquetas ni comentarios.

#### Scenario: Tres viñetas visibles

- **GIVEN** un grupo cuya semana tiene tres viñetas y 7 ofertas abiertas, calculada el lunes 2026-11-23
- **WHEN** un miembro abre `/grupos/:id` con la interfaz en español
- **THEN** SHALL ver «La semana del grupo», «Calculada el lunes, 23 de noviembre · 7 ofertas abiertas» y las tres
  viñetas encima del listado de links

#### Scenario: Vacío honesto

- **GIVEN** un grupo con `brief` `null`
- **WHEN** un miembro abre su detalle
- **THEN** la tarjeta SHALL decir «Todavía no hay resumen de esta semana.» y «Se arma solo una vez por semana cuando el
  grupo tiene ofertas abiertas.»

#### Scenario: Error de la tarjeta

- **GIVEN** `GET /api/groups/:id/weekly-brief` responde `500`
- **WHEN** un miembro abre el detalle
- **THEN** la tarjeta SHALL mostrar «No pudimos cargar la semana del grupo.» y «Reintentar»
- **AND** el listado de links del grupo SHALL mostrarse y SHALL poder guardarse un link

#### Scenario: Reintentar

- **GIVEN** la tarjeta en estado de error
- **WHEN** el miembro pulsa «Reintentar» y la api responde `200`
- **THEN** la tarjeta SHALL mostrar la semana sin recargar la página

#### Scenario: Grupo grande

- **GIVEN** una semana con `scanTruncated` `true` y 500 ofertas abiertas
- **WHEN** un miembro abre el detalle
- **THEN** la cabecera SHALL terminar en «500 ofertas abiertas (de las 500 más recientes)»

### Requirement: Texto de cada viñeta

El texto de cada viñeta SHALL armarse en el SPA desde el hecho citado, con un mensaje del catálogo i18n por variante y
el singular o el plural elegido en código, así:

| Hecho | Español | English |
|---|---|---|
| `closing_soon`, `count` 1 | «1 oferta cierra hasta el {until}.» | «1 offer closes by {until}.» |
| `closing_soon`, `count` N > 1 | «N ofertas cierran hasta el {until}.» | «N offers close by {until}.» |
| `skill_demand` | «N de M ofertas con requisitos leídos mencionan {skillLabel}.» | «N of M offers with known requirements mention {skillLabel}.» |
| `shared_last_week`, `count` 1 | «1 oferta nueva la semana pasada.» | «1 new offer last week.» |
| `shared_last_week`, `count` N > 1 | «N ofertas nuevas la semana pasada.» | «N new offers last week.» |
| `closed_last_week`, `count` 1 | «1 oferta cerró la semana pasada.» | «1 offer closed last week.» |
| `closed_last_week`, `count` N > 1 | «N ofertas cerraron la semana pasada.» | «N offers closed last week.» |

Los números SHALL ser exactamente los del hecho (`count`, `total`) y `{skillLabel}` SHALL mostrarse tal como viene, sin
traducir. Todos los textos de la tarjeta SHALL estar en el catálogo i18n en español, con tuteo, y en inglés.

#### Scenario: Habilidad

- **GIVEN** un hecho `skill_demand` con `skillLabel` «Docker», `count` 4 y `total` 7
- **WHEN** se muestra su viñeta en español y en inglés
- **THEN** SHALL leerse «4 de 7 ofertas con requisitos leídos mencionan Docker.» y «4 of 7 offers with known
  requirements mention Docker.»

#### Scenario: Cierre en singular y en plural

- **GIVEN** un `closing_soon` con `count` 1 y `until` `2026-11-29`, y otro con `count` 2 y el mismo `until`
- **WHEN** se muestran en español
- **THEN** SHALL leerse «1 oferta cierra hasta el domingo, 29 de noviembre.» y «2 ofertas cierran hasta el domingo,
  29 de noviembre.»

#### Scenario: Semana pasada en inglés

- **GIVEN** un `shared_last_week` con `count` 3 y un `closed_last_week` con `count` 1
- **WHEN** se muestran con la interfaz en inglés
- **THEN** SHALL leerse «3 new offers last week.» y «1 offer closed last week.»

### Requirement: Ofertas de cada viñeta

Cada viñeta con ofertas SHALL tener un botón «Ver ofertas (N)», con N = número de `offers` más `moreCount`, que
despliega y repliega («Ocultar ofertas») la lista de sus ofertas, con `aria-expanded` y `aria-controls`, y un área
táctil de al menos 44 px de alto. Cada oferta SHALL mostrar su título (o su `displayUrl` sin título) y su empresa si la
tiene, como enlace a su `displayUrl` que se abre en otra pestaña con `rel="noopener noreferrer"`. Con `moreCount` > 0
SHALL añadirse «y N más en el listado del grupo» (singular «y 1 más en el listado del grupo»); con `missingCount` > 0,
«N ya no están en el grupo» (singular «1 ya no está en el grupo»). Una viñeta sin `offers` ni `moreCount` NO SHALL
mostrar el botón y SHALL mostrar solo la línea de `missingCount`. Nada de la tarjeta SHALL escribir en la api.

#### Scenario: Desplegar las ofertas

- **GIVEN** una viñeta con dos ofertas, `moreCount` 0 y `missingCount` 0
- **WHEN** el miembro pulsa «Ver ofertas (2)»
- **THEN** SHALL ver los dos títulos como enlaces a sus `displayUrl` con `target="_blank"` y `rel="noopener noreferrer"`
- **AND** el botón SHALL decir «Ocultar ofertas» con `aria-expanded="true"`

#### Scenario: Más ofertas y ofertas que ya no están

- **GIVEN** una viñeta con 10 ofertas, `moreCount` 4 y `missingCount` 1
- **WHEN** el miembro la despliega
- **THEN** SHALL ver «Ver ofertas (14)» antes de desplegar, 10 enlaces, «y 4 más en el listado del grupo» y «1 ya no
  está en el grupo»

#### Scenario: Todas salieron del grupo

- **GIVEN** una viñeta con `offers` vacío, `moreCount` 0 y `missingCount` 2
- **WHEN** se muestra
- **THEN** NO SHALL haber botón «Ver ofertas» y SHALL leerse «2 ya no están en el grupo»

#### Scenario: Móvil

- **GIVEN** un viewport de 390 px de ancho y una semana con tres viñetas
- **WHEN** un miembro abre el detalle del grupo
- **THEN** la tarjeta SHALL estar encima del listado de links y cada botón «Ver ofertas» SHALL medir al menos 44 px de
  alto
