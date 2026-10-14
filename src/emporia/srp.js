// -----------------------------------------------------------------------------
// Secure Remote Password (SRP-6a), the AWS Cognito flavour (USER_SRP_AUTH).
//
// Emporia accounts live in an AWS Cognito user pool that only accepts the SRP
// flow: the password never leaves the container, Cognito only receives proof
// that we know it. This is a straight port of the reference implementation
// (amazon-cognito-identity-js `AuthenticationHelper`, the code pycognito and
// therefore PyEmVue use), with native BigInt and node:crypto: no dependency.
// test/srp.test.js checks it against a vector computed by pycognito.
// -----------------------------------------------------------------------------

import { createHash, createHmac, randomBytes } from 'node:crypto';

// RFC 5054 3072-bit group, the one Cognito uses.
const N_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
  '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
  'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
  'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
  '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9' +
  'DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64' +
  'ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
  'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6B' +
  'F12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
  'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB31' +
  '43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF';

export const N = BigInt(`0x${N_HEX}`);
export const g = 2n;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Non-negative modulo. */
function mod(a, m) {
  const r = a % m;
  return r < 0n ? r + m : r;
}

/** base^exponent mod modulus, square-and-multiply. */
export function modPow(base, exponent, modulus) {
  let result = 1n;
  let b = mod(base, modulus);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % modulus;
    }
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

/**
 * Hex of a non-negative integer, padded the way Cognito hashes it: an even
 * number of digits, and a leading 00 when the first byte has its high bit set
 * (a positive two's-complement number).
 * @param {bigint} value
 */
export function padHex(value) {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) {
    hex = `0${hex}`;
  } else if (/^[89a-f]/i.test(hex)) {
    hex = `00${hex}`;
  }
  return hex;
}

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hexHash = (hex) => sha256Hex(Buffer.from(hex, 'hex'));

const k = BigInt(`0x${hexHash(padHex(N) + padHex(g))}`);

/** HKDF-SHA256 as Cognito uses it: one 16-byte block, info "Caldera Derived Key". */
function hkdf(ikm, salt) {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  const info = Buffer.concat([Buffer.from('Caldera Derived Key', 'utf8'), Buffer.from([1])]);
  return createHmac('sha256', prk).update(info).digest().subarray(0, 16);
}

/**
 * Cognito's timestamp: "Tue Oct 14 14:15:00 UTC 2026", day of month unpadded.
 * @param {Date} date
 */
export function cognitoTimestamp(date) {
  const two = (n) => String(n).padStart(2, '0');
  return (
    `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()} ` +
    `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} ` +
    `UTC ${date.getUTCFullYear()}`
  );
}

/**
 * One SRP session: the client's ephemeral key pair, then the answer to the
 * PASSWORD_VERIFIER challenge.
 * @param {object} options
 * @param {string} options.poolId e.g. us-east-2_ghlOXVLi1
 * @param {bigint} [options.a] the private ephemeral value (tests only)
 */
export function createSrpSession({ poolId, a } = {}) {
  const poolName = poolId.split('_')[1];
  let small = a;
  let large;
  do {
    small = small ?? mod(BigInt(`0x${randomBytes(128).toString('hex')}`), N);
    large = modPow(g, small, N);
    if (large === 0n) {
      small = undefined;
    }
  } while (large === 0n);

  return {
    /** SRP_A, as InitiateAuth expects it (unpadded hex). */
    srpA: large.toString(16),

    /**
     * The PASSWORD_VERIFIER challenge answer.
     * @param {object} challenge
     * @param {string} challenge.userIdForSrp USER_ID_FOR_SRP
     * @param {string} challenge.srpB SRP_B (hex)
     * @param {string} challenge.salt SALT (hex)
     * @param {string} challenge.secretBlock SECRET_BLOCK (base64)
     * @param {string} password
     * @param {Date} [date]
     */
    respond({ userIdForSrp, srpB, salt, secretBlock }, password, date = new Date()) {
      const B = BigInt(`0x${srpB}`);
      if (mod(B, N) === 0n) {
        throw new Error('SRP: invalid server value B');
      }
      const u = BigInt(`0x${hexHash(padHex(large) + padHex(B))}`);
      if (u === 0n) {
        throw new Error('SRP: invalid scrambling parameter');
      }
      const identityHash = sha256Hex(Buffer.from(`${poolName}${userIdForSrp}:${password}`, 'utf8'));
      const x = BigInt(`0x${hexHash(padHex(BigInt(`0x${salt}`)) + identityHash)}`);
      const S = modPow(B - k * modPow(g, x, N), small + u * x, N);
      const key = hkdf(Buffer.from(padHex(S), 'hex'), Buffer.from(padHex(u), 'hex'));
      const timestamp = cognitoTimestamp(date);
      const signature = createHmac('sha256', key)
        .update(
          Buffer.concat([
            Buffer.from(poolName, 'utf8'),
            Buffer.from(userIdForSrp, 'utf8'),
            Buffer.from(secretBlock, 'base64'),
            Buffer.from(timestamp, 'utf8'),
          ]),
        )
        .digest('base64');
      return { timestamp, signature };
    },
  };
}

// Exposed for the fake Cognito of the tests (server side of the protocol).
export const internals = { k, hexHash, sha256Hex, hkdf };
