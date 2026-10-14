// -----------------------------------------------------------------------------
// The integration, wired to a Gladys client (the real SDK in index.js, the
// SDK's fake Gladys in the tests).
//
// One polling cycle, once a minute (src/poller.js):
//   1. the device list (names, circuits), re-read every hour;
//   2. getDeviceListUsages at the 1MIN scale: the power of every channel of
//      every device, in ONE request;
//   3. customers/devices/status: outlets, chargers, connectivity;
//   4. every 5 minutes, the daily totals that move the energy indexes
//      (src/energy.js);
//   5. the states of the devices the user added, changed values only.
// Nothing is read while no Emporia device is added to Gladys.
//
// Logs stay quiet: a normal cycle writes nothing at info level. Info keeps the
// life cycle (start, sign-in, a device lost and back, one line per user
// action); a failure that repeats is one warning, and one line on recovery.
// -----------------------------------------------------------------------------

import { GladysApiError, createLogger } from '@gladysassistant/integration-sdk';
import { DATA_DIR, createJsonFile } from './store.js';
import { LANGUAGES, isConfigured, normalizeConfig } from './config.js';
import { CognitoError } from './emporia/cognito.js';
import { createEmporiaClient } from './emporia/api.js';
import { parseDevices, parseStatus, parseUsage } from './emporia/model.js';
import { createEnergyTracker } from './energy.js';
import {
  buildDevice,
  deviceName,
  findDevice,
  idsOf,
  indexChannels,
  runCommand,
  statesOf,
  supportedDevices,
} from './devices/index.js';
import { createPoller } from './poller.js';
import { createIssueLog } from './issues.js';
import { TEXT, devicesMessage } from './i18n.js';
import { WIDGET, buildPowerOverview, messageContent } from './widgets.js';
import { SCENE_ACTION, SCENE_TRIGGER, dailySummary } from './scenes.js';

// Keys of the manifest `actions`: forever, once published.
export const ACTION = { LIST_DEVICES: 'list_devices' };

export const CATALOG_REFRESH_MS = 60 * 60 * 1000;
export const ENERGY_REFRESH_MS = 5 * 60 * 1000;
// An unchanged value is sent again after this long: Gladys shows "no recent
// value" past 48 h, and the indexes of an idle circuit do not move.
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;

const isAccountError = (err) => err instanceof CognitoError && err.isAccountError;

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {typeof fetch} [options.fetch] reaches Cognito and the Emporia API
 * @param {string} [options.dataDir] /data
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers] run the polling timer (tests turn it off)
 * @param {number} [options.periodMs] polling period (one minute)
 * @param {object} [options.logger]
 */
