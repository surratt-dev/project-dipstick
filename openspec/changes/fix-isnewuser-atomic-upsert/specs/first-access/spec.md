## MODIFIED Requirements

### Requirement: Automatic account creation on first authentication
The application SHALL automatically create a new user account when a valid identity assertion is received and no existing account matches the IdP's subject claim (`sub`) and issuer (`iss`). The new account SHALL have no team memberships and no assigned roles. Account creation SHALL NOT require manual provisioning or administrator action. The implementation uses a single upsert (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`) keyed on the compound unique constraint `(oidc_subject, oidc_issuer)`. Whether the account is newly created (`isNewUser`) is derived from that same upsert's `RETURNING` clause via `(xmax = 0) AS is_new_user` — a PostgreSQL-internal idiom that is true only for a row this statement inserted and false for a row it updated via `DO UPDATE`. No separate SELECT is performed to determine `isNewUser`; the flag is race-free because it is computed within the single statement that performs the write.

#### Scenario: First-time user authenticated
- **WHEN** a valid ID token is received with `sub` and `iss` claims that do not match any existing user's `oidc_subject` and `oidc_issuer`
- **THEN** a new user record is created with `oidc_subject` set to the `sub` claim, `oidc_issuer` set to the `iss` claim, `display_name` from the `name` claim (falling back to `email`, then `sub`), `email` from the `email` claim (falling back to `{sub}@unknown`), and no team memberships

#### Scenario: Returning user authenticated
- **WHEN** a valid ID token is received with `sub` and `iss` claims that match an existing user's `oidc_subject` and `oidc_issuer`
- **THEN** no new account is created; the existing account is used; `display_name` and `email` are updated from the token claims

#### Scenario: Account creation failure
- **WHEN** a system error prevents account creation during First Access
- **THEN** no session is established, the user receives a generic error message, and the error is logged with sufficient detail for operator diagnosis

---

### Requirement: Concurrent First Access handling
The application SHALL handle concurrent First Access account creations without serialization. The upsert pattern (`ON CONFLICT DO UPDATE`) ensures that duplicate `sub`/`iss` arrivals result in one account record with an update, not an error. Concurrency is handled at the database level: when two callbacks arrive simultaneously for the same new user, exactly one INSERT succeeds and the other performs an update; both return the correct user record. The `isNewUser` flag is derived per-call from that call's own upsert `RETURNING` result (`(xmax = 0) AS is_new_user`), not from a prior SELECT. Because the flag is computed within the same statement that performs the write, at most one of the two racing callbacks can observe `isNewUser = true` for a given identity — the SELECT-before-upsert race that previously allowed both callbacks to observe `isNewUser = true` cannot occur.

#### Scenario: Batch first-time authentication
- **WHEN** 10 users authenticate for the first time within 30 seconds
- **THEN** all 10 accounts are created independently without visible delays for individual users

#### Scenario: Duplicate subject claim race condition
- **WHEN** two concurrent callbacks arrive for the same user (same `sub`/`iss`)
- **THEN** one insert succeeds and the other performs an upsert update; both callbacks result in a valid session for the same user account; exactly one of the two callbacks observes `isNewUser = true` and the other observes `isNewUser = false`, each derived from its own upsert's `RETURNING` result

---

## REMOVED Requirements

None. No requirement is removed — the derivation mechanism changes but the guarantees offered (automatic creation, sub/iss matching, race-free account writes) remain the same or strengthen. The related Known Limitations entry and Open Issues line for #8 are updated directly in `openspec/specs/first-access/spec.md` at archive time to reflect that the `isNewUser` race is closed (see tasks.md) — those are prose sections outside the Requirements delta format, not requirement-level changes.
