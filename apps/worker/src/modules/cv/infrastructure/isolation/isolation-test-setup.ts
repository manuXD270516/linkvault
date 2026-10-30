import { afterEach, expect } from 'vitest';
import { killLiveChildren } from './isolated-extraction.runner';

// `afterEach` común del proyecto `worker-isolation` (N6): ningún test deja hijos vivos. Si había alguno, se mata con
// `SIGKILL` y el test falla: un runner que olvida matar es un defecto, no algo que limpiar en silencio.
afterEach(() => {
  const killed = killLiveChildren();
  expect(killed, 'children left alive by the test').toBe(0);
});
