import { logger } from "../logger.js";
import { queueTasksFailedTotal } from "../metrics.js";

const queues = new Map();

export function enqueue(key, task) {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(() => task()).catch((err) => {
    queueTasksFailedTotal.inc();
    logger.error({ event: "queue.task_failed", jid: key, err: err?.message ?? String(err) });
  });
  queues.set(key, next);
  next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
}
