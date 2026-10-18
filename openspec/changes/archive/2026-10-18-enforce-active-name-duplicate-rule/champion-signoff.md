# Internal Champion Sign-off: enforce-active-name-duplicate-rule (#299)

Devon Calloway, Internal Champion.

## Verdict

Clean sign-off on the core constraints, with two non-blocking notes.

## Core constraints

- **No-manager rule:** unaffected. The change touches only topic Add and single restore, plus client hints. No participant, role-eligibility or session-join code is in the diff.
- **Simultaneous reveal:** unaffected. No vote, readiness, reveal, outlier or pacing code is changed, and session snapshots are untouched.
- **Facilitator from another team:** unaffected. No session-start or facilitator-selection path is touched.

## Intent of the change itself

- The rule is structural. There is no flag, header, role or body field that bypasses it, `application_admin` included. Security review confirmed `force: true` and admin get the same 409. This is the "constraints must not become toggles" principle I care about.
- The lock gate stays ahead of the name check, so a locked team learns nothing about topic names.
- The default set is still visible and restorable. A rejected restore leaves the archive intact, and the documented route (archive the active topic, then restore) is stated.
- Rejection copy tells the person which topic, that nothing changed, and what to do next. This is prep work, so teaching at the point of friction is right.

## Notes (not blocking)

1. FR-8.6 "restorable at any time" is now narrowed to "restorable once the conflicting active topic is archived". The proposal records this as pending PO confirmation. It needs to be raised in the PR, not left silent. I accept the reading.
2. Single restore reversing the #218 decision must be called out plainly in the PR and release notes. Look-alike names (internal whitespace, NFC/NFD) remain a known, accepted gap against the "which Safety are we on?" problem.
