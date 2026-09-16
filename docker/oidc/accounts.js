// The four seeded local-dev accounts. Only manager-001 and admin-001 carry a
// `role` claim (persona-login design.md D4/D5): global_role for these two
// flows through the existing OIDC role-claim mapping
// (packages/backend/src/auth/account-resolver.ts) on every sign-in.
// facilitator-001 and participant-001 are intentionally left without a role
// claim -- `facilitator` is not on PERMITTED_GLOBAL_ROLES, and participant's
// default (`engineer`) already matches its label.
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
