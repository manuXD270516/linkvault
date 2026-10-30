import { describe, expect, it } from 'vitest';
import { developmentReadList } from './child-command';
import { runCvExtractProbe } from './cv-extract-probe';
import {
  CHILD_TEST_OUT_DIR,
  CHILD_TEST_SCRIPT,
  NODE_MODULES_ROOT,
} from './isolation-test-paths';

function capture(): {
  out: string;
  err: string;
  io: { out(t: string): void; err(t: string): void };
} {
  const state = { out: '', err: '' };
  return {
    get out() {
      return state.out;
    },
    get err() {
      return state.err;
    },
    io: {
      out: (text) => {
        state.out += text;
      },
      err: (text) => {
        state.err += text;
      },
    },
  };
}

describe('cv-extract-probe', () => {
  it('reads a pdf and a docx through the isolated child and prints counts and boot times', async () => {
    const output = capture();

    const code = await runCvExtractProbe({
      scriptPath: CHILD_TEST_SCRIPT,
      allowRead: developmentReadList(CHILD_TEST_OUT_DIR, NODE_MODULES_ROOT),
      io: output.io,
      bootSamples: 3,
    });

    expect(code).toBe(0);
    expect(output.out).toMatch(/pdf chars=\d+ docx chars=\d+/);
    expect(output.out).toMatch(/boot_p50_ms=\d+ boot_p95_ms=\d+/);
    expect(output.out).not.toContain('Nadia');
  });

  it('exits non-zero naming the child, and no text, when the child script is missing', async () => {
    const output = capture();

    const code = await runCvExtractProbe({
      scriptPath: `${CHILD_TEST_OUT_DIR}/missing/cv-extract-child.js`,
      allowRead: developmentReadList(CHILD_TEST_OUT_DIR, NODE_MODULES_ROOT),
      io: output.io,
      bootSamples: 1,
    });

    expect(code).toBe(1);
    expect(output.err).toContain('cv-extract-child');
    expect(output.err + output.out).not.toContain('Nadia');
  });
});
