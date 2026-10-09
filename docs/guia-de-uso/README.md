# Guía de uso de LinkVault: formularios paso a paso y pruebas

Recorrido por la plataforma en el orden en que la encuentra una persona nueva (el de
[`docs/catalogo-de-uso.md`](../catalogo-de-uso.md)). Cada paso incluye:

- una captura antes y otra después de rellenar el formulario;
- qué se escribe y qué botón se pulsa;
- qué debe pasar y qué pasó;
- qué prueba automatizada lo cubre.

- **Fecha de las capturas y de las pruebas:** 2026-09-28.
- **Commit probado:** `0f307c6e84d1ed239e83a12fd1dd3cb1771c4de3` (rama `change/e2e-suite`).

## Entorno

**Pila.** Pila aislada de la suite e2e, levantada con el runner `web-e2e:e2e-stack --keep-stack` y apagada después con
`--down`. Puertos del bloque:

| Servicio | Dirección |
| -------- | --------- |
| web | http://localhost:4300 |
| API | http://localhost:3100 |
| worker | http://localhost:3101 |
| Mailpit | http://localhost:8125 |
| Mongo | 27117 |
| Redis | 6479 |
| S3 | 9100 y 9101 |

**Configuración.** Sale de `apps/web-e2e/e2e.env`, que es fija; los puntos que afectan a esta guía:

- **IA:** `AI_CHAIN=mock` con `AI_MOCK_MODE=replay`. Solo responde a entradas que tienen fixture, y nada sale de la máquina.
- **Flags de producto apagados:** búsqueda, descubrimiento, frescura y resumen semanal.
- **Claves vacías:** no hay claves VAPID ni `AI_VAULT_KEY`.

**Navegador.** Chromium de Playwright a 1280×800. Las capturas de escritorio miden 1280 de ancho; la mayoría son de
página completa, así que pueden ser más altas. Cuatro capturas (087 a 090) son de un Pixel 7 emulado: 412×915 CSS, que
dan 1082 px de ancho por la densidad de píxeles.

**Datos, todos inventados:**

- Personas: Ana (`ana+guia@example.test`), Beto (`beto+guia@example.test`) y Carla (`carla+guia@example.test`).
- Ofertas en el dominio reservado `.invalid`, que no existe: el worker no puede leerlas y no sale ninguna petición a una
  bolsa real.
- La oferta de prueba y el CV del paso 13 son la entrada versionada del camino crítico
  (`libs/ai/src/infrastructure/fixture-inputs/critical-path.json`); así el mock en `replay` tiene fixture para el
  análisis de encaje.

**Máscaras.** Las zonas rosas tapan contraseñas, códigos de invitación, claves de IA, el texto del CV, los fragmentos del
CV en el informe de encaje y el extracto de los correos de Mailpit, que puede llevar el enlace con token.

**Capturas.** Hay 100, numeradas con tres dígitos (`001`…`100`) para que el orden alfabético sea el del recorrido. Las
genera un script de un solo uso que no está en el repositorio: recorre la interfaz con Playwright y abre los enlaces de
verificación y de restablecimiento a partir de la API de Mailpit del bloque.

## Índice

