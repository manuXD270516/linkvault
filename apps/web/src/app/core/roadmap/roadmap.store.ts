import { computed, inject } from '@angular/core';
import type { RoadmapItem, RoadmapResponse, RoadmapStatus } from '@linkvault/shared';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import {
  hasApiErrorCode,
  type RequestFailure,
  toRequestFailure,
} from '../api/api-error';
import { RoadmapApi } from './roadmap.api';

/** Cada cuánto se pregunta el estado mientras el plan se genera (spec web/roadmap). */
export const ROADMAP_POLL_INTERVAL_MS = 3_000;

export interface RoadmapState {
  analysisId: string | null;
  roadmapId: string | null;
  status: RoadmapStatus | null;
  items: RoadmapItem[];
  loading: boolean;
  requesting: boolean;
  exporting: boolean;
  failure: RequestFailure | null;
  exportFailure: RequestFailure | null;
}

const initialState: RoadmapState = {
  analysisId: null,
  roadmapId: null,
  status: null,
  items: [],
  loading: false,
  requesting: false,
  exporting: false,
  failure: null,
  exportFailure: null,
};

function applyBody(body: RoadmapResponse): Pick<
  RoadmapState,
  'roadmapId' | 'analysisId' | 'status' | 'items'
> {
  return {
    roadmapId: body.roadmapId,
    analysisId: body.analysisId,
    status: body.status,
    items: body.status === 'ready' ? [...(body.items ?? [])] : [],
  };
}

/**
 * Roadmap de estudio de un análisis. Lo provee la página: al salir se destruye y con él el sondeo.
 */
export const RoadmapStore = signalStore(
  withState(initialState),
  withComputed(({ status, items }) => ({
    isGenerating: computed(() => status() === 'generating'),
    isReady: computed(() => status() === 'ready'),
    isFailed: computed(() => status() === 'failed'),
    /** Ítems ordenados por prioridad y semanas (misma idea que el export del servidor). */
    sortedItems: computed((): RoadmapItem[] =>
      [...items()].sort(
        (a, b) => a.priority - b.priority || a.estimatedWeeks - b.estimatedWeeks,
      ),
    ),
  })),
  withMethods((store, api = inject(RoadmapApi)) => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stopPolling = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const startPolling = (): void => {
      stopPolling();
      if (store.status() !== 'generating') {
        return;
      }
      timer = setInterval(() => void poll(), ROADMAP_POLL_INTERVAL_MS);
    };

    const poll = async (): Promise<void> => {
      const analysisId = store.analysisId();
      if (analysisId === null || store.status() !== 'generating') {
        stopPolling();
        return;
      }
      try {
        const body = await api.get(analysisId);
        patchState(store, applyBody(body));
        if (body.status !== 'generating') {
          stopPolling();
        }
      } catch {
        // Un fallo silencioso en el sondeo no borra el estado de espera ni inventa un plan.
      }
    };

    const ensureRoadmap = async (analysisId: string): Promise<void> => {
      patchState(store, { requesting: true, failure: null });
      try {
        const result = await api.request(analysisId);
        if ('analysisId' in result) {
          patchState(store, applyBody(result));
        } else {
          patchState(store, {
            roadmapId: result.roadmapId,
            analysisId,
            status: result.status,
            items: [],
          });
        }
        startPolling();
      } catch (error: unknown) {
        patchState(store, { failure: toRequestFailure(error) });
      } finally {
        patchState(store, { requesting: false });
      }
    };

    return {
      /**
       * Carga el roadmap al abrir la página. Si aún no existe (auto-outbox pendiente), lo pide con POST
       * y sondea mientras `generating`.
       */
      async load(analysisId: string): Promise<void> {
        stopPolling();
        patchState(store, { ...initialState, analysisId, loading: true });
        try {
          const body = await api.get(analysisId);
          patchState(store, applyBody(body));
          startPolling();
        } catch (error: unknown) {
          if (hasApiErrorCode(error, 404, 'analysis_not_found')) {
            await ensureRoadmap(analysisId);
          } else {
            patchState(store, { failure: toRequestFailure(error) });
          }
        } finally {
          patchState(store, { loading: false });
        }
      },

      /** Descarga el Markdown del servidor (no un prompt en el cliente). */
      async exportMarkdown(): Promise<void> {
        const analysisId = store.analysisId();
        if (analysisId === null || store.status() !== 'ready' || store.exporting()) {
          return;
        }
        patchState(store, { exporting: true, exportFailure: null });
        try {
          const markdown = await api.getMarkdown(analysisId);
          downloadMarkdown(markdown, `roadmap-${analysisId}.md`);
        } catch (error: unknown) {
          patchState(store, { exportFailure: toRequestFailure(error) });
        } finally {
          patchState(store, { exporting: false });
        }
      },

      stopPolling,
    };
  }),
  withHooks({
    onDestroy(store) {
      store.stopPolling();
    },
  }),
);

export type RoadmapStore = InstanceType<typeof RoadmapStore>;

/** Dispara la descarga del `.md` en el navegador. */
export function downloadMarkdown(content: string, fileName: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
