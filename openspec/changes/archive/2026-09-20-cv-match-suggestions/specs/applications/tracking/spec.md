## MODIFIED Requirements

### Requirement: Puntuación de encaje reservada

La postulación SHALL exponer un `fitScoreDegraded` (booleano) y, **solo cuando ese análisis no vino degradado**, un
`fitScore` (entero de 0 a 100), los dos **derivados en el momento de responder** del **último análisis de encaje** de
esa persona sobre ese link. La postulación **NO SHALL guardar ninguna puntuación propia**: ninguna operación SHALL escribirla, ninguna SHALL editarla a mano y ninguna SHALL
tener que borrarla.

- **El último análisis** SHALL ser el de **fecha de finalización más reciente entre los que terminaron en `done`**, con
  esa misma definición y ninguna otra. Los análisis **en curso, los fallidos y los que se dieron por vencidos NO SHALL
  contar** para derivar la puntuación: un fallo nuestro no cambia el encaje que la persona ya conocía, así que un
  `failed` posterior NO SHALL borrar ni sustituir la puntuación del último análisis que sí terminó.
- **Derivar al leer, no copiar**, es lo que hace imposible la desincronización: no existe ningún instante en el que la
  postulación diga una puntuación y el análisis diga otra, porque solo hay un número y vive en el análisis. Terminar un
  análisis NO SHALL escribir nada en la postulación, y entre terminarlo y verlo NO SHALL haber ninguna ventana en la que
  la respuesta esté atrasada.
- **Sin ningún análisis terminado en `done`** de esa persona sobre ese link, la postulación SHALL responder **sin
  `fitScore` y sin `fitScoreDegraded`**. La ausencia SHALL representarse como campo ausente o nulo, **nunca como `0`**:
  "todavía no lo analizaste" y "no encajas nada" no pueden verse igual.
- **Si deja de quedar ningún análisis** —porque se borró el CV con el que se hicieron—, la postulación SHALL volver a
  responder sin `fitScore` ni `fitScoreDegraded` **sin que ninguna operación tenga que limpiarla**: al no haber de dónde
  derivarla, deja de haberla. Ningún proceso SHALL quedar encargado de ir a borrar puntuaciones huérfanas.
- **Un análisis degradado NO entrega número**: cuando el último análisis vino degradado, la respuesta SHALL traer
  `fitScoreDegraded` `true` y **ningún `fitScore`**. Ese número sale de un cruce por diccionario, ninguna pantalla del
  producto lo muestra —el badge de un análisis básico enseña solo su etiqueta— y entregarlo sería dejar suelto un dato
  sin consumidor esperando a que alguien lo pinte por error.
- En consecuencia, ninguna respuesta SHALL entregar `fitScore` sin `fitScoreDegraded`, y **ninguna SHALL entregar
  `fitScore` junto a `fitScoreDegraded` `true`**. `fitScoreDegraded` `true` sin `fitScore` SHALL ser una combinación
  válida y SHALL significar "lo analizaste, pero el análisis fue básico"; la ausencia de los dos SHALL seguir
  significando "no lo analizaste".
- **Rehacer el análisis SHALL cambiar la puntuación** por la del análisis nuevo, aunque sea más baja. Si el análisis
  nuevo viene degradado, el `fitScore` anterior SHALL **desaparecer** y quedar solo `fitScoreDegraded` `true`: sigue al
  último análisis, no al mejor, y no se queda enseñando un número que ya no corresponde a ningún análisis vigente.
- **Seguir una oferta ya analizada** SHALL responder desde el primer momento con la puntuación del último análisis que
  ya existía, sin pedir uno nuevo y sin copiar nada a la postulación recién creada.
- **La puntuación NO es un cambio de estado**: aparecer, cambiar o desaparecer NO SHALL subir `version`, NO SHALL tocar
  `statusChangedAt` y NO SHALL escribir ningún evento de historial, de modo que un análisis que termina mientras alguien
  tiene la pantalla abierta nunca SHALL provocar un `409 application_conflict`.
- La postulación SHALL llevar **solo el número y su procedencia**: NO SHALL incluir el informe, sus `suggestions`, sus
  `matchedSkills` ni `missingSkills`, ningún fragmento del CV ni ningún dato del proveedor que lo produjo.
- Solo SHALL derivarse de los análisis **de su dueño**: el análisis de otra persona sobre el mismo link NO SHALL puntuar
  nunca una postulación ajena.

Toda respuesta de la API que devuelva una postulación SHALL incluir `fitScoreDegraded` cuando lo haya, y `fitScore`
cuando además corresponda, junto a los demás campos de la postulación.

