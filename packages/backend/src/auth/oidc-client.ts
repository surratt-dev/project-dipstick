import * as client from "openid-client";
import { config } from "../config.js";

let oidcConfig: client.Configuration | null = null;

export async function getOidcConfig(): Promise<client.Configuration> {
  if (oidcConfig) return oidcConfig;

  const execute =
    config.NODE_ENV !== "production" ? [client.allowInsecureRequests] : [];

  oidcConfig = await client.discovery(
    new URL(config.OIDC_ISSUER),
    config.OIDC_CLIENT_ID,
    config.OIDC_CLIENT_SECRET,
    client.ClientSecretBasic(config.OIDC_CLIENT_SECRET),
    { execute },
  );

  return oidcConfig;
}

export async function getAuthorizationUrl(
  state: string,
  nonce: string,
  codeVerifier: string,
): Promise<{ url: URL; codeVerifier: string }> {
  const oidc = await getOidcConfig();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  const url = client.buildAuthorizationUrl(oidc, {
    redirect_uri: config.OIDC_REDIRECT_URI,
    scope: "openid profile email offline_access",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    response_type: "code",
  });

  return { url, codeVerifier };
}

export async function handleCallback(
  callbackUrl: URL,
  expectedNonce: string,
  expectedState: string,
  codeVerifier: string,
): Promise<client.TokenEndpointResponse & client.TokenEndpointResponseHelpers> {
  const oidc = await getOidcConfig();

  const tokens = await client.authorizationCodeGrant(oidc, callbackUrl, {
    expectedNonce,
    expectedState,
    pkceCodeVerifier: codeVerifier,
    idTokenExpected: true,
  });

  return tokens;
}

export async function refreshToken(
  refreshTokenValue: string,
): Promise<client.TokenEndpointResponse & client.TokenEndpointResponseHelpers> {
  const oidc = await getOidcConfig();
  return client.refreshTokenGrant(oidc, refreshTokenValue);
}

export async function getEndSessionUrl(
  idTokenHint: string,
  postLogoutRedirectUri: string,
): Promise<URL | null> {
  const oidc = await getOidcConfig();
  const metadata = oidc.serverMetadata();

  if (!metadata.end_session_endpoint) {
    return null;
  }

  return client.buildEndSessionUrl(oidc, {
    id_token_hint: idTokenHint,
    post_logout_redirect_uri: postLogoutRedirectUri,
  });
}
