// Logger del módulo de IA (D12 de ai-gateway-core). Solo tipos.
// Nunca recibe prompts, inputs, salidas, cuerpos HTTP ni credenciales: solo identificadores y métricas.

export type AiLogFields = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

export interface AiLogger {
  debug(message: string, fields?: AiLogFields): void;
  warn(message: string, fields?: AiLogFields): void;
}
