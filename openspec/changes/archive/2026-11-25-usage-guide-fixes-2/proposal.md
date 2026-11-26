## Why

La guía de uso del 2026-11-25 (`docs/guia-de-uso/README.md`, sección «Hallazgos», sobre `main` en `a6e943be`) recorrió
123 casos y dejó tres defectos de producto en pantallas que verá cualquiera de las primeras personas invitadas:

- **H1 (caso M01).** «Analizar mi encaje» con una cuenta sin CV: el diálogo abre con «Ningún CV marcado» y «Analizar»
  activo; al pulsarlo la API responde `409 no_cv` y el diálogo dice «No pudimos analizar ahora.» con «Reintentar», una
  avería falsa que además invita a repetir lo que no puede funcionar. El estado correcto («Necesitas un CV guardado
  para analizar tu encaje.» con «Subir mi CV») existe en el código, pero no se alcanza.
- **H2 (caso V03).** Con la sesión abierta, abrir el enlace de verificación del correo dice «Email verificado», pero en
  2 de 6 corridas el aviso «Tu email aún no está verificado…» siguió en `/grupos` hasta recargar.
- **H3 (caso F03).** En `/perfil`, tras un intento con la contraseña actual equivocada y otro con la nueva demasiado
  corta, se ven a la vez el aviso viejo y el nuevo, con los textos montados uno sobre otro.

Ninguno es cosmético: H1 presenta como avería nuestra lo que es un paso que falta, H2 contradice el «Email verificado»
que la misma persona acaba de leer, y H3 deja en pantalla un diagnóstico que ya no es verdad.

## What Changes

- **H1, clasificación por código (design D1).** El diálogo de encaje reconoce los rechazos de la API `job_not_ready`,
  `no_cv`, `cv_not_ready` y `cv_not_readable` por su **código**, sin depender del status HTTP. Hoy los compara con
  `422` mientras la API y la spec `cv/match` responden `409`, así que los cuatro caen en «No pudimos analizar ahora.»;
  el arreglo devuelve también «Pegar la descripción» (`job_not_ready`) y los dos estados de CV en lectura o ilegible,
  que tenían el mismo defecto aunque la guía no los recorrió.
- **H1, sin CV desde que se abre (design D2).** Si la lista de CV ya cargó y está vacía, y no hay informe ni fallo de
  la API en pantalla, el diálogo abre directamente en el estado «Necesitas un CV guardado para analizar tu encaje.»
  con «Subir mi CV», sin ofrecer «Analizar», sin la línea de por dónde saldría el CV y sin llamar a la API. Si la
  lista no se pudo cargar, «Analizar» sigue disponible y el `409 no_cv` lleva al mismo estado.
- **H2 (design D3).** `/verificar-email` espera a que termine la restauración de la sesión que arrancó al cargar antes
  de decidir si hay sesión (también cuando la verificación falla), y solo entonces vuelve a pedir el perfil. Si esa
  petición del perfil falla tras una verificación correcta, la página sigue diciendo «Email verificado» y, si sigue
  habiendo perfil en memoria, pasa a `emailVerified` `true`, en vez de mostrar un error.
- **H3 (design D4).** Cada intento de cambiar la contraseña, válido o no, borra el resultado del intento anterior; y
  los dos campos de contraseña usan un subíndice que crece con su contenido (`subscriptSizing="dynamic"`), para que el
  error de dos líneas empuje lo que viene detrás en vez de montarse encima. Si el apply se atrasa, H3 es lo primero
  que se recorta (PO-4 del debate).
- **Sin textos nuevos.** No cambia ningún texto visible. Se re-extrae `messages.xlf` y se commitea solo si cambian
  números de línea (ADR-050).
- **Guía de uso (design D6).** `tools/guia-de-uso/` se ajusta para que la próxima pasada compruebe M01, V03 y F03 con
  el comportamiento nuevo, y el README de la guía anota los tres hallazgos como corregidos por este change, pendientes
  de comprobar en esa pasada.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `web/cv-match`: **MODIFIED** «Falta tu CV» (D2) y **ADDED** «Los rechazos del análisis se reconocen por su código»
  (D1).
- `web/email-auth`: **MODIFIED** «Página de verificación por enlace» (D3).
- `web/auth`: **ADDED** «Los avisos del cambio de contraseña no se acumulan» (D4).

## Impact

- **Código:** solo `apps/web`: `features/match/match.dialog.ts` (y su spec), `core/api/api-error.ts` (un ayudante por
  código), `features/auth/verify-email.page.ts` (y su spec), `features/profile/profile.page.ts` y `.html` (y su spec),
  `locale/messages.xlf` si la re-extracción da diff. `apps/api`, `apps/worker` y `libs/**` no cambian.
- **Contrato de la API:** ninguno. El SPA se alinea con el que ya está escrito en `cv/match` (`409`).
- **Datos, dependencias, despliegue y CI:** ninguno.
- **Herramientas y documentación:** `tools/guia-de-uso/capture.mts`, `meta.mts` y `build-guide.mts`;
  `docs/guia-de-uso/README.md`; una fila en `docs/design-v0.2.md` §6 cuando el owner responda la Q1.
- **Relación con la fila 35:** no toca ningún fichero de despliegue, ningún workflow ni ningún requirement de
  `platform/*`.

## Fuera de alcance

- **H4 (pegar un texto que no es una oferta da un error genérico, caso K06).** Es una limitación del mock en `replay`
  (`FixtureMissing`), no del producto: con `synth` o con IA real el mensaje «Eso no parece una oferta de trabajo…» ya
  existe y depende de la respuesta. Su sitio es un change de fixtures.
- **H5 (guardar una clave de IA sin bóveda da un error genérico, caso B03).** Diferido por `usage-guide-fixes` a
  `e2e-suite-lot-2` junto con `AI_VAULT_KEY` vacía en la pila de pruebas; en producción `AI_VAULT_KEY` es obligatoria.
- **H6 (no hay modo oscuro, caso W10).** Ninguna spec lo promete: es una feature nueva, no un defecto.
- **H7 (fechas `mm/dd/yyyy`, caso K05).** Diferido por `usage-guide-fixes` a un change con datos reales de las personas
  de 35b: sustituir el control nativo es caro y el formato puede depender del sistema.
- **H8 (no hay target para levantar la interfaz en inglés).** Es la fila 37 candidata (`web-english-locale`), que no se
  abre antes de cerrar la 35c.
- H9 y H10 (pruebas) siguen en `e2e-suite-lot-2`.
- **Riesgo conocido: el aviso en otra pestaña (PO-3 del debate).** Este change arregla la pestaña que abre el enlace
  del correo. Quien se registró en una pestaña y abre el correo en otra nueva sigue viendo «Tu email aún no está
  verificado…» en la primera hasta recargar: nada vuelve a pedir el perfil al recuperar el foco. El aviso no bloquea
  nada. Si alguien lo reporta en 35b, se abre un change chico que vuelva a pedir el perfil al recuperar el foco
  mientras `emailVerified` sea `false`.
- Mover la tabla código → status de la API a `libs/shared` para que el SPA no pueda volver a divergir (design D1,
  alternativa C): toca la API y todos los códigos, y D1 ya quita la dependencia del status donde hizo daño.
