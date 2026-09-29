# Phantom EM Relationship — Query Result

Fill this in after running both scripts against production. This is a record
of what was actually run and found — not a checklist to complete in advance.

## Run details

- **Run date:**
- **Environment confirmed** (from each script's `-- STOP:` sanity check output — database name and host):
- **Operator:** (your name and `users.id` UUID used as `operator_user_id`)

## Query 1 — Detection (`8_phantom_em_detect.sql`)

- **Row count:**
- **Rows** (if non-zero — email, team name, user_id, team_id, joined_at for each):

## Query 2 — Annotation (`8_phantom_em_annotate.sql`)

- **`new_annotations_inserted` count:**

## Notification (only if Query 1's row count is non-zero)

Per design.md Decision 9, notify **Rachel Okonkwo, VP of Engineering**, directly
by email or an equivalent out-of-band human channel, sent by hand. No
automated transport exists for this — do not build one.

Send the following sentence verbatim, filling in the bracketed values. Do not
paraphrase it under time pressure:

> Query 1 flagged N phantom EM relationship(s) in `<environment>` as of
> `<timestamp>`. This is a notification, not a request for action — no
> remediation has been taken and none is authorized by this message.

- **Recipient:** Rachel Okonkwo, VP of Engineering
- **Channel used:**
- **Sent at:**

This is escalation, not remediation: sending this notification does not
authorize, and this change does not include, any revocation or modification
of a flagged `team_memberships` row.
