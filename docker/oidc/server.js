import { Provider } from "oidc-provider";
import { accounts } from "./accounts.js";
import { createInteractionRouter } from "./interactions.js";

const ISSUER = process.env.OIDC_ISSUER ?? "http://localhost:4011";
const CLIENT_ID = process.env.OIDC_CLIENT_ID ?? "dipstick-local";
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? "dipstick-local-secret";
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI ?? "http://localhost:3000/auth/callback";

const configuration = {
  clients: [
    {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uris: [REDIRECT_URI],
      post_logout_redirect_uris: ["http://localhost:5173", "http://localhost:3000"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic",
    },
  ],
  pkce: { required: () => true },
  features: {
    // persona-login design.md D10: devInteractions is replaced by the
    // login_hint-aware auto-approve handler in interactions.js, mounted
    // below via provider.use(). devInteractions must be disabled (not left
    // enabled alongside a custom interactions.url) or its own routes would
    // shadow the custom ones.
    devInteractions: { enabled: false },
    resourceIndicators: { enabled: false },
    rpInitiatedLogout: { enabled: true },
  },
  scopes: ["openid", "profile", "email", "offline_access"],
  claims: {
    // `role` rides on the `profile` scope (already requested by this
    // client -- oidc-client.ts requests "openid profile email
    // offline_access") rather than a dedicated scope: a claim not listed
    // under any requested scope's claim map never enters the ID token's
    // claims mask (see the conformIdTokenClaims comment on that flag,
    // below), regardless of what findAccount's claims() returns.
    profile: ["name", "role"],
    email: ["email"],
  },
  // Pre-existing bug found and fixed while implementing persona-login
  // (openspec/changes/persona-login): oidc-provider's default
  // (conformIdTokenClaims: true) is spec-correct but means scope-requested
  // claims (profile/email, and this change's role claim) are only returned
  // from the userinfo endpoint once an access token is also issued -- they
  // never land on the ID token itself. This backend never calls
  // /userinfo (packages/backend/src/routes/auth.ts reads tokens.claims()
  // directly, by design -- see proposal.md's "no changes to auth.ts's
  // callback handler" commitment), so every sign-in through this stub was
  // silently losing name/email/role to this masking, with the app going
  // unnoticed because resolveOrCreateAccount falls back to `sub`-derived
  // values. false here makes this dev-only stub put all consented-scope
  // claims directly on the ID token, matching what this file already
  // claims to do.
  conformIdTokenClaims: false,
  ttl: {
    AccessToken: 3600, // 1 hour
    RefreshToken: 28800, // 8 hours
    IdToken: 3600,
    Session: 28800,
    Grant: 28800,
  },
  issueRefreshToken: async (ctx, client, code) => {
    // Issue refresh tokens when offline_access scope is granted
    return client.grantTypeAllowed("refresh_token") &&
      code.scopes.has("offline_access");
  },
  findAccount: async (_ctx, id) => {
    const account = accounts[id];
    if (!account) return undefined;
    return {
      accountId: id,
      async claims() {
        const claims = {
          sub: account.sub,
          email: account.email,
          name: account.name,
        };
        // Only manager-001 and admin-001 carry a role claim (see
        // accounts.js) -- asserted in the ID token so the existing
        // OIDC_ROLE_CLAIM mapping (account-resolver.ts) picks it up.
        if (account.role) {
          claims.role = account.role;
        }
        return claims;
      },
    };
  },
  interactions: {
    url(_ctx, interaction) {
      return `/interaction/${interaction.uid}`;
    },
  },
  cookies: {
    keys: ["dipstick-local-cookie-key"],
  },
  jwks: {
    // Pre-existing bug found and fixed while implementing persona-login
    // (openspec/changes/persona-login): this key was a 1760-bit RSA
    // modulus, below the 2048-bit minimum the installed `jose` version (a
    // transitive dependency of oidc-provider) enforces for RS256 signing.
    // Every local sign-in -- persona shortcut or manual -- failed at ID
    // token issuance with "RS256 requires key modulusLength to be 2048
    // bits or larger" before this fix; confirmed by reproducing against
    // the unmodified pre-persona-login server.js. Regenerated as a fresh
    // 2048-bit key, still inline and still local-dev-only.
    keys: [
      {
        kty: "RSA",
        n: "slR01tp-gx9UJ4UTywJcm_YLGxkjxTPlsAHfXwPZ3Jl_H481XT2IzO_TUq2PmFw2XRW_Fwnc9X1wiHBa2ToqSpp5KswLS1FOKD7O4MnhQcd8LNRZ8VpxHaVqLG6LOBXE-zhM7Wv-oD0CiqZ_vwYjrm2lwW2nZ79uCHzlbeYx0yaDU6aPVJNNuAbDC8esyKqiYXWnUJ1r0FxqZjDuyfDz-J8-M3Fivmyuq_iU08O0aRXuGOJ6iovcoHU-8KMqhXYTwH62DDJrCC4-KAXurEetCmcJ7oknqB_ngRo7F0R91186tNbJRDlcUoKinu7LyZHeyGGcR2R3Ebf2TOozlC5cjQ",
        e: "AQAB",
        d: "PJurj8HthiMCRNQB59jxv9GmiWPyXkJNzFVTIZU5lxTSbZmdo2C94Unfaz9P_t5s_HDYFE25vxZoMV6yJ8uXx_AxXU4o4nVx0GHbYBiWxCAl0-0guUJRoa7BwrxudW8oAdIKN32TQjkLWbbDvmUsh3Qg8UtVEWiAAlEyOf_2YUrWCMnmhfG8eemmZ7GWn5XOF1PdtNDBktZC8A2sm8yEw_gbhau6g14RqtVZpIdGXDmgT5bqql8mMs5Y2A3dPcqsDBRsold0EZl4ABxMRF-gv7zPuVzUWFw5uaLGO7swQATkqg8ZQ6BGtCbhAfRcjrqgZwsqz-fcAnpQ_2FZJoOZ",
        p: "5_OxS7A3iohgA7k8aZQqw9ZiZ-fqaUBRyszxstl7EyjaJcxMGrodV6Qny6668pBr0_9_lPyqO2VPsJ0j5gFO17Z2i6pwrFs-9eiiUUvCmcbsVAr7BGFEWrGfBxyXOpkj56nlOFbnaFOZVHGq2J4GFQqSYFku8lxb3SI5c5cSILk",
        q: "xNGQvexYS5nP2LB2KzsQ9-OR-N93sqv1PYQAsuyLIj9QptTw-U5H3JqkJHxochh7EKErwTzgDDhGwvITXExjIWV58gH8VVCNzDK177lRb8jLqixIVtTmyxVFm2Jqk0bsyusyMuqC_6ZB8o5LbpyeJxIZQydtz93l0xnjrhDMqHU",
        dp: "Rv2Es9-ZACNBD6Kv5LheZlXFBHwseE4hOmqDRvPdAT4tlgfy-vMfa-Vn8KTnvrmI5vd5usWh7E_TlgBiLlEUKl1D5vchSP8cQ_MRSsRfKOWDCy3ZKbwDSaa3P1v2xQ59uLd82kNuy7VaZkfrvCSRQ_taVXa2MaMm0oVZBBGmkLE",
        dq: "CAulBg5-QYDlHS-BdRzyAaAc3HaOFxCucrhNqwK-YUUDT_6OZzKK_3qW0SMAxgE4LqLX_gs2AWnfgqKQpgo9VyUlyf3IydgEI9_CzizeJlqn8Knkvx_u20hgUwy_3IterKDWqXwqpLawJXEppjjiwigcPkGDXKbueSWqx_fJ1e0",
        qi: "a-R2_wOcrZwvj7a-r9x7kKkRITWdmgnqikWgXkHfSd5uJgwmUTfeXQDXiDKHWyp5Uq5pOhYxmp0VFcFB5exzC1BxdXsYW-ETA3xxSH3WBzb83SmcCy-YKtEieszf8wtS4wQCDnHBC_aJT-rqB5Esc_7C39LJA8fyhzIEwjMVuhw",
      },
    ],
  },
};

const oidc = new Provider(ISSUER, configuration);

// D10: mount the login_hint-aware interaction router. provider.use() inserts
// custom middleware before the provider's own internal routing, so these
// routes take effect (devInteractions is disabled above, so nothing else
// handles /interaction/:uid).
const interactionRouter = createInteractionRouter(oidc, accounts);
oidc.use(interactionRouter.routes());
oidc.use(interactionRouter.allowedMethods());

const PORT = 4011;
oidc.listen(PORT, () => {
  console.log(`OIDC provider listening on http://localhost:${PORT}`);
  console.log(`Discovery: ${ISSUER}/.well-known/openid-configuration`);
});
