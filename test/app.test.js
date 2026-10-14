// -----------------------------------------------------------------------------
// The whole integration against the SDK's fake Gladys and a fake Emporia
// cloud (fixtures): discovery, states, the container's own polling, logs,
// failures, connectivity, commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { CREDENTIALS, createWorld } from './helpers/world.js';
import { TEXT } from '../src/i18n.js';
import { SCENE_TRIGGER } from '../src/scenes.js';
import { CHARGING_STATE, CONNECTOR_STATUS } from '../src/devices/charger.js';

const w = (watts) => watts / 60000;

/** Sets the 1MIN usage of one channel in the fake's tree. */
function setMinuteUsage(fake, gid, num, watts) {
  const walk = (devices) => {
    for (const device of devices ?? []) {
      for (const channel of device.channelUsages ?? []) {
        if (channel.deviceGid === gid && channel.channelNum === num) {
          channel.usage = w(watts);
        }
        walk(channel.nestedDevices);
      }
    }
  };
  walk(fake.usage['1MIN'].deviceListUsages.devices);
}

test('discovery: one device per Vue, outlet and charger, with stable ids', async () => {
  const world = await createWorld({ addAll: false });
  try {
    const devices = world.gladys.fake.discoveredDevices;
    assert.deepEqual(
      devices.map((d) => d.external_id),
      [
        'ext:test-integration:vue:480001',
        'ext:test-integration:vue:480002',
        'ext:test-integration:outlet:480010',
        'ext:test-integration:charger:480020',
      ],
    );
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
    const vue = devices[0];
    const byKey = Object.fromEntries(vue.features.map((f) => [f.external_id.split(':').pop(), f]));
    // Solar Vue: the mains is a signed grid exchange, indexes from the grid channels.
    assert.equal(byKey['total-power'].category, 'grid-sensor');
    assert.equal(byKey['total-power'].min, -50000);
    assert.equal(byKey['total-index'], undefined);
    assert.equal(byKey['grid-import-index'].type, 'index');
    assert.equal(byKey['grid-export-index'].type, 'output-index');
    // Circuit 5 is Solar/Generation: production features.
    assert.equal(byKey['circuit-5-power'].category, 'energy-production-sensor');
    assert.equal(byKey['circuit-5-index'].category, 'energy-production-sensor');
    // Names from the Emporia app, French by default; same names get the number.
    assert.equal(byKey['circuit-2-power'].name, 'Dryer – puissance');
    assert.equal(byKey['circuit-8-power'].name, 'Circuit 8 – puissance');
    assert.equal(byKey['circuit-10-power'].name, 'Lights (10) – puissance');
    assert.equal(byKey['circuit-11-power'].name, 'Lights (11) – puissance');
    assert.equal(byKey['balance-power'].min, -50000);
    // Non-solar Vue: plain consumption.
    const garage = devices[1];
    assert.ok(garage.features.some((f) => f.external_id.endsWith(':total-index')));
    assert.equal(garage.features[0].category, 'energy-sensor');
    // Nothing read while no device is added (the discovery read only).
    assert.equal(world.fake.apiCalls('customers/devices/status').length, 0);
  } finally {
    await world.close();
  }
});

test('the states of the added devices: power, indexes, outlet, charger', async () => {
  const world = await createWorld();
  try {
    const last = (type, gid, key) => world.gladys.fake.lastState(world.feature(type, gid, key));
    assert.equal(last('vue', 480001, 'total-power'), 13650);
    assert.equal(last('vue', 480001, 'circuit-1-power'), 1200);
    assert.equal(last('vue', 480001, 'circuit-5-power'), 3100); // production, positive
    assert.equal(last('vue', 480001, 'circuit-5-index'), 9.6);
    assert.equal(last('vue', 480001, 'circuit-15-power'), undefined); // reading missing
    assert.equal(last('vue', 480001, 'grid-import-index'), 29);
    assert.equal(last('vue', 480001, 'grid-export-index'), 4.8);
    assert.equal(last('vue', 480002, 'total-power'), 1980);
    assert.equal(last('vue', 480002, 'total-index'), 4.4);
    assert.equal(last('outlet', 480010, 'switch'), 1);
    assert.equal(last('outlet', 480010, 'power'), 1380);
    assert.equal(last('outlet', 480010, 'index'), 0.42);
    assert.equal(last('charger', 480020, 'connector'), CONNECTOR_STATUS.OCCUPIED);
    assert.equal(last('charger', 480020, 'charging-state'), CHARGING_STATE.CHARGING);
    assert.equal(last('charger', 480020, 'target-current'), 32);
    assert.equal(last('charger', 480020, 'power'), 7680);
  } finally {
    await world.close();
  }
});

