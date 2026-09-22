/** Últimos 4 caracteres de la clave en claro para `keyHint` (spec ai/byok). */
export function keyHintOf(apiKey: string): string {
  return apiKey.slice(-4);
}
