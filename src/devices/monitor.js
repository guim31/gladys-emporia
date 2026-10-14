// -----------------------------------------------------------------------------
// Emporia Vue energy monitor (Vue 2, Vue 3, and the Vue Utility Connect, which
// reports a mains channel only): one Gladys device per Vue.
//
//   - mains "1,2,3": total power and total index. On a solar installation the
//     mains is the NET exchange with the grid (negative while exporting): it
//     becomes a signed grid-sensor/power, and the indexes come from the
//     MainsFromGrid / MainsToGrid channels the API adds for such a Vue;
//   - circuits "1".."16": power and index each, named as in the Emporia app.
//     A circuit of type Solar/Generation is a production (positive power,
//     production index); a bidirectional circuit (a battery...) keeps its sign
//     and gets no index, since its daily total can be negative;
//   - "Balance": what the circuits do not see (mains minus circuits), signed.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import {
  BALANCE,
  GRID_EXPORT,
  GRID_IMPORT,
  MAINS,
  SOLAR_CHANNEL_TYPE,
  minuteKwhToWatts,
  usageChannels,
  usageOf,
} from '../emporia/model.js';
import { featureName } from '../i18n.js';

// Display bounds (the gauge reads them, Gladys never enforces them): a
// 200 A service at 240 V is 48 kW, a 100 A sub-panel feed 24 kW.
export const MAINS_MAX_W = 50000;
export const CIRCUIT_MAX_W = 25000;
export const INDEX_MAX_KWH = 10000000;

const isCircuit = (num) => /^\d+$/.test(num);

/** A Vue on a solar installation: its mains is a net grid exchange. */
export function isSolarVue(device, usages) {
  return (
    device.solar ||
    device.channels.some((c) => c.typeGid === SOLAR_CHANNEL_TYPE) ||
    usageChannels(usages, device.gid).some((num) => num === GRID_IMPORT || num === GRID_EXPORT)
  );
}

/**
 * The features of a Vue, as specs: key, Gladys couple, and how to read it.
 * @param {object} device parsed device (src/emporia/model.js)
 * @param {Map} usages last 1MIN usage (special channels show up there only)
 * @param {string} language
 */
