# Guía funcional de pruebas locales de LinkVault, con capturas de toda la app

Recorrido por **todas las pantallas, formularios, diálogos y estados** de la aplicación de `main`, pensado para repetirse a mano en local antes del despliegue. Cada paso dice la ruta, qué se escribe y qué botón se pulsa, qué debe pasar, qué pasó y qué prueba automatizada lo cubre (o «sin prueba automatizada»), con una captura antes y otra después de rellenar. El orden es el que encuentra una persona nueva ([`docs/catalogo-de-uso.md`](../catalogo-de-uso.md)).

- **Fecha de las capturas y de las pruebas:** 2026-11-25.
- **Commit probado:** `bdb106efa262836a2902dc7f8016aeae0213291f` (`origin/main`).
- **Casos:** 123 (122 OK, 1 FALLO). **Capturas:** 215.
- **Cómo se hicieron las capturas:** `tools/guia-de-uso/capture.mts` (ver [`tools/guia-de-uso/README.md`](../../tools/guia-de-uso/README.md)). Esta guía la arma `tools/guia-de-uso/build-guide.mts` con lo que vio ese script; no se edita a mano.

## Índice

1. [Lista de comprobación](#lista-de-comprobación)
2. [Entorno local paso a paso](#entorno-local-paso-a-paso)
3. [Convenciones de la guía](#convenciones-de-la-guía)
4. [1. Sin sesión](#1-sin-sesión)
5. [2. Crear una cuenta](#2-crear-una-cuenta)
6. [3. Verificar el email](#3-verificar-el-email)
7. [4. Sesión y contraseña olvidada](#4-sesión-y-contraseña-olvidada)
8. [5. Perfil](#5-perfil)
9. [6. Grupos](#6-grupos)
10. [7. Invitar y unirse](#7-invitar-y-unirse)
11. [8. Guardar y completar ofertas](#8-guardar-y-completar-ofertas)
12. [9. Postulaciones](#9-postulaciones)
13. [10. Mi CV](#10-mi-cv)
14. [11. Analizar mi encaje](#11-analizar-mi-encaje)
15. [12. Comentarios, «Conozco a alguien», fijar y etiquetas](#12-comentarios-conozco-a-alguien-fijar-y-etiquetas)
16. [13. Enlace público](#13-enlace-público)
17. [14. Solo para mí](#14-solo-para-mí)
18. [15. Descubrir y Buscar](#15-descubrir-y-buscar)
19. [16. Notificaciones y push](#16-notificaciones-y-push)
20. [17. IA externa y claves propias](#17-ia-externa-y-claves-propias)
21. [18. Administrar grupos](#18-administrar-grupos)
22. [19. En el móvil (Pixel 7)](#19-en-el-móvil-pixel-7)
23. [20. Inglés y modo oscuro](#20-inglés-y-modo-oscuro)
24. [21. Borrar la cuenta](#21-borrar-la-cuenta)
25. [Lo que no tiene pantalla o no se pudo probar en esta pila](#lo-que-no-tiene-pantalla-o-no-se-pudo-probar-en-esta-pila)
26. [Pruebas automatizadas](#pruebas-automatizadas)
27. [Hallazgos](#hallazgos)
28. [Qué cambió respecto de la guía de septiembre](#qué-cambió-respecto-de-la-guía-de-septiembre)

---

## Lista de comprobación

Resultado de la corrida del 2026-11-25. Cada fila lleva al paso con su detalle. **FALLO** es lo que no coincide con la spec o el catálogo; está explicado en [Hallazgos](#hallazgos). Para repetir la guía a mano, cambia la última columna por tu resultado.

| Caso               | Qué se prueba                                                                         | Resultado      | Tu resultado |
| ------------------ | ------------------------------------------------------------------------------------- | -------------- | ------------ |
| [S01](#caso-s01)   | Aviso de privacidad sin sesión                                                        | OK             | [ ]          |
| [S02](#caso-s02)   | La raíz sin sesión lleva a «Iniciar sesión»                                           | OK             | [ ]          |
| [S03](#caso-s03)   | Iniciar sesión: validación de campos vacíos                                           | OK             | [ ]          |
| [S04](#caso-s04)   | Iniciar sesión: credenciales incorrectas                                              | OK             | [ ]          |
| [S05](#caso-s05)   | Una ruta protegida sin sesión lleva a `/login?returnUrl=…`                            | OK             | [ ]          |
| [S06](#caso-s06)   | Una ruta que no existe vuelve a la raíz                                               | OK             | [ ]          |
| [S07](#caso-s07)   | Oferta pública que no existe                                                          | OK             | [ ]          |
| [S08](#caso-s08)   | Verificar email con un enlace inválido                                                | OK             | [ ]          |
| [S09](#caso-s09)   | Restablecer contraseña con un enlace inválido                                         | OK             | [ ]          |
| [R01](#caso-r01)   | Crear cuenta: formulario vacío y validaciones                                         | OK             | [ ]          |
| [R02](#caso-r02)   | Crear cuenta: la contraseña no puede ser el email                                     | OK             | [ ]          |
| [R03](#caso-r03)   | Crear cuenta: Ana se registra                                                         | OK             | [ ]          |
| [R04](#caso-r04)   | Crear cuenta con un email que ya existe                                               | OK             | [ ]          |
| [V01](#caso-v01)   | Reenviar el correo de verificación                                                    | OK             | [ ]          |
| [V02](#caso-v02)   | El correo «Verifica tu email en LinkVault» llega a Mailpit                            | OK             | [ ]          |
| [V03](#caso-v03)   | Abrir el enlace: «Email verificado»                                                   | OK             | [ ]          |
| [V04](#caso-v04)   | Abrir otra vez el mismo enlace (ya usado)                                             | OK             | [ ]          |
| [L01](#caso-l01)   | Cerrar sesión                                                                         | OK             | [ ]          |
| [L02](#caso-l02)   | Recuperar contraseña: validación, email inexistente y email real                      | OK             | [ ]          |
| [L03](#caso-l03)   | Restablecer la contraseña con el enlace del correo                                    | OK             | [ ]          |
| [L04](#caso-l04)   | La contraseña vieja ya no entra y la nueva sí; la sesión sobrevive a recargar         | OK             | [ ]          |
| [F01](#caso-f01)   | Perfil inicial                                                                        | OK             | [ ]          |
| [F02](#caso-f02)   | Nombre: validación y guardado                                                         | OK             | [ ]          |
| [F03](#caso-f03)   | Contraseña: actual incorrecta, nueva demasiado corta y cambio correcto                | OK             | [ ]          |
| [F04](#caso-f04)   | IA y privacidad por defecto                                                           | OK             | [ ]          |
| [G01](#caso-g01)   | Tus grupos, sin ningún grupo                                                          | OK             | [ ]          |
| [G02](#caso-g02)   | Crear un grupo: validación y alta                                                     | OK             | [ ]          |
| [G03](#caso-g03)   | Renombrar el grupo                                                                    | OK             | [ ]          |
| [G04](#caso-g04)   | Ajuste: los links nuevos se comparten con un enlace público                           | OK             | [ ]          |
| [G05](#caso-g05)   | Copiar la invitación                                                                  | OK             | [ ]          |
| [I01](#caso-i01)   | Beto abre la invitación sin sesión y se registra                                      | OK             | [ ]          |
| [I02](#caso-i02)   | Beto pulsa «Unirme» y entra como miembro                                              | OK             | [ ]          |
| [I03](#caso-i03)   | Ana ve a Beto entre los miembros                                                      | OK             | [ ]          |
| [I04](#caso-i04)   | Unirse con un código inválido y con el campo vacío                                    | OK             | [ ]          |
| [K01](#caso-k01)   | Guardar una oferta en el grupo, con una nota                                          | OK             | [ ]          |
| [K02](#caso-k02)   | Guardar la misma URL otra vez                                                         | OK             | [ ]          |
| [K03](#caso-k03)   | URL inválida y nota demasiado larga                                                   | OK             | [ ]          |
| [K04](#caso-k04)   | La oferta que no se puede leer: «No pudimos leer esta oferta» y «Reintentar»          | OK             | [ ]          |
| [K05](#caso-k05)   | Completar la oferta a mano                                                            | OK             | [ ]          |
| [K06](#caso-k06)   | Pegar la descripción: texto que no es una oferta y texto de una oferta                | OK             | [ ]          |
| [K07](#caso-k07)   | Deshacer lo pegado                                                                    | OK             | [ ]          |
| [K08](#caso-k08)   | Importar un chat                                                                      | OK             | [ ]          |
| [K09](#caso-k09)   | Editar una oferta pegada y «Volver a lo anterior»                                     | OK             | [ ]          |
| [K10](#caso-k10)   | Quitar una oferta del grupo                                                           | OK             | [ ]          |
| [A01](#caso-a01)   | Tablero vacío (persona sin postulaciones)                                             | OK             | [ ]          |
| [A02](#caso-a02)   | Insights sin postulaciones                                                            | OK             | [ ]          |
| [A03](#caso-a03)   | «Postulé»: ¿cuándo postulaste?, fecha futura y «Hoy»                                  | OK             | [ ]          |
| [A04](#caso-a04)   | Compartir el estado con el grupo: «Qué verán», «Compartir», «Deshacer»                | OK             | [ ]          |
| [A05](#caso-a05)   | «Me interesa» en otra oferta y el aviso se cierra al navegar                          | OK             | [ ]          |
| [A06](#caso-a06)   | Tablero con columnas                                                                  | OK             | [ ]          |
| [A07](#caso-a07)   | Detalle: mover a «En proceso» con etapa, nota y compartir                             | OK             | [ ]          |
| [A08](#caso-a08)   | Cerrar una postulación: «¿Cómo se cerró?»                                             | OK             | [ ]          |
| [A09](#caso-a09)   | Insights con postulaciones                                                            | OK             | [ ]          |
| [A10](#caso-a10)   | Dejar de seguir                                                                       | OK             | [ ]          |
| [C01](#caso-c01)   | Mi CV vacío                                                                           | OK             | [ ]          |
| [C02](#caso-c02)   | Archivos que no se aceptan: tipo y tamaño                                             | OK             | [ ]          |
| [C03](#caso-c03)   | Subir el CV en PDF: «Estamos leyendo tu CV…» y «Listo»                                | OK             | [ ]          |
| [C04](#caso-c04)   | «Ver lo que leímos»                                                                   | OK             | [ ]          |
| [C05](#caso-c05)   | Un CV sin texto (escaneo) y «Usar el que sí se leyó»                                  | OK             | [ ]          |
| [C06](#caso-c06)   | Eliminar un CV                                                                        | OK             | [ ]          |
| [M01](#caso-m01)   | Sin CV: «Necesitas un CV guardado»                                                    | **FALLO** (H1) | [ ]          |
| [M02](#caso-m02)   | Analizar mi encaje: informe del fixture de replay                                     | OK             | [ ]          |
| [M03](#caso-m03)   | Sugerencia: «Copiar» y «No me convence»                                               | OK             | [ ]          |
| [M04](#caso-m04)   | El tablero muestra el badge de encaje                                                 | OK             | [ ]          |
| [M05](#caso-m05)   | Plan de estudio: un análisis que no existe                                            | OK             | [ ]          |
| [N01](#caso-n01)   | Beto ve la oferta con el estado compartido de Ana                                     | OK             | [ ]          |
| [N02](#caso-n02)   | Comentar: validación y publicación                                                    | OK             | [ ]          |
| [N03](#caso-n03)   | «Conozco a alguien ahí»                                                               | OK             | [ ]          |
| [N04](#caso-n04)   | Ana ve el comentario y el conteo en vivo, y borra el comentario ajeno                 | OK             | [ ]          |
| [N05](#caso-n05)   | Quitar la nota propia                                                                 | OK             | [ ]          |
| [N06](#caso-n06)   | Fijar, etiquetar y filtrar                                                            | OK             | [ ]          |
| [E01](#caso-e01)   | Copiar el enlace público de una tarjeta                                               | OK             | [ ]          |
| [E02](#caso-e02)   | Carla abre el enlace sin sesión                                                       | OK             | [ ]          |
| [E03](#caso-e03)   | Guardar desde el enlace público: registro y «Solo para mí»                            | OK             | [ ]          |
| [E04](#caso-e04)   | Dejar de compartir                                                                    | OK             | [ ]          |
| [E05](#caso-e05)   | Volver a compartir con un enlace público                                              | OK             | [ ]          |
| [P01](#caso-p01)   | Guardar una oferta en la lista privada                                                | OK             | [ ]          |
| [P02](#caso-p02)   | «Me interesa» y «Quitar»                                                              | OK             | [ ]          |
| [P03](#caso-p03)   | Oferta ya guardada en un grupo propio                                                 | OK             | [ ]          |
| [P04](#caso-p04)   | Oferta cerrada y «Reabrir»                                                            | OK             | [ ]          |
| [P05](#caso-p05)   | Pegar un chat en «Solo para mí»                                                       | OK             | [ ]          |
| [D01](#caso-d01)   | Descubrir vacantes (función apagada en la pila)                                       | OK             | [ ]          |
| [D02](#caso-d02)   | Buscar (función apagada en la pila)                                                   | OK             | [ ]          |
| [T01](#caso-t01)   | Preferencias de aviso: guardar y comprobar que persisten                              | OK             | [ ]          |
| [T02](#caso-t02)   | Grupo para avisos de estado                                                           | OK             | [ ]          |
| [T03](#caso-t03)   | Push del navegador (sin claves VAPID)                                                 | OK             | [ ]          |
| [T04](#caso-t04)   | Avisos por email en Mailpit                                                           | OK             | [ ]          |
| [B01](#caso-b01)   | Conceder y retirar el permiso de IA externa                                           | OK             | [ ]          |
| [B02](#caso-b02)   | Idioma de los análisis y ocultar el nombre                                            | OK             | [ ]          |
| [B03](#caso-b03)   | Clave propia (BYOK): validación y guardado sin bóveda                                 | OK             | [ ]          |
| [X01](#caso-x01)   | Beto se une con un código desde «Unirse con un código»                                | OK             | [ ]          |
| [X02](#caso-x02)   | El propietario no puede salir sin ceder la propiedad                                  | OK             | [ ]          |
| [X03](#caso-x03)   | Expulsar y regenerar el código                                                        | OK             | [ ]          |
| [X04](#caso-x04)   | El código anterior ya no sirve                                                        | OK             | [ ]          |
| [X05](#caso-x05)   | Regenerar el código a mano                                                            | OK             | [ ]          |
| [X06](#caso-x06)   | Ceder la propiedad y salir                                                            | OK             | [ ]          |
| [X07](#caso-x07)   | Borrar el grupo                                                                       | OK             | [ ]          |
| [X08](#caso-x08)   | Un grupo que no existe                                                                | OK             | [ ]          |
| [V01m](#caso-v01m) | Móvil: aviso de privacidad e inicio de sesión                                         | OK             | [ ]          |
| [V02m](#caso-v02m) | Móvil: /grupos                                                                        | OK             | [ ]          |
| [V03m](#caso-v03m) | Móvil: /grupos/6b0685dc439d6452ee3dfc78                                               | OK             | [ ]          |
| [V04m](#caso-v04m) | Móvil: /postulaciones                                                                 | OK             | [ ]          |
| [V05m](#caso-v05m) | Móvil: /mi-cv                                                                         | OK             | [ ]          |
| [V06m](#caso-v06m) | Móvil: /perfil                                                                        | OK             | [ ]          |
| [V07m](#caso-v07m) | Móvil: /notificaciones                                                                | OK             | [ ]          |
| [V08m](#caso-v08m) | Móvil: /mis-links                                                                     | OK             | [ ]          |
| [V09m](#caso-v09m) | Móvil: /buscar                                                                        | OK             | [ ]          |
| [V10m](#caso-v10m) | Móvil: /descubrir                                                                     | OK             | [ ]          |
| [V11m](#caso-v11m) | Móvil: el informe de encaje en pantalla completa                                      | OK             | [ ]          |
| [V12m](#caso-v12m) | Móvil: comentarios en pantalla completa                                               | OK             | [ ]          |
| [W01](#caso-w01)   | Interfaz en inglés (build `--localize=en`): sin sesión                                | OK             | [ ]          |
| [W02](#caso-w02)   | Inglés: grupos                                                                        | OK             | [ ]          |
| [W03](#caso-w03)   | Inglés: detalle del grupo                                                             | OK             | [ ]          |
| [W04](#caso-w04)   | Inglés: postulaciones                                                                 | OK             | [ ]          |
| [W05](#caso-w05)   | Inglés: mi-cv                                                                         | OK             | [ ]          |
| [W06](#caso-w06)   | Inglés: perfil                                                                        | OK             | [ ]          |
| [W07](#caso-w07)   | Inglés: notificaciones                                                                | OK             | [ ]          |
| [W08](#caso-w08)   | Inglés: mis-links                                                                     | OK             | [ ]          |
| [W09](#caso-w09)   | Inglés: informe de encaje                                                             | OK             | [ ]          |
| [W10](#caso-w10)   | Modo oscuro: la aplicación no lo soporta                                              | OK             | [ ]          |
| [Z01](#caso-z01)   | Diego se registra y crea un grupo con Beto dentro                                     | OK             | [ ]          |
| [Z02](#caso-z02)   | No se puede borrar la cuenta siendo el único propietario de un grupo con más miembros | OK             | [ ]          |
| [Z03](#caso-z03)   | Ceder el grupo y borrar la cuenta                                                     | OK             | [ ]          |

**Resumen:** 123 casos, 122 OK, 1 FALLO (M01).

## Entorno local paso a paso

Hay dos formas de tener LinkVault en local: la **pila aislada de la suite e2e** (la que usó esta guía; sin tocar tu `.env` ni la pila de desarrollo) y la **forma normal de desarrollo** del README. Prerrequisitos: Node.js de `.nvmrc` (22.x), pnpm de `packageManager` (`corepack enable`), Docker con Compose v2 y, en Windows, el redistribuible de Visual C++ x64.

### A. Pila aislada de la suite e2e (la de esta guía)

Fuente: `apps/web-e2e/README.md`. Monta Mongo (réplica de un nodo), Redis, el almacén S3, Mailpit, `api`, `worker` y `web` desde el código del checkout, en su propio bloque de puertos:

| Servicio           | Dirección                         |
| ------------------ | --------------------------------- |
| web                | http://localhost:4300             |
| API                | http://localhost:3100             |
| worker (salud)     | http://localhost:3101             |
| Mailpit (UI y API) | http://localhost:8125 (SMTP 1125) |
| Mongo / Redis      | 27117 / 6479                      |
| Almacén S3         | 9100 y 9101                       |

1. `pnpm install --frozen-lockfile` y, una vez, `pnpm exec playwright install chromium`.
2. Comprueba que el bloque de puertos de arriba está libre (el runner lo comprueba y se niega a arrancar si no).
3. Levanta la pila y déjala en pie:

   ```bash
   # macOS/Linux o Git Bash; en Windows no uses `pnpm nx run …` con --keep-stack: Nx termina las aplicaciones al salir
   TSX_TSCONFIG_PATH=apps/web-e2e/scripts/tsconfig.json \
     node --import tsx apps/web-e2e/scripts/e2e-stack.ts --keep-stack --list
   ```

   (`--list` solo lista las pruebas, así que el runner termina en verde y la pila queda levantada. En Linux/macOS vale también `pnpm nx run web-e2e:e2e-stack --keep-stack`, que además ejecuta la suite.) El runner tarda unos 2 minutos: levanta la infraestructura con `pnpm infra:up`, sirve `api` y `worker` con `nx serve` y `web` con `nx serve web -c production`.

4. Abre http://localhost:4300. No hay cuentas: cada paso de la guía las crea (`@example.test`).
5. Apaga todo al terminar (solo mata lo que esa corrida lanzó y borra los volúmenes del proyecto):

   ```bash
   TSX_TSCONFIG_PATH=apps/web-e2e/scripts/tsconfig.json \
     node --import tsx apps/web-e2e/scripts/e2e-stack.ts --down
   ```

**Configuración** (`apps/web-e2e/e2e.env`, fija y versionada; no se edita):

- **IA:** `AI_CHAIN=mock` con `AI_MOCK_MODE=replay`. Solo responde a entradas que tienen fixture; nada sale de la máquina. Por eso la oferta y el CV del encaje son los versionados del camino crítico (`libs/ai/src/infrastructure/fixture-inputs/critical-path.json`) y lo que se pega es el caso `oferta-entre-chat` del golden de `extract-pasted-job`.
- **Flags apagados:** `FEATURE_SEARCH`, `FEATURE_DISCOVERY`, `FEATURE_LINK_FRESHNESS`, `FEATURE_GROUP_DIGEST`. Buscar y Descubrir solo muestran «no disponible».
- **Claves vacías:** sin `VAPID_*` (push) ni `AI_VAULT_KEY` (claves propias de IA).
- **Registro:** el producto limita las altas a 10 cada 15 minutos por IP. Esta guía usa 5 (Ana, Beto, Carla, Diego y un intento repetido); una pila nueva parte de cero.

### B. Forma normal de desarrollo (README)

Fuentes: `README.md` («Prerrequisitos», «Puesta en marcha»), `docs/RUNBOOK.md`, `docs/demo.md` y `.env.example`. Con esta forma tienes **todo encendido** y la demo cargada, así que se pueden probar también Buscar, Descubrir, frescura, resumen semanal, push y claves propias (los casos que esta pila no alcanza).

```bash
pnpm install
cp .env.example .env            # y edita lo de abajo
COMPOSE_PROFILES=demo pnpm infra:up      # mongo, redis, almacén S3, mailpit, meilisearch y los buckets
ALLOW_DEMO_SEED=true pnpm nx run api:seed-demo   # cuentas y datos de la demo (idempotente)
pnpm nx serve api      # http://localhost:3000
pnpm nx serve worker   # http://localhost:3001
pnpm nx serve web      # http://localhost:4200
```

Cambios en `.env` para recorrer todo (cada variable está documentada en `.env.example`):

```dotenv
AI_CHAIN=mock
AI_MOCK_MODE=synth        # devuelve el fixture si existe y, si no, una salida sintética determinista
FEATURE_SEARCH=true
FEATURE_DISCOVERY=true
DISCOVERY_CHAIN=mock      # `live` consulta Get on Board y Remote OK de verdad
FEATURE_LINK_FRESHNESS=true
FEATURE_GROUP_DIGEST=true
VAPID_PUBLIC_KEY=<npx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<idem>
AI_VAULT_KEY=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
```

Comprobación: `curl http://localhost:3000/health` y `curl http://localhost:3001/health` → `200`. Correo (verificación, recuperación, avisos): Mailpit en http://localhost:8025. Con la demo, entra con `ana@demo.linkvault.local` / `Demo-pass-Ana-12345!` o `bob@demo.linkvault.local` / `Demo-pass-Bob-12345!` (grupo «Demo LatAm», código `SEEDD3M2`). Las cuentas de la demo nacen sin email verificado y su CV es un PDF sin texto: para el encaje sube uno real. Para partir de cero, `docker compose down -v`.

Con la forma B, lo que esta guía llama «http://localhost:4300» es http://localhost:4200, la API es http://localhost:3000 y Mailpit http://localhost:8025. Con `AI_MOCK_MODE=synth` el encaje, el pegado y el plan de estudio funcionan con datos propios (salida sintética, no es IA real).

### C. Build en inglés

`apps/web/project.json` define el locale `en`, pero ningún target lo construye ni lo sirve (ADR-050 deja pendiente publicarlo), y la pila solo sirve el español. Para las capturas en inglés se construyó el build a mano y se sirvió aparte, con un proxy de `/api` hacia la API de la pila:

```bash
pnpm nx run web:build:production --localize=en --output-path=dist/guia-web-en --skip-nx-cache
node --import tsx tools/guia-de-uso/serve-en.mts      # http://localhost:4301/en/
```

Las rutas siguen en español (`/en/grupos`, `/en/perfil`…); solo cambian los textos. Para repetir la tanda en inglés a mano, abre http://localhost:4301/en/login.

## Convenciones de la guía

- **Escritorio:** Chromium de Playwright a 1280×800; las capturas son de página completa (pueden ser más altas) salvo las de diálogos, que son del viewport.
- **Móvil:** Pixel 7 emulado (412×915 CSS; las capturas miden 1082 px de ancho por la densidad de píxeles). Sección «En el móvil».
- **Idiomas:** español por defecto (casi toda la guía) y una tanda en inglés con el build `--localize=en` (sección «Inglés y modo oscuro»).
- **Modo claro y oscuro:** la aplicación **solo tiene tema claro** (`styles.scss` fija `color-scheme: light`); el caso `W10` lo comprueba con `prefers-color-scheme: dark` (hallazgo H6).
- **Datos, todos inventados:** Ana (`ana+guia@example.test`), Beto (`beto+guia@example.test`), Carla (`carla+guia@example.test`) y Diego (`diego+guia@example.test`); ofertas en el dominio reservado `.invalid`, que no existe (el worker no puede leerlas y no sale ninguna petición a una bolsa real).
- **Máscaras:** las zonas rosas tapan contraseñas, el código de invitación, las claves de IA, el texto del CV, los fragmentos del CV en el informe de encaje y los extractos de los correos de Mailpit (pueden llevar el enlace con token).
- **Orden:** los pasos dependen de los anteriores (la cuenta, el grupo, la oferta y el CV se crean por el camino). Una pila nueva y el orden de la guía reproducen todo.

## 1. Sin sesión

### S01. Aviso de privacidad sin sesión

<a id="caso-s01"></a>

- **Ruta:** `/privacidad` (pública)
- **Se escribe y se pulsa:** Abrir la ruta sin sesión.
- **Esperado:** «Aviso de privacidad» con «Tu CV», «IA, OpenRouter y tus claves (BYOK)» y «Borrar tu cuenta».
- **Visto:** Aviso con «Tu CV», «IA, OpenRouter y tus claves (BYOK)» y «Borrar tu cuenta».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `deploy-prod.spec.ts`; unit: `features/privacy/privacy.page.spec.ts`

![privacidad sin sesion](img/001-privacidad-sin-sesion.png)

### S02. La raíz sin sesión lleva a «Iniciar sesión»

<a id="caso-s02"></a>

- **Ruta:** `/` → `/login`
- **Se escribe y se pulsa:** Abrir la raíz sin sesión.
- **Esperado:** Acaba en «Iniciar sesión».
- **Visto:** `/` acaba en `/login` con «Iniciar sesión».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `home.spec.ts` (con el origen 4200 escrito a mano); unit: `core/auth/auth.guards.spec.ts`

![login vacio](img/002-login-vacio.png)

### S03. Iniciar sesión: validación de campos vacíos

<a id="caso-s03"></a>

- **Ruta:** `/login`
- **Se escribe y se pulsa:** Pulsar «Entrar» con los dos campos vacíos.
- **Esperado:** «Introduce un email válido» e «Introduce tu contraseña»; no hay petición.
- **Visto:** «Introduce un email válido» e «Introduce tu contraseña»; no se envía nada.
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/auth/login.page.spec.ts`

![login validacion](img/003-login-validacion.png)

### S04. Iniciar sesión: credenciales incorrectas

<a id="caso-s04"></a>

- **Ruta:** `/login`
- **Se escribe y se pulsa:** Email `nadie+guia@example.test`, contraseña inventada; «Entrar».
- **Esperado:** 401 y «Email o contraseña incorrectos».
- **Visto:** `POST /api/auth/login` → 401 y «Email o contraseña incorrectos».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `auth.spec.ts` (credenciales malas)

![login incorrecto relleno](img/004-login-incorrecto-relleno.png)
![login incorrecto error](img/005-login-incorrecto-error.png)

### S05. Una ruta protegida sin sesión lleva a `/login?returnUrl=…`

<a id="caso-s05"></a>

- **Ruta:** `/postulaciones` → `/login?returnUrl=…`
- **Se escribe y se pulsa:** Abrir una ruta protegida sin sesión.
- **Esperado:** Redirige a `/login?returnUrl=%2Fpostulaciones`.
- **Visto:** Redirige a `/login?returnUrl=%2Fpostulaciones`.
- **Resultado:** OK
- **Prueba automatizada:** unit: `core/auth/auth.guards.spec.ts`

![ruta protegida login returnurl](img/006-ruta-protegida-login-returnurl.png)

### S06. Una ruta que no existe vuelve a la raíz

<a id="caso-s06"></a>

- **Ruta:** `/esto-no-existe`
- **Se escribe y se pulsa:** Abrir una ruta que no existe.
- **Esperado:** Vuelve a la raíz (y sin sesión, a `/login`).
- **Visto:** `/esto-no-existe` acaba en `/login` (sin sesión).
- **Resultado:** OK
- **Prueba automatizada:** unit: `app.routes.spec.ts`

### S07. Oferta pública que no existe

<a id="caso-s07"></a>

- **Ruta:** `/oferta/:slug` (pública)
- **Se escribe y se pulsa:** Abrir `/oferta/enlace-que-no-existe`.
- **Esperado:** «Este enlace ya no está disponible».
- **Visto:** «Este enlace ya no está disponible».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `public-share.spec.ts`; unit: `features/public/public-preview.page.spec.ts`

![oferta publica inexistente](img/007-oferta-publica-inexistente.png)

### S08. Verificar email con un enlace inválido

<a id="caso-s08"></a>

- **Ruta:** `/verificar-email?token=…`
- **Se escribe y se pulsa:** Abrir el enlace con un token inventado.
- **Esperado:** «Este enlace no es válido o ha caducado.».
- **Visto:** «Este enlace no es válido o ha caducado.» con la ayuda para pedir otro correo.
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/auth/verify-email.page.spec.ts`

![verificar email enlace invalido](img/008-verificar-email-enlace-invalido.png)

### S09. Restablecer contraseña con un enlace inválido

<a id="caso-s09"></a>

- **Ruta:** `/restablecer-contrasena?token=…`
- **Se escribe y se pulsa:** Token inventado; Nueva contraseña válida; «Guardar contraseña».
- **Esperado:** «Este enlace no es válido o ha caducado.» y «Solicitar un enlace nuevo».
- **Visto:** «Este enlace no es válido o ha caducado.» y «Solicitar un enlace nuevo».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/auth/reset-password.page.spec.ts`

![restablecer enlace invalido](img/009-restablecer-enlace-invalido.png)

## 2. Crear una cuenta

### R01. Crear cuenta: formulario vacío y validaciones

<a id="caso-r01"></a>

- **Ruta:** `/registro`
- **Se escribe y se pulsa:** Email `esto-no-es-un-email`, contraseña `corta`, nombre vacío; «Crear cuenta».
- **Esperado:** Tres errores de campo; no se envía el formulario.
- **Visto:** Tres errores de campo y no se envía el formulario.
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/auth/register.page.spec.ts`

![registro vacio](img/010-registro-vacio.png)
![registro validacion](img/011-registro-validacion.png)

### R02. Crear cuenta: la contraseña no puede ser el email

<a id="caso-r02"></a>

- **Ruta:** `/registro`
- **Se escribe y se pulsa:** Contraseña igual al email; «Crear cuenta».
- **Esperado:** «La contraseña no puede ser tu email».
- **Visto:** «La contraseña no puede ser tu email».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/auth/register.page.spec.ts`

![registro contrasena es email](img/012-registro-contrasena-es-email.png)

### R03. Crear cuenta: Ana se registra

<a id="caso-r03"></a>

- **Ruta:** `/registro` → `/grupos`
- **Se escribe y se pulsa:** Nombre `Ana Guía`, email `ana+guia@example.test`, contraseña de 10+ caracteres (enmascarada); «Crear cuenta».
- **Esperado:** Entra en `/grupos` con el aviso de email sin verificar.
- **Visto:** `POST /api/auth/register` → 201; «Tus grupos» con el aviso «Tu email aún no está verificado…» y «Reenviar correo».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 1 (lote 1), `auth.spec.ts`

![registro relleno](img/013-registro-relleno.png)
![registro hecho aviso email](img/014-registro-hecho-aviso-email.png)

### R04. Crear cuenta con un email que ya existe

<a id="caso-r04"></a>

- **Ruta:** `/registro`
- **Se escribe y se pulsa:** El mismo email de Ana con otro nombre; «Crear cuenta».
- **Esperado:** 409 y «Ya existe una cuenta con este email.».
- **Visto:** `409` y «Ya existe una cuenta con este email.» con «¿Quieres iniciar sesión?».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/auth/register.page.spec.ts`

![registro email repetido](img/015-registro-email-repetido.png)

## 3. Verificar el email

### V01. Reenviar el correo de verificación

<a id="caso-v01"></a>

- **Ruta:** Aviso de la barra
- **Se escribe y se pulsa:** «Reenviar correo».
- **Esperado:** `POST /api/auth/verify-email/resend` → 2xx y el aviso confirma el reenvío.
- **Visto:** `POST /api/auth/verify-email/resend` → 2xx; el aviso confirma el reenvío.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `auth-email-recovery.spec.ts`

![verificacion aviso](img/016-verificacion-aviso.png)
![verificacion reenviada](img/017-verificacion-reenviada.png)

### V02. El correo «Verifica tu email en LinkVault» llega a Mailpit

<a id="caso-v02"></a>

- **Ruta:** Mailpit (http://localhost:8125)
- **Se escribe y se pulsa:** Abrir la bandeja.
- **Esperado:** Correo «Verifica tu email en LinkVault» con el enlace `/verificar-email?token=…`.
- **Visto:** Correo «Verifica tu email en LinkVault» con un enlace `/verificar-email?token=…`.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `auth-email-recovery.spec.ts`

![mailpit bandeja](img/018-mailpit-bandeja.png)

### V03. Abrir el enlace: «Email verificado»

<a id="caso-v03"></a>

- **Ruta:** `/verificar-email?token=…` → `/grupos`
- **Se escribe y se pulsa:** Abrir el enlace del correo; «Ir a la aplicación».
- **Esperado:** «Email verificado» y el aviso de la barra desaparece.
- **Visto:** «Verificar email · Email verificado · Ir a la aplicación»; en `/grupos` ya no está el aviso.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `auth-email-recovery.spec.ts`; unit: `features/auth/verify-email.page.spec.ts`

![email verificado](img/019-email-verificado.png)
![grupos sin aviso](img/020-grupos-sin-aviso.png)

### V04. Abrir otra vez el mismo enlace (ya usado)

<a id="caso-v04"></a>

- **Ruta:** `/verificar-email?token=…`
- **Se escribe y se pulsa:** Abrir otra vez el mismo enlace.
- **Esperado:** Un enlace usado dice «Este enlace no es válido o ha caducado.».
- **Visto:** Un enlace usado dice «Este enlace no es válido o ha caducado.».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/auth/verify-email.page.spec.ts`

![verificar enlace ya usado](img/021-verificar-enlace-ya-usado.png)

## 4. Sesión y contraseña olvidada

### L01. Cerrar sesión

<a id="caso-l01"></a>

- **Ruta:** Barra superior
- **Se escribe y se pulsa:** «Cerrar sesión».
- **Esperado:** `POST /api/auth/logout` y vuelve a `/login`.
- **Visto:** `POST /api/auth/logout` → 2xx y vuelve a `/login`.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `auth.spec.ts`

![sesion cerrada](img/022-sesion-cerrada.png)

### L02. Recuperar contraseña: validación, email inexistente y email real

<a id="caso-l02"></a>

- **Ruta:** `/login` → `/recuperar-contrasena`
- **Se escribe y se pulsa:** «Olvidé mi contraseña»; «Enviar instrucciones» con el campo vacío; email inexistente; email de Ana.
- **Esperado:** Validación de email; con email inexistente o real, el mismo mensaje (no revela cuentas).
- **Visto:** Con email inexistente o real, el mismo mensaje: «Si existe una cuenta con ese email, te hemos enviado instrucciones…».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `auth-email-recovery.spec.ts`; unit: `features/auth/forgot-password.page.spec.ts`

![recuperar vacio](img/023-recuperar-vacio.png)
![recuperar validacion](img/024-recuperar-validacion.png)
![recuperar email inexistente](img/025-recuperar-email-inexistente.png)
![recuperar relleno](img/026-recuperar-relleno.png)
![recuperar enviado](img/027-recuperar-enviado.png)

### L03. Restablecer la contraseña con el enlace del correo

<a id="caso-l03"></a>

- **Ruta:** `/restablecer-contrasena?token=…`
- **Se escribe y se pulsa:** Enlace del correo «Restablece tu contraseña de LinkVault»; Nueva contraseña `corta` y luego una válida; «Guardar contraseña».
- **Esperado:** «Tu contraseña se ha actualizado. Ya puedes iniciar sesión con la nueva.».
- **Visto:** «Tu contraseña se ha actualizado. Ya puedes iniciar sesión con la nueva.»
- **Resultado:** OK
- **Prueba automatizada:** e2e: `auth-email-recovery.spec.ts`; unit: `features/auth/reset-password.page.spec.ts`

![restablecer vacio](img/028-restablecer-vacio.png)
![restablecer validacion](img/029-restablecer-validacion.png)
![restablecer relleno](img/030-restablecer-relleno.png)
![restablecer hecho](img/031-restablecer-hecho.png)

### L04. La contraseña vieja ya no entra y la nueva sí; la sesión sobrevive a recargar

<a id="caso-l04"></a>

- **Ruta:** `/login`
- **Se escribe y se pulsa:** Entrar con la contraseña vieja y luego con la nueva; recargar.
- **Esperado:** La vieja falla; la nueva entra; tras recargar sigue dentro.
- **Visto:** Contraseña vieja: «Email o contraseña incorrectos». La nueva entra; tras recargar sigue en «Tus grupos».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `auth.spec.ts`

![login contrasena vieja](img/032-login-contrasena-vieja.png)
![login relleno](img/033-login-relleno.png)
![login hecho sesion restaurada](img/034-login-hecho-sesion-restaurada.png)

## 5. Perfil

### F01. Perfil inicial

<a id="caso-f01"></a>

- **Ruta:** `/perfil`
- **Se escribe y se pulsa:** Abrir «Perfil».
- **Esperado:** Email de solo lectura y las secciones de nombre, contraseña, IA, claves, notificaciones y zona de peligro.
- **Visto:** Email de solo lectura, nombre, contraseña, «IA y privacidad», «Tus claves de IA», notificaciones y zona de peligro.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `auth.spec.ts`; unit: `features/profile/profile.page.spec.ts`

![perfil inicial](img/035-perfil-inicial.png)

### F02. Nombre: validación y guardado

<a id="caso-f02"></a>

- **Ruta:** `/perfil`
- **Se escribe y se pulsa:** Nombre vacío → «Guardar nombre»; luego `Ana Guía de Uso` → «Guardar nombre».
- **Esperado:** Error de campo y luego «Nombre guardado».
- **Visto:** «Nombre guardado».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `auth.spec.ts`

![perfil nombre vacio](img/036-perfil-nombre-vacio.png)
![perfil nombre relleno](img/037-perfil-nombre-relleno.png)
![perfil nombre guardado](img/038-perfil-nombre-guardado.png)

### F03. Contraseña: actual incorrecta, nueva demasiado corta y cambio correcto

<a id="caso-f03"></a>

- **Ruta:** `/perfil`
- **Se escribe y se pulsa:** Contraseña actual equivocada; nueva `corta`; y por último actual correcta y nueva válida; «Cambiar contraseña».
- **Esperado:** «La contraseña actual no es correcta»; error de longitud; «Contraseña cambiada. Cerramos tu sesión en los demás dispositivos.».
- **Visto:** «La contraseña actual no es correcta»; «La nueva contraseña debe tener al menos 10 caracteres…»; «Contraseña cambiada. Cerramos tu sesión en los demás dispositivos.».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `auth.spec.ts`; unit: `features/profile/profile.page.spec.ts`

![perfil contrasena actual incorrecta](img/039-perfil-contrasena-actual-incorrecta.png)
![perfil contrasena nueva corta](img/040-perfil-contrasena-nueva-corta.png)
![perfil contrasena rellena](img/041-perfil-contrasena-rellena.png)
![perfil contrasena cambiada](img/042-perfil-contrasena-cambiada.png)

### F04. IA y privacidad por defecto

<a id="caso-f04"></a>

- **Ruta:** `/perfil` · «IA y privacidad»
- **Se escribe y se pulsa:** Mirar la sección sin tocar nada.
- **Esperado:** Permiso externo apagado, idioma «Español», «Ocultar mi nombre…» activado.
- **Visto:** Permiso externo apagado, idioma «Español» y «Ocultar mi nombre a los proveedores externos» activado.
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/profile/profile.page.spec.ts`

![perfil ia por defecto](img/043-perfil-ia-por-defecto.png)

## 6. Grupos

### G01. Tus grupos, sin ningún grupo

<a id="caso-g01"></a>

- **Ruta:** `/grupos`
- **Se escribe y se pulsa:** Abrir «Tus grupos» sin grupos.
- **Esperado:** Explica qué es un grupo y ofrece «Crear un grupo» y «Unirse con un código».
- **Visto:** Explica qué es un grupo y ofrece «Crear un grupo» y «Unirse con un código».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/groups/groups-list.page.spec.ts`

![grupos vacio](img/044-grupos-vacio.png)

### G02. Crear un grupo: validación y alta

<a id="caso-g02"></a>

- **Ruta:** `/grupos` → `/grupos/:id`
- **Se escribe y se pulsa:** «Crear un grupo»; «Crear grupo» vacío; Nombre del grupo `Búsqueda backend 2026`; «Crear grupo».
- **Esperado:** Detalle con «Propietario» y el «Código de invitación».
- **Visto:** `POST /api/groups` → 201; detalle con «Propietario», el código (enmascarado) y «Eres el único miembro: para irte, borra el grupo».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 2, `groups.spec.ts`; unit: `features/groups/create-group.dialog.spec.ts`

![grupo crear vacio](img/045-grupo-crear-vacio.png)
![grupo crear validacion](img/046-grupo-crear-validacion.png)
![grupo crear relleno](img/047-grupo-crear-relleno.png)
![grupo creado](img/048-grupo-creado.png)

### G03. Renombrar el grupo

<a id="caso-g03"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** «Renombrar»; Nombre del grupo `Búsqueda backend (guía)`; «Guardar nombre nuevo».
- **Esperado:** El título cambia.
- **Visto:** El título cambia a «Búsqueda backend (guía)».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/groups/group-detail.page.spec.ts` (ninguna e2e)

![grupo renombrar relleno](img/049-grupo-renombrar-relleno.png)

### G04. Ajuste: los links nuevos se comparten con un enlace público

<a id="caso-g04"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** Interruptor «Los links nuevos se comparten con un enlace público»: apagar y volver a activar.
- **Esperado:** `PATCH /api/groups/:id/settings` → 200; solo afecta a lo que se guarde después.
- **Visto:** Viene activado; se apaga y se vuelve a activar (`PATCH /api/groups/:id/settings` → 200). Se deja activado para el enlace público.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 2 (lo apaga)

![grupo visibilidad activada](img/050-grupo-visibilidad-activada.png)
![grupo visibilidad apagada](img/051-grupo-visibilidad-apagada.png)

### G05. Copiar la invitación

<a id="caso-g05"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** «Copiar invitación».
- **Esperado:** «Invitación copiada»; lo copiado lleva el enlace absoluto con el código.
- **Visto:** «Invitación copiada»; el texto copiado lleva el enlace absoluto `/unirse?codigo=…` del origen de la web.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 2b, `groups.spec.ts`

![invitacion copiada](img/052-invitacion-copiada.png)

## 7. Invitar y unirse

### I01. Beto abre la invitación sin sesión y se registra

<a id="caso-i01"></a>

- **Ruta:** `/unirse?codigo=…` → `/login` → `/registro`
- **Se escribe y se pulsa:** Beto, sin sesión, abre el enlace; «Crear cuenta»; Nombre `Beto Guía`, email `beto+guia@example.test`, contraseña; «Crear cuenta».
- **Esperado:** Vuelve a `/unirse` con el código ya escrito.
- **Visto:** Tras el registro vuelve a `/unirse` con el código ya escrito en «Unirse a un grupo».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 2b

![invitado login con returnurl](img/053-invitado-login-con-returnurl.png)
![invitado registro relleno](img/054-invitado-registro-relleno.png)
![invitado unirse codigo escrito](img/055-invitado-unirse-codigo-escrito.png)

### I02. Beto pulsa «Unirme» y entra como miembro

<a id="caso-i02"></a>

- **Ruta:** `/unirse` → `/grupos/:id`
- **Se escribe y se pulsa:** «Unirme».
- **Esperado:** Beto entra como «Miembro»: ve «Salir del grupo» y no ve el código.
- **Visto:** Beto ve «Salir del grupo» y no ve el código de invitación.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 2b

![invitado dentro del grupo](img/056-invitado-dentro-del-grupo.png)

### I03. Ana ve a Beto entre los miembros

<a id="caso-i03"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** Ana abre el grupo.
- **Esperado:** Ve a Beto entre los miembros, con «Nombrar propietario» y «Expulsar».
- **Visto:** Ana ve a Beto con «Nombrar propietario» y «Expulsar».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 2b

![propietaria ve al miembro](img/057-propietaria-ve-al-miembro.png)

### I04. Unirse con un código inválido y con el campo vacío

<a id="caso-i04"></a>

- **Ruta:** `/grupos` · «Unirse con un código»
- **Se escribe y se pulsa:** «Unirme» vacío; código `ZZZZZZZZ`; «Unirme».
- **Esperado:** Error de campo; 404 y «Ese código no corresponde a ningún grupo».
- **Visto:** 404 y «Ese código no corresponde a ningún grupo».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/groups/join-group.dialog.spec.ts`

![unirse codigo vacio](img/058-unirse-codigo-vacio.png)
![unirse codigo invalido](img/059-unirse-codigo-invalido.png)

## 8. Guardar y completar ofertas

### K01. Guardar una oferta en el grupo, con una nota

<a id="caso-k01"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** Pega el enlace de una oferta `https://empleos.guia-de-uso.invalid/ofertas/backend-…`; Nota para el grupo `Esta es la que comenté ayer, pinta bien.`; «Guardar».
- **Esperado:** La tarjeta aparece leyéndose, con la nota y el aviso de enlace público.
- **Visto:** `POST /api/links` → 201; tarjeta con «Leyendo la oferta…», «Enlace público», «Nota de Ana Guía de Uso» y el aviso «Cualquiera con este enlace verá la oferta, pero no el grupo; tu nombre solo lo verá quien ya comparta un grupo contigo.» con «Copiar enlace».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 3, `links.spec.ts`, `comments.spec.ts`; unit: `features/links/save-link.form.spec.ts`

![links grupo vacio](img/060-links-grupo-vacio.png)
![guardar link relleno](img/061-guardar-link-relleno.png)
![link guardado leyendo](img/062-link-guardado-leyendo.png)

### K02. Guardar la misma URL otra vez

<a id="caso-k02"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** La misma URL otra vez; «Guardar».
- **Esperado:** «Ya estaba aquí, lo compartió …»; no se crea otra tarjeta.
- **Visto:** «Ya estaba aquí, lo compartió Ana Guía de Uso»; no se crea otra tarjeta.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `links.spec.ts`

![link repetido ya estaba](img/063-link-repetido-ya-estaba.png)

### K03. URL inválida y nota demasiado larga

<a id="caso-k03"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** URL `hola esto no es un enlace`; luego una URL válida con 300 caracteres de nota.
- **Esperado:** «Eso no parece un enlace de una oferta»; «Máximo 280 caracteres».
- **Visto:** «Eso no parece un enlace de una oferta»; «Máximo 280 caracteres» con el contador `300/280`.
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/links/save-link.form.spec.ts`

![guardar link url invalida](img/064-guardar-link-url-invalida.png)
![guardar link nota larga](img/065-guardar-link-nota-larga.png)

### K04. La oferta que no se puede leer: «No pudimos leer esta oferta» y «Reintentar»

<a id="caso-k04"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** Esperar a que la lectura termine; «Reintentar».
- **Esperado:** «No pudimos leer esta oferta» con «Completar a mano», «Pegar la descripción» y «Reintentar».
- **Visto:** La lectura de un `.invalid` acaba en «No pudimos leer esta oferta» con «Completar a mano», «Pegar la descripción» y «Reintentar»; «Reintentar» vuelve a «Leyendo la oferta…» y acaba igual.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `links.spec.ts` (lectura fallida); unit: `features/links/link-status.spec.ts`

![link no leido](img/066-link-no-leido.png)
![link reintento leyendo](img/067-link-reintento-leyendo.png)

### K05. Completar la oferta a mano

<a id="caso-k05"></a>

- **Ruta:** `/grupos/:id` · diálogo «Corregir la oferta»
- **Se escribe y se pulsa:** «Completar a mano»; Puesto `Backend Developer (oferta de prueba)`, Empresa `Empresa Ficticia E2E`, Resumen (texto de `critical-path.json`); «Guardar».
- **Esperado:** Puesto y empresa con «Escrito por Ana Guía de Uso».
- **Visto:** `PATCH /api/links/:id/preview` → 200; puesto y empresa con «Escrito por Ana Guía de Uso».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 4, `links.spec.ts`; unit: `features/links/edit-preview.dialog.spec.ts`

![corregir oferta vacio](img/068-corregir-oferta-vacio.png)
![corregir oferta relleno](img/069-corregir-oferta-relleno.png)
![oferta completada escrito por](img/070-oferta-completada-escrito-por.png)

### K06. Pegar la descripción: texto que no es una oferta y texto de una oferta

<a id="caso-k06"></a>

- **Ruta:** `/grupos/:id` · diálogo «Pegar la descripción»
- **Se escribe y se pulsa:** «Pegar la descripción»; un texto de chat; luego la oferta del golden `oferta-entre-chat`; «Completar la oferta».
- **Esperado:** Un chat se rechaza («Eso no parece una oferta de trabajo…»); una oferta completa la tarjeta con «Descripción pegada por …».
- **Visto:** Con un texto de chat: «Algo salió mal. Inténtalo de nuevo». Con la oferta del golden: tarjeta «Ingeniero de Soporte TI» de «Distribuidora Andina» con «Descripción pegada por Ana Guía de Uso» y «Deshacer lo que pegó Ana Guía de Uso».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `links.spec.ts` (pegar la descripción); unit: `features/links/paste-description.dialog.spec.ts`

![pegar descripcion vacio](img/071-pegar-descripcion-vacio.png)
![pegar descripcion error](img/072-pegar-descripcion-error.png)
![pegar descripcion relleno](img/073-pegar-descripcion-relleno.png)
![oferta pegada](img/074-oferta-pegada.png)

### K07. Deshacer lo pegado

<a id="caso-k07"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** «Deshacer lo que pegó Ana Guía de Uso».
- **Esperado:** La tarjeta vuelve al estado anterior.
- **Visto:** La tarjeta vuelve a «No pudimos leer esta oferta».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `links.spec.ts`

![pegado deshecho](img/075-pegado-deshecho.png)

### K08. Importar un chat

<a id="caso-k08"></a>

- **Ruta:** `/grupos/:id` · diálogo de importar
- **Se escribe y se pulsa:** «Pegar un chat»; un chat con dos URLs (una repetida); «Importar». Luego un texto sin enlaces.
- **Esperado:** «2 guardadas, 0 ya estaban»; «No encontramos ninguna oferta en ese texto».
- **Visto:** «2 guardadas, 0 ya estaban» (la URL repetida cuenta una vez); un texto sin enlaces: «No encontramos ninguna oferta en ese texto».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `links.spec.ts`; unit: `features/links/import-links.dialog.spec.ts`

![importar chat vacio](img/076-importar-chat-vacio.png)
![importar chat relleno](img/077-importar-chat-relleno.png)
![importar chat resumen](img/078-importar-chat-resumen.png)
![importar chat sin ofertas](img/079-importar-chat-sin-ofertas.png)

### K09. Editar una oferta pegada y «Volver a lo anterior»

<a id="caso-k09"></a>

- **Ruta:** `/grupos/:id` · «Editar»
- **Se escribe y se pulsa:** Pegar la oferta; «Editar», Puesto `… (corregido)`, «Guardar»; «Editar» otra vez, «Volver a lo anterior», «Guardar».
- **Esperado:** El editor muestra el origen de cada campo y deja volver al valor anterior.
- **Visto:** Tras corregir el puesto de una oferta pegada, el editor ofrece «Volver a lo anterior»; al marcarlo recupera «Ingeniero de Soporte TI», con su origen anterior.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `links.spec.ts` («Quién lo escribió…»); unit: `features/links/edit-preview.dialog.spec.ts`

![editar oferta volver a lo anterior](img/080-editar-oferta-volver-a-lo-anterior.png)
![editar oferta revertida](img/081-editar-oferta-revertida.png)

### K10. Quitar una oferta del grupo

<a id="caso-k10"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** «Quitar» → «Quitar».
- **Esperado:** La confirmación explica lo que se pierde; la tarjeta desaparece del grupo.
- **Visto:** La confirmación explica lo que se pierde; tras «Quitar» la tarjeta desaparece del grupo.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `links.spec.ts`

![quitar oferta confirmar](img/082-quitar-oferta-confirmar.png)
![oferta quitada](img/083-oferta-quitada.png)

## 9. Postulaciones

### A01. Tablero vacío (persona sin postulaciones)

<a id="caso-a01"></a>

- **Ruta:** `/postulaciones`
- **Se escribe y se pulsa:** Abrir el tablero con una cuenta sin postulaciones.
- **Esperado:** «Aquí verás las ofertas que sigues…» con enlaces a los grupos y a «Solo para mí».
- **Visto:** «Aquí verás las ofertas que sigues…» con «Ir a tus grupos» e «Ir a Solo para mí».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/applications/applications-board.page.spec.ts`

![tablero vacio](img/084-tablero-vacio.png)

### A02. Insights sin postulaciones

<a id="caso-a02"></a>

- **Ruta:** `/postulaciones/insights`
- **Se escribe y se pulsa:** Abrir «Ver insights» sin postulaciones.
- **Esperado:** Insights vacío con enlaces para empezar.
- **Visto:** Insights vacío con enlaces para empezar.
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/applications/applications-insights.page.spec.ts`

![insights vacio](img/085-insights-vacio.png)

### A03. «Postulé»: ¿cuándo postulaste?, fecha futura y «Hoy»

<a id="caso-a03"></a>

- **Ruta:** `/grupos/:id` · tarjeta
- **Se escribe y se pulsa:** «Postulé»; «Otro día» con un día futuro; luego un día de hace tres días; «Usar ese día».
- **Esperado:** «¿Cuándo postulaste?»; el día futuro se rechaza; `POST /api/applications` → 201 y «Tu postulación: Postulada».
- **Visto:** `POST /api/applications` → 201; «Tu postulación: Postulada». Una fecha futura se rechaza.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 5, `applications.spec.ts`; unit: `features/applications/applied-date-question.component.spec.ts`

![postule cuando](img/086-postule-cuando.png)
![postule fecha futura](img/087-postule-fecha-futura.png)
![postule otro dia relleno](img/088-postule-otro-dia-relleno.png)
![postulada aviso compartir](img/089-postulada-aviso-compartir.png)

### A04. Compartir el estado con el grupo: «Qué verán», «Compartir», «Deshacer»

<a id="caso-a04"></a>

- **Ruta:** `/grupos/:id` · aviso tras el gesto
- **Se escribe y se pulsa:** «Qué verán» → «Entendido»; «Compartir».
- **Esperado:** Aviso «¿Que tus grupos vean que postulaste…?»; tras compartir, «Compartido» con «Deshacer».
- **Visto:** «Qué verán» explica qué ve el grupo; «Compartir» → «Compartido» con «Deshacer».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `applications.spec.ts`, `share-notice-time.spec.ts`; unit: `features/applications/share-notice.component.spec.ts`, `share-invitation.spec.ts`

![compartir que veran](img/090-compartir-que-veran.png)
![estado compartido con el grupo](img/091-estado-compartido-con-el-grupo.png)

### A05. «Me interesa» en otra oferta y el aviso se cierra al navegar

<a id="caso-a05"></a>

- **Ruta:** `/grupos/:id` → `/postulaciones`
- **Se escribe y se pulsa:** «Me interesa» en otra oferta; ir a «Postulaciones».
- **Esperado:** «Tu postulación: Interés»; el aviso de compartir no sigue en el tablero.
- **Visto:** «Tu postulación: Interés»; el aviso de compartir no sigue en el tablero.
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/applications/share-invitation.spec.ts`

![me interesa](img/092-me-interesa.png)

### A06. Tablero con columnas

<a id="caso-a06"></a>

- **Ruta:** `/postulaciones`
- **Se escribe y se pulsa:** Abrir el tablero.
- **Esperado:** Seis columnas con una tarjeta en «Interés» y otra en «Postuladas».
- **Visto:** Seis columnas («Interés», «Postuladas», «En proceso», «Con oferta», «Aceptadas», «Cerradas»); una tarjeta en cada una de las dos primeras.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 5

![tablero postuladas](img/093-tablero-postuladas.png)

### A07. Detalle: mover a «En proceso» con etapa, nota y compartir

<a id="caso-a07"></a>

- **Ruta:** `/postulaciones` · panel de la tarjeta
- **Se escribe y se pulsa:** Abrir la tarjeta de «Postuladas»; «Mover a…» → «En proceso»; Etapa `Prueba técnica` → «Guardar»; Notas `Preparar el ejercicio de API REST antes del jueves.` → «Guardar la nota»; «Cerrar».
- **Esperado:** La tarjeta pasa a «En proceso · Prueba técnica»; el historial registra el cambio; «Nota guardada».
- **Visto:** La tarjeta pasa a «En proceso · Prueba técnica»; el historial registra el cambio; «Nota guardada».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `applications.spec.ts` (mover con etapa); unit: `features/applications/application-detail.dialog.spec.ts`

![detalle postulacion](img/094-detalle-postulacion.png)
![mover en proceso etapa](img/095-mover-en-proceso-etapa.png)
![detalle en proceso con nota](img/096-detalle-en-proceso-con-nota.png)
![tablero en proceso](img/097-tablero-en-proceso.png)

### A08. Cerrar una postulación: «¿Cómo se cerró?»

<a id="caso-a08"></a>

- **Ruta:** `/postulaciones`
- **Se escribe y se pulsa:** Arrastrar la tarjeta de «Interés» a «Cerradas»; elegir «Retirada».
- **Esperado:** «¿Cómo se cerró?»; la tarjeta pasa a «Cerradas».
- **Visto:** Pregunta «¿Cómo se cerró?» (Rechazada, Retirada…); la tarjeta pasa a «Cerradas».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/applications/applications-board.page.spec.ts`

![cerrar como se cerro](img/098-cerrar-como-se-cerro.png)
![tablero cerradas](img/099-tablero-cerradas.png)

### A09. Insights con postulaciones

<a id="caso-a09"></a>

- **Ruta:** `/postulaciones/insights`
- **Se escribe y se pulsa:** «Ver insights».
- **Esperado:** «Resumen» (Abiertas, Cerradas, Aceptadas), «Por estado» y «Estancadas (≥ 10 días)».
- **Visto:** «Abiertas 1», «Cerradas 1» y «Ninguna postulación abierta lleva 10 días o más sin cambio de estado.».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/applications/applications-insights.page.spec.ts` (ninguna e2e)

![insights](img/100-insights.png)

### A10. Dejar de seguir

<a id="caso-a10"></a>

- **Ruta:** `/postulaciones` · panel
- **Se escribe y se pulsa:** Abrir la tarjeta de «Cerradas»; «Dejar de seguir» → confirmar.
- **Esperado:** La tarjeta desaparece del tablero; la oferta sigue en su grupo.
- **Visto:** Tras confirmar, la tarjeta desaparece del tablero; la oferta sigue en el grupo.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `applications.spec.ts` (dejar de seguir)

![dejar de seguir confirmar](img/101-dejar-de-seguir-confirmar.png)
![dejar de seguir hecho](img/102-dejar-de-seguir-hecho.png)

## 10. Mi CV

### C01. Mi CV vacío

<a id="caso-c01"></a>

- **Ruta:** `/mi-cv`
- **Se escribe y se pulsa:** Abrir «Mi CV» sin CV.
- **Esperado:** Texto de bienvenida y «Ahora mismo no has dado ese permiso, así que tu CV no sale de LinkVault.».
- **Visto:** «Sube tu CV y LinkVault podrá comparar tus habilidades con cada vacante.» y «Ahora mismo no has dado ese permiso, así que tu CV no sale de LinkVault.».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `cv.spec.ts`; unit: `features/cv/my-cv.page.spec.ts`

![mi cv vacio](img/103-mi-cv-vacio.png)

### C02. Archivos que no se aceptan: tipo y tamaño

<a id="caso-c02"></a>

- **Ruta:** `/mi-cv`
- **Se escribe y se pulsa:** «Subir CV» con `notas.txt`; y con un `enorme.pdf` de 6 MB.
- **Esperado:** «Solo aceptamos PDF o DOCX»; «Ese archivo pesa más de 5 MB».
- **Visto:** «Solo aceptamos PDF o DOCX» y «Ese archivo pesa más de 5 MB»; no se envía nada.
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/cv/cv-upload.component.spec.ts`

![cv error tipo](img/104-cv-error-tipo.png)
![cv error tamano](img/105-cv-error-tamano.png)

### C03. Subir el CV en PDF: «Estamos leyendo tu CV…» y «Listo»

<a id="caso-c03"></a>

- **Ruta:** `/mi-cv`
- **Se escribe y se pulsa:** «Subir CV» con el PDF `e2e-cv-camino.pdf` (líneas del camino crítico).
- **Esperado:** «Estamos leyendo tu CV…» y luego «Listo · tu CV se leyó bien».
- **Visto:** `POST /api/cv` → 201; de «Estamos leyendo tu CV…» a «Listo · tu CV se leyó bien» sin recargar, con «Este es el CV que compararemos con las vacantes».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 6, `cv.spec.ts`

![mi cv leyendo](img/106-mi-cv-leyendo.png)
![mi cv listo](img/107-mi-cv-listo.png)

### C04. «Ver lo que leímos»

<a id="caso-c04"></a>

- **Ruta:** `/mi-cv` · diálogo
- **Se escribe y se pulsa:** «Ver lo que leímos» → «Cerrar».
- **Esperado:** El texto leído, sin copiar ni descargar.
- **Visto:** El diálogo «Lo que leímos de tu CV» muestra el texto (enmascarado en la captura), sin copiar ni descargar.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `cv.spec.ts`; unit: `features/cv/cv-text-preview.dialog.spec.ts`

![mi cv lo que leimos](img/108-mi-cv-lo-que-leimos.png)

### C05. Un CV sin texto (escaneo) y «Usar el que sí se leyó»

<a id="caso-c05"></a>

- **Ruta:** `/mi-cv`
- **Se escribe y se pulsa:** «Subir CV» con `cv-escaneado.pdf` (sin texto); «Usar el que sí se leyó».
- **Esperado:** «Este archivo no tiene texto…»; como CV por defecto avisa «No servirá para analizar vacantes».
- **Visto:** «Este archivo no tiene texto: parece un escaneo o una imagen.»; como CV por defecto avisa «No servirá para analizar vacantes» y ofrece «Usar el que sí se leyó».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `cv.spec.ts` (segundo CV); unit: `features/cv/cv-card.component.spec.ts`

![cv sin texto](img/109-cv-sin-texto.png)
![cv por defecto inservible](img/110-cv-por-defecto-inservible.png)

### C06. Eliminar un CV

<a id="caso-c06"></a>

- **Ruta:** `/mi-cv`
- **Se escribe y se pulsa:** «Eliminar» → «Eliminar».
- **Esperado:** El CV desaparece.
- **Visto:** Tras confirmar, el CV escaneado desaparece y queda el CV leído como el de por defecto.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `cv.spec.ts` (segundo CV)

![cv eliminar confirmar](img/111-cv-eliminar-confirmar.png)
![cv eliminado](img/112-cv-eliminado.png)

## 11. Analizar mi encaje

### M01. Sin CV: «Necesitas un CV guardado»

<a id="caso-m01"></a>

- **Ruta:** `/grupos/:id` · «Analizar mi encaje»
- **Se escribe y se pulsa:** Beto (sin CV) abre «Analizar mi encaje» y pulsa «Analizar».
- **Esperado:** «Necesitas un CV guardado…» (catálogo, paso 31).
- **Visto:** Esperado «Necesitas un CV guardado…» (catálogo, paso 31); la API responde 409 no_cv y el diálogo dice «No pudimos analizar ahora.» con «Reintentar» (ver Hallazgos)
- **Resultado:** **FALLO** (hallazgo H1, ver [Hallazgos](#hallazgos))
- **Prueba automatizada:** unit: `features/match/match.dialog.spec.ts`

![encaje sin cv](img/113-encaje-sin-cv.png)
![encaje sin cv analizar](img/114-encaje-sin-cv-analizar.png)

### M02. Analizar mi encaje: informe del fixture de replay

<a id="caso-m02"></a>

- **Ruta:** `/grupos/:id` · diálogo «Tu encaje con esta oferta»
- **Se escribe y se pulsa:** «Analizar mi encaje» → «Analizar».
- **Esperado:** El informe del fixture de replay: «80 · Encaje alto», sin «Análisis básico».
- **Visto:** `POST /api/links/:id/match` → 202 y el informe: «80 · Encaje alto»; coinciden Node, NestJS, MongoDB, Redis y Vitest; «Tienes todas las habilidades que pide esta oferta»; una sugerencia de «Experiencia».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 7 (`replay-report`), `match.spec.ts`

![encaje antes de analizar](img/115-encaje-antes-de-analizar.png)
![encaje analizando](img/116-encaje-analizando.png)
![encaje informe](img/117-encaje-informe.png)

### M03. Sugerencia: «Copiar» y «No me convence»

<a id="caso-m03"></a>

- **Ruta:** Diálogo del informe
- **Se escribe y se pulsa:** «Copiar»; «No me convence».
- **Esperado:** «Copiado» y «Marcada».
- **Visto:** «Copiado» y «Marcada».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `match.spec.ts` (copiar)

![encaje sugerencia](img/118-encaje-sugerencia.png)
![encaje copiado y no me convence](img/119-encaje-copiado-y-no-me-convence.png)

### M04. El tablero muestra el badge de encaje

<a id="caso-m04"></a>

- **Ruta:** `/postulaciones`
- **Se escribe y se pulsa:** Abrir el tablero.
- **Esperado:** La tarjeta muestra «80 · Encaje alto».
- **Visto:** La tarjeta de la postulación muestra «80 · Encaje alto».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/applications/application-card.component.spec.ts`

![tablero con badge encaje](img/120-tablero-con-badge-encaje.png)

### M05. Plan de estudio: un análisis que no existe

<a id="caso-m05"></a>

- **Ruta:** `/plan/:analysisId`
- **Se escribe y se pulsa:** Abrir `/plan/0123456789abcdef01234567`.
- **Esperado:** Avisa que el análisis no existe.
- **Visto:** La pantalla del plan avisa que el análisis no existe. El plan con contenido no es alcanzable con `replay` (ver Hallazgos).
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/roadmap/roadmap.page.spec.ts` (ninguna e2e)

![plan inexistente](img/121-plan-inexistente.png)

## 12. Comentarios, «Conozco a alguien», fijar y etiquetas

### N01. Beto ve la oferta con el estado compartido de Ana

<a id="caso-n01"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** Beto abre el grupo.
- **Esperado:** Ve la tarjeta de Ana y su estado compartido.
- **Visto:** Beto ve la tarjeta de Ana con la nota, y el avatar «AG» con el estado compartido.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `applications.spec.ts` (avatar)

![miembro ve la oferta y el estado](img/122-miembro-ve-la-oferta-y-el-estado.png)

### N02. Comentar: validación y publicación

<a id="caso-n02"></a>

- **Ruta:** `/grupos/:id` · diálogo «Comentarios»
- **Se escribe y se pulsa:** Beto: «Comentar»; 2100 caracteres; `Conozco al equipo, te cuento por privado.` → «Comentar».
- **Esperado:** Límite de longitud; `POST …/comments` → 201 y el hilo muestra el comentario.
- **Visto:** `POST /api/groups/:id/links/:id/comments` → 201; el hilo muestra el comentario con «Borrar» y el aviso de que lo verán los miembros.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `comments.spec.ts`; unit: `features/links/comments.dialog.spec.ts`

![comentarios vacio](img/123-comentarios-vacio.png)
![comentario demasiado largo](img/124-comentario-demasiado-largo.png)
![comentario relleno](img/125-comentario-relleno.png)
![comentario publicado](img/126-comentario-publicado.png)

### N03. «Conozco a alguien ahí»

<a id="caso-n03"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** «Conozco a alguien ahí».
- **Esperado:** «1 persona conoce a alguien ahí» y «Ya marqué que conozco a alguien».
- **Visto:** «1 persona conoce a alguien ahí» y el botón «Ya marqué que conozco a alguien».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/links/link-card.component.spec.ts` (ninguna e2e)

![conozco a alguien](img/127-conozco-a-alguien.png)

### N04. Ana ve el comentario y el conteo en vivo, y borra el comentario ajeno

<a id="caso-n04"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** Ana: ver la tarjeta; «Comentar» → «Borrar» → «Borrar».
- **Esperado:** Ve el comentario y el conteo en vivo; borrar lo ajeno avisa que desaparece para todo el grupo.
- **Visto:** Ana ve el comentario y «1 persona conoce a alguien ahí»; al borrar lo ajeno la confirmación avisa que desaparece para todo el grupo.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `comments.spec.ts` (moderar)

![propietaria ve comentario y conteo](img/128-propietaria-ve-comentario-y-conteo.png)
![comentario borrar confirmar](img/129-comentario-borrar-confirmar.png)

### N05. Quitar la nota propia

<a id="caso-n05"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** «Quitar la nota» → confirmar.
- **Esperado:** La nota desaparece.
- **Visto:** La nota desaparece de la tarjeta.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `comments.spec.ts`; unit: `features/links/link-card.comments.spec.ts`

![nota quitar confirmar](img/130-nota-quitar-confirmar.png)

### N06. Fijar, etiquetar y filtrar

<a id="caso-n06"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** «Fijar»; «Editar etiquetas» `backend, remoto` → «Guardar etiquetas»; «Solo fijados»; Filtrar por etiqueta `backend` → «Filtrar».
- **Esperado:** «Fijado», dos chips y la lista filtrada con «Quitar etiqueta».
- **Visto:** «Fijado», los chips «backend» y «remoto», y con «Solo fijados» y la etiqueta `backend` solo queda esa oferta junto a «Quitar etiqueta».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/groups/group-detail.page.spec.ts` (ninguna e2e)

![etiquetas rellenas](img/131-etiquetas-rellenas.png)
![filtro fijados y etiqueta](img/132-filtro-fijados-y-etiqueta.png)

## 13. Enlace público

### E01. Copiar el enlace público de una tarjeta

<a id="caso-e01"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** «Copiar enlace» en la tarjeta.
- **Esperado:** Se copia `http://localhost:3100/p/<slug>`.
- **Visto:** Se copia `http://localhost:3100/p/<slug>` (el origen público de la API del bloque).
- **Resultado:** OK
- **Prueba automatizada:** e2e: `public-share.spec.ts`

![enlace publico copiado](img/133-enlace-publico-copiado.png)

### E02. Carla abre el enlace sin sesión

<a id="caso-e02"></a>

- **Ruta:** `/p/:slug` → `/oferta/:slug`
- **Se escribe y se pulsa:** Carla, sin sesión, abre el enlace copiado.
- **Esperado:** Vista pública sin grupo ni nombres, con «Ver la oferta original» y «Guardar en LinkVault».
- **Visto:** La API redirige a `/oferta/:slug`: puesto, empresa, «Ver la oferta original», «Guardar en LinkVault» y «Entrar»; no aparece el grupo ni ningún nombre.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `public-share.spec.ts`

![vista publica sin sesion](img/134-vista-publica-sin-sesion.png)

### E03. Guardar desde el enlace público: registro y «Solo para mí»

<a id="caso-e03"></a>

- **Ruta:** `/oferta/:slug` → `/registro?import=…` → `/mis-links`
- **Se escribe y se pulsa:** «Guardar en LinkVault»; Nombre `Carla Guía`, email `carla+guia@example.test`, contraseña; «Crear cuenta».
- **Esperado:** Acaba en «Solo para mí» con la oferta guardada y sin el nombre de quien la escribió.
- **Visto:** Acaba en «Solo para mí» con «Guardada en «Solo para mí». Compártela en un grupo cuando quieras.»; la tarjeta no revela el nombre de Ana (dice «Escrito por otra persona»).
- **Resultado:** OK
- **Prueba automatizada:** e2e: `public-share.spec.ts`; unit: `features/links/my-links.page.spec.ts`

![registro desde enlace publico](img/135-registro-desde-enlace-publico.png)
![guardada en solo para mi](img/136-guardada-en-solo-para-mi.png)

### E04. Dejar de compartir

<a id="caso-e04"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** «Dejar de compartir» → «Dejar de compartir»; abrir la URL pública.
- **Esperado:** «Este enlace ya no está disponible».
- **Visto:** La URL pública deja de funcionar: «Este enlace ya no está disponible · Pídeselo de nuevo a quien te lo envió».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `public-share.spec.ts` (despublicar)

![dejar de compartir confirmar](img/137-dejar-de-compartir-confirmar.png)
![oferta sin enlace publico](img/138-oferta-sin-enlace-publico.png)
![enlace publico ya no disponible](img/139-enlace-publico-ya-no-disponible.png)

### E05. Volver a compartir con un enlace público

<a id="caso-e05"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** «Compartir con un enlace público» → «Compartir».
- **Esperado:** La tarjeta vuelve a tener «Copiar enlace».
- **Visto:** La oferta vuelve a tener «Copiar enlace» y «Dejar de compartir».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/links/link-list.public-share.spec.ts`

![compartir enlace publico confirmar](img/140-compartir-enlace-publico-confirmar.png)

## 14. Solo para mí

### P01. Guardar una oferta en la lista privada

<a id="caso-p01"></a>

- **Ruta:** `/mis-links`
- **Se escribe y se pulsa:** Pega el enlace de una oferta `…/solo-para-mi-…`; «Guardar».
- **Esperado:** La tarjeta aparece sin fijar, etiquetas ni «Conozco a alguien ahí».
- **Visto:** La tarjeta no tiene fijar, etiquetas ni «Conozco a alguien ahí», porque no está en un grupo.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `links.spec.ts` (lista privada); unit: `features/links/my-links.page.spec.ts`

![solo para mi relleno](img/141-solo-para-mi-relleno.png)
![solo para mi guardada](img/142-solo-para-mi-guardada.png)

### P02. «Me interesa» y «Quitar»

<a id="caso-p02"></a>

- **Ruta:** `/mis-links`
- **Se escribe y se pulsa:** «Me interesa»; «Quitar» → «Quitar».
- **Esperado:** «Tu postulación: Interés»; al quitar, la tarjeta desaparece.
- **Visto:** «Tu postulación: Interés»; «Se quita de tu lista; la oferta sigue disponible en tus grupos.»; al confirmar, la tarjeta desaparece.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `links.spec.ts`

![solo para mi me interesa](img/143-solo-para-mi-me-interesa.png)
![solo para mi quitar confirmar](img/144-solo-para-mi-quitar-confirmar.png)
![solo para mi quitada](img/145-solo-para-mi-quitada.png)

### P03. Oferta ya guardada en un grupo propio

<a id="caso-p03"></a>

- **Ruta:** `/mis-links`
- **Se escribe y se pulsa:** Guardar una oferta que Ana ya tiene en su grupo.
- **Esperado:** «Ya lo tienes en: Búsqueda backend (guía)».
- **Visto:** «Ya lo tienes en: Búsqueda backend (guía)».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/links/save-link.form.spec.ts`

![solo para mi ya en un grupo](img/146-solo-para-mi-ya-en-un-grupo.png)

### P04. Oferta cerrada y «Reabrir»

<a id="caso-p04"></a>

- **Ruta:** `/mis-links`
- **Se escribe y se pulsa:** Completar a mano con «Cierra el» pasado; sembrar `closedAt` en Mongo; recargar; «Reabrir» → «Sin fecha de cierre».
- **Esperado:** «Oferta cerrada»; «Elige cuándo cierra»; «Oferta marcada como abierta…».
- **Visto:** La frescura automática está apagada en la pila, así que el cierre se siembra en Mongo (`job_links.closedAt`). «Oferta cerrada» → «Reabrir» → «Elige cuándo cierra» (la fecha de cierre ya pasó) → «Sin fecha de cierre» → «Oferta marcada como abierta…».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `freshness.spec.ts` (siembra Mongo); unit: `features/links/reopen-expires.dialog.spec.ts`

![oferta cerrada](img/147-oferta-cerrada.png)
![reabrir elige cuando cierra](img/148-reabrir-elige-cuando-cierra.png)
![oferta reabierta](img/149-oferta-reabierta.png)

### P05. Pegar un chat en «Solo para mí»

<a id="caso-p05"></a>

- **Ruta:** `/mis-links`
- **Se escribe y se pulsa:** «Pegar un chat» con una URL; «Importar».
- **Esperado:** «1 guardada, 0 ya estaban».
- **Visto:** «1 guardada, 0 ya estaban».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/links/my-links.page.spec.ts`

![solo para mi importar chat](img/150-solo-para-mi-importar-chat.png)

## 15. Descubrir y Buscar

### D01. Descubrir vacantes (función apagada en la pila)

<a id="caso-d01"></a>

- **Ruta:** `/descubrir`
- **Se escribe y se pulsa:** Consulta `react`; «Buscar».
- **Esperado:** Con `FEATURE_DISCOVERY=false`: «El descubrimiento de vacantes no está disponible en este momento.».
- **Visto:** «El descubrimiento de vacantes no está disponible en este momento.» (`FEATURE_DISCOVERY=false` en `e2e.env`). Los resultados no se pueden probar con esta pila.
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/discovery/discovery.page.spec.ts` (ninguna e2e)

![descubrir vacio](img/151-descubrir-vacio.png)
![descubrir relleno](img/152-descubrir-relleno.png)
![descubrir no disponible](img/153-descubrir-no-disponible.png)

### D02. Buscar (función apagada en la pila)

<a id="caso-d02"></a>

- **Ruta:** `/buscar`
- **Se escribe y se pulsa:** «Buscar» con la consulta vacía; luego `Backend`.
- **Esperado:** «Escribe algo para buscar…»; con `FEATURE_SEARCH=false`: «La búsqueda no está disponible en este momento. Inténtalo más tarde.».
- **Visto:** Consulta vacía: «Escribe algo para buscar…». Con texto: «La búsqueda no está disponible en este momento. Inténtalo más tarde.» (`FEATURE_SEARCH=false`).
- **Resultado:** OK
- **Prueba automatizada:** e2e: `search.spec.ts`; unit: `features/search/search.page.spec.ts`

![buscar vacio](img/154-buscar-vacio.png)
![buscar consulta vacia](img/155-buscar-consulta-vacia.png)
![buscar no disponible](img/156-buscar-no-disponible.png)

## 16. Notificaciones y push

### T01. Preferencias de aviso: guardar y comprobar que persisten

<a id="caso-t01"></a>

- **Ruta:** `/perfil` → `/notificaciones`
- **Se escribe y se pulsa:** «Gestionar notificaciones»; desactivar «Nuevo link en un grupo»; «Guardar preferencias»; recargar.
- **Esperado:** «Preferencias guardadas» y el valor persiste.
- **Visto:** «Preferencias guardadas»; tras recargar, «Nuevo link en un grupo» sigue apagado. Todas las demás vienen activadas.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `notifications.spec.ts`; unit: `features/notifications/notifications.page.spec.ts`

![notificaciones inicial](img/157-notificaciones-inicial.png)
![notificaciones guardadas](img/158-notificaciones-guardadas.png)

### T02. Grupo para avisos de estado

<a id="caso-t02"></a>

- **Ruta:** `/notificaciones`
- **Se escribe y se pulsa:** «Grupo para avisos de estado» → `Búsqueda backend (guía)`; «Guardar preferencias».
- **Esperado:** Se guarda el grupo elegido.
- **Visto:** Lista «Todos mis grupos» y los grupos de la persona; se guarda y queda elegido.
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/notifications/notifications.page.spec.ts`

![notificaciones grupo de estado](img/159-notificaciones-grupo-de-estado.png)
![notificaciones grupo guardado](img/160-notificaciones-grupo-guardado.png)

### T03. Push del navegador (sin claves VAPID)

<a id="caso-t03"></a>

- **Ruta:** `/notificaciones`
- **Se escribe y se pulsa:** «Activar push».
- **Esperado:** Sin claves VAPID: «El push no está disponible ahora…».
- **Visto:** En Chromium sin interfaz el permiso de notificaciones se deniega: «No diste permiso de notificaciones. Puedes seguir editando los avisos por email.». Con un navegador normal, y sin claves VAPID, sale «El push no está disponible ahora…».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `notifications.spec.ts` (endpoint VAPID); unit: `core/notifications/push-notifications.spec.ts`

![push del navegador](img/161-push-del-navegador.png)

### T04. Avisos por email en Mailpit

<a id="caso-t04"></a>

- **Ruta:** Mailpit
- **Se escribe y se pulsa:** Abrir la bandeja tras el recorrido.
- **Esperado:** Correos «Nuevo link en tu grupo» y «Actualización de postulación en el grupo».
- **Visto:** Mailpit tiene «Nuevo link en tu grupo» y «Actualización de postulación en el grupo» (avisos del worker; solo llegan a cuentas con email verificado).
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada

![mailpit avisos](img/162-mailpit-avisos.png)

## 17. IA externa y claves propias

### B01. Conceder y retirar el permiso de IA externa

<a id="caso-b01"></a>

- **Ruta:** `/perfil` · «IA y privacidad»
- **Se escribe y se pulsa:** Activar «Permitir que un proveedor de IA externo analice mi CV»; abrir `/mi-cv`; volver a desactivarlo.
- **Esperado:** «Concedido el … · versión …»; `/mi-cv` lo refleja; «Permiso retirado…».
- **Visto:** «Concedido el … · versión …»; `/mi-cv` dice «ese permiso está activo»; al retirar, «Permiso retirado. Tus próximos análisis no saldrán de LinkVault…».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `match.spec.ts` test 2; unit: `features/profile/profile.page.spec.ts`

![ia permiso concedido](img/163-ia-permiso-concedido.png)
![mi cv permiso activo](img/164-mi-cv-permiso-activo.png)
![ia permiso retirado](img/165-ia-permiso-retirado.png)

### B02. Idioma de los análisis y ocultar el nombre

<a id="caso-b02"></a>

- **Ruta:** `/perfil` · «IA y privacidad»
- **Se escribe y se pulsa:** Idioma de los análisis → «Inglés»; apagar «Ocultar mi nombre…»; restaurar los dos.
- **Esperado:** Los dos controles cambian y se restauran.
- **Visto:** El idioma de los análisis pasa a «Inglés» y «Ocultar mi nombre…» se apaga; se restauran («No cambia el idioma de la interfaz.»).
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/profile/profile.page.spec.ts`

![ia idioma ingles y nombre visible](img/166-ia-idioma-ingles-y-nombre-visible.png)

### B03. Clave propia (BYOK): validación y guardado sin bóveda

<a id="caso-b03"></a>

- **Ruta:** `/perfil` · «Tus claves de IA»
- **Se escribe y se pulsa:** Anthropic: «Clave de API» `corta`; luego un valor de prueba de 16+ caracteres (enmascarado); «Guardar clave».
- **Esperado:** Error de longitud; la clave se guarda si hay bóveda (`AI_VAULT_KEY`).
- **Visto:** `PUT /api/users/me/ai-keys/anthropic` → 503 (`e2e.env` no trae `AI_VAULT_KEY`). La pantalla muestra «Algo salió mal. Inténtalo de nuevo».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `byok.spec.ts` (falla sin `AI_VAULT_KEY`); unit: `features/profile/profile.page.spec.ts`

![clave ia corta](img/167-clave-ia-corta.png)
![clave ia rellena](img/168-clave-ia-rellena.png)
![clave ia resultado](img/169-clave-ia-resultado.png)

## 18. Administrar grupos

### X01. Beto se une con un código desde «Unirse con un código»

<a id="caso-x01"></a>

- **Ruta:** `/grupos` · «Unirse con un código»
- **Se escribe y se pulsa:** Ana crea `Grupo para expulsar (guía)`; Beto: «Unirse con un código», el código (enmascarado), «Unirme».
- **Esperado:** Beto entra como «Miembro».
- **Visto:** Beto entra al grupo como «Miembro».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `groups.spec.ts`; unit: `features/groups/join-group.dialog.spec.ts`

![unirse con codigo relleno](img/170-unirse-con-codigo-relleno.png)
![unido con codigo](img/171-unido-con-codigo.png)

### X02. El propietario no puede salir sin ceder la propiedad

<a id="caso-x02"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** Ana mira la lista de miembros.
- **Esperado:** «Para salir, nombra propietario a otro miembro».
- **Visto:** «Para salir, nombra propietario a otro miembro».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `groups.spec.ts`

![propietario no puede salir](img/172-propietario-no-puede-salir.png)

### X03. Expulsar y regenerar el código

<a id="caso-x03"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** «Expulsar» → «Expulsar»; «Regenerar el código para que no pueda volver a entrar».
- **Esperado:** «… dejará de ver este grupo…»; el código nuevo es distinto.
- **Visto:** El diálogo de expulsión avisa que la persona dejará de ver el grupo; luego ofrece regenerar el código; el código nuevo es distinto del anterior.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `groups.spec.ts` test 1

![expulsar confirmar](img/173-expulsar-confirmar.png)
![expulsado regenerar codigo](img/174-expulsado-regenerar-codigo.png)

### X04. El código anterior ya no sirve

<a id="caso-x04"></a>

- **Ruta:** `/grupos`
- **Se escribe y se pulsa:** Beto usa el código anterior.
- **Esperado:** «Ese código no corresponde a ningún grupo».
- **Visto:** «Ese código no corresponde a ningún grupo».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `groups.spec.ts` test 1

![codigo anterior no sirve](img/175-codigo-anterior-no-sirve.png)

### X05. Regenerar el código a mano

<a id="caso-x05"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** «Regenerar el código» → «Regenerar».
- **Esperado:** El código cambia.
- **Visto:** Tras «Regenerar», el código cambia.
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/groups/group-detail.page.spec.ts`

![regenerar codigo dialogo](img/176-regenerar-codigo-dialogo.png)

### X06. Ceder la propiedad y salir

<a id="caso-x06"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** Ana crea `Grupo para ceder (guía)`, Beto se une; «Nombrar propietario» → confirmar; «Salir del grupo» → «Salir».
- **Esperado:** Beto queda como «Propietario»; Ana sale.
- **Visto:** Ana nombra propietario a Beto, ve «Salir del grupo» y sale; Beto queda como «Propietario».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `groups.spec.ts` test 2

![nombrar propietario confirmar](img/177-nombrar-propietario-confirmar.png)
![propiedad cedida](img/178-propiedad-cedida.png)
![salir del grupo confirmar](img/179-salir-del-grupo-confirmar.png)

### X07. Borrar el grupo

<a id="caso-x07"></a>

- **Ruta:** `/grupos/:id`
- **Se escribe y se pulsa:** Beto: «Borrar el grupo» → «Borrar».
- **Esperado:** «Se borrará solo para ti. No se puede deshacer.»; vuelve a «Tus grupos».
- **Visto:** La confirmación dice «Se borrará solo para ti. No se puede deshacer.»; vuelve a «Tus grupos».
- **Resultado:** OK
- **Prueba automatizada:** e2e: `groups.spec.ts` test 1

![borrar grupo confirmar](img/180-borrar-grupo-confirmar.png)
![grupo borrado](img/181-grupo-borrado.png)

### X08. Un grupo que no existe

<a id="caso-x08"></a>

- **Ruta:** `/grupos/0123456789abcdef01234567`
- **Se escribe y se pulsa:** Abrir un grupo que no existe.
- **Esperado:** «Ese grupo no existe o ya no perteneces a él».
- **Visto:** «Ese grupo no existe o ya no perteneces a él» y «Volver a tus grupos».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/groups/group-detail.page.spec.ts`

![grupo inexistente](img/182-grupo-inexistente.png)

## 19. En el móvil (Pixel 7)

### V01m. Móvil: aviso de privacidad e inicio de sesión

<a id="caso-v01m"></a>

- **Ruta:** `/login`, `/privacidad` (Pixel 7, 412×915 CSS)
- **Se escribe y se pulsa:** Entrar con Ana desde el móvil; abrir `/privacidad`.
- **Esperado:** Formularios a una columna, sin desbordes.
- **Visto:** Formularios a una columna; sin desbordes horizontales.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` en el proyecto `mobile`

![movil login vacio](img/183-movil-login-vacio.png)
![movil login relleno](img/184-movil-login-relleno.png)
![movil privacidad](img/185-movil-privacidad.png)

### V02m. Móvil: /grupos

<a id="caso-v02m"></a>

- **Ruta:** `/grupos` (móvil)
- **Se escribe y se pulsa:** Abrir.
- **Esperado:** Sin desborde horizontal.
- **Visto:** Sin desborde horizontal (0 px).
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` (`mobile`)

![movil grupos](img/186-movil-grupos.png)

### V03m. Móvil: /grupos/6b0685dc439d6452ee3dfc78

<a id="caso-v03m"></a>

- **Ruta:** `/grupos/:id` (móvil)
- **Se escribe y se pulsa:** Abrir.
- **Esperado:** Sin desborde horizontal.
- **Visto:** Sin desborde horizontal (0 px).
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` (`mobile`)

![movil detalle grupo](img/187-movil-detalle-grupo.png)

### V04m. Móvil: /postulaciones

<a id="caso-v04m"></a>

- **Ruta:** `/postulaciones` (móvil)
- **Se escribe y se pulsa:** Abrir.
- **Esperado:** Las columnas se apilan; sin desborde.
- **Visto:** Sin desborde horizontal (0 px).
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` (`mobile`)

![movil postulaciones](img/188-movil-postulaciones.png)

### V05m. Móvil: /mi-cv

<a id="caso-v05m"></a>

- **Ruta:** `/mi-cv` (móvil)
- **Se escribe y se pulsa:** Abrir.
- **Esperado:** Sin desborde horizontal.
- **Visto:** Sin desborde horizontal (0 px).
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` (`mobile`)

![movil mi cv](img/189-movil-mi-cv.png)

### V06m. Móvil: /perfil

<a id="caso-v06m"></a>

- **Ruta:** `/perfil` (móvil)
- **Se escribe y se pulsa:** Abrir.
- **Esperado:** Sin desborde horizontal.
- **Visto:** Sin desborde horizontal (0 px).
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada

![movil perfil](img/190-movil-perfil.png)

### V07m. Móvil: /notificaciones

<a id="caso-v07m"></a>

- **Ruta:** `/notificaciones` (móvil)
- **Se escribe y se pulsa:** Abrir.
- **Esperado:** Sin desborde horizontal.
- **Visto:** Sin desborde horizontal (0 px).
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada

![movil notificaciones](img/191-movil-notificaciones.png)

### V08m. Móvil: /mis-links

<a id="caso-v08m"></a>

- **Ruta:** `/mis-links` (móvil)
- **Se escribe y se pulsa:** Abrir.
- **Esperado:** Sin desborde horizontal.
- **Visto:** Sin desborde horizontal (0 px).
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada

![movil solo para mi](img/192-movil-solo-para-mi.png)

### V09m. Móvil: /buscar

<a id="caso-v09m"></a>

- **Ruta:** `/buscar` (móvil)
- **Se escribe y se pulsa:** Abrir.
- **Esperado:** Sin desborde horizontal.
- **Visto:** Sin desborde horizontal (0 px).
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada

![movil buscar](img/193-movil-buscar.png)

### V10m. Móvil: /descubrir

<a id="caso-v10m"></a>

- **Ruta:** `/descubrir` (móvil)
- **Se escribe y se pulsa:** Abrir.
- **Esperado:** Sin desborde horizontal.
- **Visto:** Sin desborde horizontal (0 px).
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada

![movil descubrir](img/194-movil-descubrir.png)

### V11m. Móvil: el informe de encaje en pantalla completa

<a id="caso-v11m"></a>

- **Ruta:** `/grupos/:id` · diálogo de encaje (móvil)
- **Se escribe y se pulsa:** «Analizar mi encaje».
- **Esperado:** El diálogo cabe en el ancho del móvil.
- **Visto:** El diálogo se adapta al ancho del móvil y se desplaza por dentro, sin desbordar de lado.
- **Resultado:** OK
- **Prueba automatizada:** e2e: `critical-path.spec.ts` paso 7 (`mobile`)

![movil encaje dialogo](img/195-movil-encaje-dialogo.png)

### V12m. Móvil: comentarios en pantalla completa

<a id="caso-v12m"></a>

- **Ruta:** `/grupos/:id` · «Comentarios» (móvil)
- **Se escribe y se pulsa:** «Comentar».
- **Esperado:** El hilo usa la pantalla completa.
- **Visto:** El hilo de comentarios usa la pantalla completa.
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/links/comments.dialog.spec.ts`

![movil comentarios](img/196-movil-comentarios.png)

## 20. Inglés y modo oscuro

### W01. Interfaz en inglés (build `--localize=en`): sin sesión

<a id="caso-w01"></a>

- **Ruta:** `http://localhost:4301/en/…`
- **Se escribe y se pulsa:** Abrir `login`, `register` y `privacidad` en el build en inglés.
- **Esperado:** Textos en inglés (catálogo `messages.en.xlf`).
- **Visto:** El build en inglés se sirve aparte (puerto 4301, ver «Entorno»); las rutas siguen en español.
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada de la interfaz en inglés; `web:i18n-check` comprueba el catálogo

![en login](img/197-en-login.png)
![en register](img/198-en-register.png)
![en privacy](img/199-en-privacy.png)

### W02. Inglés: grupos

<a id="caso-w02"></a>

- **Ruta:** `/en/grupos`
- **Se escribe y se pulsa:** Abrir con sesión.
- **Esperado:** Pantalla en inglés.
- **Visto:** La pantalla se ve traducida al inglés.
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada (`web:i18n-check` para el catálogo)

![en groups](img/200-en-groups.png)

### W03. Inglés: detalle del grupo

<a id="caso-w03"></a>

- **Ruta:** `/en/grupos/:id`
- **Se escribe y se pulsa:** Abrir con sesión.
- **Esperado:** Pantalla en inglés.
- **Visto:** La pantalla se ve traducida al inglés.
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada (`web:i18n-check` para el catálogo)

![en group detail](img/201-en-group-detail.png)

### W04. Inglés: postulaciones

<a id="caso-w04"></a>

- **Ruta:** `/en/postulaciones`
- **Se escribe y se pulsa:** Abrir con sesión.
- **Esperado:** Pantalla en inglés.
- **Visto:** La pantalla se ve traducida al inglés.
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada (`web:i18n-check` para el catálogo)

![en applications board](img/202-en-applications-board.png)

### W05. Inglés: mi-cv

<a id="caso-w05"></a>

- **Ruta:** `/en/mi-cv`
- **Se escribe y se pulsa:** Abrir con sesión.
- **Esperado:** Pantalla en inglés.
- **Visto:** La pantalla se ve traducida al inglés.
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada (`web:i18n-check` para el catálogo)

![en my cv](img/203-en-my-cv.png)

### W06. Inglés: perfil

<a id="caso-w06"></a>

- **Ruta:** `/en/perfil`
- **Se escribe y se pulsa:** Abrir con sesión.
- **Esperado:** Pantalla en inglés.
- **Visto:** La pantalla se ve traducida al inglés.
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada (`web:i18n-check` para el catálogo)

![en profile](img/204-en-profile.png)

### W07. Inglés: notificaciones

<a id="caso-w07"></a>

- **Ruta:** `/en/notificaciones`
- **Se escribe y se pulsa:** Abrir con sesión.
- **Esperado:** Pantalla en inglés.
- **Visto:** La pantalla se ve traducida al inglés.
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada (`web:i18n-check` para el catálogo)

![en notifications](img/205-en-notifications.png)

### W08. Inglés: mis-links

<a id="caso-w08"></a>

- **Ruta:** `/en/mis-links`
- **Se escribe y se pulsa:** Abrir con sesión.
- **Esperado:** Pantalla en inglés.
- **Visto:** La pantalla se ve traducida al inglés.
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada (`web:i18n-check` para el catálogo)

![en my links](img/206-en-my-links.png)

### W09. Inglés: informe de encaje

<a id="caso-w09"></a>

- **Ruta:** `/en/grupos/:id` · diálogo de encaje
- **Se escribe y se pulsa:** «Analizar mi encaje».
- **Esperado:** Diálogo e informe en inglés.
- **Visto:** El diálogo y el informe en inglés (los textos de las sugerencias vienen del fixture, en español).
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada (`web:i18n-check` para el catálogo)

![en match dialog](img/207-en-match-dialog.png)

### W10. Modo oscuro: la aplicación no lo soporta

<a id="caso-w10"></a>

- **Ruta:** `/grupos`, `/perfil` con `prefers-color-scheme: dark`
- **Se escribe y se pulsa:** Abrir con el navegador en modo oscuro.
- **Esperado:** La aplicación no tiene tema oscuro: se ve igual que en claro.
- **Visto:** Con `prefers-color-scheme: dark` la interfaz sigue clara: `styles.scss` fija `color-scheme: light` y no hay tema oscuro.
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada

![modo oscuro grupos](img/208-modo-oscuro-grupos.png)
![modo oscuro perfil](img/209-modo-oscuro-perfil.png)

## 21. Borrar la cuenta

### Z01. Diego se registra y crea un grupo con Beto dentro

<a id="caso-z01"></a>

- **Ruta:** `/registro`, `/grupos`
- **Se escribe y se pulsa:** Diego se registra, crea `Grupo de Diego (guía)` y Beto se une con el código.
- **Esperado:** Preparación del caso siguiente.
- **Visto:** Preparación: Diego es el único propietario de un grupo con otro miembro.
- **Resultado:** OK
- **Prueba automatizada:** sin prueba automatizada

### Z02. No se puede borrar la cuenta siendo el único propietario de un grupo con más miembros

<a id="caso-z02"></a>

- **Ruta:** `/perfil` · «Borrar mi cuenta»
- **Se escribe y se pulsa:** «Borrar cuenta» vacío; contraseña equivocada; contraseña correcta siendo el único propietario de un grupo con más miembros.
- **Esperado:** «Introduce tu contraseña»; error; «Eres el único propietario de un grupo con otros miembros…».
- **Visto:** Contraseña vacía: «Introduce tu contraseña»; contraseña mala: error; con la correcta, «Eres el único propietario de un grupo con otros miembros…».
- **Resultado:** OK
- **Prueba automatizada:** unit: `features/profile/profile.page.spec.ts`

![borrar cuenta vacio](img/210-borrar-cuenta-vacio.png)
![borrar cuenta validacion](img/211-borrar-cuenta-validacion.png)
![borrar cuenta clave incorrecta](img/212-borrar-cuenta-clave-incorrecta.png)
![borrar cuenta unico propietario](img/213-borrar-cuenta-unico-propietario.png)

### Z03. Ceder el grupo y borrar la cuenta

<a id="caso-z03"></a>

- **Ruta:** `/perfil` → `/login`
- **Se escribe y se pulsa:** Diego nombra propietario a Beto; «Borrar mi cuenta» → «Contraseña actual» → «Borrar cuenta»; intentar entrar.
- **Esperado:** Vuelve a `/login` y la cuenta ya no entra.
- **Visto:** `DELETE /api/users/me` → 2xx; vuelve a `/login` y la cuenta ya no entra («Email o contraseña incorrectos»).
- **Resultado:** OK
- **Prueba automatizada:** e2e: `deploy-prod.spec.ts`

![borrar cuenta relleno](img/214-borrar-cuenta-relleno.png)
![cuenta borrada ya no entra](img/215-cuenta-borrada-ya-no-entra.png)

## Lo que no tiene pantalla o no se pudo probar en esta pila

Con la forma B del entorno (todo encendido) se prueban a mano los casos con ✔; con la pila aislada no.

| Catálogo                                                  | Qué falta                                                       | Por qué                                                                                                                                                                                           | Cómo probarlo a mano                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 13. Lectura automática de ofertas reales                  | Ver una oferta leída de verdad                                  | Solo se usan dominios `.invalid`; se ve el caso «No pudimos leer esta oferta».                                                                                                                    | ✔ B: guardar una oferta de getonbrd.com (con red saliente).                   |
| 33. Plan de estudio con contenido                         | `/plan/:analysisId` con ítems por semanas y «Exportar Markdown» | En `replay`, el único encaje con fixture (`critical-path`) no tiene habilidades que falten, así que no se ofrece «Ver plan de estudio». Se prueba la pantalla de un análisis inexistente (`M05`). | ✔ B (`synth`): informe con «Habilidades que faltan» → «Ver plan de estudio».  |
| 35. Buscar con resultados; 36. Salario leído del texto    | Resultados, filtros y el CLI                                    | `FEATURE_SEARCH=false` y sin Meilisearch.                                                                                                                                                         | ✔ B: perfil `demo` y `FEATURE_SEARCH=true`.                                   |
| 37. Descubrir con resultados                              | Tarjetas de resultado y «Guardar en» con confirmación           | `FEATURE_DISCOVERY=false`.                                                                                                                                                                        | ✔ B: `FEATURE_DISCOVERY=true`, `DISCOVERY_CHAIN=mock` (dos resultados fijos). |
| 22/23. Frescura automática                                | El worker cerrando ofertas vencidas y caducando postulaciones   | `FEATURE_LINK_FRESHNESS=false`; el caso `P04` siembra el cierre en Mongo.                                                                                                                         | ✔ B: `FEATURE_LINK_FRESHNESS=true` y esperar la pasada horaria.               |
| 40. Push del navegador                                    | «Push activado» y la notificación del sistema                   | Sin claves VAPID; además Chromium sin interfaz deniega el permiso (caso `T03`).                                                                                                                   | ✔ B: claves VAPID y un navegador con interfaz.                                |
| 41. Resumen semanal                                       | El correo «Resumen semanal · {grupo}»                           | `FEATURE_GROUP_DIGEST=false` y depende del cron (procesa la semana ISO anterior).                                                                                                                 | ✔ B: `FEATURE_GROUP_DIGEST=true` y `GROUP_DIGEST_CRON`.                       |
| 34. Claves propias (BYOK) guardadas                       | «Configurada · hint …xxxx», «Rotar clave», «Revocar»            | Sin `AI_VAULT_KEY` el guardado responde 503 (caso `B03`).                                                                                                                                         | ✔ B: con `AI_VAULT_KEY`.                                                      |
| Análisis con IA externa real                              | Un proveedor externo de verdad                                  | La pila usa solo el mock; el permiso cambia textos y enrutado (`B01`).                                                                                                                            | Fuera de local (necesita una clave real).                                     |
| 42 y 43. Extensión del navegador                          | Popup de Chromium y Firefox                                     | No forma parte de la pila de la suite.                                                                                                                                                            | ✔ B: `pnpm nx build extension` y cargarla (catálogo, pasos 42 y 43).          |
| 45. Salud y métricas; 46. Reencolar lecturas; 36. Salario | `/health`, `/metrics` y los CLI                                 | Sin pantalla.                                                                                                                                                                                     | `curl http://localhost:3100/health` y `/metrics`; CLI del catálogo.           |
| 39. Avisos por email (todos)                              | Estancada y resumen                                             | Solo se vieron «Nuevo link en tu grupo» y «Actualización de postulación en el grupo» (caso `T04`).                                                                                                | ✔ B con la demo (cuenta con email verificado).                                |

## Pruebas automatizadas

Ejecutadas el 2026-11-25 sobre el commit `bdb106efa262836a2902dc7f8016aeae0213291f`.

**Lote 1 de la suite e2e (el único admitido y reproducible).** `pnpm nx run web-e2e:e2e-stack` (monta su pila aislada, ejecuta y la apaga):

| Spec                    | Proyecto                | Resultado |
| ----------------------- | ----------------------- | --------- |
| `critical-path.spec.ts` | `chromium` (escritorio) | pasa      |
| `critical-path.spec.ts` | `mobile` (Pixel 7)      | pasa      |

Corrida completa: 2 tests pasados en 52,2 s. Cubre registro, grupo, invitación, guardar y completar una oferta, «Postulé», subir el CV y el encaje con el informe del fixture de replay.

**Pruebas unitarias de `web`** (`pnpm nx run web:test`, Vitest):

`pnpm nx run web:test` el 2026-11-25: **89 ficheros y 1101 tests, todos pasan.** Cubren cada página, diálogo y estado que nombra la columna «Prueba automatizada» (prefijo `unit:`).

**El resto de specs de `apps/web-e2e/src/`** (`applications`, `auth`, `auth-email-recovery`, `byok`, `comments`, `cv`, `deploy-prod`, `freshness`, `groups`, `home`, `links`, `match`, `notifications`, `public-share`, `search`, `share-notice-time`) **no se volvieron a ejecutar** en esta pasada: según `apps/web-e2e/README.md` solo lo etiquetado `@lot1` cuenta como verificado, y el resto sigue por el camino antiguo (pila de otra sesión, puertos fijos). La columna «Prueba automatizada» de cada caso los nombra como referencia; su último resultado conocido está en la guía de septiembre (`git show 0f307c6e:docs/guia-de-uso/README.md`).

## Hallazgos

Lo que no funciona como dice la spec o el catálogo, o se vio mal. **No se corrigió nada** (`apps/**` y `libs/**` requieren un change de OpenSpec).

**Producto e interfaz**

- **H1. «Analizar mi encaje» sin CV no dice que falta el CV.** Caso [M01](#caso-m01). Ruta: `/grupos/:id` → «Analizar mi encaje» con una cuenta sin CV (Beto). El diálogo abre con «Ningún CV marcado» y el botón «Analizar» activo; al pulsarlo, la API responde `409 {"code":"no_cv","message":"Upload a CV before analysing a job"}` y el diálogo dice «No pudimos analizar ahora.» con «Reintentar». El catálogo (paso 31) promete «Necesitas un CV guardado…» y el diálogo tiene ese estado (`match-no-cv`, con «Subir CV»), pero no se llega a él. Evidencia: `encaje-sin-cv` y `encaje-sin-cv-analizar`.
- **H2. Tras verificar el email, el aviso de la barra puede seguir hasta recargar (intermitente).** Caso [V03](#caso-v03). Ruta: con sesión abierta, abrir en la misma pestaña el enlace `/verificar-email?token=…` → «Email verificado» → «Ir a la aplicación». En 2 de las 6 corridas completas de esta pasada, `/grupos` siguió mostrando «Tu email aún no está verificado…» hasta recargar; en las otras 4 desapareció. Causa probable (sin tocar código): `VerifyEmailPage` solo vuelve a pedir el perfil si ya hay sesión **cuando termina la verificación**; con una recarga completa, la restauración de la sesión y la verificación corren en paralelo y el perfil guardado puede ser anterior. La corrida final salió bien, así que no hay captura del estado malo; el script la toma sola (`grupos-aviso-persiste-tras-verificar`) si ocurre.
- **H3. Cambiar la contraseña: los mensajes de error se superponen y uno queda viejo.** Caso [F03](#caso-f03), captura `perfil-contrasena-nueva-corta`. Tras un intento con la contraseña actual equivocada («La contraseña actual no es correcta») y otro con la nueva demasiado corta, la pantalla muestra a la vez el aviso viejo y el nuevo, con los textos montados uno sobre otro.
- **H4. Pegar un texto que no es una oferta da un error genérico (solo en `replay`).** Caso [K06](#caso-k06). Con `AI_MOCK_MODE=replay` un texto sin fixture lanza `FixtureMissing` y el diálogo dice «Algo salió mal. Inténtalo de nuevo» en vez de «Eso no parece una oferta de trabajo…» (que sí existe en el código). Es una limitación del mock, no del producto: con `synth` o con IA real, el mensaje depende de la respuesta. Se deja anotado porque el mensaje correcto no se puede ver con esta pila.
- **H5. Guardar una clave de IA sin bóveda da un error genérico.** Caso [B03](#caso-b03). Con `AI_VAULT_KEY` vacía la API responde 503 y el perfil dice «Algo salió mal. Inténtalo de nuevo» en vez de decir que las claves propias no están disponibles. Ya era el H3 de septiembre; el change `usage-guide-fixes` lo difirió (en producción `AI_VAULT_KEY` es obligatoria).
- **H6. No hay modo oscuro.** Caso [W10](#caso-w10). Con `prefers-color-scheme: dark` la interfaz sigue clara (`color-scheme: light` fijo en `apps/web/src/styles.scss`, tema Material solo claro). Ninguna spec lo promete; se anota para quien espere el modo oscuro.
- **H7. Los campos de fecha salen como `mm/dd/yyyy`.** Caso [K05](#caso-k05), captura `corregir-oferta-relleno`: «Publicada el» y «Cierra el» muestran el orden de mes y día estadounidense en una interfaz en español. Visto en Chromium sin interfaz con `locale es-ES`; puede depender del sistema. Era el H7 de septiembre, diferido por `usage-guide-fixes`.
- **H8. La interfaz en inglés no se puede levantar con los targets del proyecto.** `apps/web/project.json` define el locale `en` pero no hay target que lo construya ni lo sirva (ADR-050 lo deja pendiente; el catálogo ya lo anota). Para esta guía se construyó con `--localize=en` y se sirvió con `tools/guia-de-uso/serve-en.mts`. Las rutas siguen en español en el build en inglés.

**Corregido desde septiembre** (comprobado en esta pasada): el nombre de quien escribió una oferta ya no llega a quien la guarda desde el enlace público (`E03`: «Escrito por otra persona»), el texto de ayuda de «Grupo para avisos de estado» ya no se monta sobre «Preferencias guardadas» (`T01`), el aviso «Compartido · Deshacer» se cierra al navegar (`A05`) y el campo de URL ya no queda en rojo tras guardar (`K01`).

**No se pudo probar en esta pila** (ver [la tabla](#lo-que-no-tiene-pantalla-o-no-se-pudo-probar-en-esta-pila)): plan de estudio con contenido, Buscar y Descubrir con resultados, frescura automática, resumen semanal, push real, claves propias guardadas, IA externa real, extensión y CLI.

**Pruebas**

- **H9.** Los specs del camino antiguo (`home.spec.ts`, `groups.spec.ts`) llevaban `http://localhost:4200` escrito a mano en septiembre y fallaban contra la pila del bloque; esta pasada no los volvió a ejecutar (ver [Pruebas automatizadas](#pruebas-automatizadas)).
- **H10.** Con `AI_MOCK_MODE=replay`, `critique-suggestions` no tiene fixture para el informe del camino crítico: el worker registra «critique-suggestions failed (FixtureMissing); keeping generator report» y el informe queda con las sugerencias del generador; no se nota en la pantalla (ya anotado en septiembre).

## Qué cambió respecto de la guía de septiembre

La guía de septiembre (2026-09-28, sobre `0f307c6e`) tenía 30 pasos y 100 capturas, todas de escritorio salvo cuatro del móvil, y probaba solo el camino feliz. Desde entonces cambiaron 25 ficheros de `apps/web/src` y se archivaron changes nuevos (`object-store`, `ai-usage-consent-reason`, `usage-guide-fixes`, `angular-22-2`…). Ahora:

- **Se rehízo todo con capturas nuevas** (las 100 anteriores se borraron; ninguna imagen queda sin referenciar).
- **Se agregaron los estados que faltaban:** validaciones de login, registro, recuperación y restablecimiento; enlaces inválidos y usados; rutas inexistentes; error de URL y de nota larga; archivos de CV rechazados, CV sin texto y CV por defecto inservible; ofertas ya existentes; pegar y deshacer, «Volver a lo anterior», quitar oferta y nota; tablero vacío, fecha futura, cierre de postulaciones y dejar de seguir; comentarios largos y borrar lo ajeno; volver a compartir un enlace público; lista privada con oferta ya en un grupo, oferta cerrada y «Reabrir», importar un chat; Buscar y Descubrir con consulta vacía; grupo de avisos de estado; código de invitación regenerado, expulsar con código viejo, ceder la propiedad, salir, borrar y grupo inexistente; borrar la cuenta con validaciones y con «único propietario».
- **Se agregaron tandas completas:** móvil (Pixel 7) en 12 pantallas, inglés en 9, y la comprobación del modo oscuro.
- **Se agregó** la lista de comprobación, el entorno paso a paso (pila aislada y forma de desarrollo del README) y el script de capturas reproducible (`tools/guia-de-uso/`).
- **Se quitó** el paso 15 «Plan de estudio» como sin captura: sigue sin ser alcanzable con `replay`, y ahora está en «Lo que no se pudo probar», con la pantalla del análisis inexistente (`M05`).
- **Se cerraron** los hallazgos H1, H2, H4, H5 y H6 de septiembre (los corrigió `usage-guide-fixes`); siguen H3 (ahora H5) y H7 (ahora H7), y hay hallazgos nuevos (H1, H2, H3, H6 de esta guía).
