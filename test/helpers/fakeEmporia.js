// -----------------------------------------------------------------------------
// A fake Emporia cloud, as a `fetch` function: the Cognito user pool (the
// SERVER side of SRP, which really checks the password proof) and the
// Emporia API, serving the fixtures of test/fixtures/emporia/. No network.
// -----------------------------------------------------------------------------

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { N, g, modPow, padHex, internals } from '../../src/emporia/srp.js';
import { COGNITO_ENDPOINT, CLIENT_ID, USER_POOL_ID } from '../../src/emporia/cognito.js';
import { API_ROOT } from '../../src/emporia/api.js';

const { k, hexHash, sha256Hex, hkdf } = internals;
const POOL_NAME = USER_POOL_ID.split('_')[1];

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/emporia/${name}`, import.meta.url), 'utf8'));

const json = (status, body) =>
  new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * @param {object} [options]
 * @param {string} [options.email]
 * @param {string} [options.password]
 * @param {string} [options.challenge] a challenge to ask after the password (MFA)
 */
export function createFakeEmporia({
  email = 'user@example.com',
  password = 'correct horse battery staple',
  challenge = null,
} = {}) {
  const userId = randomUUID();
  const salt = randomBytes(16).toString('hex');
  const x = BigInt(
    `0x${hexHash(padHex(BigInt(`0x${salt}`)) + sha256Hex(Buffer.from(`${POOL_NAME}${userId}:${password}`)))}`,
  );
  const verifier = modPow(g, x, N);
  const sessions = new Map(); // Session → { A, b, B, secretBlock }
  let tokenCount = 0;

  const fake = {
    devices: fixture('customers-devices.json'),
    usage: { '1MIN': fixture('usage-1min.json'), '1D': fixture('usage-1d.json') },
    /** Optional (instant ms, scale) → payload, overrides `usage`. */
    usageFor: null,
    status: fixture('status.json'),
    /** Valid ID tokens and refresh tokens. */
    idTokens: new Set(),
    refreshTokens: new Set(),
    tokenLifetimeS: 3600,
    /** Every request: { service, action|path, method, body, headers } */
    requests: [],
    /** Make every call fail like a network error. */
    down: false,
    signIns: 0,

    issueTokens(withRefresh = true) {
      tokenCount += 1;
      const id = `id-token-${tokenCount}`;
      const refresh = `refresh-token-${tokenCount}`;
      fake.idTokens.add(id);
      if (withRefresh) {
        fake.refreshTokens.add(refresh);
      }
      return {
        IdToken: id,
        AccessToken: `access-token-${tokenCount}`,
        ...(withRefresh ? { RefreshToken: refresh } : {}),
        ExpiresIn: fake.tokenLifetimeS,
        TokenType: 'Bearer',
      };
    },

    cognito(action, body) {
      if (body.ClientId !== CLIENT_ID) {
        return json(400, { __type: 'ResourceNotFoundException', message: 'bad client' });
      }
      if (action === 'InitiateAuth' && body.AuthFlow === 'USER_SRP_AUTH') {
        const A = BigInt(`0x${body.AuthParameters.SRP_A}`);
        const b = BigInt(`0x${randomBytes(32).toString('hex')}`);
        const B = (k * verifier + modPow(g, b, N)) % N;
        const session = randomUUID();
        const secretBlock = randomBytes(64).toString('base64');
        sessions.set(session, { A, b, B, secretBlock, username: body.AuthParameters.USERNAME });
        return json(200, {
          ChallengeName: 'PASSWORD_VERIFIER',
          Session: session,
          ChallengeParameters: {
            SALT: salt,
            SRP_B: B.toString(16),
            SECRET_BLOCK: secretBlock,
            USER_ID_FOR_SRP: userId,
            USERNAME: userId,
          },
        });
      }
      if (action === 'RespondToAuthChallenge') {
        const s = sessions.get(body.Session);
        sessions.delete(body.Session);
        const answer = body.ChallengeResponses;
        const u = BigInt(`0x${hexHash(padHex(s.A) + padHex(s.B))}`);
        const S = modPow(s.A * modPow(verifier, u, N), s.b, N);
        const key = hkdf(Buffer.from(padHex(S), 'hex'), Buffer.from(padHex(u), 'hex'));
        const expected = createHmac('sha256', key)
          .update(
            Buffer.concat([
              Buffer.from(POOL_NAME),
              Buffer.from(userId),
              Buffer.from(s.secretBlock, 'base64'),
              Buffer.from(answer.TIMESTAMP),
            ]),
          )
          .digest('base64');
        if (s.username.toLowerCase() !== email || answer.PASSWORD_CLAIM_SIGNATURE !== expected) {
          return json(400, {
            __type: 'NotAuthorizedException',
            message: 'Incorrect username or password.',
          });
        }
        fake.signIns += 1;
        if (challenge) {
          return json(200, { ChallengeName: challenge, Session: 'mfa', ChallengeParameters: {} });
        }
        return json(200, { AuthenticationResult: fake.issueTokens() });
      }
      if (action === 'InitiateAuth' && body.AuthFlow === 'REFRESH_TOKEN_AUTH') {
        if (!fake.refreshTokens.has(body.AuthParameters.REFRESH_TOKEN)) {
          return json(400, {
            __type: 'NotAuthorizedException',
            message: 'Refresh Token has expired',
          });
        }
        return json(200, { AuthenticationResult: fake.issueTokens(false) });
      }
      return json(400, { __type: 'InvalidParameterException', message: action });
    },

    api(method, path, headers, body) {
      if (!fake.idTokens.has(headers.authtoken)) {
        return json(401, { message: 'Unauthorized' });
      }
      const url = new URL(`${API_ROOT}/${path}`);
      if (method === 'GET' && url.pathname === '/customers/devices') {
        return json(200, fake.devices);
      }
      if (method === 'GET' && url.pathname === '/customers/devices/status') {
        return json(200, fake.status);
      }
      if (method === 'GET' && url.pathname === '/AppAPI') {
        const scale = url.searchParams.get('scale');
        const instant = Date.parse(url.searchParams.get('instant'));
        const payload = fake.usageFor ? fake.usageFor(instant, scale) : fake.usage[scale];
        return json(200, payload);
      }
      if (method === 'PUT' && url.pathname === '/devices/outlet') {
        const outlet = fake.status.outlets.find((o) => o.deviceGid === body.deviceGid);
        outlet.outletOn = body.outletOn;
        return json(200, { ...outlet });
      }
      if (method === 'PUT' && url.pathname === '/devices/evcharger') {
        const charger = fake.status.evChargers.find((c) => c.deviceGid === body.deviceGid);
        Object.assign(charger, {
          chargerOn: body.chargerOn,
          chargingRate: body.chargingRate,
        });
        return json(200, { ...charger });
      }
      return json(404, { message: 'not found' });
    },

    /** The `fetch` to hand to the code under test. */
    fetch: async (url, init = {}) => {
      if (fake.down) {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      const body = init.body ? JSON.parse(init.body) : undefined;
      if (url === COGNITO_ENDPOINT) {
        const action = init.headers['X-Amz-Target'].split('.').pop();
        fake.requests.push({ service: 'cognito', action, body });
        return fake.cognito(action, body);
      }
      const path = url.slice(API_ROOT.length + 1);
      fake.requests.push({
        service: 'api',
        method: init.method,
        path,
        body,
        headers: init.headers,
      });
      return fake.api(init.method, path, init.headers, body);
    },

    /** API requests whose path starts with this. */
    apiCalls(prefix) {
      return fake.requests.filter((r) => r.service === 'api' && r.path.startsWith(prefix));
    },
    cognitoCalls(action) {
      return fake.requests.filter(
        (r) => r.service === 'cognito' && (!action || r.action === action),
      );
    },
  };
  return fake;
}

/** A /data stand-in: JSON files in memory. */
export function memoryFile(initial = null) {
  let value = initial;
  return {
    read: async (fallback = null) => (value === null ? fallback : structuredClone(value)),
    write: async (next) => {
      value = structuredClone(next);
    },
    get value() {
      return value;
    },
  };
}
