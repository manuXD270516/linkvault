import { describe, expect, it } from 'vitest';
import { CvAnalysisCounts } from './cv-analysis-counts';

// Registro del recuento de análisis por CV (tarea 11.3 de cv-match-suggestions).

const ANA = '66e9a0000000000000000a01';
const CV_A = '66e9a0000000000000000c01';
const CV_B = '66e9a0000000000000000c02';

describe('CvAnalysisCounts', () => {
  it('defaults to zero for every CV when nobody registered a reader', async () => {
    const counts = new CvAnalysisCounts();

    const byCv = await counts.countsByCv(ANA);

    expect(byCv.size).toBe(0);
    expect(byCv.get(CV_A) ?? 0).toBe(0);
    expect(byCv.get(CV_B) ?? 0).toBe(0);
  });

  it('returns whatever the registered reader reports', async () => {
    const counts = new CvAnalysisCounts();
    counts.register({
      countsByCv: (userId) =>
        Promise.resolve(
          userId === ANA
            ? new Map([
                [CV_A, 3],
                [CV_B, 1],
              ])
            : new Map(),
        ),
    });

    await expect(counts.countsByCv(ANA)).resolves.toEqual(
      new Map([
        [CV_A, 3],
        [CV_B, 1],
      ]),
    );
    await expect(counts.countsByCv('someone-else')).resolves.toEqual(new Map());
  });
});
