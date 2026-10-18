# Security Review: written threat-model text (#296)

Reviewer: Tomás Ferreira, Security Analyst
Scope: `git diff main -- "requirements/High-Level Architecture.md"` (new 8.1 row, new 8.1.1 (a) to (h), one 8.2 bullet), checked against `design-review-security.md` section 7 and `pr-notes.md` (confirmed claims, findings 1 to 7). I did not re-run the code checks; I rely on the confirmed-claims table, which reads as disciplined (one claim dropped on evidence, 1.11e).

## Verdict

**Approve with listed conditions.** The rating (Low, likelihood only) and the reopen triggers are acceptable as written once conditions C1 to C3 are met. C1 is a text change of two clauses; C2 and C3 are process.

## 1. Merge-gate items against the final text

| # | Gate item | Holds? | Evidence in text |
|---|-----------|--------|------------------|
| 1 | Template as trust anchor for all default-copy paths | Yes | (d) "The template is the trust anchor"; names #215 and assign-defaults as copy paths, and correctly says restore-defaults (#218) does not copy template text (dropping #218 as a copy path was right; my earlier wording was wrong on that point). Closing assign-defaults alone does not close the risk is stated. |
| 2 | Template-edit audit coverage for the chain | Yes, partly | (d) names the five `topic.default_*` operations and says content of that audit "is not assessed here". That is the honest option I offered. The chain is therefore only partly detectable, and (e) calls it "detective, not preventive", which is fair. |
| 3 | "Unmonitored (#131)" adjacent to the rating; rating conditional | Yes | (e) puts "detective, not preventive, and currently unmonitored (#131...)" in the same paragraph as "Low, conditional on #208 and on the zero-topic population". The basis sentence says plainly that the rating is not resting on preventive controls. |
| 4 | No step-up / recent-authentication in single-admin caveat | Yes | (f) "no second approver and no step-up or recent-authentication requirement. A stolen long-lived admin session is the most realistic route". |
| 5 | Mutable `audit_log` caveat relevance | Yes | (f) says it matters for DB-level or code-execution compromise, not a stolen admin session alone. Correct. |
| 6 | Role provisioning and live check source | Yes, with a gap | (c) states IdP claim plus role map at sign-in, no in-app grant path, role read from `users` each request. Gap: see C1 (freshness). |
| 7 | Template-write validation | Yes | (d) "validated when written ... (length and a plain-text rule)". No claim of parity with ordinary topic text. Good. |
| 8 | File follow-up 1 and audit_log immutability rather than leave in pr-notes | **No (open)** | Follow-ups are still "drafts" in `pr-notes.md`, with the question "file now or leave" unanswered. HLA (f) does record the S-B-type limit for this endpoint, and (f) states audit_log mutability, so the threat-model text is honest. But the generalized S-B/N-A/N-D findings exist only in a file that goes away with the PR. See C2. |
| 9 | Split controls cell: transactional success audit vs best-effort denial/failure; limiter and source test not presented as controls | Yes | Row separates "Preventive", "Detective" (success fail-closed; denial/failure fail-open), "Abuse bound only", "Regression guard (not a runtime control)". |
| 10 | D9 timeout not applied to gate items | Process | pr-notes sign-off log: "Not started". Must be recorded truthfully; see C3. |

SHOULD items 11 to 16: 11 done ("covered by #208's trusted-role decision ... not separately re-accepted"), 12 done (event triggers in (h), neutral recovery-speed sentence), 13 done ((b) "target team is caller-chosen"; (c) "for any team id"), 14 done ((f) "expectation, not a measurement"), 15 done ((f) separates audit suppression from limiter fail-closed 503), 16 see ruling on finding 6.

## 2. Overclaim check

- Controls cell: "Preventive: role re-read from the database on each request" is literally true but reads stronger than it is. The database row is only as fresh as the last interactive sign-in (finding 4). A reader will infer that revoking admin at the IdP removes the capability promptly. It does not. This is the one overclaim by omission; fixed by C1.
- "Preventive: zero-active precondition checked under the per-team advisory lock": supported by 1.3c and 1.13. It bounds what the endpoint does; it does not prevent the privileged actor from using it on any zero-topic team. The row's own wording ("any zero-active-topic team of their choosing") is clear on that. No change.
- "copies the default template only (no caller-supplied topic content)": the text correctly distinguishes caller-chosen team from caller-chosen text, and (d) says the template itself is editable. Not an overclaim.
- "No `audit_log` reader exists outside the inventory ... not tamper resistance": scoped correctly, and the structural test is described as reader inventory. Acceptable.
- "Low" rating: stated basis is the expected affected population (none, unmeasured) plus accepted trusted role, with impact explicitly not claimed low. That is honest. The population remains a documented expectation; the condition holds only while that stays true, and (h) has a trigger for it.
- No use of "safe", "protected", or "accepted by" found in the diff.

