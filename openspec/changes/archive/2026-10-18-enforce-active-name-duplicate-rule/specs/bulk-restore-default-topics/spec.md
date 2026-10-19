## MODIFIED Requirements

### Requirement: An archived default whose name matches an active topic is skipped and reported, never duplicated

An archived default SHALL be skipped, and reported in `skipped` with reason `NAME_ACTIVE`, when its name matches, after `trim()` then `toLowerCase()` (no locale argument), the name of an active topic of the team or of an archived default restored earlier in the same batch. Names are compared by their current value (a renamed default is compared by its current name); `is_default` remains the only marker of a default. Prompts are not compared. Skipped topics SHALL remain archived and unchanged. This `trim().toLowerCase()` comparison uses the same shared normalizer (`normalizeTopicNameForMatch`) that Add and single restore use, through the shared finder, to reject with `409 TOPIC_NAME_ACTIVE` (see `add-custom-topic`, `restore-topic`). Bulk does not call that finder: it keeps its own sequential seen-set, and the parity scenario below guards against the two drifting. Bulk differs from the other doors in its outcome, which stays skip-and-report with reason `NAME_ACTIVE` (never an error response, no override for any role). The bulk response contract is byte-for-byte unchanged by this change: the skip reason stays `NAME_ACTIVE` and is never unified with the `TOPIC_NAME_ACTIVE` error code of the other two doors. It is a duplicate-prevention rule, not an identity check or a uniqueness guarantee, and the template-based `defaultTopicsNotActive` and the client-side `findDuplicate` hint SHALL NOT be used to decide bulk availability. Evaluation SHALL be sequential in restore order, so of two archived defaults sharing one name at most one, the first in restore order, is restored.

#### Scenario: A name already active is skipped
- **WHEN** the archived default "Code Quality" exists and an active topic named "code quality " (trailing space, different case) exists
- **THEN** "Code Quality" is not restored and appears in `skipped` with reason `NAME_ACTIVE`, and it remains archived

#### Scenario: Two archived defaults share one name
- **WHEN** two archived defaults are named "Delivery" and "delivery" and neither name is active
- **THEN** exactly the one earlier in restore order is restored and the other is skipped with `NAME_ACTIVE`

#### Scenario: Case and Unicode forms are distinct by decision
- **WHEN** an archived default is named "Équipe" and an active topic is named "equipe", or the two differ only by NFC versus NFD form
- **THEN** they are different names and the archived default is restored (the rule is `trim().toLowerCase()` with no locale or normalization form, a recorded decision)

#### Scenario: Blank-named legacy defaults
- **WHEN** an archived default has a blank or whitespace-only name
- **THEN** it is restored unless an earlier row in the same batch has the same normalized (empty) name, in which case it is skipped with `NAME_ACTIVE`

#### Scenario: Winner among same-named archived defaults ignores history
- **WHEN** two same-named archived defaults exist and the later one in restore order has votes
- **THEN** the earlier one in restore order is restored regardless of history

#### Scenario: Skipping is an outcome, not a failure
- **WHEN** some archived defaults are skipped and others restored
- **THEN** the response is `200 OK` with both arrays populated and the transaction commits

#### Scenario: Bulk and Add or single restore agree on the same name pairs
- **WHEN** the same name pairs ("Safety"/"safety", " Safety "/"Safety", "Safety"/"Safety " , "Équipe"/"Equipe", NFC/NFD, empty/empty) are run through bulk restore, Add and single restore
- **THEN** each pair is a duplicate in all three or in none (bulk reports `NAME_ACTIVE`, the others `TOPIC_NAME_ACTIVE`)

#### Scenario: Bulk concurrent with Add of a same-named topic
- **WHEN** a bulk restore and an Add of a name matching an archived default are submitted concurrently
- **THEN** the team ends with one active topic of that name: either the default is restored and the Add is rejected `TOPIC_NAME_ACTIVE`, or the Add succeeds and the default is skipped with `NAME_ACTIVE`
