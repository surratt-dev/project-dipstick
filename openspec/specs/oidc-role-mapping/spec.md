# oidc-role-mapping

## Purpose

Defines how a deployment translates the values carried on its IdP's role claim into the application's fixed internal global roles. Covers configuration, startup validation, resolution at sign-in, and the safety signals that keep a mapping mistake from silently weakening the no-manager rule or the facilitator gate.

## Requirements

### Requirement: Role map configuration format
The application SHALL accept an optional `OIDC_ROLE_MAP` environment variable whose value is a JSON object mapping IdP claim values (keys) to internal global roles (targets). Every key and every target SHALL be a non-empty string. A key SHALL NOT begin or end with whitespace, because exact matching means such a key can never match a real claim value. Any other shape SHALL stop the process at startup with an error naming the rule that was broken.

#### Scenario: Valid map is accepted
- **WHEN** the backend starts with `OIDC_ROLE_MAP='{"Dipstick-Admins":"application_admin","Eng-Managers":"engineering_manager"}'`
- **THEN** startup succeeds and the map is used for role resolution

#### Scenario: Unparseable JSON stops startup
- **WHEN** `OIDC_ROLE_MAP` is set to a string that is not valid JSON
- **THEN** the process exits at startup with an error stating that `OIDC_ROLE_MAP` is not valid JSON
- **AND** the error is a fixed message that quotes no part of the value (no fragment of four or more characters from the input appears in it), even when the value is under 30 characters

#### Scenario: Non-object value stops startup
- **WHEN** `OIDC_ROLE_MAP` parses to an array, a string, a number, or `null`
- **THEN** the process exits at startup with an error stating that `OIDC_ROLE_MAP` must be a JSON object

#### Scenario: Non-string or empty target stops startup
- **WHEN** `OIDC_ROLE_MAP` is `{"A": null}`, `{"A": 1}`, or `{"A": ""}`
- **THEN** the process exits at startup with an error naming key `A` and stating that its target must be a non-empty role string

#### Scenario: Empty key stops startup
- **WHEN** `OIDC_ROLE_MAP` contains the key `""`
- **THEN** the process exits at startup with an error stating that map keys must be non-empty

#### Scenario: Key with surrounding whitespace stops startup
- **WHEN** `OIDC_ROLE_MAP` is `{" Eng-Managers":"engineering_manager"}`
- **THEN** the process exits at startup with an error stating that map keys must not begin or end with whitespace

---

### Requirement: Map keys contain no invisible characters
A key SHALL NOT contain a control character or a zero-width character (U+200B–U+200D, U+2060, U+FEFF). Other format characters, such as bidi marks, SHALL remain permitted so that right-to-left group names still work. Such characters usually arrive by copy-paste from an IdP console and make the key impossible to match, which would silently drop the users it was meant to map. Any such key SHALL stop the process at startup with an error that names the key with the character shown escaped.

#### Scenario: Key with an invisible character stops startup
- **WHEN** `OIDC_ROLE_MAP` contains a key with a zero-width space inside it, such as `Eng`, U+200B, `-Managers`
- **THEN** the process exits at startup with an error naming the key, with the invisible character shown escaped, and stating that it contains invisible or control characters

---

### Requirement: Empty role map value is treated as unset
An `OIDC_ROLE_MAP` value that is empty or whitespace-only SHALL be treated as unset, the same way the backend treats its other optional variables.

#### Scenario: Empty value outside production is treated as unset
- **WHEN** a non-production deployment with a local `OIDC_ISSUER` starts with `OIDC_ROLE_MAP=` (empty) or a whitespace-only value
- **THEN** startup succeeds with the built-in default map and the summary line reports source `default`

#### Scenario: Empty value in production is treated as unset
- **WHEN** the backend starts with `NODE_ENV=production` and `OIDC_ROLE_MAP=` (empty) or a whitespace-only value
- **THEN** the process exits at startup with an error stating that `OIDC_ROLE_MAP` is required in production

---

### Requirement: Permitted map targets
Every `OIDC_ROLE_MAP` target SHALL be one of `application_admin`, `engineering_manager`, `facilitator`, `senior_engineer`, checked by exact membership in that set of four strings and never by a lookup that can reach names the language runtime inherits. `engineer` SHALL NOT be a permitted target, because it is the fixed fallback and mapping a group to it could hide a manager. Any other target SHALL stop the process at startup with an error naming the offending key.