test('the states refresh on the container timer, without any onPoll', async () => {
  const world = await createWorld({ app: { timers: true, periodMs: 25 } });
  try {
    const id = world.feature('vue', 480001, 'circuit-1-power');
    setMinuteUsage(world.fake, 480001, '1', 2400);
    for (let i = 0; i < 100 && world.gladys.fake.lastState(id) !== 2400; i += 1) {
      await sleep(10);
    }
    assert.equal(world.gladys.fake.lastState(id), 2400);
    assert.ok(!world.gladys.fake.wsMessages.some((m) => m.type?.includes('poll')));
  } finally {
    await world.close();
  }
});

test('one minute = one usage request and one status request for the whole account', async () => {
  const world = await createWorld();
  try {
    world.fake.requests.length = 0;
    world.clock.now += 60000;
    await world.app.cycle();
    assert.equal(world.fake.apiCalls('AppAPI').length, 1);
    assert.equal(world.fake.apiCalls('customers/devices/status').length, 1);
    assert.equal(world.fake.cognitoCalls().length, 0);
    // The energy totals every 5 minutes.
    world.clock.now += 5 * 60000;
    await world.app.cycle();
    assert.equal(world.fake.apiCalls('AppAPI').length, 3);
  } finally {
    await world.close();
  }
});

test('only changed values are sent', async () => {
  const world = await createWorld();
  try {
    const before = world.gladys.fake.states.length;
    world.clock.now += 60000;
    await world.app.cycle();
    assert.equal(world.gladys.fake.states.length, before);
    setMinuteUsage(world.fake, 480010, '1,2,3', 10);
    world.clock.now += 60000;
    await world.app.cycle();
    assert.deepEqual(world.gladys.fake.states.slice(before), [
      { device_feature_external_id: world.feature('outlet', 480010, 'power'), state: 10 },
    ]);
  } finally {
    await world.close();
  }
});

test('the core onPoll is a fallback: skipped right after a timer cycle', async () => {
  const world = await createWorld();
  try {
    const [device] = world.gladys.fake.discoveredDevices;
    world.fake.requests.length = 0;
    assert.deepEqual(await world.gladys.fake.poll(device), { success: true });
    assert.equal(world.fake.apiCalls('AppAPI').length, 0);
    world.clock.now += 60000;
    await world.gladys.fake.poll(device);
    assert.equal(world.fake.apiCalls('AppAPI').length, 1);
  } finally {
    await world.close();
  }
});

test('a normal cycle writes nothing at info level, and no secret ever reaches the logs', async () => {
  const world = await createWorld();
  try {
    const startup = world.logger.lines.length;
    for (let i = 0; i < 6; i += 1) {
      world.clock.now += 60000;
      await world.app.cycle();
    }
    const noisy = world.logger.lines.slice(startup).filter((line) => line.level !== 'debug');
    assert.deepEqual(noisy, []);

    // A failure, a recovery and a command, to log a bit of everything.
    world.fake.down = true;
    await world.app.cycle();
    world.fake.down = false;
    await world.app.cycle();
    const outlet = world.gladys.fake.discoveredDevices[2];
    await world.gladys.fake.setValue(outlet, outlet.features[0], 0);

    const all = JSON.stringify(world.logger.lines);
    for (const secret of [CREDENTIALS.password, 'id-token-', 'refresh-token-', 'access-token-']) {
      assert.ok(!all.includes(secret), `"${secret}" found in the logs`);
    }
    assert.ok(!all.includes(CREDENTIALS.email), 'the account email is not logged');
  } finally {
    await world.close();
  }
});

