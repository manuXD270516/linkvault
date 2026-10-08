## ADDED Requirements

### Requirement: Fechas en el formato del idioma de la interfaz

Todo campo del SPA donde se escribe o se elige una fecha —"Publicada el" y "Cierra el" al corregir una oferta, "Cierra
el" al reabrirla y "Otro día" en "¿Cuándo postulaste?"— SHALL mostrar e interpretar la fecha en el formato del idioma
de la interfaz, **sea cual sea el idioma o la región del navegador**: en español `dd/mm/aaaa`, con el texto de ayuda
"dd/mm/aaaa"; en inglés `mm/dd/yyyy`. Lo escrito SHALL interpretarse con ese mismo orden; una fecha que no existe SHALL
marcarse como inválida y NO SHALL enviarse. Cambiar el formato de presentación NO SHALL cambiar el día que se envía a
la API: las fechas de solo día SHALL enviarse como ese mismo día del calendario, sin desplazarse por la zona horaria,
y `appliedAt` SHALL seguir siendo la medianoche local de ese día en formato ISO.

#### Scenario: Interfaz en español con el navegador en inglés

- **GIVEN** el SPA en español abierto en un navegador configurado en inglés de Estados Unidos
- **WHEN** Ana abre "Corregir la oferta"
- **THEN** "Publicada el" y "Cierra el" SHALL mostrar "dd/mm/aaaa" como ayuda
- **AND** una fecha elegida en el calendario, el 3 de diciembre de 2026, SHALL verse como "03/12/2026"

#### Scenario: Lo tecleado se lee día primero

- **GIVEN** el SPA en español
- **WHEN** Ana escribe "03/12/2026" en "Cierra el" y guarda
- **THEN** la petición SHALL llevar `expiresAt` con el día 2026-12-03

#### Scenario: Fecha inexistente

- **GIVEN** el SPA en español
- **WHEN** Ana escribe "31/02/2026" en "Publicada el"
- **THEN** el campo SHALL marcarse como inválido
- **AND** NO SHALL enviarse esa fecha

#### Scenario: El día no se mueve con la zona horaria

- **GIVEN** un navegador en una zona horaria al oeste de UTC (por ejemplo, La Paz, UTC−4)
- **WHEN** Ana elige el 3 de diciembre de 2026 en "Cierra el" y guarda
- **THEN** la petición SHALL llevar el día 2026-12-03, no el 2026-12-02

#### Scenario: Otro día al postular

- **GIVEN** la pregunta "¿Cuándo postulaste?" abierta en el SPA en español
- **WHEN** el usuario pulsa "Otro día" y escribe "12/09/2026"
- **THEN** la petición SHALL llevar `appliedAt` con la medianoche local del 12 de septiembre de 2026 en formato ISO
- **AND** el selector NO SHALL admitir días futuros