#### Scenario: Unknown target stops startup
- **WHEN** `OIDC_ROLE_MAP` is `{"Admins":"admin"}`
- **THEN** the process exits at startup with an error naming key `Admins` and listing the permitted targets

#### Scenario: engineer target stops startup
- **WHEN** `OIDC_ROLE_MAP` is `{"Eng-Managers":"engineer"}`
- **THEN** the process exits at startup with an error naming key `Eng-Managers`, stating that `engineer` is not a permitted target, and explaining that `engineer` is the fixed default every unmapped user already receives, so it cannot be mapped

#### Scenario: Inherited property names are not permitted targets
- **WHEN** `OIDC_ROLE_MAP` is `{"A":"toString"}` or `{"A":"__proto__"}`
- **THEN** the process exits at startup with an error naming key `A` and listing the permitted targets

---

### Requirement: Duplicate map keys are rejected
A key that appears more than once in the `OIDC_ROLE_MAP` JSON text SHALL stop the process at startup with an error naming the duplicated key. Keys SHALL be compared after JSON string decoding, so two spellings that decode to the same string are duplicates. The application SHALL NOT silently keep one of the duplicates. If the application cannot verify that keys are unique, startup SHALL fail rather than skip the check.

#### Scenario: Duplicate key stops startup
- **WHEN** `OIDC_ROLE_MAP` is `{"Eng-Managers":"engineering_manager","Eng-Managers":"senior_engineer"}`
- **THEN** the process exits at startup with an error naming the duplicated key `Eng-Managers`

#### Scenario: Escape-equivalent duplicate key stops startup
- **WHEN** `OIDC_ROLE_MAP` is `{"Eng-Managers":"engineering_manager","\u0045ng-Managers":"senior_engineer"}`, where the second key spells its first character as the six-character JSON escape `\u0045` (backslash, `u`, `0045`), which decodes to `E`
- **THEN** the process exits at startup with an error naming the duplicated key `Eng-Managers`

---

### Requirement: Startup errors do not echo the map
No startup error, warning, or info line SHALL print the full `OIDC_ROLE_MAP` value or any fragment of it beyond a single offending key and, where relevant, its target. Keys and targets SHALL be printed JSON-escaped, with invisible format characters and U+2028/U+2029 also shown as `\uXXXX`, so no key can split, hide or forge log text. The raw `OIDC_ROLE_MAP` string SHALL NOT be stored on the exported configuration object.

#### Scenario: Validation error output omits the full value
- **WHEN** startup fails because one target in a multi-entry `OIDC_ROLE_MAP` is invalid
- **THEN** the full `OIDC_ROLE_MAP` string does not appear anywhere in the process output

---

### Requirement: Production deployments must map managers
When `NODE_ENV=production`, startup SHALL fail if `OIDC_ROLE_MAP` is unset or if no key targets `engineering_manager`. Without a manager mapping, every manager would resolve to `engineer` and the no-manager rule would fail open with no visible error. This guard checks only that a manager key exists, not that it matches any user's claim, and it SHALL NOT be documented or cited as evidence that managers are excluded.

#### Scenario: Production without a map does not boot
- **WHEN** the backend starts with `NODE_ENV=production` and `OIDC_ROLE_MAP` unset
- **THEN** the process exits at startup with an error stating that `OIDC_ROLE_MAP` is required in production

#### Scenario: Production map with no manager target does not boot
- **WHEN** the backend starts with `NODE_ENV=production` and `OIDC_ROLE_MAP='{"Dipstick-Admins":"application_admin","Retro-Facilitators":"facilitator"}'`
- **THEN** the process exits at startup with an error stating that at least one key must target `engineering_manager`

#### Scenario: Empty map does not boot in production
- **WHEN** the backend starts with `NODE_ENV=production` and `OIDC_ROLE_MAP='{}'`
- **THEN** the process exits at startup because no key targets `engineering_manager`

---

### Requirement: Warnings for missing targets in a configured map
When `OIDC_ROLE_MAP` is configured, in any `NODE_ENV`, and startup otherwise succeeds, the application SHALL log one warning for each of `engineering_manager`, `facilitator` and `application_admin` that no key targets. In production a missing `engineering_manager` target stops startup instead, so it is never a warning there. None of the warnings SHALL stop startup. When the built-in default map is in use, no missing-target warnings SHALL be logged.

