/**
 * Timer control utilities for testing time-dependent behavior.
 * Wraps Jest's fake timers with helpers for common patterns like
 * token expiry, refresh timeouts, and debounced operations.
 */

export interface TimerController {
  /** Install fake timers (call in beforeEach) */
  install(): void;

  /** Restore real timers (call in afterEach) */
  restore(): void;

  /** Advance time by the specified milliseconds */
  advanceBy(ms: number): void;

  /** Advance time to the next timer in the queue */
  advanceToNext(): void;

  /** Run all pending timers */
  runAll(): void;

  /** Run only currently pending timers (not ones scheduled by those) */
  runOnlyPending(): void;

  /** Get the current fake time as epoch milliseconds */
  now(): number;

  /** Set the system time to a specific timestamp */
  setSystemTime(timestamp: number | Date): void;

  /** Advance time and flush all pending promises */
  advanceByAndFlush(ms: number): Promise<void>;
}

/**
 * Creates a timer controller for managing fake timers in tests.
 *
 * @param initialTime - Optional initial system time (defaults to 2024-01-01T00:00:00Z)
 *
 * @example
 * ```ts
 * const timers = createTimerController();
 *
 * beforeEach(() => timers.install());
 * afterEach(() => timers.restore());
 *
 * it('refreshes token before expiry', async () => {
 *   timers.setSystemTime(tokenExpiresAt - 25_000); // 25s before expiry
 *   await getAccessToken(); // should trigger refresh
 * });
 * ```
 */
export function createTimerController(
  initialTime: number | Date = new Date("2024-01-01T00:00:00Z")
): TimerController {
  return {
    install() {
      jest.useFakeTimers();
      jest.setSystemTime(initialTime);
    },

    restore() {
      jest.useRealTimers();
    },

    advanceBy(ms: number) {
      jest.advanceTimersByTime(ms);
    },

    advanceToNext() {
      jest.advanceTimersToNextTimer();
    },

    runAll() {
      jest.runAllTimers();
    },

    runOnlyPending() {
      jest.runOnlyPendingTimers();
    },

    now() {
      return Date.now();
    },

    setSystemTime(timestamp: number | Date) {
      jest.setSystemTime(timestamp);
    },

    async advanceByAndFlush(ms: number) {
      jest.advanceTimersByTime(ms);
      // Flush microtask queue to allow promises to resolve
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

/**
 * Helper to create a UTC epoch seconds timestamp relative to current fake time.
 * Useful for setting token expiry times in tests.
 *
 * @param offsetSeconds - Seconds from "now" (positive = future, negative = past)
 */
export function epochSecondsFromNow(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

/**
 * Helper to wait for all pending promises to resolve.
 * Useful after advancing timers when async operations are triggered.
 */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