## 3. Rulings on pr-notes findings

### Finding 4 (IdP-side demotion can take about 90 minutes to apply): must go in the threat-model text

Reasons:
1. It is a property of the exact control the row cites. The row lists "role re-read from the database on each request" as the preventive control. Without the freshness limit, the control is overstated against the one scenario (a stolen admin session being responded to) where a reader would rely on it.
2. It belongs with an existing caveat. (f) already says a stolen long-lived admin session is the most realistic route. The incident-response lever for that route is revoking the role at the IdP; the text should say that this does not take effect immediately, and that the application's own session invalidation is the faster lever (whatever that is; the author should state it only if verified).
3. The pr-notes file is not durable, and `design.md` is not read by the people who will decide on a reopen.

Required text (C1), minimal: in (c) after "not from the session or a token claim", add that the stored role changes only when the user next signs in, so an identity-provider demotion can take up to about 90 minutes to apply (figure per `docs/deployment.md`, cite by section name only, no numbers beyond what that document states if the author prefers to keep the HLA free of limits). In the (f) stolen-session bullet, add that revoking the role at the identity provider is not immediate. Do not add it to the controls cell as a qualifier on the word "Preventive"; instead rephrase the cell to "role re-read from the database on each request (the stored role updates at sign-in)".

### Finding 6 (assign-defaults relies on SameSite=Strict, no `X-Requested-With` header): fine as a follow-up, not in the threat-model text, with conditions

Reasons:
- The threat the row models is an admin session held by an attacker. CSRF is a different vector (victim admin's browser) and SameSite=Strict is a real control for it. The HLA makes no CSRF claim for this endpoint, so there is no false statement to correct.
- Impact is bounded: no body or query, copies the template to a zero-topic team only, 409 otherwise. A forged request cannot choose text.
- Putting a per-route header inconsistency into an architecture threat model invites reader inference that other routes were assessed for it, which this change did not do.

Conditions (C2): file it as an issue (low severity, consistency/defense in depth: require the same mutation-control header as the #216 routes or document why not). `pr-notes.md` is not an acceptable home. Also add one reopen trigger to (h): a change to cookie SameSite policy or session transport (this is cheap, and keeps the SameSite dependency visible without describing the gap).

## 4. Conditions for sign-off

- **C1 (text):** Add the role-freshness limit per finding 4 in (c), the stolen-session bullet in (f), and the controls-cell phrasing. No other HLA changes required.
- **C2 (process):** File, before merge, issues for: follow-up 1 (S-B/N-A/N-D generalization), audit_log immutability (follow-up 3), the assign-defaults `X-Requested-With` / SameSite item (finding 6), and the stale comments (finding 5, trivial, may be bundled). Record issue numbers in `pr-notes.md`. Follow-up 2 (facilitator message) is a product item, my interest is lower; filing is at the team's discretion. "Draft only" is not acceptable for the first three; this repeats gate item 8 from my design review and it remains open.
- **C3 (process):** Record the Security sign-off outcome accurately in the sign-off log. If this review is not delivered or not acknowledged in time, log "not reviewed", not "proceeded as proposed". Once C1 is in the text and C2 issues exist, this review constitutes my sign-off on the rating and triggers.

## 5. Reopen triggers

Acceptable. They cover: a second lock exception, caller-supplied source, non-admin trigger, role-grant change, template editor/content change, admin compromise, a defaults-assigned row without a known recovery, #131/audit hardening, Redis/trustProxy changes, a demand for approver/step-up, and a non-trivial zero-topic count. Additions requested: cookie SameSite/session transport change (finding 6) and any change to how often the stored role refreshes from the identity provider (finding 4). The "may move either way" language for hardening landing is correct.

## 6. Other observations (no action required)

- Finding 2 (template text validation is stricter than ordinary topic text) is a product consistency note, not a threat-model gap. Rendering-as-text remains the real stored-content control. Fine as an optional follow-up.
- Finding 3 (empty template is unreachable via the #216 API) does not weaken the caveat; the HLA states the behavior without claiming reachability. Good.
- The unmeasured zero-topic count (finding 6/1.9 in their numbering) is stated as an expectation in the HLA. I would still like someone to run the read-only count once before or soon after merge and record the result, but the text is honest without it.