#### Scenario: No admin target warns
- **WHEN** a production deployment starts with a map that targets `engineering_manager` and `facilitator` but not `application_admin`
- **THEN** startup succeeds and a warning states that no IdP value maps to `application_admin`

#### Scenario: Configured map outside production warns like production
- **WHEN** a non-production deployment starts with `OIDC_ROLE_MAP='{"Retro-Facilitators":"facilitator"}'`
- **THEN** startup succeeds with exactly two missing-target warnings, one for `engineering_manager` and one for `application_admin`

#### Scenario: Default map logs no missing-target warnings
- **WHEN** a non-production deployment with a local `OIDC_ISSUER` starts with `OIDC_ROLE_MAP` unset
- **THEN** no missing-target warning is logged

---

### Requirement: Missing-target warning wording
The facilitator missing-target warning SHALL say plainly that no user will be able to run a session. The manager missing-target warning SHALL say that managers will be treated as engineers. The admin missing-target warning SHALL say that no user will be an application admin.

#### Scenario: No facilitator target warns
- **WHEN** a production deployment starts with a map that targets `engineering_manager` and `application_admin` but not `facilitator`
- **THEN** startup succeeds and a warning states that no IdP value maps to `facilitator` and no user will be able to run a session

#### Scenario: No manager target warns outside production
- **WHEN** a non-production deployment starts with a map that targets `facilitator` and `application_admin` but not `engineering_manager`
- **THEN** startup succeeds and a warning states that managers will be treated as engineers

---

### Requirement: Startup role map summary
Once per process start, and only after role map validation succeeds, the application SHALL write one informational line to standard output, beginning with the fixed prefix `OIDC_ROLE_MAP:`, reporting the map source (`source=configured` or `source=default`) and the number of keys mapped to each of the four permitted targets as `<role>=<count>`, listing all four including zeros. The line SHALL NOT include any key names. A failed boot SHALL NOT log it.

#### Scenario: Summary line reports counts only
- **WHEN** the backend starts with a configured map of two `engineering_manager` keys and one `facilitator` key
- **THEN** one line `OIDC_ROLE_MAP: source=configured engineering_manager=2 facilitator=1 application_admin=0 senior_engineer=0` is logged, containing no key names

#### Scenario: Summary line for the default map
- **WHEN** a non-production deployment with a local `OIDC_ISSUER` starts with `OIDC_ROLE_MAP` unset
- **THEN** one line `OIDC_ROLE_MAP: source=default engineering_manager=1 facilitator=1 application_admin=1 senior_engineer=1` is logged

#### Scenario: No summary line on a failed boot
- **WHEN** startup fails role map validation
- **THEN** no role map summary line is logged

---

### Requirement: Identity default only for a local issuer outside production
When `OIDC_ROLE_MAP` is unset, `NODE_ENV` is not exactly `production`, and `OIDC_ISSUER` is a local or private address (as already determined for the persona-login gate), the application SHALL use a built-in default map in which `application_admin`, `engineering_manager`, `facilitator` and `senior_engineer` each map to themselves. A claim value of `engineer` is unmapped and falls through to the `engineer` fallback.

#### Scenario: Default map resolves internal role strings
- **WHEN** a non-production deployment with a local `OIDC_ISSUER` has no `OIDC_ROLE_MAP` and users sign in with role claims `facilitator` and `senior_engineer`
- **THEN** their `global_role` values are `facilitator` and `senior_engineer` respectively

#### Scenario: Staging with a local issuer uses the default
- **WHEN** a deployment starts with `NODE_ENV=staging`, `OIDC_ISSUER=http://localhost:4011` and `OIDC_ROLE_MAP` unset
- **THEN** startup succeeds with the built-in default map and the summary line reports source `default`

#### Scenario: Default map preserves today's behaviour for existing roles
- **WHEN** a non-production deployment with a local `OIDC_ISSUER` has no `OIDC_ROLE_MAP` and users sign in with role claims `engineering_manager`, `application_admin`, and `engineer`
- **THEN** their `global_role` values are `engineering_manager`, `application_admin`, and `engineer` respectively

#### Scenario: Empty map outside production is allowed with warnings
- **WHEN** a non-production deployment starts with `OIDC_ROLE_MAP='{}'`
- **THEN** startup succeeds, three missing-target warnings are logged (`engineering_manager`, `facilitator`, `application_admin`), and every user resolves to `engineer`

---

