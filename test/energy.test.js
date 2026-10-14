import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CATCH_UP_DAYS,
  addDays,
  createEnergyTracker,
  localDate,
  startOfLocalDay,
} from '../src/energy.js';
import { memoryFile } from './helpers/fakeEmporia.js';

const TZ = 'America/Toronto'; // UTC-4 in October
const GID = 480001;
const devices = [{ gid: GID, timeZone: TZ }];
const wanted = (_gid, num) => num !== 'Balance';

/** A 1D answer: one value per channel. */
const day = (values) =>
  new Map(Object.entries(values).map(([num, usage]) => [`${GID}|${num}`, { usage, name: null }]));

/** fetchDay recording its calls, answering from a function of the instant. */
function fetcher(answer) {
  const calls = [];
  const fetchDay = async (gids, instant) => {
    calls.push(new Date(instant).toISOString());
    return answer(instant);
  };
  return { calls, fetchDay };
}

test('local dates and midnights follow the time zone, DST included', () => {
  assert.equal(localDate(Date.UTC(2026, 9, 15, 3, 59), TZ), '2026-10-14');
  assert.equal(localDate(Date.UTC(2026, 9, 15, 4, 0), TZ), '2026-10-15');
  assert.equal(startOfLocalDay('2026-10-15', TZ), Date.UTC(2026, 9, 15, 4));
  // Paris leaves summer time on 2026-10-25: that day is 25 hours long.
  assert.equal(startOfLocalDay('2026-10-25', 'Europe/Paris'), Date.UTC(2026, 9, 24, 22));
  assert.equal(startOfLocalDay('2026-10-26', 'Europe/Paris'), Date.UTC(2026, 9, 25, 23));
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  // An unknown zone falls back to the container's, without throwing.
  assert.match(localDate(Date.UTC(2026, 9, 15), 'Not/AZone'), /^2026-10-1[45]$/);
});

test('the index is today so far, and never goes back within a day', async () => {
  const tracker = createEnergyTracker({ file: memoryFile() });
  let today = 10;
  const { fetchDay } = fetcher(() => day({ '1,2,3': today, 1: -2.5, Balance: 1 }));
  await tracker.refresh({ devices, wanted, fetchDay, now: Date.UTC(2026, 9, 14, 18) });
  assert.equal(tracker.index(GID, '1,2,3'), 10);
  assert.equal(tracker.index(GID, '1'), 2.5); // sign dropped
  assert.equal(tracker.index(GID, 'Balance'), null); // not wanted

  today = 10.5;
  await tracker.refresh({ devices, wanted, fetchDay, now: Date.UTC(2026, 9, 14, 18, 5) });
  assert.equal(tracker.index(GID, '1,2,3'), 10.5);
  today = 10.2; // a late or partial answer
  await tracker.refresh({ devices, wanted, fetchDay, now: Date.UTC(2026, 9, 14, 18, 10) });
  assert.equal(tracker.index(GID, '1,2,3'), 10.5);
});

test('after midnight, yesterday is closed with its final total read at 23:59:59', async () => {
  const tracker = createEnergyTracker({ file: memoryFile() });
  const endOf14 = Date.UTC(2026, 9, 15, 4) - 1000;
  const { calls, fetchDay } = fetcher((instant) =>
    instant === endOf14 ? day({ '1,2,3': 12 }) : day({ '1,2,3': instant < endOf14 ? 10 : 0.8 }),
  );
  await tracker.refresh({ devices, wanted, fetchDay, now: Date.UTC(2026, 9, 14, 18) });
  calls.length = 0;
  await tracker.refresh({ devices, wanted, fetchDay, now: Date.UTC(2026, 9, 15, 5) });
  assert.deepEqual(calls, ['2026-10-15T03:59:59.000Z', '2026-10-15T05:00:00.000Z']);
  assert.equal(tracker.index(GID, '1,2,3'), 12.8);
  assert.equal(tracker.today(GID, '1,2,3'), 0.8);
});

test('during the first 30 minutes of a day, today is not read (API lag)', async () => {
  const tracker = createEnergyTracker({ file: memoryFile() });
  const endOf14 = Date.UTC(2026, 9, 15, 4) - 1000;
  // Right after midnight the API still answers yesterday's 12 kWh for "today".
  const { calls, fetchDay } = fetcher((instant) => day({ '1,2,3': instant <= endOf14 ? 10 : 12 }));
  await tracker.refresh({ devices, wanted, fetchDay, now: Date.UTC(2026, 9, 14, 18) });
  calls.length = 0;
  await tracker.refresh({ devices, wanted, fetchDay, now: Date.UTC(2026, 9, 15, 4, 10) });
  assert.deepEqual(calls, ['2026-10-15T03:59:59.000Z']);
  assert.equal(tracker.index(GID, '1,2,3'), 10);
});

test('missed days are caught up one by one after a downtime', async () => {
  const tracker = createEnergyTracker({ file: memoryFile() });
  const finals = {
    '2026-10-15T03:59:59.000Z': 11,
    '2026-10-16T03:59:59.000Z': 20,
    '2026-10-17T03:59:59.000Z': 30,
  };
  const { calls, fetchDay } = fetcher((instant) => {
    const iso = new Date(instant).toISOString();
    return day({ '1,2,3': finals[iso] ?? (instant < Date.UTC(2026, 9, 15) ? 10 : 5) });
  });
  await tracker.refresh({ devices, wanted, fetchDay, now: Date.UTC(2026, 9, 14, 18) });
  calls.length = 0;
  await tracker.refresh({ devices, wanted, fetchDay, now: Date.UTC(2026, 9, 17, 16) });
  assert.equal(calls.length, 4);
  assert.equal(tracker.index(GID, '1,2,3'), 11 + 20 + 30 + 5);
});

test('a downtime longer than the catch-up window counts the last days only', async () => {
  const tracker = createEnergyTracker({ file: memoryFile() });
  const { calls, fetchDay } = fetcher(() => day({ '1,2,3': 1 }));
  await tracker.refresh({ devices, wanted, fetchDay, now: Date.UTC(2026, 0, 1, 18) });
  calls.length = 0;
  await tracker.refresh({ devices, wanted, fetchDay, now: Date.UTC(2026, 5, 1, 18) });
  assert.equal(calls.length, MAX_CATCH_UP_DAYS + 1);
});

test('a failed read leaves the indexes untouched, and a restart keeps them', async () => {
  const file = memoryFile();
  const tracker = createEnergyTracker({ file });
  await tracker.refresh({
    devices,
    wanted,
    fetchDay: async () => day({ '1,2,3': 7 }),
    now: Date.UTC(2026, 9, 14, 18),
  });
  await assert.rejects(
    tracker.refresh({
      devices,
      wanted,
      fetchDay: async () => {
        throw new Error('HTTP 503');
      },
      now: Date.UTC(2026, 9, 15, 18),
    }),
  );
  assert.equal(tracker.index(GID, '1,2,3'), 7);

  const restarted = createEnergyTracker({ file });
  await restarted.load();
  assert.equal(restarted.index(GID, '1,2,3'), 7);
});

test('a null reading is skipped', async () => {
  const tracker = createEnergyTracker({ file: memoryFile() });
  await tracker.refresh({
    devices,
    wanted,
    fetchDay: async () => day({ '1,2,3': null }),
    now: Date.UTC(2026, 9, 14, 18),
  });
  assert.equal(tracker.index(GID, '1,2,3'), null);
});
