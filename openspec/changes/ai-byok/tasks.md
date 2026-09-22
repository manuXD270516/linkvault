## 1. Vault y persistencia

- [ ] 1.1 [ai] Puerto `SecretVault` + `LibsodiumSecretVault` con `AI_VAULT_KEY` (obligatoria en prod); tests round-trip y fallo con clave corta.
- [ ] 1.2 [ai] Colección `user_ai_keys` + repo Mongo en `libs/ai` (índice único userId+vendor); `deleteAllKeysForUser(userId, session)` para la misma txn del borrado de cuenta; sin EventEmitter. Tests de repo.
- [ ] 1.3 [backend] Controller `GET/PUT/DELETE /api/users/me/ai-keys[/:vendor]`; zod min length 16; `503 vault_unavailable` sin vault en no-prod; nunca plaintext.

## 2. Proveedores y routing

- [ ] 2.1 [ai] `AnthropicProvider` y `OpenAIProvider` (external, jsonMode); tests con HTTP double.
- [ ] 2.2 [ai] `OpenRouterProvider` parametrizable (`id`, `dataCollection: deny|omit`); BYOK factory: modelos env; deny solo si modelo `:free`; tests plataforma always deny + BYOK free/pago.
- [ ] 2.3 [ai] `ByokProviderFactory` + `RunTask` concatenan BYOK; con cuota no-BYOK agotada cadena **solo** byok; elegibilidad previa incluye BYOK del userId; spec «otra persona no entra».
- [ ] 2.4 [ai] Cuota ledger: contar solo success no-`byok:`; `MATCH_ANALYSES_PER_USER` intacta; tests ConfigQuotaPolicy/runTask + match vigencia tras upsert clave (D11).

## 3. Config, logs y docs

- [ ] 3.1 [infra] `.env.example` + parse: `AI_VAULT_KEY` prod, `BYOK_*_MODEL`; redactor `apiKey`/`authorization`/`AI_VAULT_KEY`/`ciphertext`/`vaultKey` en api y worker.
- [ ] 3.2 [infra] RUNBOOK: operar BYOK, rotación vault, breaker por userId, privacidad.

## 4. Frontend

- [ ] 4.1 [frontend] API client + store; sección `/perfil` CRUD + **aviso de destino** (vendor; OpenRouter no-free) + **copy claves+consent off**; i18n ES/EN.
- [ ] 4.2 [frontend] Tests de componente (avisos incluidos); e2e mínimo perfil.

## 5. Verificación

- [ ] 5.1 [ai] `pnpm nx affected -t lint,typecheck,test` con `AI_CHAIN=mock AI_MOCK_MODE=replay`.
- [ ] 5.2 [ai] ADR-032 (D1–D12) escrito; marcar al cerrar apply.