### Requirement: A real IdP always requires a role map
When `OIDC_ROLE_MAP` is unset and `OIDC_ISSUER` is not recognised as a local or private address, startup SHALL fail in every `NODE_ENV`, with an error stating that `OIDC_ROLE_MAP` is required when `OIDC_ISSUER` is not a local address. An issuer the application cannot classify SHALL be treated as not local.

#### Scenario: Non-production deployment on a real IdP without a map does not boot
- **WHEN** a deployment starts with `NODE_ENV=staging` (or `prod`, `uat`, `development`), `OIDC_ISSUER=https://idp.example.com` and `OIDC_ROLE_MAP` unset
- **THEN** the process exits at startup with an error stating that `OIDC_ROLE_MAP` is required when `OIDC_ISSUER` is not a local address

---

### Requirement: Role claim normalization
At sign-in, the application SHALL normalize the configured role claim into a list of values. A non-empty string SHALL be a list of one. An array SHALL keep only its non-empty string elements; if no element survives, the claim SHALL count as missing. Any other type and an empty string SHALL count as a missing claim.

#### Scenario: Array claim with mixed element types
- **WHEN** the role claim is `["Eng-Managers", 42]` and `Eng-Managers` maps to `engineering_manager`
- **THEN** the non-string element is ignored and the user's `global_role` is `engineering_manager`

#### Scenario: Empty string and empty array count as missing
- **WHEN** the role claim is `""` or `[]`
- **THEN** the claim is treated as missing and the user's `global_role` is `engineer`

#### Scenario: Array with no non-empty string elements counts as missing
- **WHEN** the role claim is `["", 42, null]`
- **THEN** the claim is treated as missing, the user's `global_role` is `engineer`, and no role-claim warning is logged

#### Scenario: Non-string scalar counts as missing
- **WHEN** the role claim is a number, boolean, or object
- **THEN** the claim is treated as missing and the user's `global_role` is `engineer`

---

### Requirement: Exact own-key lookup
Each normalized value SHALL be looked up by exact, case-sensitive match against the keys the operator wrote in the map, and only those keys. A value matching a name the map inherits from the language runtime, such as `constructor`, `__proto__` or `toString`, SHALL be unmapped unless the operator wrote that exact key.

#### Scenario: Case differs from the map key
- **WHEN** the map has key `Eng-Managers` and the claim value is `eng-managers`
- **THEN** the value is unmapped

#### Scenario: Inherited property names do not resolve
- **WHEN** the role claim is `"constructor"`, `"__proto__"`, or `"toString"` and none of these is a key the operator wrote
- **THEN** each value is unmapped and the user's `global_role` is `engineer`

---

### Requirement: Fixed precedence across several mapped values
When one or more normalized values map to a role, the resolved `global_role` SHALL be the highest of those roles in the fixed order `application_admin` > `engineering_manager` > `facilitator` > `senior_engineer` > `engineer`. The order SHALL NOT be configurable. `users.global_role` SHALL hold exactly one value. `users.roles` SHALL hold every mapped role once, highest first, and `users.global_role` SHALL equal its first element. Audit data SHALL record the role set in the same order.

#### Scenario: Admin and facilitator resolve to admin
- **WHEN** a user's claim values map to `application_admin` and `facilitator`
- **THEN** the user's `global_role` is `application_admin`
- **AND** the user's `roles` is exactly `[application_admin, facilitator]`

