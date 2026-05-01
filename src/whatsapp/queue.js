const queues = new Map();

export function enqueue(key, task) {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(() => task()).catch((err) => {
    console.error(`[QUEUE] Erro na tarefa para ${key}: ${err?.message ?? err}`);
  });
  queues.set(key, next);
  next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
}
