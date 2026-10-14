// -----------------------------------------------------------------------------
// Probe of the real Emporia services, read-only, from a machine with network
// access (the coding sessions cannot reach them).
//
//   node scripts/probe.mjs
//     Signs in with a made-up account: Cognito must refuse it cleanly
//     (NotAuthorizedException or UserNotFoundException). Proves the endpoint,
//     the app client id and the SRP exchange format.
//
//   EMPORIA_EMAIL=... EMPORIA_PASSWORD=... node scripts/probe.mjs
//     Also signs in with a real account and reads it: device list, one 1MIN
//     and one 1D usage, status. Prints counts and shapes only: no name, no id,
//     no token, no email. Sends no command.
//
// Exit code 0 when every step behaved as expected, 1 otherwise.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { CognitoError, signIn } from '../src/emporia/cognito.js';
import { createEmporiaClient } from '../src/emporia/api.js';
import {
  GRID_EXPORT,
  GRID_IMPORT,
  parseDevices,
  parseStatus,
  parseUsage,
} from '../src/emporia/model.js';

let failures = 0;
const ok = (message) => console.log(`OK   ${message}`);
const fail = (message) => {
  failures += 1;
  console.log(`FAIL ${message}`);
};

// 1. A fake account must be refused, cleanly.
const fakeEmail = `probe-${randomBytes(6).toString('hex')}@example.invalid`;
try {
  await signIn({ email: fakeEmail, password: randomBytes(12).toString('base64') });
  fail('Cognito accepted a made-up account');
} catch (err) {
  if (err instanceof CognitoError && err.isAccountError) {
    ok(`Cognito refused the made-up account cleanly (${err.type})`);
  } else {
    fail(`unexpected error for the made-up account: ${err.message}`);
  }
}

// 2. A real account, when given.
const email = process.env.EMPORIA_EMAIL;
const password = process.env.EMPORIA_PASSWORD;
if (!email || !password) {
  console.log('SKIP real account (set EMPORIA_EMAIL and EMPORIA_PASSWORD to read one)');
} else {
  let session = null;
  const api = createEmporiaClient({
    sessionFile: { read: async () => session, write: async (value) => (session = value) },
  });
  api.setCredentials({ email, password });
  try {
    await api.connect();
    ok('signed in with SRP, tokens received');

    const devices = parseDevices(await api.getDevices());
    const kinds = {};
    for (const device of devices.values()) {
      const key = `${device.kind ?? 'unsupported'}:${device.model || '?'}`;
      kinds[key] = (kinds[key] ?? 0) + 1;
    }
    ok(`device list: ${devices.size} device(s) ${JSON.stringify(kinds)}`);
    for (const device of devices.values()) {
      if (device.kind === 'monitor') {
        const circuits = device.channels.filter((c) => /^\d+$/.test(c.num));
        console.log(
          `     monitor ${device.model}: ${circuits.length} circuit(s), ` +
            `${circuits.filter((c) => c.name).length} named, ` +
            `solar=${device.solar}, types=${JSON.stringify([...new Set(circuits.map((c) => c.typeGid))])}, ` +
            `time zone ${device.timeZone ? 'set' : 'missing'}`,
        );
      }
    }

    const gids = [...devices.values()].filter((d) => d.kind).map((d) => d.gid);
    for (const scale of ['1MIN', '1D']) {
      const usages = parseUsage(await api.getUsage(gids, Date.now(), scale));
      const values = [...usages.entries()];
      const special = values.filter(([id]) => id.endsWith(GRID_IMPORT) || id.endsWith(GRID_EXPORT));
      ok(
        `usage ${scale}: ${values.length} channel(s), ` +
          `${values.filter(([, v]) => v.usage === null).length} null, ` +
          `${values.filter(([, v]) => v.usage < 0).length} negative, ` +
          `${special.length} grid import/export channel(s), ` +
          `${new Set(values.map(([id]) => id.split('|')[0])).size} device(s) in the tree`,
      );
    }

    const status = parseStatus(await api.getStatus());
    ok(
      `status: ${status.outlets.size} outlet(s), ${status.chargers.size} charger(s), ` +
        `${[...status.connected.values()].filter((c) => !c).length} offline device(s)`,
    );
    for (const charger of status.chargers.values()) {
      console.log(
        `     charger: status="${charger.status}" message="${charger.message}" ` +
          `rate=${charger.chargingRate}/${charger.maxChargingRate} A`,
      );
    }
  } catch (err) {
    fail(`real account: ${err.message}`);
  }
}

process.exitCode = failures === 0 ? 0 : 1;
