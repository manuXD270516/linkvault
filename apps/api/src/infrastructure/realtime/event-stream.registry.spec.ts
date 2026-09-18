import { describe, expect, it } from 'vitest';
import {
  EventStreamRegistry,
  type EventStreamSink,
} from './event-stream.registry';

// Registro de conexiones del canal de eventos (tarea 6.8). No sabe de HTTP: el transporte es un doble.

class SinkDouble implements EventStreamSink {
  readonly events: { event: string; data: string }[] = [];
  heartbeats = 0;
  closed = false;

  constructor(private readonly writable = true) {}

  send(event: string, data: string): boolean {
    this.events.push({ event, data });
    return this.writable;
  }

  heartbeat(): boolean {
    this.heartbeats += 1;
    return this.writable;
  }

  close(): void {
    this.closed = true;
  }
}

const ANA = 'ana';
const BETO = 'beto';

describe('EventStreamRegistry', () => {
  it('sends to every open connection of a person, and to nobody else', () => {
    const registry = new EventStreamRegistry();
    const tab = new SinkDouble();
    const otherTab = new SinkDouble();
    const somebodyElse = new SinkDouble();
    registry.register(ANA, tab);
    registry.register(ANA, otherTab);
    registry.register(BETO, somebodyElse);

    expect(registry.publish(ANA, 'link.enriched', '{"link":1}')).toBe(2);
    expect(tab.events).toEqual([{ event: 'link.enriched', data: '{"link":1}' }]);
    expect(otherTab.events).toHaveLength(1);
    expect(somebodyElse.events).toEqual([]);
  });

  it('sends nothing to somebody with no connection open', () => {
    const registry = new EventStreamRegistry();

    expect(registry.publish(ANA, 'link.enriched', '{}')).toBe(0);
    expect(registry.hasListeners).toBe(false);
  });

  it('forgets a connection that goes away, without leaving the person behind', () => {
    const registry = new EventStreamRegistry();
    const unregister = registry.register(ANA, new SinkDouble());

    unregister();

    expect(registry.connectionsOf(ANA)).toBe(0);
    expect(registry.hasListeners).toBe(false);
    // Darla de baja dos veces no rompe nada: el cierre del socket puede llegar después del apagado.
    expect(() => unregister()).not.toThrow();
  });

  it('does not count a connection that no longer accepts writes', () => {
    const registry = new EventStreamRegistry();
    registry.register(ANA, new SinkDouble(false));

    expect(registry.publish(ANA, 'link.enriched', '{}')).toBe(0);
  });

  it('closes every connection when the process shuts down', () => {
    const registry = new EventStreamRegistry();
    const tab = new SinkDouble();
    registry.register(ANA, tab);

    registry.onApplicationShutdown();

    expect(tab.closed).toBe(true);
    expect(registry.hasListeners).toBe(false);
  });
});