#### Scenario: La puntuación aparece tras el análisis

- **GIVEN** una postulación de Ana sobre una oferta, sin puntuación
- **WHEN** termina un análisis de encaje de Ana sobre esa oferta con `score` 78 y sin degradación y Ana consulta su
  postulación
- **THEN** la respuesta SHALL traer `fitScore` 78 y `fitScoreDegraded` `false`

#### Scenario: La respuesta no lleva la puntuación

- **GIVEN** una postulación de alguien que nunca analizó esa oferta
- **WHEN** se convierte a su representación en la API
- **THEN** la representación NO SHALL contener `fitScore` ni `fitScoreDegraded`
- **AND** NO SHALL contener `fitScore` con valor `0`

#### Scenario: Nadie escribe la puntuación

- **GIVEN** una postulación de Ana sobre una oferta
- **WHEN** termina un análisis de encaje de Ana sobre esa oferta
- **THEN** el documento guardado de la postulación NO SHALL haber cambiado
- **AND** su `version`, su `statusChangedAt` y su historial SHALL ser los mismos que antes del análisis

#### Scenario: Un análisis básico puntúa y lo dice

- **GIVEN** Ana sin consentimiento para proveedores externos y con el proveedor local caído
- **WHEN** termina un análisis degradado con `score` 41 sobre una oferta que sigue
- **THEN** su postulación SHALL responder con `fitScoreDegraded` `true` y **sin** `fitScore`
- **AND** el número 41 NO SHALL aparecer en ninguna respuesta de la postulación

#### Scenario: Rehacer el análisis manda

- **GIVEN** una postulación cuyo `fitScore` 78 procede de un análisis completo
- **WHEN** Ana vuelve a analizar esa oferta y el análisis nuevo devuelve `score` 63 sin degradación
- **THEN** su postulación SHALL responder con `fitScore` 63

#### Scenario: El análisis nuevo sale básico y el número anterior desaparece

- **GIVEN** una postulación cuyo `fitScore` 78 procede de un análisis completo
- **WHEN** Ana vuelve a analizar esa oferta y el análisis nuevo termina degradado
- **THEN** su postulación SHALL responder con `fitScoreDegraded` `true` y sin ningún `fitScore`
- **AND** NO SHALL seguir respondiendo 78

#### Scenario: Un análisis fallido no borra la puntuación anterior

- **GIVEN** una postulación cuyo `fitScore` 78 procede de un análisis terminado
- **WHEN** Ana pide otro análisis de esa oferta y termina en `failed`
- **THEN** su postulación SHALL seguir respondiendo `fitScore` 78 y `fitScoreDegraded` `false`
- **AND** un análisis todavía en curso tampoco SHALL cambiar lo que responde

#### Scenario: Seguir una oferta ya analizada

- **GIVEN** Ana con un análisis terminado y no degradado sobre una oferta que todavía no sigue
- **WHEN** pide seguirla con `status` `interested`
- **THEN** la respuesta SHALL ser `201` con el `fitScore` de ese análisis

#### Scenario: Sin análisis, sin nada que limpiar

- **GIVEN** una postulación de Ana que responde con `fitScore` 78 derivado de su único análisis sobre ese link
- **WHEN** Ana borra el CV con el que se hizo y sus análisis desaparecen
- **THEN** la postulación SHALL responder otra vez sin `fitScore` ni `fitScoreDegraded`
- **AND** su `version` SHALL ser la misma, sin que ninguna operación haya tenido que tocarla

#### Scenario: La puntuación no pisa a las pestañas abiertas

- **GIVEN** una postulación en `interested` con `version` 1 abierta en una pestaña
- **WHEN** termina un análisis de esa oferta y después su dueña la pasa a `applied` con `version` 1
- **THEN** el cambio de estado SHALL responder `200` con `version` 2
- **AND** el historial SHALL tener un único evento nuevo, el del cambio de estado

#### Scenario: La postulación no lleva el informe

- **GIVEN** un análisis terminado y no degradado con `score`, `matchedSkills`, `missingSkills` y sugerencias
- **WHEN** se consulta la postulación de esa oferta
- **THEN** la respuesta SHALL contener `fitScore` y `fitScoreDegraded`
- **AND** NO SHALL contener ninguna sugerencia, ninguna lista de skills ni ningún fragmento del CV

#### Scenario: La puntuación no se hereda de otra persona

- **GIVEN** Ana y Beto siguiendo el mismo link, con un análisis terminado solo de Ana
- **WHEN** Beto consulta su postulación
- **THEN** NO SHALL traer `fitScore` ni `fitScoreDegraded`
