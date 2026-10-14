// -----------------------------------------------------------------------------
// The Emporia cloud API (https://api.emporiaenergy.com), as PyEmVue documents
// it: the ID token goes in an `authtoken` header (not a bearer token).
//
// The session (Cognito tokens) is kept in /data/session.json, so a restart
// renews the tokens instead of signing in again. A refused password is never
// retried on its own: Cognito would end up locking the account. Only a new
// configuration (another email or password) tries again.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { CognitoError, refreshSession, signIn } from './cognito.js';

export const API_ROOT = 'https://api.emporiaenergy.com';

const TIMEOUT_MS = 15000;
// Renew the ID token this long before it expires (it lasts one hour).
const RENEW_BEFORE_MS = 5 * 60 * 1000;

export class EmporiaApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'EmporiaApiError';
    this.status = status;
  }
}

/** A stable, non-reversible key of the account, to match the stored session. */
const accountKey = (email) =>
  createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');

/**
 * UTC instant in the format PyEmVue sends (`2026-10-14T14:15:00.000Z`).
 * @param {number} ms
 */
export const formatInstant = (ms) => new Date(ms).toISOString();

/**
 * @param {object} options
 * @param {{ read: Function, write: Function }} options.sessionFile
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 * @param {{ signIn: Function, refreshSession: Function }} [options.cognito]
 */
export function createEmporiaClient({
  sessionFile,
  fetch: fetchImpl = fetch,
  now = Date.now,
  cognito = { signIn, refreshSession },
}) {
  let credentials = { email: '', password: '' };
  let session = null; // { account, tokens }
  let loaded = false;
  // The credentials Cognito refused (account key + password hash): not retried.
  let refusedCredentials = null;
  let pendingAuth = null;

  const credentialsKey = () =>
    `${accountKey(credentials.email)}:${createHash('sha256').update(credentials.password).digest('hex')}`;

  async function loadSession() {
    if (!loaded) {
      loaded = true;
      const stored = await sessionFile.read(null);
      if (stored?.account && stored?.tokens?.refreshToken) {
        session = stored;
      }
    }
  }

  async function saveSession(tokens) {
    session = { account: accountKey(credentials.email), tokens };
    await sessionFile.write(session);
  }

  async function authenticate({ forceRefresh = false } = {}) {
    await loadSession();
    const account = accountKey(credentials.email);
    if (session && session.account !== account) {
      // Another account was configured: its tokens are of no use.
      session = null;
      await sessionFile.write(null);
    }
    const tokens = session?.tokens;
    if (tokens && !forceRefresh && tokens.expiresAt - RENEW_BEFORE_MS > now()) {
      return tokens.idToken;
    }
    if (tokens?.refreshToken) {
      try {
        const renewed = await cognito.refreshSession({
          refreshToken: tokens.refreshToken,
          fetch: fetchImpl,
          now,
        });
        await saveSession(renewed);
        return renewed.idToken;
      } catch (err) {
        if (!(err instanceof CognitoError) || !err.isAccountError) {
          throw err;
        }
        // Refresh token expired or revoked: sign in again below.
      }
    }
    if (refusedCredentials === credentialsKey()) {
      throw new CognitoError('NotAuthorizedException', 'Emporia refused this email or password');
    }
    try {
      const fresh = await cognito.signIn({ ...credentials, fetch: fetchImpl, now });
      await saveSession(fresh);
      return fresh.idToken;
    } catch (err) {
      if (err instanceof CognitoError && err.isAccountError) {
        refusedCredentials = credentialsKey();
      }
      throw err;
    }
  }

  /** One authentication at a time, shared by concurrent requests. */
  function idToken(options) {
    if (!pendingAuth) {
      pendingAuth = authenticate(options).finally(() => {
        pendingAuth = null;
      });
    }
    return pendingAuth;
  }

  async function send(method, path, body, token) {
    let response;
    try {
      response = await fetchImpl(`${API_ROOT}/${path}`, {
        method,
        headers: {
          authtoken: token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new EmporiaApiError(0, `Emporia API unreachable (${err.cause?.code ?? err.name})`);
    }
    return response;
  }

  async function request(method, path, body) {
    let response = await send(method, path, body, await idToken());
    if (response.status === 401) {
      // Token revoked or expired early: renew once and retry.
      response = await send(method, path, body, await idToken({ forceRefresh: true }));
    }
    if (!response.ok) {
      throw new EmporiaApiError(
        response.status,
        `Emporia API answered HTTP ${response.status} (${path.split('?')[0]})`,
      );
    }
    const text = await response.text();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new EmporiaApiError(response.status, `Emporia API sent invalid JSON (${path})`);
    }
  }

  return {
    /** @param {{ email: string, password: string }} next */
    setCredentials(next) {
      credentials = {
        email: String(next.email ?? '').trim(),
        password: String(next.password ?? ''),
      };
    },

    /** Cognito refused the current credentials: nothing is tried until they change. */
    get accountRefused() {
      return refusedCredentials !== null && refusedCredentials === credentialsKey();
    },

    /** Signs in (or renews the session) without reading anything. */
    async connect() {
      await idToken();
    },

    /** GET /customers/devices: the account's devices, channels and names. */
    getDevices() {
      return request('GET', 'customers/devices');
    },

    /**
     * getDeviceListUsages: the energy of every channel of these devices, in
     * kWh, over the `scale` period that contains `instant` (1MIN, 1D...).
     * @param {number[]} gids
     * @param {number} instant ms
     * @param {string} scale
     */
    getUsage(gids, instant, scale) {
      const query =
        `apiMethod=getDeviceListUsages&deviceGids=${gids.join('+')}` +
        `&instant=${formatInstant(instant)}&scale=${scale}&energyUnit=KilowattHours`;
      return request('GET', `AppAPI?${query}`);
    },

    /** GET /customers/devices/status: outlets, chargers and connectivity. */
    getStatus() {
      return request('GET', 'customers/devices/status');
    },

    /**
     * @param {object} outlet the raw outlet object from the status
     * @param {boolean} on
     */
    setOutlet(outlet, on) {
      return request('PUT', 'devices/outlet', {
        deviceGid: outlet.deviceGid,
        outletOn: on,
        loadGid: outlet.loadGid,
      });
    },

    /**
     * @param {object} charger the raw charger object from the status
     * @param {{ on?: boolean, rate?: number }} change
     */
    setCharger(charger, { on, rate }) {
      const body = {
        deviceGid: charger.deviceGid,
        loadGid: charger.loadGid,
        chargerOn: on ?? charger.chargerOn,
        chargingRate: rate ?? charger.chargingRate,
        maxChargingRate: charger.maxChargingRate,
      };
      if (charger.breakerPIN) {
        // Sent back as the app does; never logged.
        body.breakerPIN = charger.breakerPIN;
      }
      return request('PUT', 'devices/evcharger', body);
    },
  };
}
