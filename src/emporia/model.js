// -----------------------------------------------------------------------------
// The Emporia payloads, turned into plain objects the rest of the code reads.
//
// Shapes from PyEmVue (api_docs.md, device.py) and its simulator:
//   - GET customers/devices lists the devices; a Vue carries its "1,2,3" mains
//     channel itself and its circuits in a sub-device of the SAME deviceGid
//     (model WAT001), which we merge back. Outlets and chargers are devices
//     carrying an `outlet` / `evCharger` object.
//   - getDeviceListUsages answers a tree: each channel lists the devices
//     plugged on it (`nestedDevices`: an outlet on a circuit, a second Vue on a
//     sub-panel). We flatten it by deviceGid and channel number.
//   - Solar Vues add MainsFromGrid / MainsToGrid channels to the usage only.
// -----------------------------------------------------------------------------

export const MAINS = '1,2,3';
export const BALANCE = 'Balance';
export const GRID_IMPORT = 'MainsFromGrid';
export const GRID_EXPORT = 'MainsToGrid';
// Emporia channel type "Solar/Generation" (devices/channels/channeltypes).
export const SOLAR_CHANNEL_TYPE = 13;

const key = (gid, num) => `${gid}|${num}`;

function readChannel(raw) {
  return {
    num: String(raw.channelNum),
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : null,
    typeGid: raw.channelTypeGid ?? null,
    bidirectional: /bidirectional/i.test(String(raw.type ?? '')),
  };
}

function deviceName(raw) {
  const props = raw.locationProperties ?? {};
  const name = [props.deviceName, props.displayName].find(
    (value) => typeof value === 'string' && value.trim() !== '',
  );
  return name ? name.trim() : null;
}

/**
 * GET customers/devices → Map deviceGid → device.
 * @param {object} json
 * @returns {Map<number, object>}
 */
export function parseDevices(json) {
  const devices = new Map();

  const add = (raw, parent) => {
    const gid = Number(raw.deviceGid);
    if (!Number.isInteger(gid) || gid <= 0) {
      return;
    }
    const channels = (raw.channels ?? []).filter(Boolean).map(readChannel);
    const existing = devices.get(gid);
    if (existing) {
      // The circuits sub-device of a Vue: same gid, merge its channels.
      for (const channel of channels) {
        if (!existing.channels.some((known) => known.num === channel.num)) {
          existing.channels.push(channel);
        }
      }
    } else {
      const props = raw.locationProperties ?? parent?.locationProperties ?? {};
      devices.set(gid, {
        gid,
        model: String(raw.model ?? ''),
        firmware: raw.firmware ?? null,
        name: deviceName(raw),
        timeZone: typeof props.timeZone === 'string' ? props.timeZone : null,
        solar: props.solar === true,
        outlet: raw.outlet ?? null,
        charger: raw.evCharger ?? null,
        connected: raw.deviceConnected?.connected ?? null,
        channels,
      });
    }
    for (const sub of raw.devices ?? []) {
      if (sub) {
        add(sub, raw);
      }
    }
  };

  for (const raw of json?.devices ?? []) {
    if (raw) {
      add(raw, null);
    }
  }

  for (const device of devices.values()) {
    device.kind = device.charger
      ? 'charger'
      : device.outlet
        ? 'outlet'
        : device.channels.length > 0
          ? 'monitor'
          : null;
  }
  return devices;
}

/**
 * getDeviceListUsages → Map "gid|channel" → { usage (kWh or null), name }.
 * @param {object} json
 */
export function parseUsage(json) {
  const values = new Map();
  const walk = (devices) => {
    for (const device of devices ?? []) {
      for (const channel of device?.channelUsages ?? []) {
        if (!channel) {
          continue;
        }
        const gid = Number(channel.deviceGid ?? device.deviceGid);
        const id = key(gid, String(channel.channelNum));
        const usage =
          typeof channel.usage === 'number' && Number.isFinite(channel.usage)
            ? channel.usage
            : null;
        const known = values.get(id);
        if (!known || (known.usage === null && usage !== null)) {
          values.set(id, { usage, name: channel.name ?? null });
        }
        walk(channel.nestedDevices);
      }
    }
  };
  walk(json?.deviceListUsages?.devices);
  return values;
}

/** Usage of one channel, in kWh over the period, or null. */
export const usageOf = (usages, gid, num) => usages?.get(key(gid, num))?.usage ?? null;

/** Channel numbers the usage reports for a device (special channels included). */
export function usageChannels(usages, gid) {
  const prefix = `${gid}|`;
  return [...(usages?.keys() ?? [])]
    .filter((id) => id.startsWith(prefix))
    .map((id) => id.slice(prefix.length));
}

/**
 * GET customers/devices/status → outlets, chargers and connectivity by gid.
 * @param {object} json
 */
export function parseStatus(json) {
  const byGid = (list) =>
    new Map(
      (list ?? []).filter((item) => item?.deviceGid).map((item) => [Number(item.deviceGid), item]),
    );
  return {
    outlets: byGid(json?.outlets),
    chargers: byGid(json?.evChargers),
    connected: new Map(
      (json?.devicesConnected ?? [])
        .filter((item) => item?.deviceGid)
        .map((item) => [Number(item.deviceGid), item.connected !== false]),
    ),
  };
}

/** kWh over one minute → W. */
export const minuteKwhToWatts = (kwh) => Math.round(kwh * 60000);
