## 1. Base de tests y contratos de dominio

- [x] 1.1 [infra] Hacer que `libs/ai/vitest.config.mts` extienda `@linkvault/testing/preset` y añada `unplugin-swc` como el worker (D14); verificar con una sonda de inyección por constructor en `libs/ai` y con una transacción contra el Mongo en memoria, y que `pnpm nx test ai` sigue pasando.
- [x] 1.2 [ai] Crear `domain/run-context.ts` y `domain/ai-result.ts` según D2, y añadir `trace?` a `CompletionRequest`; verificar con `pnpm nx typecheck ai` y un test de tipos que un `degraded` sin `output` compila y un `RunContext` sin `aiConsent` no.
- [x] 1.3 [ai] Ampliar `AiTask` con `dataSensitivity?`, `degrade?` y `sample?`, añadir `SynthUnsupported` e `InvalidDegradeOutput` a `domain/errors.ts`, y crear los puertos `prompt-registry`, `usage-ledger`, `result-cache`, `quota-policy`, `circuit-breaker`, `clock` y `ai-logger` (D1, D2); verificar que `pnpm nx typecheck ai` y `pnpm nx lint ai` pasan.
- [x] 1.4 [ai] Implementar `domain/routing-policy.ts` puro con `satisfies`, consentimiento solo para tareas `personal`, exclusión de circuitos abiertos y orden de ADR-018 §8; verificar con tests de "Capacidad insuficiente", "Sin consentimiento en una tarea personal", "Tarea pública sin consentimiento", "Proveedor gratuito antes que uno de pago" y "Local antes que remoto a igual coste".
- [x] 1.5 [infra] Ampliar el bloque de lint de dominio con patrones anclados por segmento hacia `application`, `infrastructure`, `presentation`, `tasks` y `ai.module` (D1), y añadir al test tabular de `tools/workspace-rules` una fila positiva (`../application/x` falla) y una negativa (`./application.entity` pasa); verificar que la positiva falla si se quita el patrón y que `pnpm nx run-many -t lint` pasa.

## 2. Utilidades de aplicación

- [x] 2.1 [ai] Implementar `application/canonical-json.ts` y `application/execution-key.ts` según D4; verificar con tests de reordenación anidada, `undefined` omitido, `-0`, orden de arrays conservado y el escenario "Vector de referencia" con un valor fijo.
- [x] 2.2 [ai] Implementar `application/json-extraction.ts` (D3); verificar con tests para JSON limpio, JSON en bloque de código con texto alrededor, llaves dentro de strings con escapes y texto sin JSON.
- [x] 2.3 [ai] Implementar `application/task-registry.ts` con rechazo de duplicados y de `maxAttempts` fuera de {1, 2}; verificar con tests de registro, búsqueda, duplicado y "Presupuesto de intentos inválido".

## 3. Redacción de datos personales

- [x] 3.1 [ai] Implementar en `application/pii-redactor.ts` los detectores de email y URL con marcadores estables (D11); verificar con tests de "Valor repetido" y de URLs con y sin esquema.
- [x] 3.2 [ai] Añadir el detector de móvil boliviano y de números con prefijo `+`; verificar con una tabla de positivos (`+591 71234567`, `71234567`, `+54 9 11 1234-5678`) y negativos.
- [x] 3.3 [ai] Añadir el detector de números locales LatAm con separadores y las exclusiones de fechas, años, rangos de años, rangos mes.año y montos (D11); verificar con "Números que no son teléfonos" y una tabla de positivos (`11 1234-5678`, `55 1234 5678`, `9 1234 5678`) y negativos (`2019 – 2023`, `03.2020 - 06.2022`).
- [x] 3.4 [ai] Añadir la redacción opcional del nombre y la reinyección recursiva en la salida; verificar con "Redacción de nombre activada", "Marcador en la salida" y que el mapa no queda accesible tras la ejecución.

## 4. Prompts y tarea de ejemplo