export function layout(device, usages, language) {
  const solar = isSolarVue(device, usages);
  const reported = new Set(usageChannels(usages, device.gid));
  const specs = [];
  const power = (spec) => ({ unit: UNIT.WATT, kind: 'power', ...spec });
  const index = (spec) => ({
    unit: UNIT.KILOWATT_HOUR,
    kind: 'index',
    min: 0,
    max: INDEX_MAX_KWH,
    ...spec,
  });

  if (solar) {
    specs.push(
      power({
        key: 'total-power',
        num: MAINS,
        category: CAT.GRID_SENSOR,
        type: TYPE.GRID_SENSOR.POWER,
        min: -MAINS_MAX_W,
        max: MAINS_MAX_W,
        signed: true,
        name: featureName(language, 'gridPower'),
      }),
    );
    if (reported.has(GRID_IMPORT)) {
      specs.push(
        index({
          key: 'grid-import-index',
          num: GRID_IMPORT,
          category: CAT.ENERGY_SENSOR,
          type: TYPE.ENERGY_SENSOR.INDEX,
          name: featureName(language, 'gridImportIndex'),
        }),
      );
    }
    if (reported.has(GRID_EXPORT)) {
      specs.push(
        index({
          key: 'grid-export-index',
          num: GRID_EXPORT,
          category: CAT.GRID_SENSOR,
          type: TYPE.GRID_SENSOR.OUTPUT_INDEX,
          name: featureName(language, 'gridExportIndex'),
        }),
      );
    }
  } else {
    specs.push(
      power({
        key: 'total-power',
        num: MAINS,
        category: CAT.ENERGY_SENSOR,
        type: TYPE.ENERGY_SENSOR.POWER,
        min: 0,
        max: MAINS_MAX_W,
        name: featureName(language, 'totalPower'),
      }),
      index({
        key: 'total-index',
        num: MAINS,
        category: CAT.ENERGY_SENSOR,
        type: TYPE.ENERGY_SENSOR.INDEX,
        name: featureName(language, 'totalIndex'),
      }),
    );
  }

  // Circuits, in their number order; two circuits named alike get their number.
  const circuits = device.channels
    .filter((c) => isCircuit(c.num))
    .sort((a, b) => Number(a.num) - Number(b.num));
  const nameCount = new Map();
  for (const c of circuits) {
    if (c.name) {
      nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);
    }
  }
  for (const c of circuits) {
    let label = c.name ?? featureName(language, 'circuit', { n: c.num });
    if (c.name && nameCount.get(c.name) > 1) {
      label = `${c.name} (${c.num})`;
    }
    const base = { num: c.num, circuit: label };
    if (c.typeGid === SOLAR_CHANNEL_TYPE) {
      specs.push(
        power({
          ...base,
          key: `circuit-${c.num}-power`,
          category: CAT.ENERGY_PRODUCTION_SENSOR,
          type: TYPE.ENERGY_PRODUCTION_SENSOR.POWER,
          min: 0,
          max: CIRCUIT_MAX_W,
          production: true,
          name: featureName(language, 'productionPower', { name: label }),
        }),
        index({
          ...base,
          key: `circuit-${c.num}-index`,
          category: CAT.ENERGY_PRODUCTION_SENSOR,
          type: TYPE.ENERGY_PRODUCTION_SENSOR.INDEX,
          production: true,
          name: featureName(language, 'productionIndex', { name: label }),
        }),
      );
    } else if (c.bidirectional) {
      specs.push(
        power({
          ...base,
          key: `circuit-${c.num}-power`,
          category: CAT.ENERGY_SENSOR,
          type: TYPE.ENERGY_SENSOR.POWER,
          min: -CIRCUIT_MAX_W,
          max: CIRCUIT_MAX_W,
          signed: true,
          name: featureName(language, 'circuitPower', { name: label }),
        }),
      );
    } else {
      specs.push(
        power({
          ...base,
          key: `circuit-${c.num}-power`,
          category: CAT.ENERGY_SENSOR,
          type: TYPE.ENERGY_SENSOR.POWER,
          min: 0,
          max: CIRCUIT_MAX_W,
          name: featureName(language, 'circuitPower', { name: label }),
        }),
        index({
          ...base,
          key: `circuit-${c.num}-index`,
          category: CAT.ENERGY_SENSOR,
          type: TYPE.ENERGY_SENSOR.INDEX,
          name: featureName(language, 'circuitIndex', { name: label }),
        }),
      );
    }
  }

  if (circuits.length > 0 && reported.has(BALANCE)) {
    specs.push(
      power({
        key: 'balance-power',
        num: BALANCE,
        category: CAT.ENERGY_SENSOR,
        type: TYPE.ENERGY_SENSOR.POWER,
        min: -MAINS_MAX_W,
        max: MAINS_MAX_W,
        signed: true,
        name: featureName(language, 'balancePower'),
      }),
    );
  }
  return specs;
}

/**
 * Value of a power spec in W from the 1MIN usage, or null.
 * Emporia reports generation as negative: a production is published positive,
 * a plain circuit as its absolute value (as the HACS integration does), and
 * the mains of a solar Vue, the bidirectional circuits and the balance keep
 * their sign (negative = energy going back to the grid).
 */
export function powerValue(spec, gid, usages) {
  const kwh = usageOf(usages, gid, spec.num);
  if (kwh === null) {
    return null;
  }
  const watts = minuteKwhToWatts(kwh);
  return spec.signed ? watts : Math.abs(watts) || 0;
}

export const monitor = {
  kind: 'monitor',
  layout,
  powerValue,
};
