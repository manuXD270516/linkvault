import { z } from 'zod';

// Persona que aparece en una tarjeta de link: quien lo compartió o quien escribió un comentario. Vive aparte de
// `link.schema.ts` para que los contratos de comentarios (`group-link-comment.schema.ts`) la usen sin un import
// circular: `link.schema.ts` necesita a su vez el resumen de comentarios. Se reexporta desde `link.schema.ts`.

/** Quién compartió un link en un grupo, o quién escribió un comentario. Estricto: el email nunca sale de `users`. */
export const linkSharerSchema = z.strictObject({
  userId: z.string().min(1),
  displayName: z.string().min(1),
});
export type LinkSharer = z.infer<typeof linkSharerSchema>;
