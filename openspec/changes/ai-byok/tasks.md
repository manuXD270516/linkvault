## 1. Vault y persistencia

- [ ] 1.1 [ai] Puerto `SecretVault` + `LibsodiumSecretVault` con `AI_VAULT_KEY`; tests unitarios encrypt/decrypt round-trip y fallo con clave corta.
- [ ] 1.2 [backend] Colección `user_ai_keys`, repositorio Mongo (índice único userId+vendor), casos de uso upsert/list/delete; cascada en borrado de cuenta (o hook documentado si el borrado aún no existe).
- [ ] 1.3 [backend] Controller `GET/PUT/DELETE /api/users/me/ai-keys[/:vendor]`; schemas zod en shared; nunca devolver plaintext.

## 2. Proveedores y routing

- [ ] 2.1 [ai] `AnthropicProvider` y `OpenAIProvider` (capabilities external, jsonMode); tests con HTTP double.
- [ ] 2.2 [ai] Factory BYOK: descifra claves del userId, construye `byok:<userId>:<vendor>` con modelos de env; OpenRouter BYOK reusa provider con apiKey inyectada.
- [ ] 2.3 [ai] `RunTaskUseCase` / registry concatena BYOK delante de la cadena de plataforma; spec de routing «BYOK de otra persona no entra».
- [ ] 2.4 [ai] Cuota: contar solo success no-`byok:`; permitir ejecución si hay BYOK elegible con cuota de plataforma agotada; tests en `ConfigQuotaPolicy` / `runTask`.

## 3. Config, logs y docs

- [ ] 3.1 [infra] `.env.example` + parse config: `AI_VAULT_KEY`, `BYOK_*_MODEL`, timeouts; redactor pino para apiKey/authorization.
- [ ] 3.2 [infra] RUNBOOK: operar BYOK, rotación de vault key (revocar y volver a pegar), privacidad.

## 4. Frontend

- [ ] 4.1 [frontend] API client + store de ai-keys; sección en `/perfil` (guardar/rotar/revocar, hints); i18n ES/EN.
- [ ] 4.2 [frontend] Tests de componente; e2e mínimo en perfil o extensión de smoke de auth/perfil.

## 5. Verificación

- [ ] 5.1 [ai] `pnpm nx affected -t lint,typecheck,test` con `AI_CHAIN=mock AI_MOCK_MODE=replay`.
- [ ] 5.2 [ai] ADR-032 (o siguiente libre) si el debate fija D3–D7; marcar tasks al cerrar.