test('a cloud outage: one warning, a status, then one line on recovery', async () => {
  const world = await createWorld();
  try {
    world.logger.lines.length = 0;
    world.fake.down = true;
    for (let i = 0; i < 3; i += 1) {
      world.clock.now += 60000;
      await world.app.cycle();
    }
    const warnings = world.logger.lines.filter((l) => l.level === 'warn');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].text, /Emporia cloud unreachable/);
    assert.deepEqual(world.gladys.fake.connectionStatus, {
      connected: false,
      message: TEXT.cloudUnreachable,
    });

    world.fake.down = false;
    world.clock.now += 60000;
    await world.app.cycle();
    assert.deepEqual(
      world.logger.lines.filter((l) => l.level === 'info').map((l) => l.text),
      ['Emporia cloud reachable again'],
    );
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  } finally {
    await world.close();
  }
});

test('a wrong password is reported, and never retried on its own', async () => {
  const world = await createWorld({ config: { password: 'wrong' }, addAll: false });
  try {
    assert.deepEqual(world.gladys.fake.connectionStatus, {
      connected: false,
      message: TEXT.accountRefused,
    });
    for (let i = 0; i < 5; i += 1) {
      world.clock.now += 60000;
      await world.app.cycle();
    }
    assert.equal(world.fake.cognitoCalls('RespondToAuthChallenge').length, 1);

    // The user fixes the password.
    await world.gladys.fake.configUpdated({ ...CREDENTIALS });
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
    assert.equal(world.gladys.fake.discoveredDevices.length, 4);
  } finally {
    await world.close();
  }
});

test('an MFA account gets its own message', async () => {
  const world = await createWorld({ emporia: { challenge: 'SMS_MFA' }, addAll: false });
  try {
    assert.deepEqual(world.gladys.fake.connectionStatus, {
      connected: false,
      message: TEXT.signInUnsupported,
    });
  } finally {
    await world.close();
  }
});

test('not configured: a message, and not a single request', async () => {
  const world = await createWorld({ config: { email: '', password: '' }, addAll: false });
  try {
    assert.deepEqual(world.gladys.fake.connectionStatus, {
      connected: false,
      message: TEXT.notConfigured,
    });
    await world.app.cycle();
    assert.equal(world.fake.requests.length, 0);
  } finally {
    await world.close();
  }
});

test('a device going offline and back: scene trigger, transport badge, two info lines', async () => {
  const world = await createWorld();
  try {
    world.logger.lines.length = 0;
    const entry = world.fake.status.devicesConnected.find((d) => d.deviceGid === 480002);
    entry.connected = false;
    world.clock.now += 60000;
    await world.app.cycle();
    entry.connected = true;
    world.clock.now += 60000;
    await world.app.cycle();

    const vue = 'ext:test-integration:vue:480002';
    assert.deepEqual(world.gladys.fake.sceneEvents, [
      {
        key: SCENE_TRIGGER.CONNECTION_CHANGED,
        data: { device: vue, status: 'offline', device_name: 'Garage' },
      },
      {
        key: SCENE_TRIGGER.CONNECTION_CHANGED,
        data: { device: vue, status: 'online', device_name: 'Garage' },
      },
    ]);
    assert.deepEqual(
      world.gladys.fake.transports
        .filter((t) => t.device_external_id === vue)
        .map((t) => t.transport),
      ['cloud', 'unreachable', 'cloud'],
    );
    assert.deepEqual(
      world.logger.lines.filter((l) => l.level === 'info').map((l) => l.text),
      ['Garage is offline (no data from Emporia)', 'Garage reaches the Emporia cloud again'],
    );
  } finally {
    await world.close();
  }
});

