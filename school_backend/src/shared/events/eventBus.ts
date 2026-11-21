import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';

/**
 * Catalogue of domain events. Modules publish events instead of calling each other
 * for side-effects (SMS alerts, notifications, sync to website...). A new module can
 * subscribe without the publisher changing at all — this keeps modules loosely coupled.
 */
export interface DomainEvents {
  'student.created': { studentId: number; actorUserId: number };
  'attendance.absent': { date: string; sectionId: number; enrollmentIds: number[]; actorUserId: number };
  'results.published': { examId: number; published: boolean; actorUserId: number };
  'results.withheld': { examId: number; withheld: boolean; enrollmentIds: number[]; actorUserId: number };
  'receipt.created': { receiptId: number; studentId: number; amount: number; actorUserId: number };
  'receipt.cancelled': { receiptId: number; studentId: number; actorUserId: number };
  'inquiry.received': { inquiryId: number; source: string };
}

export type EventName = keyof DomainEvents;
export type EventHandler<K extends EventName> = (payload: DomainEvents[K]) => void | Promise<void>;

export interface EventBus {
  publish<K extends EventName>(name: K, payload: DomainEvents[K]): void;
  subscribe<K extends EventName>(name: K, handler: EventHandler<K>): void;
}

/** In-process implementation. Swap for Redis/RabbitMQ later without touching modules. */
export function createEventBus(logger: Logger): EventBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);
  return {
    publish(name, payload) {
      // Fire-and-forget after the current request finishes; a failing handler never breaks the request.
      setImmediate(() => emitter.emit(name, payload));
    },
    subscribe(name, handler) {
      emitter.on(name, async (payload) => {
        try {
          await handler(payload);
        } catch (err) {
          logger.error({ err, event: name }, 'Event handler failed');
        }
      });
    },
  };
}
