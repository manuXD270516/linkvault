import type {
  CvTextExtractor,
  ExtractionAttempt,
} from '../../application/ports/cv-text-extractors.port';
import type { CvFileFormat } from './child-command';
import type { IsolatedExtractionRunner } from './isolated-extraction.runner';

// Adaptador del puerto `CvTextExtractor` sobre la lectura aislada (D1 y D6 de cv-extract-isolation). **El puerto no
// cambia**: `unreadable_file` para toda causa de contenido; el fallo de maquinaria (`CvExtractionMachineryError`) se
// **relanza**, para que la cola reintente en vez de dar el CV por ilegible.

export class IsolatedCvTextExtractor implements CvTextExtractor {
  constructor(
    private readonly format: CvFileFormat,
    private readonly runner: IsolatedExtractionRunner,
  ) {}

  async extract(bytes: Uint8Array): Promise<ExtractionAttempt> {
    const outcome = await this.runner.run(this.format, bytes);
    return outcome.kind === 'text'
      ? { kind: 'text', text: outcome.text }
      : { kind: 'unreadable_file' };
  }
}