- [x] 4.1 [ai] Instalar `mustache` y `yaml` en `dependencies` y `@types/mustache` en `devDependencies`, e implementar `infrastructure/prompt-registry/file-prompt-registry.ts` con front-matter `task`/`version`, secciones `# system`/`# user`, normalización CRLF y Mustache con `escape` por llamada (D7); verificar con "Prompt renderizado con el input", "Versión de prompt inexistente", front-matter que no coincide y un archivo con CRLF.
- [x] 4.2 [ai] Crear `tasks/classify-skills.task.ts` con schemas, `dataSensitivity: 'personal'` y `sample` según D13, y `infrastructure/prompts/classify-skills.v1.md` usando `outputLanguage`; verificar con tests de los schemas, que el prompt real carga y "Idioma por defecto", y que `sample` es determinista y nunca inventa términos ausentes.

## 5. Pipeline y caso de uso

- [x] 5.1 [ai] Implementar `application/structured-output.pipeline.ts` con reparación única en `user` compuesto (D3); verificar con proveedores falsos "JSON dentro de un bloque de código", "JSON inválido en el primer intento" y que con `maxAttempts: 1` no hay reparación.
- [x] 5.2 [ai] Implementar el camino principal de `application/run-task.usecase.ts`: validación, clave con `outputLanguage`, `trace`, cadena de `RoutingPolicy`, render, temperatura y formato JSON (D2, D4); verificar con puertos en memoria "Ejecución correcta de una tarea declarada", "Input inválido" y "Proveedor con modo JSON".
- [x] 5.3 [ai] Añadir fallback ante error y `schema_error`, degradación tipada con `no_providers`/`providers_failed` y `degrade()` validado; verificar con "JSON inválido también tras la reparación", "Cadena agotada sin función de degradación", "Cadena agotada con función de degradación", "Función de degradación con salida inválida" y "Ningún proveedor elegible".
- [x] 5.4 [ai] Asegurar que `FixtureMissing`, el input inválido y `InvalidDegradeOutput` se propagan sin convertirse en `degraded` (D2); verificar con un test por error.
- [x] 5.5 [ai] Integrar la caché (lectura antes de la cadena, escritura solo en `success`, caché nula con `mock` en la cadena, fallo de caché como ausencia); verificar con puertos en memoria "Segunda ejecución idéntica", "Nueva versión de prompt", "Mismo input en otro idioma", "Cadena con mock" y "Almacén de caché caído".
- [x] 5.6 [ai] Integrar la redacción y reinyección solo para tareas `personal` con proveedores `external`; verificar con "Proveedor externo", "Proveedor local" y "Tarea pública hacia proveedor externo".
- [x] 5.7 [ai] Integrar el ledger no bloqueante: un registro por intento, un `degraded` por degradación con proveedor nulo, nada en cache hit, coste estimado y `void` con captura hacia `AiLogger` (D9); verificar con un ledger en memoria "Ejecución exitosa", "Fallo seguido de éxito", "Resultado degradado" y "Proveedor gratuito", y con un ledger que nunca resuelve que `runTask` no espera.
- [x] 5.8 [ai] Integrar la cuota previa a la cadena con un único registro `quota` y apertura ante error (D9); verificar con una política en memoria "Límite alcanzado", "Ejecución sin usuario" y una política que lanza error.

## 6. Resiliencia

- [x] 6.1 [ai] Implementar `infrastructure/resilience/in-memory-circuit-breaker.ts` con `openIds`, `tryAcquire`, `recordSuccess` y `recordFailure` y `Clock` inyectable (D10); verificar con "Apertura tras fallos repetidos", "Recuperación en half-open", fallo en half-open que reabre y "Permiso de prueba no usado".
- [x] 6.2 [ai] Conectar el breaker a `runTask` (`openIds` a la política, `tryAcquire` antes de completar, `schema_error` como disponibilidad); verificar con un test de integración con proveedores falsos que un proveedor con 5 errores queda fuera de la siguiente ejecución.
- [x] 6.3 [ai] Implementar la carrera de `complete()` contra la señal combinada del timeout del proveedor y `ctx.signal` filtrando ausentes, pasándola en `req.signal` (D10); verificar con timeouts de decenas de ms y temporizadores reales "Proveedor que no responde", una ejecución sin `ctx.signal`, que `req.signal` llega abortado al proveedor, y "Cancelación del llamador" sin `provider_error` ni fallo en el breaker.