1. [Sin sesión: aviso de privacidad e inicio](#1-sin-sesión-aviso-de-privacidad-e-inicio)
2. [Crear una cuenta](#2-crear-una-cuenta)
3. [Verificar el email](#3-verificar-el-email)
4. [Perfil: nombre y contraseña](#4-perfil-nombre-y-contraseña)
5. [Crear un grupo](#5-crear-un-grupo)
6. [Ajustes del grupo](#6-ajustes-del-grupo)
7. [Copiar la invitación](#7-copiar-la-invitación)
8. [Una segunda persona se une con el enlace](#8-una-segunda-persona-se-une-con-el-enlace)
9. [Guardar una oferta en el grupo](#9-guardar-una-oferta-en-el-grupo)
10. [Completar la oferta a mano](#10-completar-la-oferta-a-mano)
11. [«Postulé» y compartir el estado](#11-postulé-y-compartir-el-estado)
12. [Tablero de postulaciones e insights](#12-tablero-de-postulaciones-e-insights)
13. [Mi CV: subir y «Ver lo que leímos»](#13-mi-cv-subir-y-ver-lo-que-leímos)
14. [Analizar mi encaje](#14-analizar-mi-encaje)
15. [Plan de estudio](#15-plan-de-estudio)
16. [Comentarios y «Conozco a alguien ahí»](#16-comentarios-y-conozco-a-alguien-ahí)
17. [Fijar, etiquetar y filtrar](#17-fijar-etiquetar-y-filtrar)
18. [Importar un chat](#18-importar-un-chat)
19. [Enlace público y guardar desde él](#19-enlace-público-y-guardar-desde-él)
20. [Dejar de compartir el enlace público](#20-dejar-de-compartir-el-enlace-público)
21. [Solo para mí](#21-solo-para-mí)
22. [Descubrir vacantes](#22-descubrir-vacantes)
23. [Buscar](#23-buscar)
24. [Notificaciones y push](#24-notificaciones-y-push)
25. [Permiso de IA externa y claves propias](#25-permiso-de-ia-externa-y-claves-propias)
26. [Unirse con un código, expulsar y borrar un grupo](#26-unirse-con-un-código-expulsar-y-borrar-un-grupo)
27. [En el móvil (Pixel 7)](#27-en-el-móvil-pixel-7)
28. [Cerrar sesión, iniciar sesión y recuperar la contraseña](#28-cerrar-sesión-iniciar-sesión-y-recuperar-la-contraseña)
29. [Borrar la cuenta](#29-borrar-la-cuenta)
30. [Lo que no tiene pantalla o no se probó en local](#30-lo-que-no-tiene-pantalla-o-no-se-probó-en-local)
- [Pruebas automatizadas](#pruebas-automatizadas)
- [Hallazgos](#hallazgos)

---

## 1. Sin sesión: aviso de privacidad e inicio

**Objetivo:** ver qué se hace con el CV, la IA y la cuenta antes de registrarse; la raíz sin sesión lleva a iniciar sesión.

- **Ruta:** `/privacidad` (pública) y `/` → `/login`.
- **Esperado:** «Aviso de privacidad» con «Tu CV», «IA, OpenRouter y tus claves (BYOK)» y «Borrar tu cuenta»; `/` acaba en
  «Iniciar sesión».
- **Visto:** lo esperado.
- **Prueba:** `deploy-prod.spec.ts` (privacidad pública, pasa) y `home.spec.ts` (raíz sin sesión; falla fuera de su
  entorno, ver [Pruebas](#pruebas-automatizadas)).

![Aviso de privacidad sin sesión](img/001-privacidad-sin-sesion.png)
![Iniciar sesión, vacío](img/002-login-vacio.png)

## 2. Crear una cuenta

**Objetivo:** darse de alta con nombre, email y contraseña.

| Campo | Se escribe |
| ----- | ---------- |
| Nombre | `Ana Guía` |
| Email | `ana+guia@example.test` |
| Contraseña | una contraseña inventada de 10 o más caracteres (enmascarada) |

- **Botón:** «Crear cuenta».
- **Esperado:** entra en `/grupos` («Tus grupos») con el aviso de email sin verificar.
- **Visto:** `POST /api/auth/register` → 201; «Tus grupos» con «Tu email aún no está verificado. Revisa tu bandeja o
  reenvía el correo de verificación.» y el botón «Reenviar correo».
- **Prueba:** `critical-path.spec.ts` paso 1 (lote 1, pasa); `auth.spec.ts` (pasa).

![Crear cuenta, vacío](img/003-registro-vacio.png)
![Crear cuenta, relleno](img/004-registro-relleno.png)
![Tras registrarse, aviso de email sin verificar](img/005-registro-hecho-aviso-email.png)

## 3. Verificar el email

**Objetivo:** confirmar el email con el enlace que llega por correo.

- **Acción:** en el aviso, «Reenviar correo»; en Mailpit del bloque, el correo «Verifica tu email en LinkVault»; abrir
  su enlace (`/verificar-email?token=…`).
- **Esperado:** «Email verificado» y el aviso desaparece.
- **Visto:**
  - el correo llega a Mailpit;
  - la página dice «Verificar email · Email verificado · Ir a la aplicación»;
  - al volver a `/grupos` ya no está el aviso.

  En la bandeja se ven también los avisos que mandó el worker durante el recorrido: «Nuevo link en tu grupo»,
  «Actualización de postulación en el grupo» y «Restablece tu contraseña de LinkVault».
- **Prueba:** `auth-email-recovery.spec.ts` (pasa).

![Aviso tras «Reenviar correo»](img/006-verificacion-reenviada.png)
![Bandeja de Mailpit del bloque (extractos enmascarados)](img/007-mailpit-bandeja.png)
![Email verificado](img/008-email-verificado.png)
![Grupos sin el aviso](img/009-grupos-sin-aviso.png)

## 4. Perfil: nombre y contraseña

**Objetivo:** cambiar el nombre visible y la contraseña.

| Formulario | Campo | Se escribe | Botón |
| ---------- | ----- | ---------- | ----- |
| Perfil | Nombre | `Ana Guía de Uso` | «Guardar nombre» |
| Cambiar la contraseña | Contraseña actual y Nueva contraseña | contraseñas inventadas (enmascaradas) | «Cambiar contraseña» |

- **Esperado:** «Nombre guardado»; «Contraseña cambiada. Cerramos tu sesión en los demás dispositivos.».
- **Visto:** los dos mensajes. La sección «IA y privacidad» parte con el permiso externo apagado, idioma «Español» y
  «Ocultar mi nombre a los proveedores externos» activado. No se toca hasta después del análisis de encaje (paso 25),
  porque la entrada de replay del encaje usa `outputLanguage=es`.
- **Prueba:** `auth.spec.ts` (pasa).

![Perfil inicial](img/010-perfil-inicial.png)
![Nombre relleno](img/011-perfil-nombre-relleno.png)
![Nombre guardado](img/012-perfil-nombre-guardado.png)
![Contraseña rellena](img/013-perfil-contrasena-rellena.png)
![Contraseña cambiada](img/014-perfil-contrasena-cambiada.png)
![IA y privacidad por defecto](img/015-perfil-ia-y-privacidad-por-defecto.png)

## 5. Crear un grupo

**Objetivo:** crear el espacio donde el círculo junta ofertas.

| Campo | Se escribe |
| ----- | ---------- |
| Nombre del grupo | `Búsqueda backend 2026` |

- **Botón:** «Crear un grupo» → «Crear grupo».
- **Esperado:** detalle `/grupos/:id` con «Propietario» y el «Código de invitación».
- **Visto:** `POST /api/groups` → 201; el detalle muestra a Ana como «Propietario», el código (enmascarado) y «Eres el
  único miembro: para irte, borra el grupo».
- **Prueba:** `critical-path.spec.ts` paso 2 (pasa); `groups.spec.ts` (el test de este flujo falla fuera de su entorno).

![Crear un grupo, vacío](img/016-crear-grupo-vacio.png)
![Crear un grupo, relleno](img/017-crear-grupo-relleno.png)
![Grupo creado](img/018-grupo-creado.png)

## 6. Ajustes del grupo

**Objetivo:** renombrar el grupo y revisar si los links nuevos nacen con enlace público.

| Campo | Se escribe | Botón |
| ----- | ---------- | ----- |
| Nombre del grupo (diálogo «Renombrar el grupo») | `Búsqueda backend (guía)` | «Guardar nombre nuevo» |

- **Interruptor:** «Los links nuevos se comparten con un enlace público». Viene activado y se deja así para el paso 19. El
  camino crítico, en cambio, lo apaga.
- **Visto:** el título cambia al nombre nuevo; el interruptor está activado, con la nota «Solo afecta a lo que se guarde a
  partir de ahora; los links que ya están no cambian.».
- **Prueba:** `critical-path.spec.ts` paso 2 (el interruptor); el renombrado no lo cubre ninguna e2e.

![Renombrar el grupo](img/019-renombrar-grupo-relleno.png)
![Grupo renombrado y ajuste de visibilidad](img/020-grupo-renombrado-ajustes.png)

## 7. Copiar la invitación

**Objetivo:** obtener el enlace `/unirse?codigo=…` para mandarlo al grupo.

- **Botón:** «Copiar invitación».
- **Esperado:** «Invitación copiada»; lo copiado lleva el enlace absoluto con el código.
- **Visto:** «Invitación copiada». El texto copiado es «Únete a «…» en LinkVault: http://localhost:4300/unirse?codigo=…
  (código …)», con el origen de la web del bloque.
- **Prueba:** `critical-path.spec.ts` paso 2b (pasa); `groups.spec.ts` lo comprueba contra `localhost:4200` escrito a mano
  (falla aquí).

![Invitación copiada](img/021-invitacion-copiada.png)

## 8. Una segunda persona se une con el enlace

**Objetivo:** que alguien sin cuenta abra la invitación, se registre y entre al grupo.

**Acción (Beto, en otra ventana sin sesión):**

1. Abre el enlace; llega a «Iniciar sesión» con `returnUrl`.
2. Pulsa «Crear cuenta» y rellena Nombre `Beto Guía`, Email `beto+guia@example.test` y una contraseña.
3. Pulsa «Crear cuenta»; se abre «Unirse a un grupo» con el código ya escrito (enmascarado).
4. Pulsa «Unirme».

- **Esperado:** Beto aterriza en el detalle del grupo como «Miembro»; Ana lo ve en «Miembros».
- **Visto:** lo esperado. Beto ve «Salir del grupo» y no ve el código. Ana ve a Beto con «Nombrar propietario» y
  «Expulsar».
- **Prueba:** `critical-path.spec.ts` paso 2b (pasa).

![Invitación abierta sin sesión: login con returnUrl](img/022-invitado-login-con-returnurl.png)
![Registro de la persona invitada](img/023-invitado-registro-relleno.png)
![Unirse con el código ya escrito](img/024-invitado-unirse-codigo-escrito.png)
![Beto dentro del grupo](img/025-invitado-dentro-del-grupo.png)
![Ana ve a Beto entre los miembros](img/026-propietaria-ve-al-miembro.png)

## 9. Guardar una oferta en el grupo

**Objetivo:** compartir el enlace de una oferta con el grupo, con una nota.

| Campo | Se escribe |
| ----- | ---------- |
| Pega el enlace de una oferta | `https://empleos.guia-de-uso.invalid/ofertas/backend-…` |
| Nota para el grupo (opcional) | `Esta es la que comenté ayer, pinta bien.` |

- **Botón:** «Guardar». Después, la misma URL otra vez.
- **Esperado:** la tarjeta aparece leyéndose, con la nota y el aviso de enlace público; la segunda vez, «Ya estaba aquí…».
- **Visto:**
  - `POST /api/links` → 201;
  - la tarjeta sale con «Leyendo la oferta…», «Compartido por Ana Guía de Uso», «Enlace público» y «Nota de Ana Guía de
    Uso»;
  - el formulario avisa «Cualquiera con este enlace verá la oferta; no se verá el grupo ni tu nombre» y ofrece «Copiar
    enlace»;
  - la segunda vez sale «Ya estaba aquí, lo compartió Ana Guía de Uso».
- **Prueba:** `critical-path.spec.ts` paso 3 (pasa); `links.spec.ts` y `comments.spec.ts` (pasan).

![Guardar link, relleno](img/027-guardar-link-relleno.png)
![Link guardado, leyendo la oferta](img/028-link-guardado-leyendo.png)
![La misma URL otra vez: «Ya estaba aquí»](img/029-link-repetido-ya-estaba.png)

## 10. Completar la oferta a mano

**Objetivo:** escribir los datos de una oferta que no se puede leer.

| Campo | Se escribe (entrada versionada del camino crítico) |
| ----- | ---------- |
| Puesto | `Backend Developer (oferta de prueba)` |
| Empresa | `Empresa Ficticia E2E` |
| Resumen | el texto de `critical-path.json` («…servicios backend con Node, NestJS y MongoDB, con colas de trabajos en Redis y tests automatizados. Trabajo remoto.») |

- **Botón:** «Completar a mano» → «Guardar».
- **Esperado:** la tarjeta muestra el puesto y la empresa con «Escrito por Ana Guía de Uso».
- **Visto:** la lectura acaba en «No pudimos leer esta oferta», con «Completar a mano», «Pegar la descripción» y
  «Reintentar». Tras guardar (`PATCH /api/links/:id/preview` → 200), la tarjeta lleva puesto y empresa, cada uno con
  «Escrito por Ana Guía de Uso».
- **Prueba:** `critical-path.spec.ts` paso 4 (pasa); `links.spec.ts` («Corregir el título», «Quién lo escribió…», pasa).

![Oferta sin leer: «Completar a mano»](img/030-link-no-leido-completar-a-mano.png)
![Corregir la oferta, vacío](img/031-corregir-oferta-vacio.png)
![Corregir la oferta, relleno](img/032-corregir-oferta-relleno.png)
![Oferta completada, «Escrito por…»](img/033-oferta-completada-escrito-por.png)

## 11. «Postulé» y compartir el estado

**Objetivo:** registrar la postulación y, si se quiere, que el grupo vea el estado.

- **Botones:** «Postulé» → «¿Cuándo postulaste?» → «Hoy»; en el aviso, «Compartir».
- **Esperado:** «Tu postulación: Postulada»; tras compartir, «Compartido».
- **Visto:** `POST /api/applications` → 201; la tarjeta dice «Tu postulación: Postulada». Sale el aviso «¿Que tus grupos
  vean que postulaste a esta oferta? También quien entre después.» con «Qué verán» y «Compartir»; tras pulsar
  «Compartir», «Compartido» con «Deshacer».
- **Prueba:** `critical-path.spec.ts` paso 5 (pasa; deja la postulación privada); `applications.spec.ts` (compartir y
  deshacer, pasa).

![¿Cuándo postulaste?](img/034-postule-cuando.png)
![Postulada, aviso para compartir](img/035-postulada-aviso-compartir.png)
![Estado compartido con el grupo](img/036-estado-compartido-con-el-grupo.png)

## 12. Tablero de postulaciones e insights

**Objetivo:** mover la postulación de columna, con etapa y nota privada.

| Formulario | Campo | Se escribe | Botón |
| ---------- | ----- | ---------- | ----- |
| En proceso | Etapa (opcional) | `Prueba técnica` | «Guardar» |
| Detalle de la postulación | Notas (solo las ves tú) | `Preparar el ejercicio de API REST antes del jueves.` | «Guardar la nota» |

- **Acción:** «Postulaciones» → abrir la tarjeta → «Mover a…» → «En proceso» → etapa → nota → «Cerrar» → «Ver insights».
- **Esperado:** seis columnas; la tarjeta pasa a «En proceso» con la etapa; el historial registra el cambio.
- **Visto:**
  - las seis columnas («Interés», «Postuladas», «En proceso», «Con oferta», «Aceptadas», «Cerradas»);
  - el detalle con «En proceso · Prueba técnica»;
  - el historial: «Postulada» y «En proceso · Prueba técnica»;
  - «Nota guardada» y el interruptor «Compartir mi estado con mis grupos» activado;
  - Insights: «Abiertas 1», «En proceso 1» y «Ninguna postulación abierta lleva 10 días o más sin cambio de estado.».
- **Prueba:** `critical-path.spec.ts` paso 5 (columna «Postuladas», pasa); `applications.spec.ts` (mover con etapa, pasa).
  Los insights no los cubre ninguna e2e.

![Tablero: Postuladas](img/037-tablero-postuladas.png)
![Detalle de la postulación](img/038-detalle-postulacion.png)
![Mover a «En proceso» con etapa](img/039-mover-en-proceso-etapa.png)
![Detalle en proceso con nota](img/040-detalle-en-proceso-con-nota.png)
![Tablero: En proceso](img/041-tablero-en-proceso.png)
![Insights](img/042-insights.png)

## 13. Mi CV: subir y «Ver lo que leímos»

**Objetivo:** subir el CV en PDF y comprobar el texto que se leyó.

- **Archivo:** `cv-ana-guia.pdf`, generado con las líneas del CV de `critical-path.json` (inventado, sin datos
  personales).
- **Botones:** «Subir CV» → «Ver lo que leímos» → «Cerrar».
- **Esperado:** «Estamos leyendo tu CV…» y luego «Listo · tu CV se leyó bien».
- **Visto:** `POST /api/cv` → 201; la tarjeta pasa de «Estamos leyendo tu CV…» a «Listo · tu CV se leyó bien» sin
  recargar. La página explica que «Ahora mismo no has dado ese permiso, así que tu CV no sale de LinkVault». El diálogo
  «Lo que leímos de tu CV» muestra el texto (enmascarado) sin opción de copiarlo ni descargarlo.
- **Prueba:** `critical-path.spec.ts` paso 6 (pasa); `cv.spec.ts` (dos tests, pasan).

![Mi CV vacío](img/043-mi-cv-vacio.png)
![Leyendo el CV](img/044-mi-cv-leyendo.png)
![CV leído](img/045-mi-cv-listo.png)
![Lo que leímos (texto enmascarado)](img/046-mi-cv-lo-que-leimos-enmascarado.png)

## 14. Analizar mi encaje

**Objetivo:** comparar el CV con la oferta.

- **Botones:** en la tarjeta, «Analizar mi encaje» → «Analizar»; en el informe, «Copiar» y «No me convence».
- **Esperado:** el informe del fixture de replay de `match-cv`, sin «Análisis básico».
- **Visto:**
  - `POST /api/links/:id/match` → 202 y «Estamos analizando tu encaje…»;
  - el informe, en unos 8 s: «80 · Encaje alto»; habilidades que coinciden: Node, NestJS, MongoDB, Redis y Vitest;
    «Tienes todas las habilidades que pide esta oferta»;
  - una sugerencia de «Experiencia», con «Lo pide la oferta» y «En tu CV dice» (enmascarado);
  - «Copiar» → «Copiado»; «No me convence» → «Marcada».

  Como el informe solo trae una sugerencia, las dos acciones se hicieron sobre la misma.
- **Prueba:** `critical-path.spec.ts` paso 7 (`replay-report`, pasa en escritorio y móvil); `match.spec.ts` test 1 (pasa).

![Antes de analizar](img/047-encaje-antes-de-analizar.png)
![Analizando](img/048-encaje-analizando.png)
![Informe de encaje](img/049-encaje-informe.png)
![Sugerencia con su evidencia](img/050-encaje-informe-sugerencias.png)
![«Copiado» y «Marcada»](img/051-encaje-copiado-y-no-me-convence.png)

## 15. Plan de estudio

**Objetivo:** plan por semanas para las habilidades que faltan.

- **Esperado:** «Ver plan de estudio» en el informe → `/plan/:analysisId`.
- **Visto:** **no se pudo probar.** El informe del fixture del camino crítico no tiene habilidades que falten, así que no
  ofrece «Ver plan de estudio». En `replay` no hay otra entrada con fixture de `build-roadmap` que se pueda alcanzar
  desde la interfaz con datos propios. No hay captura.
- **Prueba:** ninguna e2e.

## 16. Comentarios y «Conozco a alguien ahí»

**Objetivo:** conversar sobre una oferta dentro del grupo.

| Campo | Se escribe | Botón |
| ----- | ---------- | ----- |
| Escribe un comentario (Beto) | `Conozco al equipo, te cuento por privado.` | «Comentar» |

- **Acción:** después, Beto pulsa «Conozco a alguien ahí».
- **Esperado:** el comentario aparece en la tarjeta de Ana y el conteo «1 persona conoce a alguien ahí».
- **Visto:**
  - Beto ve la tarjeta con el avatar «AG», el estado compartido de Ana del paso 11;
  - el diálogo «Comentarios» muestra el comentario con «Borrar» y el aviso «Lo verán los miembros de este grupo y seguirá
    aquí aunque salgas.»;
  - Ana ve en su tarjeta el comentario, «1 persona conoce a alguien ahí» y «Responder».
- **Prueba:** `comments.spec.ts` (pasa). «Conozco a alguien ahí» no lo cubre ninguna e2e.

![Beto ve la oferta y el estado de Ana](img/052-miembro-ve-la-oferta-y-el-estado.png)
![Comentario relleno](img/053-comentario-relleno.png)
![Comentario publicado](img/054-comentario-publicado.png)
![«Conozco a alguien ahí»](img/055-conozco-a-alguien.png)
![Ana ve comentario y conteo](img/056-propietaria-ve-comentario-y-conteo.png)

## 17. Fijar, etiquetar y filtrar

| Campo | Se escribe | Botón |
| ----- | ---------- | ----- |
| Etiquetas | `backend, remoto` | «Guardar etiquetas» |
| Filtrar por etiqueta | `backend` | «Filtrar» |

- **Acción:** «Fijar» → «Editar etiquetas» → … → «Solo fijados» → «Filtrar».
- **Esperado:** «Fijado», las etiquetas como chips y la lista filtrada.
- **Visto:** «Fijado», los chips «backend» y «remoto», y con «Solo fijados» y la etiqueta `backend` solo queda esa
  oferta, junto al botón «Quitar etiqueta».
- **Prueba:** ninguna e2e.

![Etiquetas rellenas](img/057-etiquetas-rellenas.png)
![Filtro por fijados y etiqueta](img/058-filtro-fijados-y-etiqueta.png)

## 18. Importar un chat

- **Campo:** un chat de tres líneas con dos URLs `.invalid` distintas; una de ellas aparece dos veces.
- **Botones:** «Pegar un chat» → «Importar».
- **Esperado:** resumen de guardadas y ya existentes.
- **Visto:** «2 guardadas, 0 ya estaban» (la URL repetida dentro del mismo chat cuenta una vez); las dos tarjetas nuevas
  acaban en «No pudimos leer esta oferta».
- **Prueba:** `links.spec.ts` (pasa).

![Importar un chat, relleno](img/059-importar-chat-relleno.png)
![Resumen de la importación](img/060-importar-chat-resumen.png)

## 19. Enlace público y guardar desde él

**Acción:**

1. En la tarjeta, «Copiar enlace»; se copia `http://localhost:3100/p/<slug>`.
2. Carla, sin sesión, abre ese enlace; la API la manda a `/oferta/:slug`.
3. Pulsa «Guardar en LinkVault», se registra como `Carla Guía` / `carla+guia@example.test` y pulsa «Crear cuenta».

- **Esperado:** vista pública sin grupo ni nombres; tras registrarse, la oferta en «Solo para mí».
- **Visto:**
  - vista pública con puesto, empresa, «Ver la oferta original», «Guardar en LinkVault» y «Entrar»;
  - tras el registro, «Solo para mí» con «Guardada en «Solo para mí». Compártela en un grupo cuando quieras.»;
  - **la tarjeta de Carla muestra «Escrito por Ana Guía de Uso»** (ver [Hallazgos](#hallazgos), H1).
- **Prueba:** `public-share.spec.ts` (pasa).

![Enlace público copiado](img/061-enlace-publico-copiado.png)
![Vista pública sin sesión](img/062-vista-publica-sin-sesion.png)
![Registro desde el enlace público](img/063-registro-desde-enlace-publico.png)
![Guardada en «Solo para mí»](img/064-guardada-en-solo-para-mi.png)

## 20. Dejar de compartir el enlace público

- **Botones:** «Dejar de compartir» → «Dejar de compartir».
- **Esperado:** la URL pública deja de funcionar.
- **Visto:** el diálogo explica que «El enlace dejará de funcionar para todo el mundo…». La URL, abierta de nuevo sin
  sesión, dice «Este enlace ya no está disponible · Pídeselo de nuevo a quien te lo envió».
- **Prueba:** `public-share.spec.ts` paso 8.6 (pasa).

![Confirmar «Dejar de compartir»](img/065-dejar-de-compartir-confirmar.png)
![Enlace público ya no disponible](img/066-enlace-publico-ya-no-disponible.png)

## 21. Solo para mí

| Campo | Se escribe | Botón |
| ----- | ---------- | ----- |
| Pega el enlace de una oferta | `https://empleos.guia-de-uso.invalid/ofertas/solo-para-mi-…` | «Guardar» |

- **Acción:** «Me interesa» → «Quitar» → «Quitar».
- **Esperado:** «Tu postulación: Interés»; al quitar, la tarjeta desaparece.
- **Visto:** lo esperado. La tarjeta no tiene fijar, etiquetas ni «Conozco a alguien ahí», porque no está en un grupo.
- **Prueba:** `links.spec.ts` («the private list only holds…», pasa).

![Solo para mí, relleno](img/067-solo-para-mi-relleno.png)
![Guardada y «Me interesa»](img/068-solo-para-mi-guardada-me-interesa.png)
![Confirmar «Quitar»](img/069-solo-para-mi-quitar-confirmar.png)
![Quitada](img/070-solo-para-mi-quitada.png)

## 22. Descubrir vacantes

- **Campo:** «Consulta» `react` → «Buscar».
- **Visto:** con `FEATURE_DISCOVERY=false` en `e2e.env`, «El descubrimiento de vacantes no está disponible en este
  momento.». El formulario («Consulta», «Bolsa», «Guardar en») sí se ve. **No se pudieron probar resultados en local**
  con esta pila.
- **Prueba:** ninguna e2e.

![Descubrir, relleno](img/071-descubrir-relleno.png)
![Descubrir, no disponible](img/072-descubrir-resultado.png)

## 23. Buscar

- **Campo:** «Consulta» `Backend` → «Buscar».
- **Visto:** con `FEATURE_SEARCH=false`, «La búsqueda no está disponible en este momento. Inténtalo más tarde.». Los
  filtros (Tipo, Grupo, Modalidad, Estado, Moneda, Salario mínimo y máximo, «Solo abiertas») sí se ven.
- **Prueba:** `search.spec.ts` (pasa con el flag apagado, así que no demuestra que haya resultados).

![Buscar, relleno](img/073-buscar-relleno.png)
![Buscar, no disponible](img/074-buscar-resultado.png)

## 24. Notificaciones y push

- **Acción:** «Perfil» → «Gestionar notificaciones» → desactivar «Nuevo link en un grupo» → «Guardar preferencias»; luego
  «Activar push».
- **Esperado:** «Preferencias guardadas»; push según las claves VAPID.
- **Visto:**
  - todas las preferencias vienen activadas;
  - tras guardar, «Preferencias guardadas», aunque el texto de ayuda de «Grupo para avisos de estado» se monta encima
    (H2);
  - push: «Push desactivado en este dispositivo» y, tras «Activar push», «El push no está disponible ahora…»; `e2e.env`
    deja vacías las claves VAPID y el worker lo avisa al arrancar.
- **Prueba:** `notifications.spec.ts` (pasa).

![Notificaciones, inicial](img/075-notificaciones-inicial.png)
![Preferencias guardadas](img/076-notificaciones-guardadas.png)
![Push del navegador](img/077-push-del-navegador.png)

## 25. Permiso de IA externa y claves propias

- **Acción:**
  - activar y desactivar «Permitir que un proveedor de IA externo analice mi CV»;
  - en «Tus claves de IA» (Anthropic), «Clave de API» con un valor de prueba que no es una clave real (enmascarado) →
    «Guardar clave».
- **Esperado:** «Concedido el … · versión …» y, al retirar, «Permiso retirado…»; la clave se guarda si hay bóveda.
- **Visto:**
  - «Concedido el 28/09/2026 02:45 · versión 2026-09-21»;
  - al retirar, «Permiso retirado. Tus próximos análisis no saldrán de LinkVault…»;
  - la clave: `PUT /api/users/me/ai-keys/:vendor` → **503**, porque `e2e.env` no trae `AI_VAULT_KEY`, y la pantalla muestra
    el genérico «Algo salió mal. Inténtalo de nuevo» (H3).
- **Orden:** se hizo después del encaje para no cambiar su entrada de replay.
- **Prueba:** `match.spec.ts` test 2 (permiso; falla aquí por otra causa) y `byok.spec.ts` (falla aquí por el 503).

![Permiso concedido](img/078-ia-permiso-concedido.png)
![Permiso retirado](img/079-ia-permiso-retirado.png)
![Clave de API rellena (enmascarada)](img/080-clave-ia-rellena-enmascarada.png)
![Guardar clave: error](img/081-clave-ia-resultado.png)

## 26. Unirse con un código, expulsar y borrar un grupo

**Acción:**

1. Ana crea `Grupo para borrar (guía)`.
2. Beto pulsa «Unirse con un código», escribe el código (enmascarado) y pulsa «Unirme».
3. Ana pulsa «Expulsar» en Beto, confirma con «Expulsar» y elige «Regenerar el código para que no pueda volver a
   entrar».
4. Ana pulsa «Borrar el grupo» → «Borrar».

- **Visto:**
  - Beto entra en el grupo;
  - el diálogo de expulsión dice «Beto Guía dejará de ver este grupo…»;
  - tras expulsar, se ofrecen «Regenerar el código para que no pueda volver a entrar» y «Ahora no»;
  - el borrado confirma «Se borrará solo para ti. No se puede deshacer.» y lleva de vuelta a «Tus grupos».

  Las capturas 083 y 085 se repitieron tras la corrida: 083 sobre el grupo principal (se canceló) y 085 sobre otro grupo
  vacío igual. La máscara del código tapaba los diálogos.
- **Prueba:** `groups.spec.ts` test 1 (falla aquí por el origen 4200, antes de llegar a expulsar); `groups.spec.ts`
  test 2 (ceder la propiedad y salir, pasa).

![Unirse con un código](img/082-unirse-con-codigo-relleno.png)
![Confirmar expulsión](img/083-expulsar-confirmar.png)
![Expulsado: regenerar el código](img/084-expulsado-regenerar-codigo.png)
![Confirmar borrado del grupo](img/085-borrar-grupo-confirmar.png)
![Grupo borrado](img/086-grupo-borrado.png)

## 27. En el móvil (Pixel 7)

Inicio de sesión de Ana, «Tus grupos», detalle del grupo (página completa) y tablero de postulaciones.

- **Visto:**
  - la barra superior ocupa tres filas y no se desborda;
  - el tablero apila las columnas y muestra en la tarjeta «80 · Encaje alto», además de «Prueba técnica», «Postulaste hoy»
    y «Compartida con tus grupos».
- **Prueba:** `critical-path.spec.ts` en el proyecto `mobile` (pasa).

![Móvil: login relleno](img/087-movil-login-relleno.png)
![Móvil: tus grupos](img/088-movil-grupos.png)
![Móvil: detalle del grupo](img/089-movil-detalle-grupo.png)
![Móvil: postulaciones](img/090-movil-postulaciones.png)

## 28. Cerrar sesión, iniciar sesión y recuperar la contraseña

**Acción:**

1. «Cerrar sesión».
2. «Entrar» con una contraseña mala.
3. «Olvidé mi contraseña» → Email `ana+guia@example.test` → «Enviar instrucciones».
4. Abrir el enlace del correo «Restablece tu contraseña de LinkVault» de Mailpit.
5. «Nueva contraseña» → «Guardar contraseña».
6. «Entrar» con la nueva y recargar.

- **Esperado:** «Email o contraseña incorrectos»; «Tu contraseña se ha actualizado…»; tras recargar sigue dentro.
- **Visto:** lo esperado: «Tu contraseña se ha actualizado. Ya puedes iniciar sesión con la nueva.», y tras recargar
  sigue en «Tus grupos».
- **Prueba:** `auth.spec.ts` (login, logout, credenciales malas; pasa); `auth-email-recovery.spec.ts` (pasa).

![Contraseña incorrecta](img/091-login-contrasena-incorrecta.png)
![Recuperar contraseña, relleno](img/092-recuperar-relleno.png)
![Instrucciones enviadas](img/093-recuperar-enviado.png)
![Restablecer, relleno](img/094-restablecer-relleno.png)
![Contraseña restablecida](img/095-restablecer-hecho.png)
![Login relleno](img/096-login-relleno.png)
![Sesión restaurada tras recargar](img/097-login-hecho-sesion-restaurada.png)

## 29. Borrar la cuenta

- **Acción (Carla):** «Perfil» → «Borrar mi cuenta» → «Contraseña actual» → «Borrar cuenta»; después, intentar entrar.
  Para terminar, Beto cierra sesión.
- **Esperado:** vuelve a `/login` y la cuenta ya no entra.
- **Visto:** lo esperado: «Email o contraseña incorrectos» con las credenciales de Carla.
- **Prueba:** `deploy-prod.spec.ts` (pasa).

![Borrar la cuenta, relleno](img/098-borrar-cuenta-relleno.png)
![La cuenta borrada ya no entra](img/099-cuenta-borrada-ya-no-entra.png)
![Cerrar sesión](img/100-cerrar-sesion.png)

## 30. Lo que no tiene pantalla o no se probó en local

| Catálogo | Por qué no está en la guía |
| -------- | -------------------------- |
| 13. Lectura automática de ofertas reales | Solo se usaron dominios `.invalid`, para no pedir nada a una bolsa real; se ve el caso «No pudimos leer esta oferta». |
| 15. Pegar la descripción | En `replay`, un texto propio no tiene fixture de `extract-pasted-job`. Lo cubre `links.spec.ts` (pasa). |
| 16. Quitar una oferta del grupo | No se capturó en el grupo; sí en «Solo para mí» (paso 21). |
| 22. Oferta cerrada y reabrir; 23. Frescura | `FEATURE_LINK_FRESHNESS=false`; `freshness.spec.ts` (pasa) siembra el cierre directamente en Mongo. |
| 33. Plan de estudio | Ver el paso 15. |
| 35 y 37. Buscar y Descubrir con resultados | Flags apagados en `e2e.env` (pasos 22 y 23). |
| 36. Salario leído del texto; 46. Reencolar lecturas | Son CLI, sin pantalla. |
| 39. Avisos por email | No se probaron a propósito, pero Mailpit recibió «Nuevo link en tu grupo» y «Actualización de postulación en el grupo» (captura 007). |
| 40. Push del navegador | Claves VAPID vacías (paso 24). |
| 41. Resumen semanal | `FEATURE_GROUP_DIGEST=false` y depende del cron. |
| 42 y 43. Extensión del navegador | No forma parte de la pila de la suite. |
| 45. Salud y métricas | Sin pantalla; el runner comprobó `/health` de api (3100) y worker (3101) en 200. |
| Análisis con IA externa real | La pila usa solo el mock; el permiso cambia textos y enrutado, pero no hay proveedor externo. |

## Pruebas automatizadas

Ejecutadas el 2026-09-28 sobre el commit `0f307c6`, en la misma pila aislada.

**Lote 1 (el único admitido y reproducible).** Se lanzó con el runner (`e2e-stack.ts --keep-stack --reporter=list`),
que siempre filtra por `@lot1`.

| Spec | Proyecto | Pasos | Resultado | Duración |
| ---- | -------- | ----- | --------- | -------- |
| `critical-path.spec.ts` | `chromium` | 14: A1 registro · A2 grupo sin visibilidad pública · B2b invitación, registro desde el login y unirse · A3–A7 y B3–B7 link, completar a mano, «Postulé → Hoy», CV, encaje `replay-report` · A8 limpieza | pasa | 19,5 s |
| `critical-path.spec.ts` | `mobile` (Pixel 7) | los mismos 14 | pasa | 19,4 s |

Corrida completa: 2 tests pasados en 42,7 s.

**Resto de specs (camino antiguo, no admitido).** Solo `critical-path.spec.ts` lleva `@lot1`, así que el runner no
ejecuta los demás. Se lanzaron uno a uno con Playwright (`--project=chromium`) contra la misma pila, con estas
precauciones para no alcanzar la pila de otra sesión:

- `E2E_BASE_URL=http://localhost:4300`;
- `MONGO_URI` en el puerto 27117;
- `LINKVAULT_API_ORIGIN=http://localhost:3100`;
- `docker` fuera del `PATH`;
- el contador de registros vaciado solo en el Redis del bloque antes de cada spec.

Según `apps/web-e2e/README.md`, un spec sin `@lot1` no cuenta como verificado: estos resultados son informativos.

| Spec | Qué cubre | Pasos | Resultado | Duración | Motivo si falla |
| ---- | --------- | ----- | --------- | -------- | --------------- |
| `home.spec.ts` | Raíz sin sesión → `/login` sin errores | 1 test | **falla** | 0,6 s | Espera el 401 del refresh en `http://localhost:4200/api/auth/refresh` (origen escrito a mano); en la pila del bloque es 4300. |
| `auth.spec.ts` | Registro, sesión restaurada, token no persistido, nombre, contraseña, logout y login | 9 | pasa | 2,4 s | — |
| `auth-email-recovery.spec.ts` | Aviso de email, «Olvidé mi contraseña», verificación | 1 test | pasa | 1,1 s | — |
| `groups.spec.ts` › flujo de grupos | Crear, invitar, miembros, expulsar, salir, borrar | 9 | **falla** | 1,6 s | En «copy the invitation…» espera `http://localhost:4200/unirse?codigo=…`; la app copia `http://localhost:4300/…` (origen escrito a mano en el spec). |
| `groups.spec.ts` › ceder la propiedad | Nombrar propietario, salir, el grupo conserva sus links | 5 | pasa | 4,3 s | — |
| `links.spec.ts` | Guardar, abrir, importar chat, quitar, lista privada, procedencia, lectura fallida, LinkedIn, pegar la descripción y deshacer | 23 | pasa | 10,6 s | — |
| `comments.spec.ts` | Nota, comentario en vivo, moderar, salir | 4 | pasa | 6,5 s | — |
| `applications.spec.ts` | «Postulé → Hoy», compartir, avatar, tablero con etapa, dejar de seguir | 10 | pasa | 7,3 s | — |
| `cv.spec.ts` › subir y leer | Pantalla vacía, subida, lectura, «Ver lo que leímos» | 4 | pasa | 3,6 s | — |
| `cv.spec.ts` › segundo CV | Marca de CV por defecto, moverla, eliminar | 4 | pasa | 1,6 s | — |
| `match.spec.ts` › análisis | Diálogo, pasos, informe, sugerencias, copiar | 4 | pasa | 9,2 s | — |
| `match.spec.ts` › permiso | Conceder en perfil, estado en `/mi-cv`, retirar, borrar el CV | 5 | **falla** | 18,7 s | En 17.2 no aparece la tarjeta con la etiqueta «backend nestjs senior …»: probablemente porque los dos tests comparten la misma URL de LinkedIn (`JOB_ID` del módulo) y, por la deduplicación, la tarjeta ya trae el título sembrado por el primero. |
| `public-share.spec.ts` | Tarjeta pública, página con Open Graph, salto a la SPA, vista sin sesión, alta desde el enlace, despublicar | 6 | pasa | 7,9 s | — |
| `byok.spec.ts` | Avisos de destino, guardar clave de OpenAI con hint, texto sin permiso | 1 test | **falla** | 21,9 s | Espera un 2xx de `PUT /api/users/me/ai-keys/openai` y responde 503: `e2e.env` no trae `AI_VAULT_KEY`. |
| `notifications.spec.ts` | Preferencias desde el perfil, guardar, endpoint VAPID | 1 test | pasa | 1,5 s | — |
| `deploy-prod.spec.ts` | `/privacidad` pública y zona de peligro del perfil | 1 test | pasa | 1,7 s | — |
| `freshness.spec.ts` | Marca de oferta cerrada en `/mis-links` (cierre sembrado en Mongo) | 1 test | pasa | 1,2 s | — |
| `search.spec.ts` | `/buscar`, consulta vacía, `GET /api/search` | 1 test | pasa | 1,1 s | — |

Resumen del resto: 15 specs y 18 tests; **14 tests pasan y 4 fallan** (`home`, `groups` test 1, `match` test 2 y
`byok`). Ninguno de los cuatro fallos apunta a un defecto del producto: tres dependen del entorno (origen 4200 escrito a
mano, falta de `AI_VAULT_KEY`) y uno, del orden entre tests del mismo spec. No se ha arreglado nada.

## Hallazgos

Qué no funcionó, qué se vio mal y qué no se pudo probar en local. No se ha corregido nada.

**Producto e interfaz**

- **H1. El nombre de quien escribió la oferta llega a quien la guarda desde el enlace público.** Al guardar, el
  formulario promete «Cualquiera con este enlace verá la oferta; no se verá el grupo ni tu nombre». La vista pública
  cumple (062), pero Carla, que no es del grupo, ve en su «Solo para mí» «Escrito por Ana Guía de Uso» junto al puesto y
  la empresa (064).
  **Corregido por el change `usage-guide-fixes`:** la API devuelve `by: null` para los autores con quienes quien lee no comparte ningún grupo y la tarjeta dice «Escrito por otra persona»; el texto de la promesa se ajustó a lo que de verdad se cumple.
- **H2. Texto superpuesto en Notificaciones.** Tras «Guardar preferencias», el texto de ayuda de «Grupo para avisos de
  estado» se monta encima de «Preferencias guardadas» (076).
  **Corregido por el change `usage-guide-fixes`:** el subíndice del selector crece con su ayuda, y «Todos mis grupos» se ve elegido.
- **H3. Error genérico al guardar una clave de IA sin bóveda.** Con la API respondiendo 503 (sin `AI_VAULT_KEY`), el
  perfil muestra «Algo salió mal. Inténtalo de nuevo» en vez de decir que las claves propias no están disponibles (081).
  **Diferido por el change `usage-guide-fixes`** a `e2e-suite-lot-2`, junto con H11: con `AI_VAULT_KEY` obligatoria en producción nadie lo verá.
- **H4. Aviso de lectura que no se actualiza.** El formulario de guardar sigue diciendo «Todavía estamos leyendo la oferta:
  si lo envías ahora, la tarjeta saldrá sin datos», aunque la lectura ya terminó en «No pudimos leer esta oferta» y aunque
  la oferta ya se completó a mano (030, 033, 035).
  **Corregido por el change `usage-guide-fixes`:** el aviso sigue al link guardado y depende de que la tarjeta tenga o no puesto.
- **H5. El campo de URL queda en rojo tras guardar.** Después de un guardado correcto, la etiqueta «Pega el enlace de una
  oferta» se pinta como error con el campo vacío (028, 068).
  **Corregido por el change `usage-guide-fixes`:** tras guardar, el formulario se reinicia entero (`resetForm`).
- **H6. El aviso «Compartido · Deshacer» sigue al navegar.** Sale en el grupo y sigue visible en el tablero, los insights y
  «Mi CV» (037, 042 a 046).
  **Corregido por el change `usage-guide-fixes`:** el aviso se cierra al navegar a otra página y no se abre si la persona ya salió.
- **H7. Fechas en formato estadounidense.** Los campos «Publicada el» y «Cierra el» del editor muestran `mm/dd/yyyy` en una
  interfaz en español (032). Visto en Chromium sin interfaz con `locale es-ES`; puede depender del sistema.
  **Diferido por el change `usage-guide-fixes`** a un change futuro con datos reales de las 5 personas de 35b.

**No se pudo probar en local**

- **H8.** Plan de estudio: con el único fixture de encaje que responde en `replay` no faltan habilidades y no se ofrece el
  plan (paso 15). No hay e2e que lo cubra.
- **H9.** Buscar y Descubrir con resultados, frescura y resumen semanal: flags apagados en `e2e.env` (pasos 22 y 23). Además,
  `search.spec.ts` pasa también con la búsqueda no disponible, así que su verde no demuestra resultados.
- **H10.** Push: las claves VAPID de `e2e.env` están vacías; el worker registra «VAPID keys missing; web push disabled» y la
  pantalla dice «El push no está disponible ahora» (077).
- **H11.** Claves propias (BYOK): sin `AI_VAULT_KEY` el guardado responde 503 (paso 25); por eso falla `byok.spec.ts`.
- **H12.** En `replay`, el paso `critique-suggestions` del encaje no tiene fixture. El worker registra
  «critique-suggestions failed (FixtureMissing); keeping generator report» y el informe se queda con las sugerencias del
  generador; no se nota en la pantalla.
- **H13.** IA externa real, extensión del navegador, lectura de bolsas reales y los CLI: fuera de esta pila (sección 30).

**Pruebas**

- **H14.** `home.spec.ts` y `groups.spec.ts` llevan `http://localhost:4200` escrito a mano y fallan contra cualquier otro
  origen, como el del bloque de la suite.
- **H15.** `match.spec.ts` test 2 depende, probablemente, de no ejecutarse después del test 1 en el mismo proceso (misma URL
  de LinkedIn para los dos).
- **H16.** Los specs del camino antiguo escriben capturas en `reports/smoke/<spec>/` del checkout (carpeta ignorada por
  git). Al ejecutarlos se crean o se sobrescriben esas carpetas.
- **H17.** `links.spec.ts` y `match.spec.ts` guardan URLs de `linkedin.com`, un dominio real. No se comprobó si el worker
  hizo alguna petición saliente (su log a nivel `info` no registra lecturas).
