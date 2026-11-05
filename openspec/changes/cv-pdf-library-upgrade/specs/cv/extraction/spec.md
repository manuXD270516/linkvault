## MODIFIED Requirements

### Requirement: Texto extraído, normalizado y acotado

El worker SHALL extraer el texto del PDF con un **pdf.js mantenido** (requirement «La biblioteca de PDF es un pdf.js
mantenido, fijado y sin evaluación de código») y el del DOCX con `mammoth`, los dos **dentro del proceso hijo** de la
lectura aislada (requirement «La lectura corre aislada del proceso del worker»). El texto de un PDF SHALL unir en una
misma línea los fragmentos que comparten la coordenada vertical y separar con un salto de línea los que no.

La extracción SHALL leer como mucho las **50 primeras páginas** de un PDF y SHALL dejar de acumular texto al llegar a
**1.000.000 de caracteres** crudos, entregando lo acumulado; ninguno de los dos topes SHALL convertir la lectura en un
fallo.

El texto SHALL guardarse normalizado: `\r\n` y `\r` pasan a `\n`, se quitan los caracteres de control salvo `\n` y
`\t`, se colapsan las líneas en blanco repetidas y se recortan los extremos.

El texto guardado SHALL tener como mucho 200.000 caracteres; si sobra, SHALL recortarse y marcarse como recortado **en
la base de datos**, marca que NO SHALL salir en ninguna respuesta. `textChars` SHALL contar los caracteres guardados. El
texto SHALL guardarse en el documento del CV y de él SHALL salir únicamente la vista previa.

#### Scenario: PDF con texto

- **GIVEN** un CV en PDF con una página de texto
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `extracted` con su texto guardado y `textChars` mayor que cero

#### Scenario: DOCX con texto

- **GIVEN** un CV en DOCX
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `extracted` con su texto guardado

#### Scenario: Texto larguísimo

- **GIVEN** un archivo cuyo texto supera los 200.000 caracteres
- **WHEN** el worker lo lee
- **THEN** SHALL guardarse exactamente 200.000 caracteres y el documento SHALL quedar marcado como recortado
- **AND** esa marca NO SHALL aparecer en el listado de la persona

#### Scenario: Saltos y caracteres de control

- **GIVEN** un archivo cuyo texto trae `\r\n`, caracteres de control y líneas en blanco repetidas
- **WHEN** el worker lo lee
- **THEN** el texto guardado SHALL tener solo `\n`, sin caracteres de control y sin líneas en blanco repetidas

#### Scenario: Un PDF de muchas páginas

- **GIVEN** un PDF generado de 200 páginas, cada una con una marca de página distinta
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `extracted`
- **AND** el texto SHALL contener las marcas de las páginas 1 a 50 y ninguna de la 51 en adelante

#### Scenario: Un PDF con texto sin fin

- **GIVEN** un PDF generado cuyo contenido produce más de 1.000.000 de caracteres de texto
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `extracted` con 200.000 caracteres y marcado como recortado
- **AND** la lectura SHALL terminar antes del plazo

#### Scenario: Las líneas de un PDF se unen por su altura

- **GIVEN** un PDF generado con dos fragmentos de texto a la misma altura y un tercero más abajo
- **WHEN** el worker lo lee
- **THEN** el texto guardado SHALL tener los dos primeros fragmentos en una misma línea y el tercero en la siguiente

## ADDED Requirements

### Requirement: La biblioteca de PDF es un pdf.js mantenido, fijado y sin evaluación de código

El PDF SHALL leerlo una distribución publicada y mantenida de pdf.js —la adoptada en el spike de
`cv-pdf-library-upgrade`: `pdfjs-dist` en su build `legacy` o, como alternativa, `unpdf`—, declarada como dependencia
directa del workspace con **versión exacta**, sin `^` ni `~`, tanto en el `package.json` raíz como en el manifiesto
generado del worker. `pdf-parse` y sus tipos NO SHALL figurar entre las dependencias ni en el candado.

