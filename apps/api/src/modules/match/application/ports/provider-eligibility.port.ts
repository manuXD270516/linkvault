// Reexporta el token y el contrato de elegibilidad de `@linkvault/ai` (tarea 4.3 / 8.7). `match` no declara un token
// propio: es el mismo que exporta `AiModule`, para que la API consulte circuitos compartidos sin contactar a nadie.

export {
  PROVIDER_ELIGIBILITY,
  type ProviderEligibility,
  type ProviderEligibilityQuery,
  type ProviderEligibilityResult,
} from '@linkvault/ai';
