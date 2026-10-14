// -----------------------------------------------------------------------------
// Emporia smart outlet: on/off, power, energy index.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { MAINS } from '../emporia/model.js';
import { featureName } from '../i18n.js';
import { INDEX_MAX_KWH } from './monitor.js';

// A 15 A plug at 120 V is 1.8 kW; Emporia also sells 240 V models abroad.
const OUTLET_MAX_W = 3700;

export const outlet = {
  kind: 'outlet',

  layout(_device, _usages, language) {
    return [
      {
        key: 'switch',
        kind: 'outlet-switch',
        category: CAT.SWITCH,
        type: TYPE.SWITCH.BINARY,
        min: 0,
        max: 1,
        writable: true,
        name: featureName(language, 'outletSwitch'),
      },
      {
        key: 'power',
        kind: 'power',
        num: MAINS,
        category: CAT.SWITCH,
        type: TYPE.SWITCH.POWER,
        unit: UNIT.WATT,
        min: 0,
        max: OUTLET_MAX_W,
        name: featureName(language, 'outletPower'),
      },
      {
        key: 'index',
        kind: 'index',
        num: MAINS,
        category: CAT.SWITCH,
        type: TYPE.SWITCH.ENERGY,
        unit: UNIT.KILOWATT_HOUR,
        min: 0,
        max: INDEX_MAX_KWH,
        name: featureName(language, 'outletIndex'),
      },
    ];
  },
};
