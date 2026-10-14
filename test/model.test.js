import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  minuteKwhToWatts,
  parseDevices,
  parseStatus,
  parseUsage,
  usageChannels,
  usageOf,
} from '../src/emporia/model.js';
import { fixture } from './helpers/fakeEmporia.js';

test('the device list merges a Vue and its circuits sub-device', () => {
  const devices = parseDevices(fixture('customers-devices.json'));
  assert.deepEqual([...devices.keys()], [480001, 480002, 480010, 480020]);
  const vue = devices.get(480001);
  assert.equal(vue.kind, 'monitor');
  assert.equal(vue.name, 'Maison');
  assert.equal(vue.model, 'VUE003');
  assert.equal(vue.timeZone, 'America/Toronto');
  assert.equal(vue.solar, true);
  assert.equal(vue.channels.length, 17); // "1,2,3" + 16 circuits
  assert.equal(vue.channels.find((c) => c.num === '5').typeGid, 13);
  assert.equal(vue.channels.find((c) => c.num === '5').bidirectional, true);
  assert.equal(vue.channels.find((c) => c.num === '8').name, null);
  assert.equal(devices.get(480010).kind, 'outlet');
  assert.equal(devices.get(480020).kind, 'charger');
});

test('the usage tree is flattened, nested devices included', () => {
  const usages = parseUsage(fixture('usage-1min.json'));
  assert.equal(minuteKwhToWatts(usageOf(usages, 480001, '1,2,3')), 13650);
  assert.equal(minuteKwhToWatts(usageOf(usages, 480010, '1,2,3')), 1380); // outlet on circuit 3
  assert.equal(minuteKwhToWatts(usageOf(usages, 480020, '1,2,3')), 7680); // charger on the mains
  assert.equal(minuteKwhToWatts(usageOf(usages, 480002, '2')), 1200); // Vue on circuit 16
  assert.equal(usageOf(usages, 480001, '15'), null); // missing reading
  assert.equal(usageOf(usages, 480001, '99'), null);
  assert.ok(usageChannels(usages, 480001).includes('MainsToGrid'));
});

test('the status gives outlets, chargers and connectivity', () => {
  const status = parseStatus(fixture('status.json'));
  assert.equal(status.outlets.get(480010).outletOn, true);
  assert.equal(status.chargers.get(480020).chargingRate, 32);
  assert.equal(status.connected.get(480002), true);
});

test('empty or odd payloads give empty results', () => {
  assert.equal(parseDevices(null).size, 0);
  assert.equal(parseDevices({ devices: [null, { deviceGid: 'x' }] }).size, 0);
  assert.equal(parseUsage({}).size, 0);
  assert.equal(parseStatus(undefined).outlets.size, 0);
  // A device without channel, outlet nor charger (a battery...) is not supported.
  assert.equal(parseDevices({ devices: [{ deviceGid: 7, model: 'BAT001' }] }).get(7).kind, null);
});
