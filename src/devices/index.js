// -----------------------------------------------------------------------------
// Registry of the device blueprints, and what they share: the Gladys device
// built from a layout, the states read from the latest Emporia snapshot, and
// the commands.
//
// A snapshot is what one polling cycle read:
//   { catalog: Map gid → device, usages: Map (1MIN), status, energy, config }
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { MAINS, usageOf, minuteKwhToWatts } from '../emporia/model.js';
import { monitor } from './monitor.js';
import { outlet } from './outlet.js';
import { charger, chargerStates, maxCurrent, MIN_CURRENT_A } from './charger.js';
import { TEXT } from '../i18n.js';

export const BLUEPRINTS = { monitor, outlet, charger };

// External id "type" per kind: ext:<selector>:<type>:<deviceGid>. Never change.
const ID_TYPE = { monitor: 'vue', outlet: 'outlet', charger: 'charger' };

/** deviceGid is the platform id Emporia gives every device: stable. */
export const idsOf = (gladys, device) =>
  gladys.externalIds(ID_TYPE[device.kind], String(device.gid));

/** The feature specs of a device, in the configured language. */
export function layoutOf(device, snapshot) {
  const { config } = snapshot;
  return BLUEPRINTS[device.kind].layout(device, snapshot.usages, config.language, config);
}

/** Display name: the one set in the Emporia app, else model and id. */
export const deviceName = (device) =>
  device.name ?? `Emporia ${device.model || ''} ${device.gid}`.replace(/\s+/g, ' ');

/**
 * The Gladys device of an Emporia device.
 * @param {object} gladys
 * @param {object} device parsed device
 * @param {object} snapshot
 */
export function buildDevice(gladys, device, snapshot) {
  const ids = idsOf(gladys, device);
  return {
    name: deviceName(device),
    external_id: ids.device,
    // Polled by the container's own timer (src/poller.js); the core's onPoll
    // stays a fallback, at the slowest pace Gladys schedules.
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params: [
      { name: 'MODEL', value: device.model || 'unknown' },
      { name: 'DEVICE_GID', value: String(device.gid) },
    ],
    features: layoutOf(device, snapshot).map((spec) => ({
      name: spec.name,
      external_id: ids.feature(spec.key),
      category: spec.category,
      type: spec.type,
      ...(spec.unit ? { unit: spec.unit } : {}),
      min: spec.min,
      max: spec.max,
      read_only: !spec.writable,
      has_feedback: Boolean(spec.writable),
      keep_history: true,
    })),
  };
}

/** Every device of the account that becomes a Gladys device. */
export const supportedDevices = (catalog) =>
  [...(catalog?.values() ?? [])].filter((device) => BLUEPRINTS[device.kind]);

/** Channels that get an energy index, for src/energy.js. */
export function indexChannels(device, snapshot) {
  return new Set(
    layoutOf(device, snapshot)
      .filter((spec) => spec.kind === 'index')
      .map((spec) => spec.num),
  );
}

/** Current outlet / charger object: the status, else the device list. */
const outletOf = (device, snapshot) => snapshot.status?.outlets.get(device.gid) ?? device.outlet;
const chargerOf = (device, snapshot) => snapshot.status?.chargers.get(device.gid) ?? device.charger;
const isOnline = (device, snapshot) =>
  snapshot.status?.connected.get(device.gid) ?? device.connected ?? true;

