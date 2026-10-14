// -----------------------------------------------------------------------------
// Emporia EV charger (EVSE): connector and charging state, power, energy
// index, and the charger switch and target current.
//
// Control is off by default (configuration `charger_control`): the switch and
// the target current are then read-only, and a command is refused anyway.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { MAINS } from '../emporia/model.js';
import { featureName } from '../i18n.js';
import { INDEX_MAX_KWH } from './monitor.js';

// Gladys enums (server/utils/constants.js), OCPP 2.0.1 vocabulary.
export const CONNECTOR_STATUS = { AVAILABLE: 0, OCCUPIED: 1, UNAVAILABLE: 3, FAULTED: 4 };
export const CHARGING_STATE = {
  CHARGING: 0,
  EV_CONNECTED: 1,
  PAUSED_BY_VEHICLE: 2,
  PAUSED_BY_CHARGER: 3,
  IDLE: 4,
};

// The Emporia app refuses less than 6 A (the J1772 minimum).
export const MIN_CURRENT_A = 6;
const DEFAULT_MAX_CURRENT_A = 48;
const CHARGER_MAX_W = 12000;

// Messages Emporia shows with status "Standby" while no vehicle is plugged in
// (listed by the HACS integration from field data).
const NO_VEHICLE_MESSAGES = new Set(['ready', 'off', 'self test', 'please wait']);

/**
 * Emporia charger status → Gladys connector status and charging state.
 * Known raw values: status "Charging" | "Standby" | "DeviceNotConnected" | "";
 * message "Charging", "Ready", "Off", "Self Test", "Offline", "EV is not
 * accepting charge", "Connected to EV", "Please Wait", "Charging Halted".
 * @param {object} charger raw charger object of the status
 * @param {boolean} online whether the charger reaches the Emporia cloud
 */
export function chargerStates(charger, online = true) {
  const status = String(charger?.status ?? '').toLowerCase();
  const message = String(charger?.message ?? '').toLowerCase();
  const fault = String(charger?.faultText ?? '').trim();

  if (!online || message === 'offline') {
    return { connector: CONNECTOR_STATUS.UNAVAILABLE, charging: CHARGING_STATE.IDLE };
  }
  if (fault || /error|fault/.test(status) || /error|fault/.test(message)) {
    return { connector: CONNECTOR_STATUS.FAULTED, charging: CHARGING_STATE.IDLE };
  }
  if (status === 'charging') {
    return { connector: CONNECTOR_STATUS.OCCUPIED, charging: CHARGING_STATE.CHARGING };
  }
  if (
    status === '' ||
    status === 'devicenotconnected' ||
    (status === 'standby' && NO_VEHICLE_MESSAGES.has(message))
  ) {
    return { connector: CONNECTOR_STATUS.AVAILABLE, charging: CHARGING_STATE.IDLE };
  }
  // A vehicle is plugged in, not charging: who holds the charge back?
  let charging = CHARGING_STATE.EV_CONNECTED;
  if (charger?.chargerOn === false || message.includes('halted')) {
    charging = CHARGING_STATE.PAUSED_BY_CHARGER;
  } else if (message.includes('not accepting')) {
    charging = CHARGING_STATE.PAUSED_BY_VEHICLE;
  }
  return { connector: CONNECTOR_STATUS.OCCUPIED, charging };
}

/** Highest current the charger accepts, in A. */
export const maxCurrent = (charger) => {
  const max = Number(charger?.maxChargingRate);
  return Number.isFinite(max) && max >= MIN_CURRENT_A ? max : DEFAULT_MAX_CURRENT_A;
};

export const charger = {
  kind: 'charger',

  layout(device, _usages, language, config) {
    const control = config.charger_control === true;
    return [
      {
        key: 'connector',
        kind: 'charger-connector',
        category: CAT.CHARGING_STATION,
        type: TYPE.CHARGING_STATION.CONNECTOR_STATUS,
        min: 0,
        max: 4,
        name: featureName(language, 'chargerConnector'),
      },
      {
        key: 'charging-state',
        kind: 'charger-state',
        category: CAT.CHARGING_STATION,
        type: TYPE.CHARGING_STATION.CHARGING_STATE,
        min: 0,
        max: 5,
        name: featureName(language, 'chargerState'),
      },
      {
        key: 'switch',
        kind: 'charger-switch',
        category: CAT.SWITCH,
        type: TYPE.SWITCH.BINARY,
        min: 0,
        max: 1,
        writable: control,
        name: featureName(language, 'chargerSwitch'),
      },
      {
        key: 'target-current',
        kind: 'charger-current',
        category: CAT.SWITCH,
        type: TYPE.SWITCH.TARGET_CURRENT,
        unit: UNIT.AMPERE,
        min: MIN_CURRENT_A,
        max: maxCurrent(device.charger),
        writable: control,
        name: featureName(language, 'chargerCurrent'),
      },
      {
        key: 'power',
        kind: 'power',
        num: MAINS,
        category: CAT.ENERGY_SENSOR,
        type: TYPE.ENERGY_SENSOR.POWER,
        unit: UNIT.WATT,
        min: 0,
        max: CHARGER_MAX_W,
        name: featureName(language, 'chargerPower'),
      },
      {
        key: 'index',
        kind: 'index',
        num: MAINS,
        category: CAT.ENERGY_SENSOR,
        type: TYPE.ENERGY_SENSOR.INDEX,
        unit: UNIT.KILOWATT_HOUR,
        min: 0,
        max: INDEX_MAX_KWH,
        name: featureName(language, 'chargerIndex'),
      },
    ];
  },
};
