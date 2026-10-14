// -----------------------------------------------------------------------------
// The container's own polling timer.
//
// The devices are published with `should_poll: true` and a valid
// `poll_frequency`, but the core cannot be trusted to call onPoll: Gladys
// 5.2.0 skips devices created without `should_poll`, and a device keeps the
// polling fields it was created with (GladysAssistant/Gladys#3198, not fixed
// in 5.2.1). So the container reads Emporia by itself, once a minute, and the
// core's onPoll stays as a fallback.
//
// One cycle reads every device of the account in one request, so there is a
// single pace for all of them. No double work: the core's onPoll only runs a
// cycle when the timer has not run one for 90 % of a period, and a cycle in
// progress is shared by whoever asks for one meanwhile.
// -----------------------------------------------------------------------------

export const PERIOD_MS = 60 * 1000;

/**
 * @param {object} options
 * @param {(options: { force: boolean }) => Promise<void>} options.run one cycle; never throws
 * @param {boolean} [options.timers] run the periodic timer (tests turn it off)
 * @param {() => number} [options.now]
 * @param {number} [options.periodMs]
 */
export function createPoller({ run, timers = true, now = Date.now, periodMs = PERIOD_MS }) {
  let timer = null;
  let stopped = true;
  let inFlight = null;
  let lastRunAt = null;

  async function cycle({ force = false, minGap = 0 } = {}) {
    if (inFlight) {
      return inFlight;
    }
    if (!force && lastRunAt !== null && now() - lastRunAt < periodMs * minGap) {
      return undefined;
    }
    lastRunAt = now();
    inFlight = run({ force }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      await cycle().catch(() => {});
      schedule();
    }, periodMs);
  }

  return {
    /** (Re)start: one cycle now, then one every period. */
    async restart() {
      stopped = false;
      schedule();
      await cycle({ force: true });
    },

    /** The core's onPoll: a cycle unless the timer just ran one. */
    fromCore() {
      return cycle({ minGap: 0.9 });
    },

    /** A cycle now (a device was just added...). */
    now(options = {}) {
      return cycle({ force: true, ...options });
    },

    /** Time of the last cycle start, or null. */
    get lastRunAt() {
      return lastRunAt;
    },

    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
  };
}