export function createApp({
  gladys,
  fetch: fetchImpl = fetch,
  dataDir = DATA_DIR,
  now = Date.now,
  timers = true,
  periodMs,
  logger = createLogger({ name: 'emporia' }),
}) {
  const api = createEmporiaClient({
    sessionFile: createJsonFile(dataDir, 'session.json'),
    fetch: fetchImpl,
    now,
  });
  const energy = createEnergyTracker({ file: createJsonFile(dataDir, 'energy.json') });
  const issues = createIssueLog(logger);

  /** What the last cycle read. */
  const snapshot = {
    config: normalizeConfig(),
    catalog: null,
    usages: new Map(),
    status: null,
    energy,
  };
  let catalogAt = null;
  let energyAt = null;
  let publishedDevices = null;
  /** gid → reaches the Emporia cloud, as last seen. */
  const online = new Map();

  const poller = createPoller({ run: (options) => cycle(options), timers, now, periodMs });

  const config = () => snapshot.config;

  function applyConfig(raw) {
    snapshot.config = normalizeConfig(raw);
    api.setCredentials(snapshot.config);
  }

  /** The Emporia devices the user added to Gladys. */
  function createdDevices() {
    const created = new Set((gladys.devices ?? []).map((device) => device.external_id));
    return supportedDevices(snapshot.catalog).filter((device) =>
      created.has(idsOf(gladys, device).device),
    );
  }

  const allGids = () => supportedDevices(snapshot.catalog).map((device) => device.gid);

  async function readCatalog() {
    snapshot.catalog = parseDevices(await api.getDevices());
    catalogAt = now();
  }

  async function readUsage() {
    const gids = allGids();
    snapshot.usages =
      gids.length > 0 ? parseUsage(await api.getUsage(gids, now(), '1MIN')) : new Map();
  }

  /** Publishes the discovered devices, unless Gladys already has this list. */
  async function publishDiscovery({ force = false } = {}) {
    const devices = supportedDevices(snapshot.catalog).map((device) =>
      buildDevice(gladys, device, snapshot),
    );
    const signature = JSON.stringify(devices);
    if (!force && signature === publishedDevices) {
      return;
    }
    await gladys.publishDiscoveredDevices(devices);
    publishedDevices = signature;
    logger.debug(`Published ${devices.length} discovered device(s)`);
  }

  async function refreshEnergy() {
    const devices = supportedDevices(snapshot.catalog);
    const wanted = new Map(devices.map((device) => [device.gid, indexChannels(device, snapshot)]));
    await energy.refresh({
      devices: devices.map((device) => ({ gid: device.gid, timeZone: device.timeZone })),
      wanted: (gid, num) => wanted.get(gid)?.has(num) ?? false,
      // Always the whole account: an outlet or a second Vue only shows up
      // nested in the tree of the Vue it hangs on.
      fetchDay: async (_gids, instant) => parseUsage(await api.getUsage(allGids(), instant, '1D')),
      now: now(),
    });
    energyAt = now();
  }

  /** Reports a failure in the logs (once) and in the Configuration screen. */
  async function reportError(err) {
    if (isAccountError(err)) {
      const first = !issues.isFailing('account');
      issues.fail('account', `Emporia sign-in refused (${err.type}): fix the configuration`);
      if (first) {
        const message =
          err.type === 'ChallengeNotSupported' ? TEXT.signInUnsupported : TEXT.accountRefused;
        await gladys.setConnectionStatus(false, message).catch(() => {});
      }
      return;
    }
    if (err instanceof GladysApiError) {
      const first = !issues.isFailing('gladys');
      issues.fail('gladys', `Gladys refused a request: ${err.message}`);
      if (first) {
        await gladys.setConnectionStatus(false, TEXT.publishFailed).catch(() => {});
      }
      return;
    }
    const first = !issues.isFailing('cloud');
    issues.fail('cloud', `Emporia cloud unreachable: ${err.message}`);
    if (first) {
      await gladys.setConnectionStatus(false, TEXT.cloudUnreachable).catch(() => {});
    }
  }

  /** Everything works (again): one info line per problem that ended. */
  async function reportOk() {
    const wasFailing = ['account', 'gladys', 'cloud'].filter((key) => issues.isFailing(key));
    issues.ok('account', 'Emporia accepts the account again');
    issues.ok('gladys', 'Gladys accepts the requests again');
    issues.ok('cloud', 'Emporia cloud reachable again');
    if (wasFailing.length > 0) {
      await gladys.setConnectionStatus(true).catch(() => {});
    }
  }

  /** Sign in, read the account and publish its devices. */
  async function connectAccount() {
    publishedDevices = null;
    snapshot.catalog = null;
    if (!isConfigured(config())) {
      logger.info('Not configured yet: waiting for the Emporia email and password');
      await gladys.setConnectionStatus(false, TEXT.notConfigured);
      return;
    }
    try {
      await api.connect();
      await readCatalog();
      // One reading: the special channels of a solar Vue only show up there.
      await readUsage();
      await publishDiscovery({ force: true });
      await gladys.setConnectionStatus(true);
      logger.info(`Signed in to Emporia: ${supportedDevices(snapshot.catalog).length} device(s)`);
      await reportOk();
    } catch (err) {
      await reportError(err);
    }
  }

  /** Connectivity of the added devices: logs, scene trigger, transport badge. */
  async function followConnectivity(devices) {
    const transports = [];
    for (const device of devices) {
      const isOnline = snapshot.status?.connected.get(device.gid) ?? device.connected ?? true;
      const before = online.get(device.gid);
      online.set(device.gid, isOnline);
      if (before === isOnline) {
        continue;
      }
      const externalId = idsOf(gladys, device).device;
      transports.push({ external_id: externalId, transport: isOnline ? 'cloud' : 'unreachable' });
      if (before === undefined && isOnline) {
        continue;
      }
      logger.info(
        `${deviceName(device)} ${isOnline ? 'reaches the Emporia cloud again' : 'is offline (no data from Emporia)'}`,
      );
      if (before !== undefined) {
        await gladys
          .publishSceneEvent(SCENE_TRIGGER.CONNECTION_CHANGED, {
            device: externalId,
            status: isOnline ? 'online' : 'offline',
            device_name: deviceName(device),
          })
          .catch((err) => logger.debug(`Scene event refused: ${err.message}`));
      }
    }
    if (transports.length > 0) {
      await gladys
        .publishTransports(transports)
        .catch((err) => logger.debug(`Transports refused: ${err.message}`));
    }
  }

  /** One polling cycle. Never throws. */
  async function cycle({ force = false } = {}) {
    if (!isConfigured(config()) || api.accountRefused || gladys.connected === false) {
      logger.debug('Cycle skipped (not configured, account refused or Gladys away)');
      return;
    }
    try {
      if (snapshot.catalog === null || now() - catalogAt >= CATALOG_REFRESH_MS) {
        await readCatalog();
      }
      const devices = createdDevices();
      if (devices.length === 0) {
        await publishDiscovery();
        await reportOk();
        logger.debug('No Emporia device added to Gladys: nothing read');
        return;
      }
      await readUsage();
      snapshot.status = parseStatus(await api.getStatus());
      // Names, circuits or solar channels may have changed.
      await publishDiscovery();

      if (force || energyAt === null || now() - energyAt >= ENERGY_REFRESH_MS) {
        try {
          await refreshEnergy();
          issues.ok('energy', 'Energy indexes updated again');
        } catch (err) {
          if (isAccountError(err)) {
            throw err;
          }
          issues.fail('energy', `Energy indexes not updated: ${err.message}`);
        }
      }

      await followConnectivity(devices);
      const states = devices.flatMap((device) => statesOf(gladys, device, snapshot));
      const { count } = await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      logger.debug(`Cycle: ${states.length} state(s), ${count} sent`);
      await reportOk();
    } catch (err) {
      await reportError(err);
    }
  }

  // --- Handlers ---------------------------------------------------------------

  gladys.onScanRequest(async () => {
    logger.info('Search requested: reading the Emporia account');
    if (!isConfigured(config())) {
      return;
    }
    try {
      await readCatalog();
      await readUsage();
      await publishDiscovery({ force: true });
      await reportOk();
    } catch (err) {
      await reportError(err);
      throw err;
    }
  });

  gladys.onSetValue(async (device, feature, value) => {
    const target = findDevice(gladys, snapshot.catalog, device.external_id);
    if (!target) {
      throw new Error(TEXT.deviceUnknown[config().language] ?? TEXT.deviceUnknown.en);
    }
    const featureKey = feature.external_id.slice(device.external_id.length + 1);
    logger.info(`Command: ${deviceName(target)} ${featureKey} = ${value}`);
    const states = await runCommand({ gladys, api, device: target, featureKey, value, snapshot });
    await gladys.publishChangedStates(states);
  });

  gladys.onPoll(() => poller.fromCore());

  const deviceAdded = async () => {
    // The SDK forgot what it sent for this device: everything goes again now.
    await poller.now();
    // Fire-and-forget nudge, dropped by the SDK while disconnected.
    gladys.requestWidgetRefresh(WIDGET.POWER_OVERVIEW);
  };
  gladys.onDeviceCreated(deviceAdded);
  gladys.onDeviceUpdated(deviceAdded);

  gladys.onConfigUpdated(async (raw) => {
    logger.info('Configuration updated');
    applyConfig(raw);
    await connectAccount();
    await poller.restart();
  });

  gladys.onAction(ACTION.LIST_DEVICES, async () => {
    logger.info('Action: list the Emporia devices');
    if (!isConfigured(config())) {
      return TEXT.notConfigured;
    }
    await readCatalog();
    return devicesMessage(
      supportedDevices(snapshot.catalog).map((device) => ({
        name: deviceName(device),
        kind: device.kind,
        circuits: device.channels.filter((c) => /^\d+$/.test(c.num)).length,
      })),
    );
  });

  gladys.onSceneAction(SCENE_ACTION.DAILY_SUMMARY, async (fields) => {
    logger.info('Scene action: daily summary');
    if (snapshot.catalog === null) {
      await readCatalog();
    }
    return dailySummary({ gladys, snapshot, deviceExternalId: fields.device });
  });

  gladys.onWidgetGet(WIDGET.POWER_OVERVIEW, async ({ settings = {}, language } = {}) => {
    const lang = LANGUAGES.includes(language) ? language : config().language;
    if (!isConfigured(config())) {
      return messageContent(TEXT.notConfigured, lang);
    }
    const monitors = createdDevices().filter((device) => device.kind === 'monitor');
    const device = settings.device
      ? monitors.find((d) => idsOf(gladys, d).device === settings.device)
      : monitors[0];
    if (!device) {
      return messageContent(TEXT.widgetPickVue, lang);
    }
    return buildPowerOverview({ gladys, device, snapshot, language: lang });
  });

  gladys.on('connected', async () => {
    try {
      applyConfig(await gladys.getConfig());
      await connectAccount();
      await poller.restart();
    } catch (err) {
      logger.error(`Initialization failed: ${err.message}`);
    }
  });

  return {
    snapshot,
    poller,
    cycle,
    /** Stops the timer (shutdown, end of a test). */
    stop() {
      poller.stop();
    },
  };
}
