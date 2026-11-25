// Token del puerto `WeeklyPlanner` (D1 de weekly-plan). La interfaz y su entrada/salida viven en
// `domain/weekly-plan/` (puras); aquí solo el token con el que el módulo provee la implementación:
// `{ provide: WEEKLY_PLANNER, useClass: RuleBasedPlanner }`. El planificador LLM del corte siguiente entra por el mismo
// token sin cambiar a quien llama.

export const WEEKLY_PLANNER = Symbol('WEEKLY_PLANNER');

export type { WeeklyPlanner } from '../../domain/weekly-plan/weekly-planner';
