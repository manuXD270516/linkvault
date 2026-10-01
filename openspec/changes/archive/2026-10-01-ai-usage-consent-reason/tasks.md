## 1. Test en rojo

- [x] 1.1 [ai] `libs/ai/src/infrastructure/persistence/mongo-usage-ledger.spec.ts`: escribir un `degraded` con motivo
  `consent_required` contra el MongoMemoryReplSet y comprobar que el documento se guarda con ese motivo; con el nombre
  del escenario "Resultado degradado por falta de consentimiento" en el título del `it`. Debe fallar con
  `ValidationError` antes de 2.1.

## 2. Una sola fuente de verdad

- [x] 2.1 [ai] `libs/ai/src/domain/ai-result.ts`: exportar `DEGRADED_REASONS` (`as const`) y derivar `DegradedReason`
  de ella; `libs/ai/src/domain/ports/usage-ledger.port.ts`: exportar `USAGE_OUTCOMES` y derivar `UsageOutcome`.
- [x] 2.2 [ai] `libs/ai/src/infrastructure/persistence/ai-usage.schema.ts`: sustituir las listas locales por
  `DEGRADED_REASONS` y `USAGE_OUTCOMES`.
- [x] 2.3 [ai] `mongo-usage-ledger.spec.ts`: recorrer `DEGRADED_REASONS` y `USAGE_OUTCOMES` para comprobar que el
  ledger acepta cada valor, de modo que un motivo nuevo sin soporte en el almacén haga fallar el test.

## 3. Cierre

- [x] 3.1 [infra] `pnpm nx affected -t lint,typecheck,test,i18n-check --base=main` y `openspec validate --all` en verde.
