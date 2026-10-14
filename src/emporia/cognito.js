// -----------------------------------------------------------------------------
// AWS Cognito sign-in of an Emporia account.
//
// Emporia's mobile app (and PyEmVue) sign in against a public Cognito app
// client: InitiateAuth (USER_SRP_AUTH) → PASSWORD_VERIFIER challenge →
// RespondToAuthChallenge, then REFRESH_TOKEN_AUTH to renew the tokens. The
// app client has no secret, so the calls need no AWS signature: plain JSON
// over HTTPS. The ID token is the one the Emporia API wants.
// -----------------------------------------------------------------------------

import { createSrpSession } from './srp.js';

export const USER_POOL_ID = 'us-east-2_ghlOXVLi1';
export const CLIENT_ID = '4qte47jbstod8apnfic0bunmrq';
export const COGNITO_ENDPOINT = 'https://cognito-idp.us-east-2.amazonaws.com/';

const TIMEOUT_MS = 15000;

// Cognito answers these when the email or the password is wrong, or when the
// account cannot sign in as is: retrying will not help, the user must act.
const ACCOUNT_ERRORS = new Set([
  'NotAuthorizedException',
  'UserNotFoundException',
  'UserNotConfirmedException',
  'PasswordResetRequiredException',
  'ChallengeNotSupported',
]);

export class CognitoError extends Error {
  /**
   * @param {string} type Cognito error type (NotAuthorizedException...)
   * @param {string} message never carries a credential
   */
  constructor(type, message) {
    super(message);
    this.name = 'CognitoError';
    this.type = type;
  }

  /** The account itself is refused: wrong email or password, MFA... */
  get isAccountError() {
    return ACCOUNT_ERRORS.has(this.type);
  }
}

async function call(fetchImpl, action, body) {
  let response;
  try {
    response = await fetchImpl(COGNITO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new CognitoError('NetworkError', `Cognito unreachable (${err.cause?.code ?? err.name})`);
  }
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // An HTML error page from a proxy: the status says enough.
  }
  if (!response.ok) {
    // "__type" is "NotAuthorizedException" or "com.amazon...#NotAuthorizedException".
    const type = String(json.__type ?? `HTTP${response.status}`)
      .split('#')
      .pop();
    const message = String(json.message ?? json.Message ?? `HTTP ${response.status}`);
    throw new CognitoError(type, `${type}: ${message}`);
  }
  return json;
}

/** The useful part of an AuthenticationResult, with an absolute expiry. */
function toTokens(result, now, previousRefreshToken) {
  if (!result?.IdToken) {
    throw new CognitoError('InvalidResponse', 'Cognito answered without tokens');
  }
  return {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    // A refresh does not send a new refresh token: keep the one we used.
    refreshToken: result.RefreshToken ?? previousRefreshToken,
    expiresAt: now() + Number(result.ExpiresIn ?? 3600) * 1000,
  };
}

/**
 * Sign in with the email and password of the Emporia account (SRP: the
 * password itself is never sent).
 * @param {object} options
 * @param {string} options.email
 * @param {string} options.password
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 */
export async function signIn({ email, password, fetch: fetchImpl = fetch, now = Date.now }) {
  const srp = createSrpSession({ poolId: USER_POOL_ID });
  const started = await call(fetchImpl, 'InitiateAuth', {
    AuthFlow: 'USER_SRP_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { USERNAME: email, SRP_A: srp.srpA },
  });
  if (started.ChallengeName !== 'PASSWORD_VERIFIER') {
    throw new CognitoError(
      'ChallengeNotSupported',
      `Cognito asked for ${started.ChallengeName ?? 'nothing'}, only the password is supported`,
    );
  }
  const params = started.ChallengeParameters ?? {};
  const { timestamp, signature } = srp.respond(
    {
      userIdForSrp: params.USER_ID_FOR_SRP,
      srpB: params.SRP_B,
      salt: params.SALT,
      secretBlock: params.SECRET_BLOCK,
    },
    password,
    new Date(now()),
  );
  const answered = await call(fetchImpl, 'RespondToAuthChallenge', {
    ChallengeName: 'PASSWORD_VERIFIER',
    ClientId: CLIENT_ID,
    Session: started.Session,
    ChallengeResponses: {
      USERNAME: params.USERNAME ?? params.USER_ID_FOR_SRP,
      PASSWORD_CLAIM_SECRET_BLOCK: params.SECRET_BLOCK,
      PASSWORD_CLAIM_SIGNATURE: signature,
      TIMESTAMP: timestamp,
    },
  });
  if (answered.ChallengeName) {
    // MFA, forced password change...: the Emporia app must be used first.
    throw new CognitoError(
      'ChallengeNotSupported',
      `Cognito asked for ${answered.ChallengeName}, which this integration cannot answer`,
    );
  }
  return toTokens(answered.AuthenticationResult, now);
}

/**
 * Renew the ID and access tokens with the refresh token.
 * @param {object} options
 * @param {string} options.refreshToken
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 */
export async function refreshSession({ refreshToken, fetch: fetchImpl = fetch, now = Date.now }) {
  const answered = await call(fetchImpl, 'InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
  return toTokens(answered.AuthenticationResult, now, refreshToken);
}
