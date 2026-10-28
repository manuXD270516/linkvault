## MODIFIED Requirements

### Requirement: Lista de CV guardados con su estado

Cada CV SHALL mostrarse en una tarjeta, del más reciente al más antiguo, identificado por **su nombre de archivo y su
fecha**, con su tamaño. El número de versión NO SHALL mostrarse.

Cada estado SHALL terminar en una acción o en una explicación de qué hacer:

- `pending`: "Estamos leyendo tu CV…";
- `extracted`: "Listo · tu CV se leyó bien", con la acción "Ver lo que leímos";
- `failed` con `unreadable_file`: "No pudimos abrir este archivo. Si tiene contraseña, quítasela; si no, prueba a
  exportarlo de nuevo como PDF o súbelo en DOCX.";
- `failed` con `no_text`: "Este archivo no tiene texto: parece un escaneo o una imagen.", seguido del consejo que
  corresponde a su formato: con un PDF, "Sube el PDF original (no una foto ni un escaneo) o vuelve a exportarlo desde
  tu editor"; con un DOCX, "Vuelve a exportarlo desde tu editor y súbelo otra vez";
- `failed` con `internal_error`: "No pudimos leerlo ahora. Vuelve a subirlo en un rato.".

El número de caracteres leídos NO SHALL mostrarse, y el texto del CV NO SHALL aparecer en la lista.

#### Scenario: Tres CV guardados

- **GIVEN** Ana con tres CV
- **WHEN** abre `/mi-cv`
- **THEN** SHALL verlos del más nuevo al más viejo, cada uno con su nombre y su fecha
- **AND** NO SHALL ver ningún número de versión ni ningún recuento de caracteres

#### Scenario: Un CV que no se pudo leer

- **GIVEN** un CV en PDF en `failed` con motivo `no_text`
- **WHEN** Ana lo mira
- **THEN** SHALL ver el mensaje del escaneo con el consejo para un PDF, y la acción de eliminar

#### Scenario: Un DOCX sin texto

- **GIVEN** un CV en DOCX en `failed` con motivo `no_text`
- **WHEN** Ana lo mira
- **THEN** el consejo SHALL decirle que lo exporte otra vez desde su editor y lo suba de nuevo
- **AND** NO SHALL pedirle que suba "el PDF original"

#### Scenario: Un CV protegido con contraseña

- **GIVEN** un CV en `failed` con motivo `unreadable_file`
- **WHEN** Ana lo mira
- **THEN** el mensaje SHALL decirle que le quite la contraseña si la tiene
- **AND** SHALL ofrecerle, si no la tiene, exportarlo de nuevo como PDF o subirlo en DOCX

#### Scenario: El mismo texto en inglés

- **GIVEN** un CV en `failed` con motivo `unreadable_file` y el SPA en inglés
- **WHEN** Ana lo mira
- **THEN** SHALL ver "We could not open this file. If it has a password, remove it; otherwise, try exporting it again as
  a PDF or upload it as a DOCX."
