import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CognitoError, refreshSession, signIn } from '../src/emporia/cognito.js';
import { createFakeEmporia } from './helpers/fakeEmporia.js';

const email = 'user@example.com';
const password = 'correct horse battery staple';

test('signs in with SRP and gets the tokens', async () => {
  const fake = createFakeEmporia({ email, password });
  const tokens = await signIn({ email, password, fetch: fake.fetch, now: () => 1000 });
  assert.ok(fake.idTokens.has(tokens.idToken));
  assert.ok(tokens.refreshToken);
  assert.equal(tokens.expiresAt, 1000 + 3600 * 1000);
  // The password itself never travels.
  assert.ok(!JSON.stringify(fake.requests).includes(password));
});

test('a wrong password is an account error', async () => {
  const fake = createFakeEmporia({ email, password });
  await assert.rejects(
    signIn({ email, password: 'nope', fetch: fake.fetch }),
    (err) =>
      err instanceof CognitoError && err.type === 'NotAuthorizedException' && err.isAccountError,
  );
});

test('an unknown email is an account error too', async () => {
  const fake = createFakeEmporia({ email, password });
  await assert.rejects(
    signIn({ email: 'other@example.com', password, fetch: fake.fetch }),
    (err) => err.isAccountError,
  );
});

test('an MFA challenge is refused clearly', async () => {
  const fake = createFakeEmporia({ email, password, challenge: 'SOFTWARE_TOKEN_MFA' });
  await assert.rejects(
    signIn({ email, password, fetch: fake.fetch }),
    (err) => err.type === 'ChallengeNotSupported' && err.isAccountError,
  );
});

test('a network failure is not an account error', async () => {
  const fake = createFakeEmporia();
  fake.down = true;
  await assert.rejects(
    signIn({ email, password, fetch: fake.fetch }),
    (err) => err.type === 'NetworkError' && !err.isAccountError,
  );
});

test('the refresh keeps the refresh token Cognito does not send back', async () => {
  const fake = createFakeEmporia({ email, password });
  const first = await signIn({ email, password, fetch: fake.fetch });
  const renewed = await refreshSession({ refreshToken: first.refreshToken, fetch: fake.fetch });
  assert.notEqual(renewed.idToken, first.idToken);
  assert.equal(renewed.refreshToken, first.refreshToken);
  await assert.rejects(
    refreshSession({ refreshToken: 'revoked', fetch: fake.fetch }),
    (err) => err.isAccountError,
  );
});
