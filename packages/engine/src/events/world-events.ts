/**
 * World event log.
 *
 * Every important simulation change goes through here:
 *  - events are numbered with a monotonic id so clients can deduplicate;
 *  - a dedupe key prevents the same event from flooding the ticker;
 *  - severity 3 events are also pushed to the notification feed.
 */

import type { EventCategory, EventSeverity, WorldEvent } from "@openwars/shared";

export interface EventInput {
  category: EventCategory;
  severity: EventSeverity;
  message: string;
  players: number[];
  icons?: string[];
  tile?: number;
  tick: number;
  /** Same key within `dedupeWindow` ticks => dropped. */
  dedupeKey?: string;
}

export class EventLog {
  private nextId = 1;
  private history: WorldEvent[] = [];
  private pending: WorldEvent[] = [];
  private unnotified: WorldEvent[] = [];
  private readonly lastEmit = new Map<string, number>();

  constructor(
    private readonly capacity: number,
    private readonly dedupeWindow = 30,
  ) {}

  emit(input: EventInput): WorldEvent | null {
    if (input.dedupeKey) {
      const previous = this.lastEmit.get(input.dedupeKey);
      if (previous !== undefined && input.tick - previous < this.dedupeWindow) {
        return null;
      }
      this.lastEmit.set(input.dedupeKey, input.tick);
      if (this.lastEmit.size > 4000) this.prune(input.tick);
    }
    const event: WorldEvent = {
      id: this.nextId++,
      tick: input.tick,
      category: input.category,
      severity: input.severity,
      message: input.message,
      players: [...input.players],
      icons: input.icons ? [...input.icons] : undefined,
      tile: input.tile,
    };
    this.pending.push(event);
    if (event.severity >= 3) this.unnotified.push(event);
    this.history.push(event);
    if (this.history.length > this.capacity) {
      this.history.splice(0, this.history.length - this.capacity);
    }
    return event;
  }

  /** Events produced since the last drain (they travel in the tick update). */
  drain(): WorldEvent[] {
    const events = this.pending;
    this.pending = [];
    return events;
  }

  /** Major events that must trigger a notification. */
  drainNotifications(): WorldEvent[] {
    const events = this.unnotified;
    this.unnotified = [];
    return events;
  }

  recent(limit = 40): WorldEvent[] {
    return this.history.slice(-limit);
  }

  private prune(tick: number): void {
    for (const [key, value] of this.lastEmit) {
      if (tick - value > this.dedupeWindow * 10) this.lastEmit.delete(key);
    }
  }
}
