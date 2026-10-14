// -----------------------------------------------------------------------------
// Cumulative energy indexes (kWh), built from Emporia's daily totals.
//
// Gladys tracks energy from a cumulative meter index (energy-sensor/index,
// switch/energy, energy-production-sensor/index): the core derives the
// 30-minute consumption and its cost from the index deltas. Emporia has no
// index, only the energy of a period (scale 1D = since local midnight of the
// device's time zone). So each index is
//
//   index = sum of the completed days (base) + energy of today so far
//
// The completed days are read back at their very end (the `instant` of the
// request is the last second of that day): exact, self-healing after a
// restart (the missed days are read one by one, 31 at most), and equal to
// what the Emporia app shows. The state lives in /data/energy.json.
//
// Two guards keep the index from ever going back, which the core would read
// as a negative consumption:
//   - today's value never decreases within a day (a late or partial answer);
//   - during the first 30 minutes of a day, today's value is not read: right
//     after midnight the API may still answer yesterday's total (the HACS
//     integration debounces the same lag), which would be counted twice.
// -----------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
export const RESET_DEBOUNCE_MS = 30 * 60 * 1000;
export const MAX_CATCH_UP_DAYS = 31;

const formatters = new Map();

/** Intl formatter for a time zone, falling back to the container's (TZ). */
function formatter(timeZone) {
  const cacheKey = timeZone ?? '';
  if (!formatters.has(cacheKey)) {
    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    };
    let fmt;
    try {
      fmt = new Intl.DateTimeFormat('en-US', { ...options, timeZone: timeZone ?? undefined });
    } catch {
      // Unknown time zone name: the container's own (Gladys injects TZ).
      fmt = new Intl.DateTimeFormat('en-US', options);
    }
    formatters.set(cacheKey, fmt);
  }
  return formatters.get(cacheKey);
}

function wallClock(ms, timeZone) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Local date "YYYY-MM-DD" of an instant in a time zone. */
export function localDate(ms, timeZone) {
  const { year, month, day } = wallClock(ms, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** UTC instant of the local midnight that starts a date in a time zone. */
export function startOfLocalDay(date, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);
  const offsetAt = (ms) => {
    const wall = wallClock(ms, timeZone);
    return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - ms;
  };
  let ms = target - offsetAt(target);
  ms = target - offsetAt(ms);
  return ms;
}

/** "YYYY-MM-DD" shifted by n days. */
export function addDays(date, n) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + n * DAY_MS).toISOString().slice(0, 10);
}

const round3 = (value) => Math.round(value * 1000) / 1000;

/**
 * @param {object} options
 * @param {{ read: Function, write: Function }} options.file /data/energy.json
 */
export function createEnergyTracker({ file }) {
  /** "gid|channel" → { day, base, today } */
  let channels = null;

  async function load() {
    if (channels === null) {
      const stored = await file.read(null);
      channels = stored?.version === 1 && stored.channels ? stored.channels : {};
    }
  }

  return {
    /**
     * Read the daily totals and move the indexes forward.
     * @param {object} options
     * @param {Array<{ gid: number, timeZone: string|null }>} options.devices every device read
     * @param {(gid: number, num: string) => boolean} options.wanted channels that get an index
     * @param {(gids: number[], instant: number) => Promise<Map>} options.fetchDay parsed 1D usage
     * @param {number} options.now
     */
    async refresh({ devices, wanted, fetchDay, now }) {
      await load();
      const next = structuredClone(channels);
      const today = new Map(devices.map((d) => [d.gid, localDate(now, d.timeZone)]));
      const zoneOf = new Map(devices.map((d) => [d.gid, d.timeZone]));

      // 1. Days that ended since the last refresh: read their final totals.
      const pastDays = new Map(); // "zone|date" → { zone, date, gids:Set }
      for (const [id, entry] of Object.entries(next)) {
        const gid = Number(id.split('|')[0]);
        if (!today.has(gid) || entry.day >= today.get(gid)) {
          continue;
        }
        const first = [entry.day, addDays(today.get(gid), -MAX_CATCH_UP_DAYS)].sort()[1];
        for (let date = first; date < today.get(gid); date = addDays(date, 1)) {
          const zone = zoneOf.get(gid) ?? '';
          const groupKey = `${zone}|${date}`;
          if (!pastDays.has(groupKey)) {
            pastDays.set(groupKey, { zone: zoneOf.get(gid), date, gids: new Set() });
          }
          pastDays.get(groupKey).gids.add(gid);
        }
      }
      const finals = new Map(); // "date|gid|channel" → kWh
      for (const { zone, date, gids: dayGids } of [...pastDays.values()].sort((a, b) =>
        a.date.localeCompare(b.date),
      )) {
        const lastSecond = startOfLocalDay(addDays(date, 1), zone) - 1000;
        const usages = await fetchDay([...dayGids], lastSecond);
        for (const [id, value] of usages) {
          if (value.usage !== null) {
            finals.set(`${date}|${id}`, Math.abs(value.usage));
          }
        }
      }
      for (const [id, entry] of Object.entries(next)) {
        const gid = Number(id.split('|')[0]);
        if (!today.has(gid) || entry.day >= today.get(gid)) {
          continue;
        }
        const first = [entry.day, addDays(today.get(gid), -MAX_CATCH_UP_DAYS)].sort()[1];
        for (let date = first; date < today.get(gid); date = addDays(date, 1)) {
          const final = finals.get(`${date}|${id}`);
          entry.base += date === entry.day ? Math.max(final ?? 0, entry.today) : (final ?? 0);
        }
        entry.day = today.get(gid);
        entry.today = 0;
      }

      // 2. Today so far, except right after the local midnight.
      const readable = devices.filter(
        (d) => now - startOfLocalDay(today.get(d.gid), d.timeZone) >= RESET_DEBOUNCE_MS,
      );
      const current =
        readable.length > 0
          ? await fetchDay(
              readable.map((d) => d.gid),
              now,
            )
          : new Map();
      for (const [id, value] of current) {
        const [gidText, num] = id.split('|');
        const gid = Number(gidText);
        if (!today.has(gid) || !wanted(gid, num) || value.usage === null) {
          continue;
        }
        const kwh = Math.abs(value.usage);
        const entry = next[id];
        if (!entry) {
          next[id] = { day: today.get(gid), base: 0, today: kwh };
        } else {
          entry.today = Math.max(entry.today, kwh);
        }
      }
      const changed = JSON.stringify(next) !== JSON.stringify(channels);
      channels = next;
      if (changed) {
        await file.write({ version: 1, channels });
      }
    },

    /** Index of a channel in kWh, or null before its first reading. */
    index(gid, num) {
      const entry = channels?.[`${gid}|${num}`];
      return entry ? round3(entry.base + entry.today) : null;
    },

    /** Energy of a channel since local midnight in kWh, or null. */
    today(gid, num) {
      const entry = channels?.[`${gid}|${num}`];
      return entry ? round3(entry.today) : null;
    },

    /** Loads the stored indexes (published before the first refresh). */
    load,
  };
}
