import crypto from 'node:crypto';

export interface PkceChallengePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  state: string;
}

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
  tokenType: 'Bearer';
  scope?: string;
}

function toBase64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * RFC 7636 OAuth 2.0 PKCE Manager (`OAuthPkceManager`) for Transform Hub & TDS providers.
 */
export class OAuthPkceManager {
  public generatePkceChallenge(): PkceChallengePair {
    const verifierBytes = crypto.randomBytes(32);
    const codeVerifier = toBase64Url(verifierBytes);
    const challengeDigest = crypto.createHash('sha256').update(codeVerifier).digest();
    const codeChallenge = toBase64Url(challengeDigest);
    const state = toBase64Url(crypto.randomBytes(16));

    return {
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: 'S256',
      state,
    };
  }

  public verifyChallengePair(codeVerifier: string, expectedChallenge: string): boolean {
    const computed = toBase64Url(crypto.createHash('sha256').update(codeVerifier).digest());
    return computed === expectedChallenge;
  }

  public buildAuthorizationUrl(options: {
    authorizationEndpoint: string;
    clientId: string;
    redirectUri: string;
    challenge: PkceChallengePair;
    scopes?: string[];
  }): string {
    const url = new URL(options.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', options.clientId);
    url.searchParams.set('redirect_uri', options.redirectUri);
    url.searchParams.set('code_challenge', options.challenge.codeChallenge);
    url.searchParams.set('code_challenge_method', options.challenge.codeChallengeMethod);
    url.searchParams.set('state', options.challenge.state);
    if (options.scopes && options.scopes.length > 0) {
      url.searchParams.set('scope', options.scopes.join(' '));
    }
    return url.toString();
  }
}
