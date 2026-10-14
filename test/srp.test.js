// -----------------------------------------------------------------------------
// SRP against the reference: test/fixtures/srp-pycognito-vector.json was
// computed by pycognito (the library PyEmVue signs in with) from fixed
// values. Same inputs, same signature: the port is exact.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cognitoTimestamp, createSrpSession, padHex } from '../src/emporia/srp.js';

const vector = JSON.parse(
  await readFile(new URL('./fixtures/srp-pycognito-vector.json', import.meta.url), 'utf8'),
);

test('the SRP answer matches pycognito, bit for bit', () => {
  const session = createSrpSession({ poolId: 'us-east-2_ghlOXVLi1', a: BigInt(`0x${vector.a}`) });
  assert.equal(session.srpA, vector.A);
  const answer = session.respond(
    {
      userIdForSrp: vector.userIdForSrp,
      srpB: vector.B,
      salt: vector.salt,
      secretBlock: vector.secretBlock,
    },
    vector.password,
    new Date(Date.UTC(2026, 9, 14, 14, 15, 0)),
  );
  assert.equal(answer.timestamp, vector.timestamp);
  assert.equal(answer.signature, vector.signature);
});

test('a wrong password gives another signature', () => {
  const session = createSrpSession({ poolId: 'us-east-2_ghlOXVLi1', a: BigInt(`0x${vector.a}`) });
  const answer = session.respond(
    {
      userIdForSrp: vector.userIdForSrp,
      srpB: vector.B,
      salt: vector.salt,
      secretBlock: vector.secretBlock,
    },
    'wrong password',
    new Date(Date.UTC(2026, 9, 14, 14, 15, 0)),
  );
  assert.notEqual(answer.signature, vector.signature);
});

test('padHex follows Cognito: even length, 00 before a high first byte', () => {
  assert.equal(padHex(0xfn), '0f');
  assert.equal(padHex(0x7fn), '7f');
  assert.equal(padHex(0x80n), '0080');
  assert.equal(padHex(0xabcn), '0abc');
});

test('the timestamp has an unpadded day of month', () => {
  assert.equal(
    cognitoTimestamp(new Date(Date.UTC(2026, 9, 4, 9, 5, 7))),
    'Sun Oct 4 09:05:07 UTC 2026',
  );
});

test('a random session draws a fresh A each time, and refuses B = 0 mod N', () => {
  const one = createSrpSession({ poolId: 'us-east-2_x' });
  const two = createSrpSession({ poolId: 'us-east-2_x' });
  assert.notEqual(one.srpA, two.srpA);
  assert.throws(
    () => one.respond({ userIdForSrp: 'u', srpB: '0', salt: '01', secretBlock: '' }, 'p'),
    /invalid server value/,
  );
});
