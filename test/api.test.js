import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmporiaClient } from '../src/emporia/api.js';
import { CognitoError } from '../src/emporia/cognito.js';
import { createFakeEmporia, memoryFile } from './helpers/fakeEmporia.js';

const credentials = { email: 'user@example.com', password: 'correct horse battery staple' };

function client(fake, sessionFile = memoryFile(), now = () => Date.now()) {
  const api = createEmporiaClient({ sessionFile, fetch: fake.fetch, now });
  api.setCredentials(credentials);
  return api;
}

test('reads the devices with the ID token in the authtoken header', async () => {
  const fake = createFakeEmporia();
  const devices = await client(fake).getDevices();
  assert.equal(devices.devices.length, 4);
  const [call] = fake.apiCalls('customers/devices');
  assert.ok(fake.idTokens.has(call.headers.authtoken));
});

test('a restart reuses the stored session: no new sign-in', async () => {
  const fake = createFakeEmporia();
  const sessionFile = memoryFile();
  await client(fake, sessionFile).getDevices();
  assert.equal(fake.signIns, 1);
  // The session file never holds the password.
  assert.ok(!JSON.stringify(sessionFile.value).includes(credentials.password));
  await client(fake, sessionFile).getDevices();
  assert.equal(fake.signIns, 1);
});

test('an expired ID token is renewed with the refresh token', async () => {
  const fake = createFakeEmporia();
  let clock = 0;
  const api = client(fake, memoryFile(), () => clock);
  await api.getDevices();
  clock += 56 * 60 * 1000; // past "expiry minus 5 minutes"
  await api.getDevices();
  assert.equal(fake.signIns, 1);
  assert.equal(
    fake.cognitoCalls('InitiateAuth').filter((c) => c.body.AuthFlow === 'REFRESH_TOKEN_AUTH')
      .length,
    1,
  );
});

test('a 401 renews the token once and retries', async () => {
  const fake = createFakeEmporia();
  const api = client(fake);
  await api.getDevices();
  fake.idTokens.clear(); // revoked server-side
  const devices = await api.getDevices();
  assert.equal(devices.devices.length, 4);
});

test('a revoked refresh token falls back to a new sign-in', async () => {
  const fake = createFakeEmporia();
  const api = client(fake);
  await api.getDevices();
  fake.idTokens.clear();
  fake.refreshTokens.clear();
  await api.getDevices();
  assert.equal(fake.signIns, 2);
});

test('a refused password is not tried again until the credentials change', async () => {
  const fake = createFakeEmporia();
  const api = createEmporiaClient({ sessionFile: memoryFile(), fetch: fake.fetch });
  api.setCredentials({ ...credentials, password: 'wrong' });
  await assert.rejects(api.getDevices(), CognitoError);
  assert.equal(api.accountRefused, true);
  await assert.rejects(api.getDevices(), CognitoError);
  assert.equal(fake.cognitoCalls('RespondToAuthChallenge').length, 1);

  api.setCredentials(credentials);
  assert.equal(api.accountRefused, false);
  await api.getDevices();
  assert.equal(fake.signIns, 1);
});

test('another account drops the stored session', async () => {
  const fake = createFakeEmporia();
  const sessionFile = memoryFile();
  await client(fake, sessionFile).getDevices();
  const other = createEmporiaClient({ sessionFile, fetch: fake.fetch });
  other.setCredentials({ email: 'someone@example.com', password: 'x' });
  await assert.rejects(other.getDevices(), (err) => err.isAccountError);
  assert.equal(sessionFile.value, null);
});

test('the usage request names every device and the scale', async () => {
  const fake = createFakeEmporia();
  await client(fake).getUsage([480001, 480010], Date.UTC(2026, 9, 14, 18, 15), '1MIN');
  const [call] = fake.apiCalls('AppAPI');
  assert.equal(
    call.path,
    'AppAPI?apiMethod=getDeviceListUsages&deviceGids=480001+480010' +
      '&instant=2026-10-14T18:15:00.000Z&scale=1MIN&energyUnit=KilowattHours',
  );
});

test('an API error carries its status, never the token', async () => {
  const fake = createFakeEmporia();
  const api = client(fake);
  fake.api = () => new Response('', { status: 503 });
  await assert.rejects(api.getStatus(), (err) => {
    assert.equal(err.status, 503);
    assert.ok(!err.message.includes('id-token'));
    return true;
  });
});
