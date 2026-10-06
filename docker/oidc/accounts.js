// The four seeded local-dev accounts. manager-001, admin-001 and
// facilitator-001 carry a `role` claim (persona-login design.md D4/D5;
// configurable-oidc-role-map #243 D9). global_role for these flows through the
// OIDC role-claim mapping (packages/backend/src/auth/role-map.ts, called from
// account-resolver.ts) on every sign-in. Locally no OIDC_ROLE_MAP is set, so
// the backend's built-in identity map applies (local issuer, non-production)
// and each role string maps to itself. participant-001 is intentionally left
// without a role claim -- its default (`engineer`) already matches its label.
export const accounts = {
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
    role: "facilitator",
  },
  "manager-001": {
    sub: "manager-001",
    email: "manager@example.com",
    name: "Morgan Manager",
    password: "password",
    role: "engineering_manager",
  },
  "admin-001": {
    sub: "admin-001",
    email: "admin@example.com",
    name: "Riley Admin",
    password: "password",
    role: "application_admin",
  },
};
