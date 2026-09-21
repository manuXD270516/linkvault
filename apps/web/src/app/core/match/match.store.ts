import { DestroyRef, computed, inject } from '@angular/core';
import {
  MATCH_PROGRESS_STEPS,
  type AnalysisStepMessage,
  type MatchFailureCode,
  type MatchLatest,
  type MatchProgressStep,
  type MatchReport,
  type MatchRequestAccepted,
  type MatchRunning,
  type MatchStep,
  isMatchFinalStep,
  isMatchStepRegression,
  matchStepOrder,
} from '@linkvault/shared';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import {
  hasApiErrorCode,
  type RequestFailure,
  toRequestFailure,
} from '../api/api-error';
import { EventsChannel } from '../events/events.channel';
import { MatchApi } from './match.api';
import { MatchBusyRegistry } from './match-busy.registry';

/** Cada cuánto se pregunta el estado mientras el análisis corre (spec web/cv-match). */
export const MATCH_POLL_INTERVAL_MS = 3_000;

/**
 * Bloque en curso tal como lo usa el store. Tras el `202` del POST todavía no hay `maxAgeMs`; el primer `GET` lo
 * publica. Mientras falte, el sondeo pregunta sin inventar un plazo más corto.
 */
export type MatchRunningView = Omit<MatchRunning, 'maxAgeMs'> & { maxAgeMs?: number };

/**
 * Estado del diálogo de encaje para **una** oferta. Lo provee el diálogo: al cerrarlo se destruye y con él el sondeo.
 * Los dos bloques del `GET` viven lado a lado para que pedir un reanálisis no vacíe el informe que se estaba leyendo.
 */
export interface MatchState {
  linkId: string | null;
  latest: MatchLatest | null;
  running: MatchRunningView | null;
  /** Paso de la última consulta (el de `running` si hay, si no el de `latest`). */
  step: MatchStep | null;
  /** Pasos de progreso ya hechos; un degradado no deja `drafting-suggestions` pendiente. */
  completedSteps: MatchProgressStep[];
  loading: boolean;
  requesting: boolean;
  failure: RequestFailure | null;
  /**
   * `true` cuando se agotó la ventana derivada del `maxAgeMs` de la API y el análisis sigue en marcha.
   * Sin `maxAgeMs` conocido nunca pasa a `true`: se sigue preguntando.
   */
  stalled: boolean;
}

const initialState: MatchState = {
  linkId: null,
  latest: null,
  running: null,
  step: null,
  completedSteps: [],
  loading: false,
  requesting: false,
  failure: null,
  stalled: false,
};

/**
 * Pasos de progreso ya hechos a partir del paso actual. Con `done-degraded`, `drafting-suggestions` y los pasos del
 * juez no quedan pendientes: se saltaron por contrato y no se marcan como hechos ni como a la espera.
 */
export function completedMatchSteps(step: MatchStep): MatchProgressStep[] {
  if (step === 'done') {
    return [...MATCH_PROGRESS_STEPS];
  }
  if (step === 'done-degraded') {
    // Drafting y juez se saltaron: hecho lo anterior, y esos pasos no quedan pendientes.
    return ['reading-job', 'comparing-cv'];
  }
  if (step === 'failed') {
    return [];
  }
  const order = matchStepOrder(step);
  return MATCH_PROGRESS_STEPS.filter((progress) => matchStepOrder(progress) < order);
}

/** `true` si ese paso de progreso sigue a la espera de llegar. Un saltado (degradado) no cuenta. */
export function isMatchStepPending(step: MatchProgressStep, current: MatchStep): boolean {
  if (isMatchFinalStep(current)) {
    return false;
  }
  return matchStepOrder(step) > matchStepOrder(current);
}

function applyBlocks(
  latest: MatchLatest | null | undefined,
  running: MatchRunningView | null | undefined,
): Pick<MatchState, 'latest' | 'running' | 'step' | 'completedSteps'> {
  const nextLatest = latest ?? null;
  const nextRunning = running ?? null;
  const step = nextRunning?.step ?? nextLatest?.step ?? null;
  return {
    latest: nextLatest,
    running: nextRunning,
    step,
    completedSteps: step === null ? [] : completedMatchSteps(step),
  };
}

