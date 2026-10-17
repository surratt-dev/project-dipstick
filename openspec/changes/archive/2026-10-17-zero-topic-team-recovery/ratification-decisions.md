# Ratification decisions — zero-topic-team-recovery (#200, PR #292)

Recorded 2026-10-17 from the product owner's answers at PR review (task 9.1).

| # | Item | Decision |
|---|---|---|
| 1 | Policy changes: single lock carve-out, naming "an application administrator" in facilitator copy, use-case 08 amendments, remaining proposal ratification items | **Ratified as built.** Any further lock exception still needs explicit PO sign-off (spec Purpose). |
| 2 | `topic.defaults_assign_failed` fail-open audit row; denial-audit bound of 10 rows/actor/minute | **Accepted as built.** The compliance/security owner's recorded answer on the failure row is **still outstanding** (owner: PO to obtain). Fallback if declined: log-only plus runbook search (tasks.md "Cut fallout"). |
| 3 | Draft-page gap (`DraftSessionHost` ignored the server 409 message) | **Fix in this PR.** The draft page's fixed zero-topic line now names both paths: "This team has no active topics, so the room can't open yet. Add or restore a topic on Topic Management; if the team's topics are locked, ask an application administrator to assign the default topics." (Chosen because the page does not know the lock state.) Follow-up 8.4(d) is dropped. `session-creation` spec updated. |
| 4 | Assign failure copy | **Keep as written:** "The default topics couldn't be assigned. Try again." |
| 5a | Follow-up issues | Filed: #293 FR-8.6 residual (8.4a), #294 TOPIC-005 restore name collision (8.4b), #295 per-actor denial bound in TOPIC-002 (8.4c), #296 threat-model update (8.4e). 8.4(d) dropped per item 3. |
| 5b | Diagnostic and legacy-lobby queries against staging/production | **PO runs post-release** (queries in the runbook, `docs/deployment.md` "Zero-topic teams"). If either returns rows, add the `/start` guard (task 5.3) before further rollout. |

## Still open
- Compliance/security answer on the failure audit row (item 2).
- Post-release query counts (8.1) and the non-gating usability walk-through (8.3).
- `proposal.md` has not been edited to cite #293 (task 8.4 asks for it); add it if desired.