## 7. Mock determinista

- [x] 7.1 [ai] Implementar `infrastructure/providers/mock-deterministic.provider.ts` en modo replay con `AI_FIXTURES_DIR` y la clave de `trace` (D5); verificar con "Fixture existente", "Fixture ausente en CI", "Mismo input con claves en otro orden" y "Cambio en el texto de la plantilla".
- [x] 7.2 [ai] Añadir el modo synth con `TaskRegistry`, `task.sample` y PRNG mulberry32 sembrado con la clave, prefiriendo fixture si existe (D5); verificar de punta a punta con `runTask` "Mismo input dos veces en modo synth", "Salida sintetizada válida y creíble" y "Tarea sin muestra".
- [x] 7.3 [ai] Escribir a mano los fixtures de replay de `classify-skills` para los inputs de test con `"source": "handwritten"` (D13); verificar que `pnpm nx test ai` pasa con `AI_MOCK_MODE=replay` y sin red.

## 8. Proveedores reales

- [x] 8.1 [ai] Implementar `infrastructure/providers/ollama.provider.ts` con `num_ctx`, `num_predict`, uso de tokens, latencia y `healthy()` (D6); verificar contra un servidor `node:http` local "Completado contra Ollama" (incluido `num_ctx` en el cuerpo) y "Ollama no disponible".
- [x] 8.2 [ai] Implementar `infrastructure/providers/openrouter.provider.ts` con URL base configurable, `response_format`, `data_collection: "deny"` y errores sin cuerpo ni credencial (D6); verificar contra un servidor `node:http` local "Completado contra OpenRouter" y "Error de la API".
- [x] 8.3 [ai] Implementar `infrastructure/providers/provider-registry.ts` que construye los proveedores de una configuración ya validada, incluida la cadena vacía de `none`; verificar con tests de construcción por cada combinación de `AI_CHAIN` y "Sin IA configurada" ejecutando `runTask`.

## 9. Persistencia

- [x] 9.1 [infra] Ampliar el doble RESP de `tools/testing` con `GET`, `SET` (`EX`/`PX`) y `DEL` sobre un mapa con expiración; verificar con tests de ioredis para set/get, expiración y borrado sin romper los tests de salud.
- [x] 9.2 [ai] Implementar `infrastructure/persistence/redis-result-cache.ts` y su cliente con el patrón del cliente de salud (D8); verificar contra el doble RESP "Caché compartida entre procesos", expiración, y que con el doble en `stop` una lectura y una escritura no lanzan.
- [x] 9.3 [ai] Implementar `infrastructure/persistence/mongo-usage-ledger.ts` con el schema de D9, `bufferCommands: false` e índice; verificar con `MongoMemoryReplSet` la escritura de cada `outcome` con sus campos nulos y a 0, y "Input con datos personales".
- [x] 9.4 [ai] Implementar `infrastructure/quota/config-quota-policy.ts` con `countDocuments` en 24 h, `maxTimeMS` y carrera contra un temporizador de 300 ms (D9); verificar contra Mongo en memoria "Límite alcanzado" y una tarea sin límite, "Conteo no disponible" con un conteo que lanza error, y con un conteo que nunca resuelve que `allows` devuelve `true` en menos de 1 s.
- [x] 9.5 [ai] Verificar "Ledger no disponible": un test de `runTask` con proveedor falso de latencia 0 y el ledger de Mongo sobre una conexión sin servidor que comprueba que el resultado llega en menos de 1 s.

