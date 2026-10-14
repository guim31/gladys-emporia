// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (a solar Vue 3 with 16 circuits, a Vue 2 on a sub-panel, an
// outlet, a charger), also without solar, with charger control, and in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

/** The same account without solar: no generation circuit, no grid channels. */
function withoutSolar(fake) {
  const [vue] = fake.devices.devices;
  vue.locationProperties.solar = false;
  for (const channel of vue.devices[0].channels) {
    channel.channelTypeGid = channel.channelTypeGid === 13 ? 1 : channel.channelTypeGid;
    channel.type = 'FiftyAmp';
  }
  for (const scale of ['1MIN', '1D']) {
    const [tree] = fake.usage[scale].deviceListUsages.devices;
    tree.channelUsages = tree.channelUsages.filter((c) => !c.channelNum.startsWith('Mains'));
  }
}

const scenarios = [
  { label: 'solar account, French names', config: {} },
  { label: 'without solar', config: {}, prepare: withoutSolar },
  { label: 'charger control allowed', config: { charger_control: true } },
  { label: 'English names', config: { language: 'en' } },
  { label: 'German names', config: { language: 'de' } },
  { label: 'Spanish names', config: { language: 'es' } },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const world = await createWorld({ config: scenario.config, prepare: scenario.prepare });
    try {
      const devices = world.gladys.fake.discoveredDevices;
      assert.equal(devices.length, 4, 'two Vues, an outlet and a charger');

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await world.close();
    }
  });
}

test('every published state fits the bounds of its feature', async () => {
  for (const prepare of [undefined, withoutSolar]) {
    const world = await createWorld({ prepare });
    try {
      const features = new Map(
        world.gladys.fake.discoveredDevices
          .flatMap((d) => d.features)
          .map((f) => [f.external_id, f]),
      );
      assert.ok(world.gladys.fake.states.length > 40);
      for (const { device_feature_external_id: id, state } of world.gladys.fake.states) {
        const feature = features.get(id);
        assert.ok(feature, `${id}: state of an unknown feature`);
        assert.ok(state >= feature.min && state <= feature.max, `${id}: ${state} out of bounds`);
      }
    } finally {
      await world.close();
    }
  }
});

test('the indexes are the cumulative types the core turns into energy tracking', async () => {
  const world = await createWorld({ prepare: withoutSolar });
  try {
    const indexes = world.gladys.fake.discoveredDevices
      .flatMap((d) => d.features)
      .filter((f) => f.unit === 'kilowatt-hour');
    // ENERGY_INDEX_FEATURE_TYPES and PRODUCTION_INDEX_FEATURE_TYPES of Gladys 5.1+.
    const tracked = ['energy-sensor/index', 'switch/energy', 'energy-production-sensor/index'];
    for (const feature of indexes) {
      assert.ok(tracked.includes(`${feature.category}/${feature.type}`), feature.name);
    }
    assert.equal(indexes.length, 1 + 16 + 1 + 4 + 1 + 1); // Vue 3, Vue 2, outlet, charger
  } finally {
    await world.close();
  }
});
