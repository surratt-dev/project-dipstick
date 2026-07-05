import { Provider } from "oidc-provider";

const ISSUER = process.env.OIDC_ISSUER ?? "http://localhost:4011";
const CLIENT_ID = process.env.OIDC_CLIENT_ID ?? "dipstick-local";
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? "dipstick-local-secret";
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI ?? "http://localhost:3000/auth/callback";

const accounts = {
  "participant-001": {
    sub: "participant-001",
    email: "participant@example.com",
    name: "Alex Participant",
    password: "password",
  },
  "facilitator-001": {
    sub: "facilitator-001",
    email: "facilitator@example.com",
    name: "Sam Facilitator",
    password: "password",
  },
  "manager-001": {
    sub: "manager-001",
    email: "manager@example.com",
    name: "Morgan Manager",
    password: "password",
  },
  "admin-001": {
    sub: "admin-001",
    email: "admin@example.com",
    name: "Riley Admin",
    password: "password",
  },
};

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
    devInteractions: { enabled: true },
    resourceIndicators: { enabled: false },
    rpInitiatedLogout: { enabled: true },
  },
  scopes: ["openid", "profile", "email", "offline_access"],
  claims: {
    profile: ["name"],
    email: ["email"],
  },
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
        return {
          sub: account.sub,
          email: account.email,
          name: account.name,
        };
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
    keys: [
      {
        kty: "RSA",
        // Inline test key — never use in production
        n: "pjdss8ZaDfEH6K6U7GeW2nxDqR4IP049fk1fK0lndimbMMVBdPv_hSpm8T8EtBDxrUdi1OHZfMhUixGaut-3nQ4GG9nM2rWxwEdrjBys1No7MtJoDKrXf1n310JwYV3Q09X7n4-xoILH4BBuns-DnTDT93xfDaNHXqe8GGlSBCNaFkMYcrHPzLNcL5GkmFUMx4iFaF0FjmcWA7GHgmgFnIVIHNsYFmGiJlDHHbIIXfkGGU0X5EpGHB7hc2UcehPVoOVTkBEUkSEkqKH_I1Gvj8F8j7hV8BVQIDAQAB",
        e: "AQAB",
        d: "ksDmucdMJXkFGZxiomNHnroOZxe7fytu-Qn3i-GeLFh3GKMiVkMrV5_Y4slvQFWRCLkKMs0Po7B0ApESAhMpwq9QWdBdUnTHzwNEWuJAVCKwBD0VFxP6kM36HrqDmb2iJSB_b0tLkXpSudV-B0RxGt7tU2cAPANHXe29bpT_dFcgKnZS7qxEAMhF7Teb0YtFOIKr45e98kY0lxJIjGn7j6Wiz_8lMZVWvVc5gG9zB0P3E4RwNzVSMoO3vfT66Z4-TQwk6Pz6rV9zJxMdT3QkCbBJBWzJc4SXqhCb_FHVKQfmBFvqbRFBQVBiTUEh9cVLwMx4YHLpC6AwAQ",
        p: "0GB3mMGBnNcMBFMh6MoNIDBrWIzLm7TuPDa8U_XGq7V9UJSOV73HBhv4_RkP9ELi9GaM9KY8Fq1FBs4vq8M4GkrHDa3R0S_-p-A-hDc3nxQNVbVw91UWQmUC9RQ6LWYRymIoHsz_MYkHLSb1MXDSAZkqK4PwxHQKBPt5nE",
        q: "w2kqT1r5y-VKS7x-JDluuvTNNDGbIlnuv1cygT8cH73sD2KHPOiH7HIPVjuGPvGpd0JObI5oi2Y9HCYpDnz0Cz76vLbnj5LFkwqm_7P9PKxOAQl1Ax5b0JKlWU1TMFMqq9a6JBRdJa5UBxjxU3REPEQUkq5JmMHZNIjUbzU",
        dp: "pDpgFtpHqsGsG3I3uqPVvfBJrJFMZ5e3bDtpGGwVGNvDNs1FPFGNBvmVDvH-x3YBDVP8nKHRJy8zQDJo6_Y2cAqdJzr4cN7CxZPv_JqFbJdvEJKhNmwO6H0lWJkEp9dGLl5E4vM3B3yWR8hcVVmST_FNkIDILVqC7mD7bc0",
        dq: "wU9E7e3RrZ1U_JVj-DfUPU8jMNKHGE5kFENTHZMnWMF8aeMXKAZHKTdK1DsU-ELhWvs_RUo1X3V_yMV8m4FvG8Bn-dUVdcVKwXXCGlhvBNNr4vOKmrWMvWOx1HXLB1-Kh0HQVJT3BKgqOVKXe2N3CJHrBUgL37V4Y09wj0",
        qi: "m5SJFDMFuvCRivJk3lzxCe0kAbBlGb0lXp4wqiPd5MwG9tgm5XrM5GTbBKxb8_P6d79s1dF3l0l0tEDkEBpg7nV-rTjJXvf48wMvQ_lWOULfB_D-7rDYzp1E4rkmqkLs0jHX06Y8g7VWzT9xQpfNxXD7XL5P2bSBkGJ4oFx4",
      },
    ],
  },
};

const oidc = new Provider(ISSUER, configuration);

const PORT = 4011;
oidc.listen(PORT, () => {
  console.log(`OIDC provider listening on http://localhost:${PORT}`);
  console.log(`Discovery: ${ISSUER}/.well-known/openid-configuration`);
});