## 10. Configuración y módulo

- [x] 10.1 [ai] Implementar `infrastructure/config/ai-config.schema.ts` y `parse-ai-config.ts` con problemas `{ variable, problem, detail? }` (D12); verificar con tests de "Proveedor desconocido", "Proveedor externo sin credencial", "Mock en producción", "Arranque en producción con el mock en la cadena", "Producción sin mock con AI_MOCK_MODE heredado", "Modo no soportado", "Modelo de pago configurado", URL base no https y `AI_QUOTAS` mal formado, comprobando que ningún mensaje contiene la credencial.
- [ ] 10.2 [backend] Aceptar `none` en `AI_CHAIN` y dejar de exigir `AI_MOCK_MODE` en los schemas de configuración de api y worker, componer `parseAiConfig` en el del worker antes de crear Nest y añadir `detail?` a `env-parser` del worker; verificar con los tests de configuración del worker (proveedor desconocido nombra `AI_CHAIN` y el identificador) y de api (`none` válido).
- [x] 10.3 [ai] Implementar `infrastructure/logging/nest-ai-logger.ts` y un `AiLogger` en memoria para tests (D12); verificar con un test que el logger en memoria captura `debug` y `warn`.
- [x] 10.4 [ai] Implementar `ai.module.ts` (`AiModule.forRootAsync`) que registra tareas, prompts, proveedores, caché o caché nula, ledger, cuota, breaker y exporta `RUN_TASK` (D12); verificar con un test que compila el módulo con una configuración `mock`/`replay` y resuelve `RUN_TASK`.
- [x] 10.5 [ai] Test de integración de `AiModule` con Mongo en memoria y el doble RESP que espera `connection.asPromise()`, ejecuta `classify-skills` en replay y comprueba con `vi.waitFor` el registro `success` en `ai_usage`; verificar que pasa de forma estable en 5 ejecuciones seguidas.
- [ ] 10.6 [backend] Importar `AiModule` en `apps/worker` y añadir `*.headers.authorization` y `*.headers.Authorization` a la redacción del logger; verificar con el test de arranque del worker sin dependencias y un test de log que no contiene la cabecera.
- [x] 10.7 [infra] Copiar `libs/ai/src/infrastructure/prompts/**` como assets del build de `worker` y añadir un paso de CI tras `build` que comprueba `dist/apps/worker/assets/ai/prompts/classify-skills.v1.md` (D7); verificar con `pnpm nx build worker` y la comprobación local del paso.
- [ ] 10.8 [infra] Actualizar `.env.example` con las variables de D6–D9 y valores seguros (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL` y `AI_QUOTAS` vacías, `openrouter` fuera de `AI_CHAIN`) y `AI_MOCK_MODE=synth`; verificar que los tests de configuración de api y worker pasan con el `.env.example` actualizado.

## 11. Protección de datos de punta a punta

- [x] 11.1 [ai] Test de integración de `runTask` con `classify-skills` contra el servidor local que imita OpenRouter: el cuerpo recibido contiene `[EMAIL_1]` y `[PHONE_1]` y no los valores, y la salida devuelta tiene el email reinyectado; verificar que pasa y falla si se desactiva la redacción.
- [x] 11.2 [ai] Test de "Log de una petición a OpenRouter" con el `AiLogger` en memoria en `debug` y una respuesta de error que repite el prompt: ningún log ni mensaje de error contiene la credencial, el prompt ni el cuerpo; verificar que pasa.
- [x] 11.3 [ai] Test de "Entrada de caché": tras un `success` con proveedor real falso, la entrada en el doble RESP solo contiene `output`, `providerId`, `model` y `promptVersion`; verificar que pasa.

## 12. Cierre

- [ ] 12.1 [infra] Ejecutar `pnpm nx affected -t lint,typecheck,test,build --base=main` y `pnpm exec openspec validate --all` con `AI_CHAIN=mock AI_MOCK_MODE=replay`; verificar que todo pasa en verde.
