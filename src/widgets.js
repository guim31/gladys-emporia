// -----------------------------------------------------------------------------
// Dashboard widget "power_overview" (Gladys 5.1+): the total power of a Vue,
// its solar production when it has some, and the circuits drawing the most
// right now. Pure builder: index.js / app.js hand it the latest snapshot.
//
// Budget of the core: 8 components, 6 tiles, 1 status list, 2 texts. The total
// tile is bound to its device feature, so it follows the live states; the
// ranking needs the integration and refreshes with the content (60 s).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { TEXT } from './i18n.js';
import { idsOf, layoutOf } from './devices/index.js';
import { usageOf, minuteKwhToWatts } from './emporia/model.js';

export const WIDGET = { POWER_OVERVIEW: 'power_overview' };
export const TOP_CIRCUITS = 5;

const text = (key, language) => TEXT[key][language] ?? TEXT[key].en;
const watts = (value, language) =>
  `${new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(value)} W`;

/**
 * The circuits of a Vue by current power, highest first.
 * @returns {Array<{ name: string, watts: number }>}
 */
export function rankCircuits(device, snapshot) {
  return layoutOf(device, snapshot)
    .filter((spec) => spec.kind === 'power' && spec.circuit && !spec.production && !spec.signed)
    .map((spec) => {
      const kwh = usageOf(snapshot.usages, device.gid, spec.num);
      return { name: spec.circuit, watts: kwh === null ? null : Math.abs(minuteKwhToWatts(kwh)) };
    })
    .filter((circuit) => circuit.watts !== null)
    .sort((a, b) => b.watts - a.watts);
}

/** Simple contents: a sentence. */
export const messageContent = (message, language) => ({
  ttl_seconds: 60,
  components: [{ type: 'text', variant: 'body', text: message[language] ?? message.en }],
});

/**
 * @param {object} options
 * @param {object} options.gladys
 * @param {object} options.device the Vue (parsed device)
 * @param {object} options.snapshot
 * @param {string} options.language
 */
export function buildPowerOverview({ gladys, device, snapshot, language }) {
  const ids = idsOf(gladys, device);
  const specs = layoutOf(device, snapshot);
  const total = specs.find((spec) => spec.key === 'total-power');
  const totalWatts = usageOf(snapshot.usages, device.gid, total.num);
  if (totalWatts === null) {
    return messageContent(TEXT.widgetNoData, language);
  }
  const components = [
    {
      type: 'value',
      label: text(total.signed ? 'widgetGrid' : 'widgetTotal', language),
      icon: 'zap',
      device_feature: ids.feature(total.key),
    },
  ];

  const production = specs
    .filter((spec) => spec.kind === 'power' && spec.production)
    .map((spec) => usageOf(snapshot.usages, device.gid, spec.num))
    .filter((kwh) => kwh !== null);
  if (production.length > 0) {
    components.push({
      type: 'value',
      label: text('widgetSolar', language),
      icon: 'sun',
      value: production.reduce((sum, kwh) => sum + Math.abs(minuteKwhToWatts(kwh)), 0),
      unit: 'W',
      color: WIDGET_COLORS.SUCCESS,
    });
  }

  const circuits = rankCircuits(device, snapshot).filter((c) => c.watts > 0);
  if (circuits.length === 0) {
    components.push({ type: 'text', variant: 'caption', text: text('widgetAllIdle', language) });
  } else {
    // On a solar Vue the mains is a net exchange: a share of it means nothing.
    const reference = total.signed ? 0 : minuteKwhToWatts(totalWatts);
    components.push({
      type: 'status',
      items: circuits.slice(0, TOP_CIRCUITS).map((circuit, rank) => {
        const share = reference > 0 ? Math.round((circuit.watts / reference) * 100) : null;
        return {
          label: circuit.name.slice(0, 40),
          value:
            share === null
              ? watts(circuit.watts, language)
              : `${watts(circuit.watts, language)} · ${share} %`,
          icon: 'zap',
          color: rank === 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
        };
      }),
    });
  }
  return { ttl_seconds: 60, components };
}
