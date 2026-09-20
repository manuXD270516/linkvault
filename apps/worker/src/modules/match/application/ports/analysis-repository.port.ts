import type { MatchStep } from '@linkvault/shared';
import type {
  CompleteAnalysisInput,
  FailAnalysisInput,
  MatchAnalysis,
} from '../../domain/analysis';

// Puerto del repositorio de análisis en el worker (tareas 13.2, 13.4, 13.5). **Solo actualiza**: nunca crea
// documentos (ADR-030 §13). La API es quien inserta con `createRunning`.

export const ANALYSIS_REPOSITORY = Symbol('ANALYSIS_REPOSITORY');

export interface AnalysisRepository {
  /** Lee el análisis por id; `null` si no existe o el id está mal formado. */
  findById(analysisId: string): Promise<MatchAnalysis | null>;

  /**
   * Persiste el informe en un `running` dentro de plazo. `false` si no había documento que actualizar (ya resuelto,
   * vencido o purgado). **Sin upsert.**
   */
  complete(analysisId: string, input: CompleteAnalysisInput): Promise<boolean>;

  /**
   * Deja el análisis en `failed` con su código. Misma condición que `complete`. No lanza si no encuentra documento.
   */
  fail(analysisId: string, input: FailAnalysisInput): Promise<boolean>;

  /**
   * Deja escrito el último paso alcanzado. No retrocede, no crea, no escribe informe. Un fallo aquí no debe tumbar
   * el análisis: quien llama captura.
   */
  recordStep(analysisId: string, step: MatchStep): Promise<boolean>;
}
