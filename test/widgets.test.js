import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createWorld } from './helpers/world.js';
import { TEXT } from '../src/i18n.js';

const get = (world, settings = {}, language = 'fr') =>
  world.gladys.fake.widgetGet('power_overview', { settings, language });

test('the power widget: total, solar, and the five circuits drawing the most', async () => {
  const world = await createWorld();
  try {
    const ack = await get(world, { device: 'ext:test-integration:vue:480001' });
    assert.equal(ack.success, true);
    const content = ack.data.content;
    assert.deepEqual(validateWidgetContent(content), []);

    const [total, solar, status] = content.components;
    assert.equal(total.device_feature, 'ext:test-integration:vue:480001:total-power');
    assert.equal(total.label, 'Réseau'); // solar Vue: the mains is the grid exchange
    assert.equal(solar.value, 3100);
    assert.deepEqual(
      status.items.map((item) => item.label),
      ['A/C', 'Heat pump', 'Kitchen', 'Furnace', 'Office'],
    );
    // No share of a net grid exchange.
    assert.equal(status.items[0].value, '2 300 W');

    // Every bound feature exists on the discovered devices.
    const features = new Set(
      world.gladys.fake.discoveredDevices.flatMap((d) => d.features.map((f) => f.external_id)),
    );
    for (const component of content.components.filter((c) => c.device_feature)) {
      assert.ok(features.has(component.device_feature), component.device_feature);
    }
  } finally {
    await world.close();
  }
});

test('on a Vue without solar, each circuit shows its share of the total', async () => {
  const world = await createWorld();
  try {
    const ack = await get(world, { device: 'ext:test-integration:vue:480002' }, 'en');
    const content = ack.data.content;
    assert.deepEqual(validateWidgetContent(content), []);
    assert.equal(content.components[0].label, 'Total');
    assert.equal(content.components[1].items[0].label, 'Compressor');
    assert.equal(content.components[1].items[0].value, '1,200 W · 61 %');
  } finally {
    await world.close();
  }
});

test('without settings, the first Vue; an outlet or an unknown device asks for a Vue', async () => {
  const world = await createWorld();
  try {
    const first = await get(world, {}, 'de');
    assert.equal(first.data.content.components[0].device_feature.split(':')[3], '480001');
    const outlet = await get(world, { device: 'ext:test-integration:outlet:480010' }, 'es');
    assert.deepEqual(outlet.data.content.components, [
      { type: 'text', variant: 'body', text: TEXT.widgetPickVue.es },
    ]);
  } finally {
    await world.close();
  }
});

test('not configured: the widget says so', async () => {
  const world = await createWorld({ config: { email: '' }, addAll: false });
  try {
    const ack = await get(world, {}, 'en');
    assert.equal(ack.data.content.components[0].text, TEXT.notConfigured.en);
  } finally {
    await world.close();
  }
});
