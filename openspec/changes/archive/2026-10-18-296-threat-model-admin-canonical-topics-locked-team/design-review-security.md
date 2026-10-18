# Security Review: design.md and proposal.md (#296)

Reviewer: Tomás Ferreira, Security Analyst
Scope: design.md, proposal.md. I did not re-verify code identifiers; that is deferred to tasks section 1, and I note below where that deferral is itself load-bearing.

## Verdict

Approve with changes. The change is honest in its overall posture: it says "detective, not preventive" and refuses to call the carve-out "safe". That is the right instinct. There are, however, three places where the threat is characterized more narrowly than it is, two places where a security decision is implicit, and several wording risks. None block drafting. Items marked MERGE-GATE should be resolved before I give the D9 sign-off.

## 1. Is the threat characterized correctly?

### 1.1 Single compromised application_admin: mostly right, but it understates what the attacker gets

The row and (c) describe "an application_admin (or an attacker holding an admin session)". Fine. Two gaps:

- **The carve-out is not the interesting capability; the template edit is.** From #216, an admin can rewrite the default template. The assign-defaults endpoint is then a delivery mechanism for attacker-chosen text into every zero-topic team. But the template rewrite also affects every future team-creation copy (#215) and the bulk "Restore default topics" action (#218) and the admin maintenance path (#216). The row is titled and scoped to the lock carve-out, so it reads as if assign-defaults is the exposure. The honest framing is that the template is the trust anchor for *all* default-copy paths, and the lock carve-out is just the one that crosses the lock. Item (d) says "the bound is whatever the template holds", which is good, but it is framed as a limit on assign-defaults only. Recommend (d) state that the same bound applies to team creation and restore-defaults, so the reader does not conclude that closing or monitoring assign-defaults closes the template-text risk. (MERGE-GATE, wording only.)
- **Compromised admin can create the precondition, not just exploit it.** The design treats "zero active topics" as the thing that makes the carve-out harmless ("nothing for the lock to protect"). But an admin who can write to a team before the lock does not apply, or who can reach zero active topics by any other route, can manufacture the precondition. D3 says `zero-topic-invariant-integration.test.ts` refuses archiving the last active topic on both locked and unlocked teams, which helps, but the HLA text is told to claim no "permanent invariant". Then the justification "justified by a precondition, not by who the caller is" (proposal, Constraints preserved) is stronger than what is established: it is only as strong as the set of ways to reach zero active topics. The proposal should state that the precondition is *reachable* (it is what #200 recovers from: legacy data, template failure, drift) and that this design does not enumerate reachability. If the zero-topic invariant has holes, the lock-bypass has the same holes. I want one sentence in (a) or (f) saying so, or an explicit note that task 3 confirms the invariant tests are not a complete enumeration.
- **Chain, step 1 is not audited by this change.** The template-rewrite-then-assign chain is described as "accepted under #208's trusted-role decision". The template edit is a different endpoint with its own audit story that this document does not characterize. A reviewer reading 8.1.1 learns that assign-defaults is audited but not whether the template edit leaves an audit row, who can see it, or whether it records the content diff. If the template edit is not audited with content, the chain is only half-detectable and (e)'s "detective" rating is overstated for the chain. Either cite the template-edit audit operation by name (D2 style) or add a caveat that the first step's audit coverage is not assessed here. (MERGE-GATE.)

### 1.2 The assign-defaults carve-out: well characterized, with one omission

Good: no caller-supplied source or text, live role check, advisory lock, same-transaction success audit. Omissions:

- **Data volume / amplification.** Template size is bounded by what? An emptied template degrades onboarding (covered). An oversized or hostile-text template (very long strings, markup) is copied into many teams. The HLA is silent on whether output encoding/length limits exist on topic text. That is arguably out of scope, but the threat is "whatever the template holds", so stored-content handling at render is the downstream control. State in (d) whether topic text is validated at template-write time or only at team-topic-write time; if the template path bypasses the validation used by ordinary topic writes, that is a finding, not a caveat. Task 1 should check this and the answer recorded. (MERGE-GATE: check, not necessarily a text change.)
- **Cross-team reach.** (c) says "any application_admin, including a member of the target team". It does not say the admin can target *any* team by id. That should be explicit, since the blast radius of one stolen session is every zero-topic team, not one. Given the expected population is none, this is low, but the sentence belongs in (c).

### 1.3 Role model

"Live role check per request" is listed as a control. That is a good property (a revoked admin is stopped on the next request). Confirm it means a DB lookup per request and not a claim in the session or JWT; the row says "live" and task 1 should confirm the source of truth. I would rather the row say "role re-read from the database on each request" if that is what it is. If it reads from a cached or session-embedded claim, the word "live" overclaims. Flag for task 1.1.

## 2. Is the residual-risk rating and caveat list honest?

### 2.1 Rating "low"

Defensible, but the stated basis is circular in one way. The basis is "expected affected population is none and application_admin is already an accepted trusted role (#208)". The second half is a *decision* (the trusted-role acceptance), the first half is an *expectation about data*. Neither is a control. The honest statement is: likelihood is low because few people hold the role and the population is near zero; impact if the role is compromised is not low (arbitrary default text to the zero-topic population, plus the whole template chain). Low is an acceptable *residual* given the compensating trust assumption, but the text should say "low, conditional on #208 and on the zero-topic population staying near zero", so the rating visibly flips when those premises change. The reopen triggers cover both premises, which is good. I would put the conditionality in (e) itself, not only in (h).

### 2.2 Caveat list: complete against what I would expect, with additions

Each of your listed caveats is correct and appropriately worded in the design: detective not preventive, no monitoring consumer (#131), mutable audit_log, sampled denial rows, trustProxy dependence, generic 500, single admin. Specific comments:

- **Mutable audit_log.** "audit_log is modifiable by the application DB role and no tamper evidence is claimed." Good. But combine this with the threat: the attacker in scope holds an *application admin session*, not DB access, so the application role's UPDATE/DELETE on audit_log is only reachable via SQL injection or a code path that edits audit rows. Say which: the caveat matters for a DB-level or code-execution compromise, not for a stolen admin session alone. Otherwise it reads as if this specific attacker can erase the trail. State it precisely; I do not want the risk inflated or deflated. Also, the out-of-scope list defers the REVOKE. That is a deferred security decision. See 3.1.
- **No monitoring consumer.** With no consumer, "detective" is aspirational: the controls detect only if someone reads the table. (e)'s "detective, not preventive" should add "and currently unmonitored (#131)", in the same sentence as the rating, not buried in (f). A rating of low whose detective control has no consumer is a rating that rests on nobody looking. I want the two adjacent. (MERGE-GATE.)
- **Sampled denial rows.** The design says "denial rows are sampled and absent on a Redis outage (this endpoint only)". Clarify direction of the failure: if Redis is down, are denials suppressed, or does the limiter fail open (allowing writes), or both? "Suppressed audit on Redis outage" is a detection gap an attacker can induce; "fails open" is a preventive gap. These are different severities. Also, `topic.denial_audit_suppressed` is named in D2, so there is a marker row; say whether suppression itself is recorded unsampled. If the suppression marker is also sampled, the gap is silent.
- **trustProxy.** `actor_ip` depends on correct trustProxy configuration. State the consequence: if misconfigured, actor_ip is attacker-influenced (X-Forwarded-For spoofing) or is the proxy address. Either way it is untrustworthy as forensic evidence. One clause is enough. Also note the audit row's `actor_user_id` is the primary attribution and does not depend on this; say so, to avoid over-weighting the caveat.
- **Generic 500 leaves only a log line.** Honest. Add: application logs have their own retention/immutability, which this change does not assess. Also whether the `topic.defaults_assign_failed` row exists for *handled* failures only; the 500 case is the unhandled one. The distinction is stated implicitly; keep it explicit.
- **Single admin, no approver.** Good. Also say no step-up or re-authentication; the proposal treats "step-up" as out of scope but the caveat should name the absence, since a stolen session is exactly the case step-up would address. Currently the caveat says "single admin, no second approver" and nothing on session freshness. A session hijack of a long-lived admin session is the most realistic route to this compromise. (MERGE-GATE: add "no step-up or recent-authentication requirement" to the caveat.)
- **"Expected affected count is none, citing docs/deployment.md".** This is an assertion about production state, not a control. It cites a doc section that says the expected count is 0; it does not say anyone checked. Word it as "documented as expected to be none; not measured by this change" unless a query is run. Leaving a number-of-teams claim uncorroborated and then using it as half the basis for "low" is the weakest link in the rating. At minimum, task 1 should include one read-only count of zero-active-topic teams (or record that none was run). If the count can be queried, the reopen trigger "found to be non-trivial" becomes checkable; otherwise it has no detection path. See 4.
- **"No audit_log reader outside the #271 inventory exists, worded as that structural test asserts."** This is a claim about readers of the log, not about writers or modifiers, and it is in a caveat list about mutability, where a reader may take it as reassurance about tampering. It is not. Reword or move so it cannot be read as a tamper-resistance statement. It also bounds nothing about who can *read* topic audit rows through admin UI; if there is an admin audit viewer it is in the inventory, otherwise no.

### 2.3 Caveats not on the list that I would add

- **Session/CSRF posture of the endpoint.** A state-changing POST under an admin session: confirm CSRF protection or SameSite/token-in-header; an admin visiting a hostile page is a more plausible route to "admin session misuse" than credential theft. If the app is bearer-token/JWT-header based, say so in one clause. Task 1 should confirm; it need not become HLA text.
- **Rate limiter scope.** "Per-actor topic-write limiter" bounds a single compromised actor's rate but not total effect, and a per-actor limit means multiple compromised admins multiply it. Not the focus, but the control cell should not imply a global bound. The numeric limits are intentionally omitted (fine), but then the reader cannot judge; at least say "per-actor" bounds one session, as the row already does.

## 3. Security decisions that are deferred or implicit

### 3.1 Deferred (explicit, but I want them acknowledged as decisions with owners)

- **REVOKE UPDATE/DELETE on audit_log**: out of scope and no follow-up issue is drafted for it. The follow-ups list covers #216 items and a facilitator-UX item. The audit-immutability hardening and monitoring (#131) are called out of scope but nothing creates a trace to track them. #131 exists; the REVOKE does not appear to. Add to follow-up 1 or create a third. Without an owner, "no tamper evidence is claimed" becomes the permanent position.
- **Step-up / second approver**: deferred as reopen trigger. Acceptable; see 4 for trigger quality.
- **Generalized denial-audit sampling, sentinel-lock blast radius, "never spread request.body"** (#216 S-B, N-A, N-D): deferred to a drafted-but-unfiled issue. These are security findings from a prior review. Leaving them in an unfiled draft in `pr-notes.md` (a file that goes away with the PR) means they are effectively dropped. I ask that follow-up 1 be filed, or that the findings be recorded in the HLA 8.1.1 text as known open items by issue number. The proposal explicitly makes the follow-ups "not a gate". For documentation of a threat model, "not a gate" on filing the security follow-ups is the wrong default; filing an issue is cheap. (MERGE-GATE: file follow-up 1.)

### 3.2 Implicit

- **The trust decision in #208 is being relied on as the acceptance for a new, larger exposure.** The proposal admits the exposure is "slightly larger than #200 knew" because of #216. Citing #208 as acceptance of the *chained* path was a decision made before the chain existed, or at least before it was written down. Calling this "accepted under #208's trusted-role decision" is a defensible reading, but "accepted" is a stronger word than "not previously rejected". Recommend "covered by the trusted-role decision in #208 (made before the template-edit path existed in #216); not separately re-accepted". If the product owner or Director of InfoSec has not seen the chain, this is the document's first disclosure of it, and the HLA should say so by process, not by wording: record in `pr-notes.md` who was informed. D4 also forbids "accepted by the product owner" which is right because they did not; the same logic argues against implying acceptance by #208 of something #208 did not consider.
- **Who may be an application_admin and how that is provisioned** is assumed. Admin count, provisioning path (IdP group vs app-managed flag) and whether the role can be granted by another admin are the determinants of "single compromised admin" likelihood. Item (c) and the rating depend on these but the text records only that #208 accepted the role. One line in (c): how the role is assigned (IdP claim or app table) and by whom. If it is an app-table flag that any admin can set, the single-admin assumption in the threat model is weaker (an admin session can mint more admins), and that is its own reopen consideration. Task 1 should verify where `isApplicationAdmin` reads from.
- **Reopen trigger detection**. See 4.
- **Pre-production review dependence.** The change leans on "SEC-31 revisit at the 8.4 pre-production review". That review is mine. Fine, but the HLA statement should not imply the revisit will verify anything about runtime state; it will re-read this text against the code, as proposed. OK.

## 4. Are the reopen triggers right?

Triggers as drafted: second exception to the lock; any topic-writing endpoint accepting caller-supplied source text; non-admin allowed to trigger assign-defaults; security/compliance requires approver or step-up; zero-active-topic count found non-trivial.

Assessment: the first three are structural and the source test makes them mechanically detectable (the test pins the route list; a second carve-out or new route fails it). Good, that is a trigger with a detector. The last two are not:

- **"Security or compliance requires a second approver"** is a trigger that fires only when someone else decides. That is fine as an acceptance of an external decision, but I would add triggers that are *events*, not policy changes:
  - confirmed or suspected compromise of an application_admin account, or any use of `topic.defaults_assigned` that does not correspond to a known recovery;
  - a change to how the application_admin role is granted, or an increase in the number of admins beyond a stated bound;
  - a change to what the default template can contain (new fields, free text beyond topic title/description) or to who can edit it, i.e. #216's authorization changing;
  - `audit_log` hardening or monitoring (#131) landing, which changes the "detective, unmonitored" basis of the rating, in the downgrade direction; a rating should be reopenable in both directions.
  - Redis/limiter behavior or trustProxy configuration changing materially, as these are stated caveats.
- **"Number of zero-active-topic teams found non-trivial"** has no stated detector or owner. "Found" by whom, how? Either tie it to a periodic query in the deployment doc's "Zero-topic teams" section or admit it is an incidental trigger. Better: a count of `topic.defaults_assigned` rows over a window above a stated small number (even "more than a handful per quarter") gives a checkable signal without citing numeric limits in code. The design forbids numeric limits for *rate limits*; a threshold for review cadence is a different thing. Judgement call; I recommend at least a named detector.
- **The recovery-speed sentence** ("Any reopen decision must weigh recovery speed against the near-zero affected population"): this is a pre-committed bias in a security document. It frames any future tightening (approver, step-up) as something that must be justified against speed, and the population premise ("near-zero") is the one I flagged as unmeasured. I understand the product reasoning (facilitators wait on an admin before a scheduled session), and it is acceptable as a weighing factor, but it should not read as the first consideration. Suggest: "Any reopen decision must weigh recovery speed and the affected population against the exposure at that time", which does not presuppose "near-zero" as a permanent fact. This is a wording change; I will not block on it, but "near-zero" should not be baked into a forward-looking trigger.

## 5. Wording that overclaims a control

Checked against D6's grep intent and the text in design.md:

1. **"Live role check per request"** in the row: confirm source (see 1.3). If cached/claim-based, remove "live".
2. **"zero-active precondition checked under the per-team advisory lock"**: accurate as a TOCTOU control only if the count and insert are in the same transaction as the lock acquisition and the lock is transaction-scoped. Task 1 lists it; "checked under the lock" is OK if confirmed. Also note per-team advisory locks do not protect against a concurrent *template edit* during the copy; the chain edge case (template changes between read and copy) is not covered by the lock. Is the template read in the same transaction at an isolation level that gives a consistent snapshot? Minor, but "copies the default template only" reads as atomic. Low risk; note it in task 1.2.
3. **"success audit row written in the same transaction"**: this is a good control (audit cannot be lost without rolling back the write). But it is only true for the success path. Say that the denial and failure rows are *not* transactional with anything and may be lost. The row lists both without distinguishing; (f) later says denial rows are sampled and failures may be a log only. In the table cell, the juxtaposition "success audit row in same transaction; denial and failure audit rows" can read as equivalent guarantees. Split the clause. 
4. **"per-actor topic-write limiter"** listed under controls for a privileged-write threat: a limiter is not a control against a single deliberate invocation (the attack needs one call). The row should not present it as mitigating the stated threat; it mitigates abuse and enumeration. Either move it after the others with "(abuse bound only)" or drop it from the controls cell. As written it pads the list.
5. **"source test cited in 8.2"** as a control: a source test is a regression guard on code shape, not a runtime control. 8.2 sentence is carefully capped (good) but the 8.1 row lists it among "controls". Label it "regression guard".
6. **"requires assign-defaults not to [call the lock gate]"** in 8.2: this asserts *absence* of a gate call, which is the intended carve-out. A reader may take it as a security property ("the lock is bypassed in exactly one place"). Make the sentence say what the test pins (the route list and gate usage), not that the carve-out is correctly bounded. The proposed text already does this; I only note it should keep "pins", not "ensures".
7. **"nothing caller-supplied"**: fine if the handler reads no body/query/params other than `:teamId`. Path param teamId is caller-supplied (target selection). Say "no caller-supplied topic content" to be precise.
8. **D3 integration-test claims**: capped properly. "Refuses ... annotate on a locked one-topic team" etc. is accurately bounded. Keep "not a sequence search". Good discipline.
9. **"(a) ... accepted on locked and unlocked teams"**: confirm it is intentional that assign-defaults works on unlocked teams; that widens the endpoint beyond the "lock carve-out" name. The row name "topic-lock carve-out" then undersells that it is a general admin-restore-for-empty-team path, which is also what makes it a reopen-trigger candidate for "second exception". Fine; just ensure the row description matches (it says "locked", the body says both).
10. **"Residual risk low" with "detective"**: see 2.1/2.2. The two adjacent claims should be adjacent.
11. **"expected affected count is none"**: see 2.2; claim of an expectation, not a measurement. Say so.

## 6. Process points

- D9 timeout: "no reply in one business day, proceed" applies to my sign-off. I would accept that for wording-only items. For the MERGE-GATE items above (follow-up filing, step-up caveat, adjacent detective/unmonitored, template-edit audit coverage, role-provisioning source) I ask that the timeout not apply: a silent timeout on a security sign-off should not turn a deferred finding into an accepted one. Alternatively record the timeout outcome as "not reviewed", not "proceeded as proposed", in `pr-notes.md`, so that SEC-31 revisit can see it.
- The doc says explicitly "No first-person or persona voice in HLA text" (D4). Agreed; keep my name out of the HLA.
- "First use defines carve-out": OK.

## 7. Summary of requested changes

MERGE-GATE:
1. Frame the template as the trust anchor for all default-copy paths (team creation, restore-defaults, assign-defaults); not only assign-defaults (1.1).
2. Address template-edit audit coverage for the chain or state it is not assessed (1.1).
3. Put "currently unmonitored (#131)" adjacent to "detective, not preventive" and make the rating conditional on its premises (2.1, 2.2).
4. Add "no step-up / recent-authentication requirement" to the single-admin caveat (2.2).
5. Clarify the mutable audit_log caveat's relevance to the in-scope attacker (2.2).
6. Verify and, if needed, state how application_admin is provisioned and whether admins can mint admins; verify "live" role check source (1.3, 3.2).
7. Verify topic text validation applies on the template-write path (1.2).
8. File follow-up 1 (and an audit_log immutability item) rather than leaving them in pr-notes.md (3.1).
9. Split the controls cell so success-path transactional audit is not equated with best-effort denial/failure rows; mark the limiter and source test as abuse bound / regression guard rather than controls against the stated threat (5).
10. Do not apply the D9 timeout to these items; record unanswered as "not reviewed".

SHOULD (wording):
11. "Accepted under #208" -> "covered by #208's trusted-role decision (predates #216's template edit)" (3.2).
12. Reopen triggers: add event triggers (admin compromise, role provisioning change, template editability change, #131 or audit hardening landing); name a detector for the zero-topic count; neutral phrasing for the recovery-speed sentence (4).
13. State that target teamId is caller-chosen so reach is every zero-topic team (1.2).
14. "Expected affected count is none" is documented, not measured; run or record a read-only count (2.2).
15. Redis outage: state whether denials are only unaudited or whether the limiter also fails open; state whether suppression markers are unsampled (2.2).
16. Confirm CSRF/session posture for the POST (2.3).

Overall: the structure is sound and the authors have been disciplined about not overclaiming tests. The remaining risk is that "low" is carrying more weight than its stated basis supports, because the detective control has no consumer, the population is unmeasured and the chain's first step is not assessed. Fix those and I will sign off on rating and triggers.