test('the outlet switches, and its state follows at once', async () => {
  const world = await createWorld();
  try {
    const outlet = world.gladys.fake.discoveredDevices[2];
    const ack = await world.gladys.fake.setValue(outlet, outlet.features[0], 0);
    assert.deepEqual(ack, { success: true });
    const [put] = world.fake.apiCalls('devices/outlet');
    assert.deepEqual(put.body, { deviceGid: 480010, outletOn: false, loadGid: 0 });
    assert.equal(world.gladys.fake.lastState(outlet.features[0].external_id), 0);
  } finally {
    await world.close();
  }
});

test('charger control is off by default: read-only features, command refused', async () => {
  const world = await createWorld();
  try {
    const charger = world.gladys.fake.discoveredDevices[3];
    const current = charger.features.find((f) => f.external_id.endsWith(':target-current'));
    assert.equal(current.read_only, true);
    const ack = await world.gladys.fake.setValue(charger, current, 16);
    assert.equal(ack.success, false);
    assert.match(ack.error, /désactivé/);
    assert.equal(world.fake.apiCalls('devices/evcharger').length, 0);
  } finally {
    await world.close();
  }
});

test('with charger control, the target current is set within 6 A and the charger maximum', async () => {
  const world = await createWorld({ config: { charger_control: true } });
  try {
    const charger = world.gladys.fake.discoveredDevices[3];
    const current = charger.features.find((f) => f.external_id.endsWith(':target-current'));
    assert.equal(current.read_only, false);
    assert.equal(current.max, 40);
    await world.gladys.fake.setValue(charger, current, 60);
    const [put] = world.fake.apiCalls('devices/evcharger');
    assert.equal(put.body.chargingRate, 40);
    assert.equal(put.body.chargerOn, true);
    assert.equal(world.gladys.fake.lastState(current.external_id), 40);

    const toggle = charger.features.find((f) => f.external_id.endsWith(':switch'));
    await world.gladys.fake.setValue(charger, toggle, 0);
    assert.equal(world.fake.apiCalls('devices/evcharger')[1].body.chargerOn, false);
    assert.equal(world.gladys.fake.lastState(toggle.external_id), 0);
  } finally {
    await world.close();
  }
});

test('adding a device sends its states again and nudges the widget', async () => {
  const world = await createWorld();
  try {
    const vue = world.gladys.fake.discoveredDevices[1];
    const before = world.gladys.fake.states.length;
    await world.gladys.fake.deviceUpdated(vue);
    const resent = world.gladys.fake.states.slice(before).map((s) => s.device_feature_external_id);
    assert.ok(resent.includes(world.feature('vue', 480002, 'total-power')));
    assert.ok(world.gladys.fake.widgetRefreshes.includes('power_overview'));
  } finally {
    await world.close();
  }
});

test('the search action lists the account devices in four languages', async () => {
  const world = await createWorld({ addAll: false });
  try {
    const ack = await world.gladys.fake.action('list_devices');
    assert.equal(ack.success, true);
    assert.equal(
      ack.data.message.fr,
      '4 appareil(s) Emporia : Maison (Vue, 16 circuit(s)), Garage (Vue, 4 circuit(s)), ' +
        'Bouilloire (prise), Borne (borne).',
    );
    assert.ok(ack.data.message.de.startsWith('4 Emporia-Gerät(e)'));
  } finally {
    await world.close();
  }
});

test('the daily summary scene action', async () => {
  const world = await createWorld();
  try {
    const ack = await world.gladys.fake.sceneAction('get_daily_summary', {
      device: 'ext:test-integration:vue:480001',
    });
    assert.deepEqual(ack.data.outputs, {
      energy_today_kwh: 29,
      production_today_kwh: 9.6,
      top_circuit: 'A/C',
      top_circuit_kwh: 5,
      power_w: 13650,
    });
    const unknown = await world.gladys.fake.sceneAction('get_daily_summary', {
      device: 'ext:test-integration:vue:1',
    });
    assert.equal(unknown.success, false);
  } finally {
    await world.close();
  }
});