#### Scenario: Manager and facilitator resolve to manager (known behaviour)
- **WHEN** a user's claim values map to `engineering_manager` and `facilitator`
- **THEN** the user's `global_role` is `engineering_manager`
- **AND** the user's `roles` is exactly `[engineering_manager, facilitator]`
- **AND** no user-facing notice is shown by this capability (the notice belongs to #241)

#### Scenario: Admin and manager resolve to admin
- **WHEN** a user's claim values map to `application_admin` and `engineering_manager`
- **THEN** the user's `global_role` is `application_admin`
- **AND** the user's `roles` is exactly `[application_admin, engineering_manager]`, so the manager role is recorded even though it does not win precedence
- **AND** the user cannot take part in or receive live events of any session (see `session-participation` and `websocket-session-authorization`)

#### Scenario: Facilitator and senior engineer resolve to facilitator
- **WHEN** a user's claim values map to `facilitator` and `senior_engineer`
- **THEN** the user's `global_role` is `facilitator`
- **AND** the user's `roles` is exactly `[facilitator, senior_engineer]`

#### Scenario: Duplicate and out-of-order mapped values are stored once, highest first
- **WHEN** a user's claim is `["Facilitators", "Eng-Mgrs", "Dipstick-Admins", "Eng-Mgrs"]` and those keys map to `facilitator`, `engineering_manager` and `application_admin`
- **THEN** the user's `roles` is exactly `[application_admin, engineering_manager, facilitator]`
- **AND** the user's `global_role` is `application_admin`

#### Scenario: Single-string claim stores a one-element set
- **WHEN** a user's claim is the single string `"facilitator"` (not an array) and that value maps to `facilitator`
- **THEN** the user's `roles` is exactly `[facilitator]` and `global_role` is `facilitator`

#### Scenario: Admin and senior engineer store the full set
- **WHEN** a user's claim values map to `application_admin` and `senior_engineer`
- **THEN** the user's `roles` is exactly `[application_admin, senior_engineer]` and `global_role` is `application_admin`
- **AND** no precedence-discard line is logged, because `senior_engineer` is outside the discard scope

---

### Requirement: Fixed engineer fallback
When no normalized value maps to a role, including when the claim is missing, the resolved `global_role` SHALL be `engineer`. The fallback SHALL NOT be configurable. In that case `users.roles` SHALL be exactly `{engineer}`. `engineer` SHALL appear in `users.roles` only as its sole element; it is the absence of a mapped role, not a role held alongside others.

#### Scenario: Nothing mapped
- **WHEN** a user's claim is `["All-Staff", "Building-3"]` and neither value is a map key
- **THEN** the user's `global_role` is `engineer`, the user's `roles` is exactly `[engineer]`, and sign-in succeeds

#### Scenario: Missing claim stores the engineer set
- **WHEN** a user signs in without the configured role claim
- **THEN** the user's `roles` is exactly `[engineer]`

#### Scenario: Senior engineer alone does not include engineer
- **WHEN** a user's claim values map only to `senior_engineer`
- **THEN** the user's `roles` is exactly `[senior_engineer]`

#### Scenario: Inherited property names produce the engineer set
- **WHEN** the role claim is `["toString", "__proto__", "constructor"]` and none of these is a key the operator wrote
- **THEN** the user's `roles` is exactly `[engineer]`

---

### Requirement: Role mapping logging never carries claim values
No log line or audit record produced by role mapping at sign-in SHALL contain a claim value or a map key. Every such line SHALL be a structured record whose fields, not only its message text, carry the configured claim name and the sign-in's `correlationId`.

#### Scenario: Present but wholly unmapped claim warns with the name only
- **WHEN** a user signs in with role claim `["All-Staff"]` and nothing maps
- **THEN** one warning is logged containing the configured claim name and the sign-in's `correlationId`
- **AND** the string `All-Staff` appears in no log line and no audit record

---

### Requirement: Role claim warnings at sign-in
At sign-in, a missing claim SHALL log nothing, except that when the token has an own `_claim_names` entry for the configured claim name (as Entra ID sends on group overage) the application SHALL log exactly one warning with the reason `claim_overage`. A claim with at least one value but zero mapped values SHALL log exactly one warning per sign-in attempt. A claim with some mapped and some unmapped values SHALL NOT log a warning.

#### Scenario: Missing claim is silent
- **WHEN** a user signs in without the configured role claim and the token has no `_claim_names` entry for it
- **THEN** no warning about the role claim is logged

#### Scenario: Claim omitted for overage warns with the name only
- **WHEN** a user signs in with `OIDC_ROLE_CLAIM=groups`, no `groups` claim, and `_claim_names: { "groups": "src1" }` on the token
- **THEN** the user's `global_role` is `engineer`
- **AND** one warning is logged carrying the claim name `groups`, the reason `claim_overage` and the sign-in's `correlationId`, and no claim values

#### Scenario: Partial match is not warned
- **WHEN** a user signs in with role claim `["Eng-Managers", "All-Staff"]` and only `Eng-Managers` maps
- **THEN** no role-claim warning is logged

---

### Requirement: Precedence-discard signal
When the resolved role outranks `facilitator` or `engineering_manager` and a claim value also mapped to that role, the application SHALL log one warn-level line carrying the claim name, the resolved internal role, the discarded internal roles and the `correlationId`, and nothing else derived from the token. A discarded `senior_engineer` SHALL NOT be reported. The line SHALL be emitted on every such sign-in, new or returning, without de-duplication. Discarded roles stay in `users.roles`.

#### Scenario: Admin who is also in the facilitator group
- **WHEN** a returning user's claim values map to `application_admin` and `facilitator`
- **THEN** the user's `global_role` is `application_admin`
- **AND** one warn-level discard line is logged with the claim name, `resolvedRole = application_admin`, `discardedRoles = [facilitator]` and the `correlationId`, and no claim values
- **AND** the user's `roles` still contains `facilitator`

#### Scenario: Manager who is also in the facilitator group
- **WHEN** a returning user's claim values map to `engineering_manager` and `facilitator`
- **THEN** the user's `global_role` is `engineering_manager`
- **AND** one warn-level discard line is logged with `resolvedRole = engineering_manager`, `discardedRoles = [facilitator]` and no claim values

#### Scenario: Manager who is also in the admin group
- **WHEN** a user's claim values map to `application_admin` and `engineering_manager`
- **THEN** the user's `global_role` is `application_admin`
- **AND** one warn-level discard line is logged with `resolvedRole = application_admin`, `discardedRoles = [engineering_manager]` and the `correlationId`, and no claim values

#### Scenario: Admin who is also in the manager and facilitator groups
- **WHEN** a user's claim values map to `application_admin`, `engineering_manager` and `facilitator`
- **THEN** exactly one warn-level discard line is logged with `discardedRoles` listing both `engineering_manager` and `facilitator`

#### Scenario: Facilitator-only user produces no discard signal
- **WHEN** a user's claim values map only to `facilitator`
- **THEN** no discard line is logged

#### Scenario: Senior engineer discard is not reported
- **WHEN** a user's claim values map to `facilitator` and `senior_engineer`
- **THEN** no discard line is logged
- **AND** the user's `roles` still contains `senior_engineer`

---

### Requirement: Outranked roles are recorded in the audit role set
A role outranked by precedence SHALL be recorded durably only through the role set carried by the sign-in audit rows (see `auth-error-handling`), in addition to the precedence-discard log line. Neither `auth.first_access_created` nor `auth.role_claim_mapped` metadata SHALL carry a discard flag, and no separate conflict operation SHALL be written. A user-visible record or notice of this conflict belongs to #241.

#### Scenario: Discard on a returning sign-in adds no audit flag
- **WHEN** a returning user's claim values map to `application_admin` and `facilitator`
- **THEN** the `auth.role_claim_mapped` metadata carries `roles = [application_admin, facilitator]`
- **AND** it carries no discard flag

#### Scenario: Discard on a first sign-in is logged, not audited
- **WHEN** a user with no prior account signs in and their claim values map to `application_admin` and `facilitator`
- **THEN** one warn-level discard line is logged
- **AND** the `auth.first_access_created` metadata carries `roles = [application_admin, facilitator]` and no discard flag

---

### Requirement: Role map changes take effect at next sign-in
The application SHALL apply `OIDC_ROLE_MAP` only when it resolves a role at an interactive sign-in (the OIDC callback). Token refresh SHALL NOT re-resolve the role. A change to the map requires a restart, and a change to the map or to a user's IdP groups affects that user only at their next interactive sign-in.

#### Scenario: Group change reaches the user at next sign-in
- **WHEN** an IdP administrator moves a user from the facilitator group to no mapped group and the user later signs in again
- **THEN** the user's `global_role` changes from `facilitator` to `engineer` at that sign-in

#### Scenario: Map change without restart has no effect
- **WHEN** an operator changes `OIDC_ROLE_MAP` in the environment without restarting the backend and a user then signs in
- **THEN** the user's role is resolved with the map loaded at the last process start

---

### Requirement: Role revocation latency is bounded by the session lifetime
Because the absolute session lifetime forces a new interactive sign-in after 90 minutes, the worst-case delay before an IdP-side demotion (including removal of `application_admin`) takes effect SHALL be about 90 minutes, and restarting the backend does not shorten it. Once `users.global_role` changes, every authorization check that reads it SHALL apply the new value on its next evaluation.

#### Scenario: Token refresh does not re-resolve the role
- **WHEN** a signed-in user's IdP group membership changes and the application refreshes that user's tokens without a new interactive sign-in
- **THEN** the user's `global_role` is unchanged until their next interactive sign-in, which the 90-minute absolute session lifetime forces at the latest

---

### Requirement: Stored role set is consistent with the single role by construction
The database SHALL reject any `users` row whose `roles` is malformed (not one-dimensional, not starting at index 1, or containing NULL), is empty, has a first element other than `global_role`, contains `engineer` alongside another role, or is not strictly descending in precedence. An unknown check result SHALL count as a rejection.

#### Scenario: Role set disagreeing with the single role is rejected
- **WHEN** any writer stores a `users` row with `global_role = 'facilitator'` and `roles = {application_admin, facilitator}`
- **THEN** the write fails with a check-constraint violation and no row changes

#### Scenario: Empty role set is rejected
- **WHEN** any writer stores a `users` row with `roles = {}`
- **THEN** the write fails with a check-constraint violation

#### Scenario: Engineer alongside another role is rejected
- **WHEN** any writer stores a `users` row with `roles = {senior_engineer, engineer}`
- **THEN** the write fails with a check-constraint violation

#### Scenario: Duplicate or ascending order is rejected
- **WHEN** any writer stores a `users` row with `roles = {facilitator, facilitator}` or `roles = {facilitator, application_admin}`
- **THEN** the write fails with a check-constraint violation

#### Scenario: Malformed role arrays are rejected
- **WHEN** any writer stores a `users` row with `roles = {NULL}`, `roles = {application_admin, NULL}`, a two-dimensional `roles = {{facilitator}}`, or `global_role = 'facilitator'` with `roles = [0:1]={application_admin, facilitator}`
- **THEN** each write fails with a check-constraint violation and no row changes

#### Scenario: A non-role value cannot be stored
- **WHEN** any writer stores `roles = {toString}`
- **THEN** the write fails because `toString` is not a valid internal role

---

### Requirement: The role set has no column default
`users.roles` SHALL be NOT NULL with no column default. The application's writer SHALL always state the set; only the legacy-writer shim (see "The previous build keeps working through the upgrade window") supplies one, and always `{global_role}`.

#### Scenario: Omitting the role set never stores a default other than the single role
- **WHEN** any writer inserts a `users` row with `global_role = 'facilitator'` and no `roles` value
- **THEN** the stored `roles` is exactly `[facilitator]`, never `[engineer]` or any other set

---

### Requirement: Existing accounts are backfilled without changing any role
On upgrade, every existing `users` row SHALL receive `roles = {global_role}`, and no row's `global_role` SHALL change. Until a user's next interactive sign-in, the backfilled set can under-record roles they hold; the backfill SHALL never record a role other than the user's current `global_role`.

#### Scenario: Existing admin is backfilled with a single-element set
- **WHEN** the upgrade runs against a user with `global_role = 'application_admin'`
- **THEN** the user's `roles` is exactly `[application_admin]` and `global_role` is still `application_admin`

#### Scenario: Next sign-in replaces the backfilled set
- **WHEN** a backfilled user whose claim maps to `application_admin` and `engineering_manager` next signs in
- **THEN** the user's `roles` becomes `[application_admin, engineering_manager]`

#### Scenario: Fresh install passes the consistency rule
- **WHEN** all migrations run against an empty database, including the seed data that precedes the migration adding `roles`
- **THEN** every seeded `users` row has `roles = {global_role}` and satisfies the consistency rule

---

### Requirement: The previous build keeps working through the upgrade window
After the migration adding `users.roles` has applied, while the previous build still serves, a `users` write that sets `global_role` without stating `roles` SHALL succeed, storing `roles = {global_role}` when the row is new or its `global_role` changed and leaving `roles` unchanged otherwise. An UPDATE restating the stored `roles` counts as omitting it. Any other stated `roles` SHALL NOT be altered and stays subject to the consistency rule. This is transitional and removed in contract step 1.

#### Scenario: First sign-in through the previous build after the migration
- **WHEN** the migration has applied, the previous build is still serving, and a user with no account signs in and resolves to `facilitator`
- **THEN** the sign-in succeeds and the new row has `global_role = 'facilitator'` and `roles = [facilitator]`

#### Scenario: Role-changing sign-in through the previous build after the migration
- **WHEN** the migration has applied, the previous build is still serving, and a returning user stored as `global_role = 'facilitator'`, `roles = [facilitator]` signs in and resolves to `engineer`
- **THEN** the sign-in succeeds and the row has `global_role = 'engineer'` and `roles = [engineer]`

#### Scenario: Unchanged-role sign-in through the previous build keeps the stored set
- **WHEN** the previous build signs in a returning user stored as `roles = [application_admin, engineering_manager]` who still resolves to `application_admin`
- **THEN** the sign-in succeeds and `roles` is still `[application_admin, engineering_manager]`

#### Scenario: A stated inconsistent role set is not swallowed by the shim
- **WHEN** any writer UPDATEs a `users` row stored as `global_role = 'facilitator'`, `roles = [facilitator]`, setting `global_role = 'engineering_manager'` and `roles = {facilitator, senior_engineer}`
- **THEN** the write fails with a check-constraint violation and the row still has `global_role = 'facilitator'` and `roles = [facilitator]`

#### Scenario: The new build's writes are never altered
- **WHEN** the new build signs in a user whose claim maps to `engineering_manager` and `facilitator`
- **THEN** the stored `roles` is exactly `[engineering_manager, facilitator]`

---

### Requirement: Rollback redeploys the previous build before any down migration
The documented rollback SHALL redeploy the previous build, and confirm that no instance of the new build is serving, before any down migration of `users.roles` is run. The down migration SHALL be optional, because the previous build works on the migrated schema.

#### Scenario: Rollback keeps sign-in working
- **WHEN** an operator rolls back by following the upgrade notes
- **THEN** sign-in succeeds at every step, both before and after the optional down migration

---

### Requirement: The migration's effect on live sessions is bounded
The migration adding `users.roles` SHALL hold its lock on `users` for at most 1 second on a 10,000-user table and wait at most 5 seconds to acquire it; failing that, it SHALL roll back with no schema change and exit non-zero so it can be re-run. It SHALL NOT end any open lobby or live session, cause a re-authorization refusal, or require anyone to sign in again. A request reading `users` is delayed at most once, by about 6 seconds.

#### Scenario: Migration fails cleanly when it cannot get the lock
- **WHEN** a long-running transaction holds a conflicting lock on `users` and the migration runs
- **THEN** the migration fails within about 5 seconds and exits non-zero
- **AND** `users` has no `roles` column and no row's `global_role` has changed
- **AND** re-running the migration after the transaction ends succeeds

#### Scenario: Live lobby survives the migration
- **WHEN** the migration runs while a lobby is open over WebSocket
- **THEN** no participant or facilitator is disconnected, refused at re-authorization or asked to sign in again because of the migration

---

### Requirement: The audit role-set column is added without failing audit writes
The migration adding `audit_log.actor_roles` SHALL be separate from the migration adding `users.roles` and SHALL run in its own transaction. It SHALL wait at most 200 milliseconds to acquire its lock on `audit_log`, so that no audit write fails because of it; failing that, it SHALL roll back with no schema change so it can be re-run.

#### Scenario: Audit column migration fails cleanly when it cannot get the lock
- **WHEN** a transaction holds a conflicting lock on `audit_log` and the migration adding `actor_roles` runs
- **THEN** the migration fails within about 200 milliseconds, `audit_log` has no `actor_roles` column, and re-running it after the transaction ends succeeds

#### Scenario: Sign-in during the audit column migration succeeds
- **WHEN** a user signs in while the migration adding `actor_roles` is waiting for or holding its lock
- **THEN** the sign-in succeeds and its sign-in audit row is written

---

### Requirement: The role set does not drive authorization in this step
No authorization decision SHALL read `users.roles`, the audit role-set fields, or `audit_log.actor_roles`. Every check SHALL keep reading `global_role` and team membership exactly as before, so storing the set changes no user's access.

#### Scenario: Facilitator who is also an admin is still refused draft creation
- **WHEN** a user whose claim maps to `application_admin` and `facilitator` tries to create a draft session
- **THEN** the response is 403 with `error.category = "forbidden"` and message "Only a facilitator can create a draft session."
- **AND** no `audit_log` row is written by the request, as before

#### Scenario: Manager who is also an admin is still excluded from sessions
- **WHEN** a user whose claim maps to `application_admin` and `engineering_manager` tries to register as a participant
- **THEN** the response is 403 with `error.category = "invalid_request"` and message "You are not eligible to participate as a voter in this session.", the same response an Engineering Manager receives
- **AND** one `session.participant_registration_rejected` row is written with `actor_global_role = 'application_admin'` and `actor_roles` NULL (it is not a sign-in row; see `auth-error-handling`, "Other operations leave actor_roles empty")

#### Scenario: Manager who is also an admin still cannot be associated as a team's manager
- **WHEN** an authorized actor calls TEAM-006 for a user whose claim maps to `application_admin` and `engineering_manager`
- **THEN** TEAM-006 returns 409 with the `global_role` precondition error code, as before