Dentro del proceso hijo, la biblioteca SHALL:

- cargarse entera **antes** de que el hijo se anuncie listo, incluido el módulo que pdf.js usa como worker, de modo que
  una biblioteca o un módulo ausente sea un fallo de maquinaria y no un archivo ilegible;
- abrir el documento con la evaluación de código desactivada en sus opciones, además de la desactivación por flag del
  proceso hijo;
- leer los datos solo desde memoria, sin URL remota, sin fuentes del sistema, sin canvas ni dependencia nativa de
  dibujo y sin crear hilos;
- leer los mapas de caracteres y las fuentes estándar que necesite solo desde su propio paquete, dentro de las rutas
  que el proceso hijo ya tiene permitidas.

Un PDF que pide contraseña SHALL seguir terminando en `unreadable_file` como protegido.

#### Scenario: La dependencia vieja no vuelve

- **GIVEN** el `package.json` raíz y `pnpm-lock.yaml` del workspace
- **WHEN** corre el test de dependencias del worker
- **THEN** ninguno de los dos SHALL nombrar `pdf-parse` ni `@types/pdf-parse`
- **AND** la biblioteca de PDF adoptada SHALL figurar en `dependencies` con una versión que no empieza por `^` ni `~`

#### Scenario: El manifiesto del worker fija la biblioteca de PDF

- **GIVEN** el worker construido
- **WHEN** se lee `dist/apps/worker/package.json`
- **THEN** la biblioteca de PDF adoptada y `mammoth` SHALL figurar con versión exacta
- **AND** el candado generado del worker NO SHALL contener `@napi-rs/canvas`

#### Scenario: La evaluación de código está desactivada al abrir el PDF

- **GIVEN** un doble del cargador de la biblioteca de PDF que registra las opciones con que se abre el documento
- **WHEN** el hijo lee un PDF
- **THEN** la opción de evaluación de código SHALL llegar desactivada
- **AND** NO SHALL llegar ninguna URL de documento ni la opción de usar fuentes del sistema activada

#### Scenario: Falta el módulo de worker de pdf.js

- **GIVEN** un proceso hijo cuyo `node_modules` no tiene el módulo de worker de la biblioteca de PDF
- **WHEN** el worker lee un PDF
- **THEN** el desenlace SHALL ser un fallo de maquinaria, que se reintenta y, agotado, deja el CV en `failed` con
  `internal_error`
- **AND** el CV NO SHALL quedar en `unreadable_file`

#### Scenario: Un PDF protegido con contraseña con la biblioteca nueva

- **GIVEN** un CV en PDF que pide contraseña
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `failed` con el motivo `unreadable_file`
- **AND** la causa contada SHALL ser `password`

### Requirement: El cambio de biblioteca conserva el texto de los fixtures y no relee CV

El texto normalizado que el worker guarda para los PDF sintéticos de las pruebas SHALL ser idéntico, línea a línea, al
que guardaba `pdf-parse` 1.1.4, registrado como constante sin datos personales antes de la sustitución. Sustituir la
biblioteca NO SHALL volver a leer ningún CV ya leído ni cambiar su texto, su estado ni su motivo: solo los CV que se
leen después del despliegue usan la biblioteca nueva.

#### Scenario: Los PDF sintéticos se leen igual que antes

- **GIVEN** los PDF sintéticos de las pruebas (con texto, sin capa de texto y con marcas de página) y los textos que
  `pdf-parse` 1.1.4 guardaba para ellos
- **WHEN** el worker los lee con la biblioteca nueva
- **THEN** el texto guardado de cada uno SHALL ser idéntico, línea a línea, al registrado

#### Scenario: Un CV ya leído no se vuelve a leer

- **GIVEN** un CV en `extracted` leído con `pdf-parse` antes del despliegue
- **WHEN** arranca el worker con la biblioteca nueva
- **THEN** NO SHALL encolarse ninguna lectura de ese CV
- **AND** su texto, su estado y `textChars` SHALL seguir siendo los mismos
