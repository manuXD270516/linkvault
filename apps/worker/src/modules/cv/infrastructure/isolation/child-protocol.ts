import { z } from 'zod';
import { CV_MAX_RAW_TEXT_CHARS } from './extraction-limits';

// Protocolo entre el worker y el proceso hijo de lectura (D1 y D6 de cv-extract-isolation). Una línea JSON por mensaje
// por el descriptor 3. El hijo habla; el padre lo parsea **a la defensiva**: una línea inválida es un desenlace
// (`protocol`), nunca una excepción, y de ella no queda ni su texto ni el `ZodError`.

/** Código de un `boot_error`: lo único del hijo que se puede registrar, y solo si cumple este patrón. */
export const CHILD_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;

/** Causas con las que el hijo declara que no pudo leer el archivo. Lista cerrada. */
export const CHILD_FAILURE_CAUSES = [
  'parse_error',
  'password',
  'input_budget',
] as const;
export type ChildFailureCause = (typeof CHILD_FAILURE_CAUSES)[number];

const childMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({
    type: z.literal('boot_error'),
    code: z.string().regex(CHILD_CODE_PATTERN),
  }),
  z.strictObject({
    type: z.literal('text'),
    text: z.string().max(CV_MAX_RAW_TEXT_CHARS),
    pagesCapped: z.boolean(),
    rawCapped: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('failed'),
    cause: z.enum(CHILD_FAILURE_CAUSES),
  }),
]);

export type ChildMessage = z.infer<typeof childMessageSchema>;

export type ParsedFrame =
  | { readonly ok: true; readonly message: ChildMessage }
  | { readonly ok: false; readonly cause: 'protocol' };

const INVALID: ParsedFrame = { ok: false, cause: 'protocol' };

/** Parsea una línea ya completa. **Nunca lanza** y no devuelve nada de la línea ni del error de validación. */
export function parseFrame(line: string): ParsedFrame {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return INVALID;
  }
  const parsed = childMessageSchema.safeParse(raw);
  return parsed.success ? { ok: true, message: parsed.data } : INVALID;
}

/** Serializa un mensaje como una línea. Lo usa el hijo. */
export function encodeFrame(message: ChildMessage): string {
  return `${JSON.stringify(message)}\n`;
}
