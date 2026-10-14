// -----------------------------------------------------------------------------
// Scene trigger and scene action (Gladys 5.1+).
//
// Trigger "device_connection_changed": an Emporia device lost (or found back)
// its link to the Emporia cloud. Nothing else in Gladys says it: the power
// features just stop moving. A Vue offline means the monitoring is blind.
//
// Action "get_daily_summary": today's energy of a device so far, its biggest
// circuit and its current power, as outputs for the next steps of a scene (an
// evening message "23.4 kWh today, Dryer first with 5.1 kWh"). Gladys keeps
// 30-minute consumptions, but a scene cannot add them up nor rank circuits.
// -----------------------------------------------------------------------------

import { GRID_IMPORT, MAINS, minuteKwhToWatts, usageOf } from './emporia/model.js';
import { findDevice, layoutOf } from './devices/index.js';
import { TEXT } from './i18n.js';

export const SCENE_TRIGGER = { CONNECTION_CHANGED: 'device_connection_changed' };
export const SCENE_TRIGGER_KEYS = Object.values(SCENE_TRIGGER);
export const SCENE_ACTION = { DAILY_SUMMARY: 'get_daily_summary' };

const round3 = (value) => Math.round(value * 1000) / 1000;

/**
 * Outputs of get_daily_summary.
 * @param {object} options
 * @param {object} options.gladys
 * @param {object} options.snapshot
 * @param {string} options.deviceExternalId the device chosen in the scene
 */
export function dailySummary({ gladys, snapshot, deviceExternalId }) {
  const { config } = snapshot;
  const device = findDevice(gladys, snapshot.catalog, deviceExternalId);
  if (!device) {
    throw new Error(TEXT.deviceUnknown[config.language] ?? TEXT.deviceUnknown.en);
  }
  const energy = snapshot.energy;
  const today = (num) => energy?.today(device.gid, num) ?? null;
  const specs = layoutOf(device, snapshot);

  // Energy taken from the grid: the mains, or its import half on a solar Vue.
  const consumed = specs.some((spec) => spec.num === GRID_IMPORT)
    ? today(GRID_IMPORT)
    : today(MAINS);
  const produced = specs
    .filter((spec) => spec.kind === 'index' && spec.production)
    .reduce((sum, spec) => sum + (today(spec.num) ?? 0), 0);
  const circuits = specs
    .filter((spec) => spec.kind === 'index' && spec.circuit && !spec.production)
    .map((spec) => ({ name: spec.circuit, kwh: today(spec.num) }))
    .filter((circuit) => circuit.kwh !== null)
    .sort((a, b) => b.kwh - a.kwh);
  const mainsKwh = usageOf(snapshot.usages, device.gid, MAINS);

  return {
    energy_today_kwh: consumed === null ? 0 : round3(consumed),
    production_today_kwh: round3(produced),
    top_circuit: circuits[0]?.name ?? '',
    top_circuit_kwh: circuits[0] ? round3(circuits[0].kwh) : 0,
    power_w: mainsKwh === null ? 0 : minuteKwhToWatts(mainsKwh),
  };
}
