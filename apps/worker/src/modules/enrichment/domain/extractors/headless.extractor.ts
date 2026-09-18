import { NOTHING_EXTRACTED } from './extractor';
import type { ExtractionOutcome, ExtractorStrategy } from './extractor';

// Cuarta y última etapa de la cadena (D3): el hueco del renderizado con navegador. **Existe el eslabón, no el
// adaptador.** No hay Playwright en el worker y este change no lo trae: escribirlo contra las cinco bolsas del
// manifiesto sería mantenimiento perpetuo de código que casi ninguna nos deja ejecutar (Non-Goals de design.md).
//
// Lo que sí queda es el punto de extensión, con su flag: cuando haya un adaptador de verdad, entra aquí y
// `FEATURE_HEADLESS_EXTRACTION` lo enciende sin tocar la cadena.

export const HEADLESS_EXTRACTOR_ID = 'headless';

export class HeadlessExtractor implements ExtractorStrategy {
  readonly id = HEADLESS_EXTRACTOR_ID;

  /** `FEATURE_HEADLESS_EXTRACTION`. Apagado en todos los entornos mientras no haya adaptador. */
  constructor(private readonly enabled: boolean) {}

  supports(): boolean {
    return this.enabled;
  }

  extract(): Promise<ExtractionOutcome> {
    // Con el flag encendido y sin adaptador, la etapa no aporta nada y lo dice: no lanza, porque una etapa que
    // revienta dejaría el link en `failed` por un fallo nuestro, y lo que hay es una función que aún no existe.
    return Promise.resolve(NOTHING_EXTRACTED);
  }
}