/**
 * Análisis de encaje de la oferta abierta en el diálogo (D12, spec web/cv-match).
 *
 * **No es `providedIn: 'root'`**: lo provee el diálogo, para que cerrarlo lo destruya y con él el sondeo. Un store de
 * raíz seguiría preguntando desde otra pantalla.
 */
export const MatchStore = signalStore(
  withState(initialState),
  withComputed(({ latest, running, step }) => ({
    report: computed((): MatchReport | null => latest()?.report ?? null),
    failureCode: computed((): MatchFailureCode | null => latest()?.failureCode ?? null),
    aiQuotaRetryAt: computed((): string | null => latest()?.aiQuotaRetryAt ?? null),
    stale: computed(() => latest()?.stale === true),
    cvChanged: computed(() => latest()?.cvChanged === true),
    consentRequired: computed(() => latest()?.consentRequired === true),
    isRunning: computed(() => running() !== null),
    /** Pasos de progreso que aún no han llegado y no se saltaron. */
    pendingSteps: computed((): MatchProgressStep[] => {
      const current = step();
      if (current === null) {
        return [];
      }
      return MATCH_PROGRESS_STEPS.filter((progress) => isMatchStepPending(progress, current));
    }),
  })),
  withMethods((store, api = inject(MatchApi), busy = inject(MatchBusyRegistry)) => {
    let timer: ReturnType<typeof setInterval> | null = null;
    /**
     * Instantáneo en el que se agota la ventana abierta, o `null` mientras no haya `maxAgeMs` (se sigue preguntando
     * sin inventar un plazo más corto).
     */
    let windowEndsAt: number | null = null;

    const stopPolling = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const syncBusy = (linkId: string, running: MatchRunningView | null): void => {
      busy.setBusy(linkId, running !== null);
    };

    const applyResponse = (
      latest: MatchLatest | null | undefined,
      running: MatchRunningView | null | undefined,
      linkId: string,
    ): void => {
      const blocks = applyBlocks(latest, running);
      patchState(store, {
        linkId,
        ...blocks,
      });
      syncBusy(linkId, blocks.running);
    };

    /**
     * Abre (o reabre) una ventana de espera. La duración sale del `maxAgeMs` del análisis en curso; sin ese dato no se
     * fija ningún tope. "Actualizar" vuelve a llamar esto con el plazo que publique la API.
     */
    const openWindow = (maxAgeMs: number | undefined, now: number = Date.now()): void => {
      stopPolling();
      patchState(store, { stalled: false });
      if (store.running() === null) {
        windowEndsAt = null;
        return;
      }
      windowEndsAt = maxAgeMs === undefined ? null : now + maxAgeMs;
      timer = setInterval(() => void poll(), MATCH_POLL_INTERVAL_MS);
    };

    /** Una vuelta del sondeo: pregunta el estado y decide si la ventana sigue, se cierra o se agota. */
    const poll = async (): Promise<void> => {
      const linkId = store.linkId();
      if (linkId === null) {
        stopPolling();
        return;
      }
      await fetchStatus(linkId, true);
      if (store.running() === null) {
        stopPolling();
        windowEndsAt = null;
        return;
      }
      // Si la API acaba de publicar el plazo y aún no había ventana, se toma ahora —nunca un valor inventado antes.
      if (windowEndsAt === null) {
        const maxAgeMs = store.running()?.maxAgeMs;
        if (maxAgeMs !== undefined) {
          windowEndsAt = Date.now() + maxAgeMs;
        }
        return;
      }
      if (Date.now() >= windowEndsAt) {
        stopPolling();
        patchState(store, { stalled: true });
      }
    };

    const fetchStatus = async (linkId: string, silent: boolean): Promise<void> => {
      if (!silent) {
        patchState(store, { loading: true, failure: null });
      }
      try {
        const response = await api.get(linkId);
        applyResponse(response.latest, response.running, response.linkId);
      } catch (error: unknown) {
        // Nunca se pidió análisis de esta oferta: estado vacío, no avería (spec cv/match).
        if (hasApiErrorCode(error, 404, 'analysis_not_found')) {
          applyResponse(null, null, linkId);
        } else if (!silent) {
          patchState(store, { failure: toRequestFailure(error) });
        }
      } finally {
        if (!silent) {
          patchState(store, { loading: false });
        }
      }
    };

    return {
      /**
       * Carga el estado de la oferta al abrir el diálogo. Si hay un análisis en curso, abre la ventana de sondeo con el
       * `maxAgeMs` que publique la API.
       */
      async load(linkId: string): Promise<void> {
        stopPolling();
        patchState(store, { ...initialState, linkId });
        await fetchStatus(linkId, false);
        openWindow(store.running()?.maxAgeMs);
      },

      /**
       * "Analizar" / "Volver a analizar". Un informe anterior **no se borra** al pedir: los dos bloques conviven hasta
       * que el nuevo termine. Un segundo intento mientras `requesting` no hace nada.
       */
      async request(cvId?: string): Promise<void> {
        const linkId = store.linkId();
        if (linkId === null || store.requesting() || store.running() !== null) {
          return;
        }
        patchState(store, { requesting: true, failure: null, stalled: false });
        busy.setBusy(linkId, true);
        try {
          const result = await api.request(linkId, cvId);
          if (result.status === 'running') {
            const accepted = result as MatchRequestAccepted;
            // Conserva `latest` (y su informe); solo pone el bloque en curso. Sin `maxAgeMs` hasta el GET.
            const runningView: MatchRunningView = {
              analysisId: accepted.analysisId,
              cvId: accepted.cvId,
              status: 'running',
              step: accepted.step,
              requestedAt: accepted.requestedAt,
            };
            patchState(store, {
              ...applyBlocks(store.latest(), runningView),
            });
            syncBusy(linkId, runningView);
            openWindow(undefined);
            await fetchStatus(linkId, true);
            openWindow(store.running()?.maxAgeMs);
          } else {
            const reused = result as MatchLatest;
            patchState(store, {
              ...applyBlocks(reused, null),
              stalled: false,
            });
            syncBusy(linkId, null);
            stopPolling();
            windowEndsAt = null;
          }
        } catch (error: unknown) {
          // El informe anterior permanece; solo se anota el fallo de la petición.
          patchState(store, { failure: toRequestFailure(error) });
          if (store.running() === null) {
            busy.setBusy(linkId, false);
          }
        } finally {
          patchState(store, { requesting: false });
        }
      },

      /**
       * "Actualizar" del aviso de paciencia y "Reintentar": pregunta otra vez y, si sigue en marcha, reanuda otra
       * ventana con el `maxAgeMs` actual de la API.
       */
      async refresh(): Promise<void> {
        const linkId = store.linkId();
        if (linkId === null) {
          return;
        }
        await fetchStatus(linkId, false);
        openWindow(store.running()?.maxAgeMs);
      },

      /**
       * Adelanta el paso mostrado al recibir `analysis.step` de **este** análisis. Otro análisis no entra. Un
       * retroceso se ignora. Sin canal, el sondeo basta igual (spec web/cv-match).
       */
      applyAnalysisStep(message: AnalysisStepMessage): void {
        const running = store.running();
        const linkId = store.linkId();
        if (running === null || linkId === null) {
          return;
        }
        if (message.analysisId !== running.analysisId || message.linkId !== linkId) {
          return;
        }
        if (isMatchStepRegression(running.step, message.step)) {
          return;
        }
        const nextRunning: MatchRunningView = { ...running, step: message.step };
        patchState(store, applyBlocks(store.latest(), nextRunning));
      },

      /**
       * Marca «no me convence» sobre una sugerencia del informe final (índice en `report.suggestions`).
       * Ruta: `POST /api/analyses/:analysisId/suggestion-feedback`.
       */
      async submitFeedback(suggestionIndex: number): Promise<void> {
        const linkId = store.linkId();
        const analysisId = store.latest()?.analysisId;
        if (linkId === null || analysisId === undefined) {
          return;
        }
        await api.submitFeedback(linkId, analysisId, suggestionIndex);
      },

      /** Detiene el sondeo: lo llama el hook al destruirse el diálogo y los tests que no quieren relojes vivos. */
      stopPolling,
    };
  }),
  withHooks({
    onInit(store, channel = inject(EventsChannel), destroyRef = inject(DestroyRef)) {
      const subscription = channel.analysisStep.subscribe((message) => {
        store.applyAnalysisStep(message);
      });
      destroyRef.onDestroy(() => subscription.unsubscribe());
    },
    onDestroy(store) {
      store.stopPolling();
    },
  }),
);

export type MatchStore = InstanceType<typeof MatchStore>;
