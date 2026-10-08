## MODIFIED Requirements

### Requirement: Preview con procedencia por campo

Cada campo del preview SHALL guardarse con su valor y su origen: `auto` con el identificador del extractor que lo
produjo, `pasted` con quién pegó el texto del que salió y cuándo, o `manual` con quién lo escribió y cuándo. Al leerse,
los orígenes `pasted` y `manual` SHALL decir el nombre visible de la persona, no su identificador, **solo a quien
pueda verlo**: el propio autor o quien comparta con él al menos un grupo en el momento de la lectura (spec
`users/profile`, «Consulta del perfil propio»). A cualquier otro lector la API SHALL devolver ese autor vacío
(`by: null`), sin nombre ni identificador, y lo mismo el autor de la entrada que el campo guarda para deshacerse; el
origen (`pasted` o `manual`) y su fecha SHALL seguir saliendo. La regla SHALL aplicarse a toda respuesta que lleve la
procedencia —listados, guardar, importar, pegar, editar, reabrir, releer— y a cada destinatario de los avisos en
tiempo real por separado. Si no puede saberse a quién es visible un autor, la respuesta SHALL fallar antes que
nombrarlo. Lo que se guarda NO SHALL cambiar: el autor se conserva siempre. La precedencia SHALL
ser **escrito a mano > pegado > leído de la página**, y SHALL ser una sola regla para todo lo que escribe el preview: un
merge automático NO SHALL sobrescribir un campo `manual` ni `pasted`, y un pegado NO SHALL sobrescribir un campo
`manual`. Cuando una persona sustituya un campo —pegando una descripción o escribiendo a mano—, SHALL guardarse la
entrada sustituida —valor, origen, extractor, autor y fecha— para poder volver a ella; una relectura automática que
sustituye un valor automático por otro no guarda nada, y la tarjeta no ofrece volver en ese campo. En un merge
automático o en un pegado, un valor vacío NO SHALL sustituir a uno que ya hubiera; una persona que escribe a mano sí
puede vaciar un campo. Dentro de una misma pasada,
entre dos valores automáticos SHALL ganar el de la etapa anterior de la cadena, que es la más fiable. Frente a lo ya
guardado, un valor automático nuevo SHALL sustituir al automático anterior aunque venga de una etapa menos fiable: la
página pudo cambiar.

#### Scenario: Lo manual no se pisa

- **GIVEN** un link cuyo `title` fue editado a mano
- **WHEN** se vuelve a enriquecer y la extracción propone otro título
- **THEN** el `title` SHALL seguir siendo el escrito a mano, con origen `manual`
- **AND** los demás campos SHALL actualizarse

#### Scenario: Gana la etapa más fiable

- **GIVEN** JSON-LD y la IA proponiendo empresas distintas en la misma pasada
- **WHEN** se mezclan
- **THEN** SHALL conservarse la de JSON-LD
- **AND** el campo SHALL decir de qué extractor salió

#### Scenario: Reenriquecimiento con datos nuevos

- **GIVEN** un link cuyo `title` automático salió de JSON-LD hace semanas
- **WHEN** se vuelve a enriquecer y solo la IA propone un título distinto
- **THEN** SHALL guardarse el título nuevo
- **AND** el campo SHALL decir que salió de la IA

#### Scenario: Se guarda lo que la edición desplazó

- **GIVEN** un link con el `title` extraído de la página
- **WHEN** una persona lo corrige a mano
- **THEN** el campo SHALL conservar el valor automático anterior y su extractor

#### Scenario: Una relectura no pisa lo pegado

- **GIVEN** un link cuyo `company` salió de un texto pegado
- **WHEN** se vuelve a leer la página y la extracción propone otra empresa
- **THEN** `company` SHALL seguir siendo la pegada, con origen `pasted`

#### Scenario: Pegar no pisa lo escrito a mano

- **GIVEN** un link cuyo `title` escribió una persona a mano
- **WHEN** otra persona pega el texto de la oferta y de él sale otro título
- **THEN** `title` SHALL seguir siendo el escrito a mano, con lo que guardaba para deshacerse intacto
- **AND** los campos que nadie escribió a mano SHALL tomar lo pegado

#### Scenario: Volver a lo pegado

- **GIVEN** un campo que salió de un texto pegado y después se corrigió a mano
- **WHEN** se pide volver al valor anterior
- **THEN** el campo SHALL recuperar el valor pegado, con su origen `pasted` y su autor

#### Scenario: Quien comparte grupo con el autor ve su nombre

- **GIVEN** Ana y Beto miembros del grupo "Backend Bolivia" y un link cuyo `title` escribió Ana a mano
- **WHEN** Beto pide el listado de "Backend Bolivia"
- **THEN** `previewSources.title.by` SHALL ser `{ userId, displayName }` de Ana

#### Scenario: Quien no comparte grupo con el autor no ve su nombre

- **GIVEN** un link cuyo `title` escribió Ana a mano y Carla, que no comparte ningún grupo con Ana, con ese link en su
  lista privada
- **WHEN** Carla pide `GET /api/links/mine`
- **THEN** `previewSources.title` SHALL tener origen `manual` y su fecha
- **AND** `previewSources.title.by` SHALL ser `null`
- **AND** la respuesta NO SHALL contener ni el `userId` ni el `displayName` de Ana en ningún campo

#### Scenario: Tampoco en lo que se guarda para deshacer

- **GIVEN** un link cuyo `company` pegó Beto y después corrigió Ana a mano, y Carla, que no comparte grupo con ninguno
  de los dos, con ese link en su lista privada
- **WHEN** Carla recibe ese link en cualquier respuesta de la API
- **THEN** `previewSources.company.by` y `previewSources.company.replaced.by` SHALL ser `null`

#### Scenario: Uno mismo siempre se ve

- **GIVEN** Carla, sin grupos, que corrige a mano el `title` de un link de su lista privada
- **WHEN** recibe la respuesta de `PATCH /api/links/:id/preview`
- **THEN** `previewSources.title.by` SHALL ser `{ userId, displayName }` de Carla

#### Scenario: Cada destinatario de un aviso en tiempo real recibe lo suyo

- **GIVEN** un link cuyo `title` escribió Ana, en "Backend Bolivia" (donde está Beto) y en la lista privada de Carla,
  ambos con la conexión de avisos abierta
- **WHEN** se termina de leer la oferta y se reparte el aviso
- **THEN** Beto SHALL recibir `previewSources.title.by` con el nombre de Ana
- **AND** Carla SHALL recibir `previewSources.title.by` `null`

#### Scenario: Un miembro no ve el nombre de quien corrigió desde fuera del grupo

- **GIVEN** un link de "Backend Bolivia" (donde está Beto) que Carla, que no comparte ningún grupo con Beto, tiene en su
  lista privada y cuyo `title` corrigió a mano
- **WHEN** Beto pide el listado de "Backend Bolivia"
- **THEN** `previewSources.title` SHALL tener origen `manual` y `by` `null`
- **AND** la respuesta NO SHALL contener ni el `userId` ni el `displayName` de Carla

#### Scenario: Calcular quién es visible no falla abierto

- **GIVEN** un lector y un link con autores ajenos a él
- **WHEN** la consulta de quién comparte grupo con el lector falla
- **THEN** la petición SHALL fallar
- **AND** NO SHALL devolverse ningún nombre de autor ajeno

#### Scenario: Lo guardado no cambia

- **GIVEN** un link cuyo `title` escribió Ana a mano
- **WHEN** Carla, sin grupo en común con Ana, lo lee
- **THEN** el documento guardado SHALL seguir teniendo a Ana como autora de `title`
