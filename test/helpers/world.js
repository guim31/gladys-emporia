// -----------------------------------------------------------------------------
// A whole integration under test: the app, the SDK's fake Gladys, the fake
// Emporia cloud, a temporary /data and a logger that records every line.
// -----------------------------------------------------------------------------

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../../src/app.js';
import { createFakeEmporia } from './fakeEmporia.js';

export const CREDENTIALS = {
  email: 'user@example.com',
  password: 'correct horse battery staple',
};

export function recordingLogger() {
  const lines = [];
  const log =
    (level) =>
    (...args) =>
      lines.push({
        level,
        text: args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '),
      });
  return {
    lines,
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child: () => recordingLogger(),
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.config] Gladys configuration of the integration
 * @param {boolean} [options.addAll] the user adds every discovered device
 * @param {object} [options.emporia] options of the fake Emporia
 * @param {object} [options.app] extra createApp options
 * @param {(fake: object) => void} [options.prepare] edits the fake account before connecting
 */
export async function createWorld({
  config = {},
  addAll = true,
  emporia = {},
  app: appOptions = {},
  prepare = () => {},
} = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'emporia-test-'));
  const fake = createFakeEmporia(emporia);
  prepare(fake);
  const gladys = createFakeGladys({ config: { ...CREDENTIALS, ...config } });
  const logger = recordingLogger();
  // 18:15 UTC = 14:15 in Toronto, the time zone of the fixtures: mid-day.
  const clock = { now: Date.UTC(2026, 9, 14, 18, 15) };
  const app = createApp({
    gladys,
    fetch: fake.fetch,
    dataDir,
    timers: false,
    logger,
    now: () => clock.now,
    ...appOptions,
  });
  await gladys.connect();
  if (addAll) {
    for (const device of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(device);
    }
  }
  return {
    gladys,
    fake,
    app,
    logger,
    dataDir,
    clock,
    /** Feature external id of a device by gid. */
    feature: (type, gid, key) => `ext:test-integration:${type}:${gid}:${key}`,
    async close() {
      app.stop();
      await gladys.disconnect();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
