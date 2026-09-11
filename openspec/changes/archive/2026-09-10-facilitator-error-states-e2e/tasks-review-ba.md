# Tasks Review — Business Analyst (Marcus Delgado)

**Reviewing:** `tasks.md` against `proposal.md` and `design.md`, this pass focused on whether the design-stage revisions landed faithfully and whether `tasks.md` still covers every capability/acceptance condition in `proposal.md`.
**Prior passes:** `explore-review-ba.md`, `propose-review-ba.md` (both already adopted per `proposal.md`'s disposition section, verified below).

## Bottom line

The six design-stage revisions I was asked to check all landed correctly in `tasks.md`, and they landed well — the dedicated-role mechanism for Error State 2 in particular is now specified at a level of precision I'd hold up as the bar for the rest of the document. The per-state acceptance-condition coverage is also intact: all six states/sub-states from `proposal.md`'s "What Changes" list have a corresponding task with the right endpoint, the right trigger mechanism, and the right assertion. Task 11.10's annotate-not-check disposition and the timeout/issue-#26 disambiguation are both carried through exactly as directed.

But this pass surfaced one real drift between `proposal.md` and everything downstream of it, and one commitment from `proposal.md`'s Impact section that has no task counterpart at all. Neither is a blocker on the shape of the work — the actual engineering scope in `tasks.md` is sound — but both are exactly the kind of "the document people will trust says one thing, the thing that got built says another" gap I keep flagging on this proposal, and they're cheap to close before implementation starts.

---

## 1. Finding: `proposal.md` names three Error-State-3 trigger endpoints; `design.md`, `tasks.md`, and the spec delta all agree on two

`proposal.md` line 13 (What Changes, Error State 3):

> "...following a real committed transition via the **topic-advance/lobby-advance/session-close endpoints**, delivered to a real connected subscriber..."

Three endpoints, named as a set. But every document produced since — the ones that actually govern what gets built — converge on two:

- `design.md`'s "Relevant endpoints" (Context) lists only `topics/advance` (wrap-up-entry branch) and `complete` as Error State 3 triggers. The draft→lobby `advance` endpoint isn't mentioned.
- `design.md` D3 explicitly frames the WS-delivery proof as "the endpoint that actually computes the spec's required banner text/shape" plus "the wrap-up-entry branch fires" — again, two endpoints, not three.
- `tasks.md` 4.2/4.3 implement exactly these two: `topics/advance` (wrap-up-entry, facilitator subscriber) and `complete` (participant subscriber, per the authorization-asymmetry note). No task anywhere calls the draft→lobby `advance` endpoint.
- The spec delta's own implementation note (`specs/team-content-access/spec.md`) already says "via the topic-advance wrap-up-entry branch or session completion" — two, matching `design.md` and `tasks.md`, not `proposal.md`.

I checked whether this narrowing is actually a defect or a correct decision that `proposal.md` just never caught up to. It's the latter, functionally: task 4.5 confirms `bannerState` is only non-null for `wrap_up`/`complete`/`abandoned`, and is explicitly `null` for `lobby`/`pre_session`/`active`. A draft→lobby transition lands in the "normal, no banner" bucket — it isn't one of Error State 3's observable trigger cases the way `spec.md` defines the state (a banner the facilitator must dismiss/resume from). Testing it would prove the same generic pub/sub mechanism `topics/advance` and `complete` already prove, without adding a new observable acceptance condition. So the two-endpoint scope in `design.md`/`tasks.md` is the right call — I'm not asking for a third test.

What I am flagging: `proposal.md`'s own "What Changes" bullet still tells a reader three endpoints are in scope for this state, and nothing in this change updates that line to match the two the team actually settled on. That's the same category of drift Item 1 in my propose-stage review caught (the spec delta's two extra scenarios) — a document whose job is to be the thing people trust says something the actual deliverable doesn't do. `proposal.md` and `design.md`/`tasks.md`/`spec.md` currently disagree with each other on record.

**Recommendation:** edit `proposal.md` line 13 to read "via the topic-advance wrap-up-entry branch or session completion," matching `design.md`/`tasks.md`/the spec delta exactly, and drop "lobby-advance" from the list. Small edit, but it removes the one place in this change's document set where the acceptance condition as stated and the acceptance condition as built no longer match.

## 2. Finding: the issue #19 closure-communication commitment has no task

`proposal.md`'s Impact section carries a commitment that isn't test-scope but is still a deliverable of this change:

> "Whatever GitHub comment or PR description closes out issue #19 will state plainly that it closes only the backend-rigor half of task 11.10 and will link forward to issue #38 by number — not close silently."

This exists because of Rachel's condition (b) at propose-review stage, and the disposition section confirms it was adopted "as the new 'Issue #19 closure communication' bullet in Impact." That's true — but adoption only touched `proposal.md`. Nothing in `tasks.md` (not Section 6's documentation updates, not Section 7's verification) tells whoever opens the closing PR to actually write that comment. `tasks.md` is the document someone works through top-to-bottom to know the change is done; `proposal.md`'s Impact section is not something implementation checklists typically get re-read against at PR time.

This is a small thing to lose, but it's exactly the kind of small thing that gets lost silently — a commitment made to satisfy an exec-level review condition, living only in a document nobody re-reads at merge time.

**Recommendation:** add a short task — Section 6 or 7 is fine, e.g. "6.3 / 7.5: PR description or issue-#19-closing comment states this closes only the backend-rigor half of task 11.10 and links forward to issue #38 by number" — so the commitment is on the checklist, not just on record.

## 3. Minor: the auth-scope Non-Goal isn't echoed as a `tasks.md` instruction

`design.md`'s Non-Goals state plainly that no real authentication is exercised — the harness sets `request.session = {userId}` directly, matching the existing convention in `facilitator-error-states.test.ts` and `ws-pubsub-integration.test.ts`. This is a real scope boundary (it's explicitly called out as a Non-Goal, not left implicit), and the timeout Non-Goal right next to it in the same section got its own explicit `tasks.md` instruction (4.4's code comment) specifically so an implementer reading only `tasks.md` wouldn't rediscover or misjudge the boundary. The auth-scope Non-Goal doesn't get the same treatment — nothing in Section 1 (harness setup) tells the implementer to use the direct-session-assignment convention rather than reach for a real OIDC/cookie flow.

This is lower stakes than Items 1-2 — the fixture convention is well-established elsewhere in the codebase and an implementer copying `ws-pubsub-integration.test.ts` (as Section 1 already directs) will pick it up by osmosis. But since design.md treated this as worth stating as an explicit Non-Goal rather than leaving it assumed, I'd rather see it land the same way the timeout Non-Goal did than rely on an implementer inferring it from the file they're told to copy.

**Recommendation:** optional — add a one-line note to task 1.1 or 1.3 stating the harness uses direct `request.session` assignment, not real auth, matching the existing convention. Not a blocker.

---

## 4. Confirmed correct: the design-stage revisions I was asked to check

- **Dedicated-role mechanism for Error State 2 (D7).** Tasks 1.5 and 3.1 implement this exactly and thoroughly: the isolated file, the `DROP ROLE IF EXISTS` self-heal, the precise `GRANT SELECT` list (deliberately omitting `session_topics`), the `DATABASE_URL` save/override/restore with dynamic imports, the explicit note ruling out `REVOKE`-against-`dipstick` (matching D7's superuser reasoning verbatim), and the no-audit-log-cleanup-needed note for this one GET-only test. Task 7.1 closes the loop by verifying the role is gone afterward. Nothing lost in translation here — if anything this is the most rigorously specified task group in the document.
- **New `/facilitator-state` coverage task.** Task 4.5 matches D3's second assertion exactly: real HTTP call, `wrap_up`/`complete`/`abandoned` fixture states, the exact banner message and `displayType`/`action` fields, plus the `null`-for-normal-states check matching the mocked suite's existing coverage. This directly closes the gap `design-review-engineer.md`'s should-fix #1 raised (the banner-producing endpoint previously had zero real-infra coverage) — confirmed landed.
- **`/complete` endpoint subscriber-type note.** Task 4.3's "Important" callout matches D3's authorization-asymmetry paragraph and `design-review-engineer.md`'s should-fix #2 precisely — participant subscriber required, facilitator subscriber would fail for reasons unrelated to what's under test, and the reasoning (delivery-time authorization working as designed, not a bug) is stated rather than just the mechanical instruction. This is the right level of detail for an implementer to not "fix" a false failure.
- **`audit_log` cleanup requirements (D4).** Tasks 2.1 and 4.6 both carry the FK-non-enforcement reasoning and the explicit `DELETE FROM audit_log WHERE actor_user_id = $1`/`team_id = $1` instruction. Task 3.1 step 5 correctly notes the *opposite* — no audit_log cleanup needed there, since that test only calls GET. Consistent and correctly scoped in both directions.
- **Raw-body disclosure-check requirement.** Task 3.3 matches design.md's Goals bullet 4 exactly, down to citing the same line range and reusing the same `rawBody`/`res.body` pattern from the existing mocked suite, and explicitly states why a parsed-JSON-only check would be insufficient rigor. Faithful.
- **Auth-scope Non-Goal.** Present and correctly stated in `design.md`. Not lost from the *design*, but see Item 3 above — it doesn't get its own `tasks.md` instruction the way the timeout Non-Goal does.

## 5. Confirmed correct: all six per-state acceptance conditions from `proposal.md`

| Proposal condition | Task(s) | Check |
|---|---|---|
| State 1 recoverable — real reveal, session stays active | 2.2 | exact status/errorState/recoverable/message + active-confirmation asserted |
| State 1 non-recoverable — real reveal, session not active | 2.3 | exact status/errorState/recoverable/message asserted |
| State 1a — backend contract only, `already_revealed` shape | 2.4 | real endpoint, `revealedAt`, no-error-chrome assertion |
| State 1b — backend contract only, `advance_blocked`, `requiresReveal: true` | 2.5 | matches exactly |
| State 2 — real HTTP, empty-state body, confirmed not 403 | 3.1 | matches, plus the D7 mechanism and the authorization-vs-Error-State-2 disambiguation note |
| State 3 — real trigger, real Redis pub/sub, real connected subscriber | 4.1-4.5 | matches, modulo Item 1 above (endpoint-list wording, not test coverage) |
| State 4 — real cross-team request, non-disclosure by absence | 3.2/3.3 | matches, explicitly reuses existing rigor |

## 6. Confirmed correct: task 11.10 annotate-not-check disposition

Task 6.2 states the annotation content (which states/sub-states, what infra, that the task remains unchecked pending issue #38) and explicitly instructs: "Do not check the box — per design.md D6 and the exploration notes, only the change that delivers the frontend rendering may check task 11.10." This matches `proposal.md` line 18's "Annotate (not check)" directive exactly. No drift.

## 7. Confirmed correct: system-timeout exclusion with the issue-#26 disambiguation

Task 4.4 carries both halves: the exclusion reason (no timeout-driven auto-transition mechanism exists) and the explicit disclaimer that this is "a separate, unbuilt mechanism, not a consequence of issue #26." This is precisely the fix my propose-stage review (Item 2) asked for, and the disposition section in `proposal.md` confirms it was adopted into both `design.md`'s Non-Goals and `tasks.md` 4.4 — verified directly, it's there in both.

---

## Summary of what needs fixing

1. **Edit `proposal.md` line 13** to name the same two Error-State-3 trigger endpoints `design.md`/`tasks.md`/the spec delta already agree on ("topic-advance wrap-up-entry branch or session completion"), dropping "lobby-advance." The narrower scope is correct; the document just hasn't been updated to say so.
2. **Add a task** (Section 6 or 7) for the issue #19 closure-communication commitment from `proposal.md`'s Impact section, so it's on the checklist an implementer actually works through, not only on record in a document read once at sign-off.
3. **Optional:** note the direct-`request.session`-assignment auth convention in Section 1, matching the treatment the timeout Non-Goal already gets.

None of this changes the shape of the work. The engineering scope in `tasks.md` — six states, real Postgres, real Redis, the restricted-role mechanism, the two-endpoint Error State 3 proof, the audit_log cleanup discipline — is sound and ready to build against. Items 1 and 2 are bookkeeping between documents, not scope changes; I'd want them fixed before this is called fully consistent, but neither should block implementation from starting.
