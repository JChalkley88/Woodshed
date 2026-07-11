import { describe, expect, it } from "vitest";
import { SerialQueue } from "./queue.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("SerialQueue", () => {
  it("never lets two tasks overlap, even when enqueued together", async () => {
    const queue = new SerialQueue();
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(10);
      active--;
    };
    // The re-entrancy shape from the live bug: a second request arriving
    // while the first is mid-flight.
    await Promise.all([queue.run(task), queue.run(task), queue.run(task)]);
    expect(maxActive).toBe(1);
  });

  it("preserves order", async () => {
    const queue = new SerialQueue();
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        queue.run(async () => {
          await sleep(4 - n); // later tasks are quicker; order must hold
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it("a failing task rejects its caller but never poisons the queue", async () => {
    const queue = new SerialQueue();
    await expect(
      queue.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(queue.run(async () => "recovered")).resolves.toBe(
      "recovered",
    );
  });

  it("reports pending depth", async () => {
    const queue = new SerialQueue();
    const first = queue.run(() => sleep(10));
    const second = queue.run(() => sleep(1));
    expect(queue.pending).toBe(2);
    await Promise.all([first, second]);
    expect(queue.pending).toBe(0);
  });
});
