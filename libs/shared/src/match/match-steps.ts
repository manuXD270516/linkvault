import { z } from 'zod';

// Conjunto cerrado de pasos del análisis de encaje (ADR-030 §9, D12; cv-suggestions-review §5). **Única definición**:
// api, worker y web importan de aquí; repetir la lista en cada capa acabaría con tres pantallas que cuentan la espera
// distinto.
//
// Un análisis degradado se salta `drafting-suggestions` **y** los pasos del juez (`critiquing-suggestions`,
// `revising-suggestions`) **por contrato**: no redacta ni critica sugerencias, así que esos pasos no están pendientes
// y quien los muestre puede darlos por no aplicables sin adivinar.

/** Pasos de progreso, en el orden en que se alcanzan. */
export const MATCH_PROGRESS_STEPS = [
  'reading-job',
  'comparing-cv',
  'drafting-suggestions',
  'critiquing-suggestions',
  'revising-suggestions',
] as const;

/**
 * Finales: todo análisis termina en uno de estos tres. Son exactamente tres; un cuarto rompería el contrato de la
 * pantalla que cuenta la espera.
 */
export const MATCH_FINAL_STEPS = ['done', 'done-degraded', 'failed'] as const;

/** Todos los pasos del análisis, progreso y finales. */
export const MATCH_STEPS = [
  ...MATCH_PROGRESS_STEPS,
  ...MATCH_FINAL_STEPS,
] as const;

export const matchStepSchema = z.enum(MATCH_STEPS);
export type MatchStep = z.infer<typeof matchStepSchema>;

export type MatchFinalStep = (typeof MATCH_FINAL_STEPS)[number];
export type MatchProgressStep = (typeof MATCH_PROGRESS_STEPS)[number];

/** Secuencia completa: con sugerencias y bucle de juez hasta `done`. */
export const MATCH_FULL_SEQUENCE = [
  'reading-job',
  'comparing-cv',
  'drafting-suggestions',
  'critiquing-suggestions',
  'revising-suggestions',
  'done',
] as const satisfies readonly MatchStep[];

/**
 * Secuencia degradada: se salta `drafting-suggestions` y los pasos del juez por contrato y termina en
 * `done-degraded`. Quien muestre el progreso no debe esperar esos pasos intermedios.
 */
export const MATCH_DEGRADED_SEQUENCE = [
  'reading-job',
  'comparing-cv',
  'done-degraded',
] as const satisfies readonly MatchStep[];

/** Orden numérico: un paso no puede retroceder a otro con índice menor. Los finales comparten el tope. */
const MATCH_STEP_ORDER: Readonly<Record<MatchStep, number>> = {
  'reading-job': 0,
  'comparing-cv': 1,
  'drafting-suggestions': 2,
  'critiquing-suggestions': 3,
  'revising-suggestions': 4,
  done: 5,
  'done-degraded': 5,
  failed: 5,
};

/** `true` si el paso es uno de los tres finales. */
export function isMatchFinalStep(step: MatchStep): step is MatchFinalStep {
  return (MATCH_FINAL_STEPS as readonly string[]).includes(step);
}

/** Índice de orden del paso (0…5). Los tres finales valen 5. */
export function matchStepOrder(step: MatchStep): number {
  return MATCH_STEP_ORDER[step];
}

/**
 * `true` si pasar de `from` a `to` sería un retroceso (o salir de un final). Guardar un paso que retrocede no debe
 * escribirse: el paso alcanzado nunca baja.
 */
export function isMatchStepRegression(from: MatchStep, to: MatchStep): boolean {
  if (isMatchFinalStep(from)) {
    return from !== to;
  }
  return matchStepOrder(to) < matchStepOrder(from);
}