/** Value of one spec, or null when unknown. */
function valueOf(spec, device, snapshot) {
  switch (spec.kind) {
    case 'power': {
      if (device.kind === 'monitor') {
        return monitor.powerValue(spec, device.gid, snapshot.usages);
      }
      const kwh = usageOf(snapshot.usages, device.gid, MAINS);
      return kwh === null ? null : Math.abs(minuteKwhToWatts(kwh)) || 0;
    }
    case 'index':
      return snapshot.energy?.index(device.gid, spec.num) ?? null;
    case 'outlet-switch': {
      const current = outletOf(device, snapshot);
      return typeof current?.outletOn === 'boolean' ? Number(current.outletOn) : null;
    }
    case 'charger-switch': {
      const current = chargerOf(device, snapshot);
      return typeof current?.chargerOn === 'boolean' ? Number(current.chargerOn) : null;
    }
    case 'charger-current': {
      const rate = Number(chargerOf(device, snapshot)?.chargingRate);
      return Number.isFinite(rate) ? rate : null;
    }
    case 'charger-connector':
      return chargerStates(chargerOf(device, snapshot), isOnline(device, snapshot)).connector;
    case 'charger-state':
      return chargerStates(chargerOf(device, snapshot), isOnline(device, snapshot)).charging;
    default:
      return null;
  }
}

/**
 * The states of a device, ready for publishChangedStates.
 * @returns {Array<{ device_feature_external_id: string, state: number }>}
 */
export function statesOf(gladys, device, snapshot) {
  const ids = idsOf(gladys, device);
  return layoutOf(device, snapshot)
    .map((spec) => ({ id: ids.feature(spec.key), value: valueOf(spec, device, snapshot) }))
    .filter(({ value }) => typeof value === 'number' && Number.isFinite(value))
    .map(({ id, value }) => ({ device_feature_external_id: id, state: value }));
}

/** The Emporia device behind a Gladys device external id. */
export function findDevice(gladys, catalog, externalId) {
  return supportedDevices(catalog).find((device) => idsOf(gladys, device).device === externalId);
}

const refuse = (text, language) => new Error(text[language] ?? text.en);

/**
 * A command from Gladys. Resolves with the states to publish right away.
 * @param {object} options
 * @param {object} options.gladys
 * @param {object} options.api Emporia client
 * @param {object} options.device parsed device
 * @param {string} options.featureKey last part of the feature external id
 * @param {number} options.value
 * @param {object} options.snapshot
 */
export async function runCommand({ gladys, api, device, featureKey, value, snapshot }) {
  const { config } = snapshot;
  const ids = idsOf(gladys, device);
  if (device.kind === 'outlet' && featureKey === 'switch') {
    const current = outletOf(device, snapshot) ?? { deviceGid: device.gid, loadGid: 0 };
    const updated = await api.setOutlet(current, Number(value) === 1);
    const on = typeof updated?.outletOn === 'boolean' ? updated.outletOn : Number(value) === 1;
    snapshot.status?.outlets.set(device.gid, { ...current, ...(updated ?? {}), outletOn: on });
    return [{ device_feature_external_id: ids.feature('switch'), state: Number(on) }];
  }
  if (device.kind === 'charger' && (featureKey === 'switch' || featureKey === 'target-current')) {
    if (!config.charger_control) {
      throw refuse(TEXT.chargerControlDisabled, config.language);
    }
    const current = chargerOf(device, snapshot);
    if (!current) {
      throw refuse(TEXT.deviceUnknown, config.language);
    }
    const change =
      featureKey === 'switch'
        ? { on: Number(value) === 1 }
        : {
            rate: Math.min(maxCurrent(current), Math.max(MIN_CURRENT_A, Math.round(Number(value)))),
          };
    if (change.rate !== undefined && !Number.isFinite(change.rate)) {
      throw new Error(`Invalid current: ${value}`);
    }
    const updated = { ...current, ...((await api.setCharger(current, change)) ?? {}) };
    snapshot.status?.chargers.set(device.gid, updated);
    return [
      { device_feature_external_id: ids.feature('switch'), state: Number(updated.chargerOn) },
      {
        device_feature_external_id: ids.feature('target-current'),
        state: Number(updated.chargingRate),
      },
    ].filter((s) => Number.isFinite(s.state));
  }
  throw new Error(`Feature ${featureKey} of ${deviceName(device)} cannot be controlled`);
}
