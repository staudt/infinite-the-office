import type { Mood, Part, Reaction, SetId } from '../schema/episode';

// Discrete happenings emitted by the engine. Views subscribe to these; for continuous
// state (actor positions, the current card) they read the Stage each frame.
export type EngineEvent = { t: number } & (
  | { type: 'episodeStart'; title: string; label: string }
  | { type: 'episodeEnd' }
  | { type: 'sceneStart'; index: number; set: SetId; region: string; venue: string; /** Title-card text, or '' when the scene cuts in without one. */ title: string; part: Part }
  | { type: 'sceneEnd'; index: number; recap: string }
  | { type: 'card'; text: string; sub: string; seconds: number }
  | { type: 'caption'; text: string }
  | { type: 'pause'; seconds: number; caption: string }
  | { type: 'spawn'; id: string }
  | { type: 'despawn'; id: string }
  | { type: 'said'; who: string; text: string; mood: Mood; to: string }
  | { type: 'headStart'; who: string }
  | { type: 'headSay'; who: string; text: string; mood: Mood }
  | { type: 'headEnd'; who: string }
  | { type: 'action'; who: string; caption: string }
  | { type: 'react'; who: string; reaction: Reaction }
);

export type EventOf<T extends EngineEvent['type']> = Extract<EngineEvent, { type: T }>;

// Distributes Omit over the union so each variant keeps its own fields.
export type EventInput = EngineEvent extends infer E ? (E extends EngineEvent ? Omit<E, 't'> : never) : never;

export class EventBus {
  private listeners: ((e: EngineEvent) => void)[] = [];

  constructor(private clock: () => number) {}

  on(fn: (e: EngineEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  emit(e: EventInput): void {
    const ev = { ...e, t: Math.round(this.clock() * 1000) / 1000 } as EngineEvent;
    for (const l of this.listeners) l(ev);
  }
}
