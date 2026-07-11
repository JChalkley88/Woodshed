// Serialisation primitive for the separation worker: ORT sessions cannot
// run two inferences concurrently (the runtime throws "Session already
// started"), so anything that touches the session must queue, never
// interleave.

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  /** Number of tasks running or waiting. */
  get pending(): number {
    return this.depth;
  }

  /** Runs fn after every previously enqueued task has settled. A failed
   *  task rejects its own caller but never poisons the queue. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    this.depth++;
    const result = this.tail.then(fn);
    this.tail = result
      .catch(() => {})
      .finally(() => {
        this.depth--;
      });
    return result;
  }
}
