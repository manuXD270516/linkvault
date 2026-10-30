import { Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';
import {
  CV_EXTRACTION_CAUSES,
  PrometheusCvExtractionMetrics,
  type CvExtractionCombination,
} from './cv-extraction.metrics';

async function valueOf(registry: Registry, labels: string): Promise<number> {
  const body = await registry.metrics();
  const line = body
    .split('\n')
    .find((entry) =>
      entry.startsWith(`linkvault_cv_extractions_total{${labels}}`),
    );
  return line === undefined ? 0 : Number(line.split(' ').pop());
}

describe('PrometheusCvExtractionMetrics', () => {
  it('counts a timeout with its cause', async () => {
    const registry = new Registry();
    const metrics = new PrometheusCvExtractionMetrics(registry);

    metrics.record('pdf', { outcome: 'unreadable', cause: 'timeout' });

    expect(
      await valueOf(
        registry,
        'format="pdf",outcome="unreadable",cause="timeout"',
      ),
    ).toBe(1);
  });

  it('counts a machinery error', async () => {
    const registry = new Registry();
    const metrics = new PrometheusCvExtractionMetrics(registry);

    metrics.record('docx', {
      outcome: 'machinery_error',
      cause: 'boot_timeout',
    });
    metrics.record('docx', {
      outcome: 'machinery_error',
      cause: 'boot_timeout',
    });

    expect(
      await valueOf(
        registry,
        'format="docx",outcome="machinery_error",cause="boot_timeout"',
      ),
    ).toBe(2);
  });

  it('counts a capped text', async () => {
    const registry = new Registry();
    const metrics = new PrometheusCvExtractionMetrics(registry);

    metrics.record('pdf', { outcome: 'text', cause: 'pages_capped' });
    metrics.record('pdf', { outcome: 'text', cause: 'none' });

    expect(
      await valueOf(
        registry,
        'format="pdf",outcome="text",cause="pages_capped"',
      ),
    ).toBe(1);
    expect(
      await valueOf(registry, 'format="pdf",outcome="text",cause="none"'),
    ).toBe(1);
  });

  it('rejects a label combination outside the closed set', () => {
    const metrics = new PrometheusCvExtractionMetrics(new Registry());

    // En tipos: una causa de otro desenlace no compila.
    // @ts-expect-error `timeout` no es una causa de `text`.
    const invalid: CvExtractionCombination = {
      outcome: 'text',
      cause: 'timeout',
    };
    // En ejecución: lo rechaza aunque el tipo se haya saltado.
    expect(() => {
      metrics.record('pdf', invalid);
    }).toThrow();
    expect(() => {
      metrics.record('pdf', {
        outcome: 'machinery_error',
        cause: 'heap_limit',
      } as unknown as CvExtractionCombination);
    }).toThrow();
  });

  it('pins the closed sets of causes', () => {
    expect(CV_EXTRACTION_CAUSES).toEqual({
      text: ['none', 'pages_capped', 'raw_text_capped'],
      unreadable: [
        'parse_error',
        'password',
        'timeout',
        'heap_limit',
        'memory_ceiling',
        'child_exit',
        'input_budget',
        'protocol',
      ],
      machinery_error: ['boot_error', 'boot_timeout', 'protocol'],
    });
  });
});
