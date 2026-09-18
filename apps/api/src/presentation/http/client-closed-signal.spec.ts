import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { clientClosedSignal, type RawResponse } from './client-closed-signal';

class ResponseDouble extends EventEmitter implements RawResponse {
  writableEnded = false;
}

describe('clientClosedSignal', () => {
  it('aborts when the client goes away before the answer', () => {
    const response = new ResponseDouble();
    const signal = clientClosedSignal(response);

    response.emit('close');

    expect(signal.aborted).toBe(true);
  });

  it('does not abort when the connection closes after the whole answer was written', () => {
    const response = new ResponseDouble();
    const signal = clientClosedSignal(response);

    response.writableEnded = true;
    response.emit('close');

    expect(signal.aborted).toBe(false);
  });
});
