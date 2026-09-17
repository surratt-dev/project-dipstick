# Exploration Notes — Escalation Contact Mechanism (GitHub #15)

**Explored by:** Devon Calloway (Internal Champion / SME), 2026-09-16
**Revised:** 2026-09-16, addressing Priya Nair's (Facilitator) and Marcus Delgado's (BA) review feedback. Revisions are marked inline; new §3a resolves as many of their open questions as the repo can actually answer, and §5 is rewritten to carry forward only what's genuinely unresolved.
**Scope:** Close the gap between the minimum-acceptable escalation text already shipped and the spec's "specific contact mechanism" requirement, for both the TEAM-005 role-assignment escalation and the TEAM-006 EM-association escalation in `MemberManagement.tsx`.

I'm treating the underlying decision (admin-only for TEAM-006, admin/EM-only for TEAM-005) as settled — Rachel already signed off on it, conditioned on this exact gap being closed. My job here is to make sure the fix closes the gap for real, without opening a new one.

---

## 1. Why I care about this one specifically

This is precisely the kind of item described in my own concerns list: "he becomes the escalation path for every edge case." If a facilitator hits a dead end in the app with no real mechanism to unblock themselves, the next thing that happens is they message me, or someone on their team messages me, because I'm the person who's been explaining this ritual by hand for years. The whole point of building this into software was to stop being the help desk. An escalation message that says "contact your admin" with no way to find the admin doesn't route around me — it routes *to* me, informally, every single time. That's the adoption risk Rachel and the architect both flagged, and it's not abstract to me.

It also matters for a narrower reason: this is the first time a facilitator from outside a team encounters the tool's limits. First impressions on the ritual are fragile. A dead end at setup time, before a session even starts, is a bad place for someone's first real friction with the application to happen.

---

## 2. Ritual constraints that bound the solution space

None of the core ritual mechanics (simultaneous reveal, no-manager-participation, facilitator-from-another-team) are directly touched by this fix — this is pre-session team administration, not session mechanics. But two things from my list are directly load-bearing here:

**"The application disappears into the background."** The acceptance criteria already encode this correctly: *no modal, no required acknowledgment, passive visible text only*. That's consistent with how the existing "access model statement" pattern works elsewhere on this same page (`data-testid="access-model-statement"` — small, gray, inline, no interaction required). Whatever contact mechanism gets added here needs to look like *more of that same thing* — a link or address embedded in static text — not a new UI surface (a "Request Access" button, a modal form, a notification). If the fix introduces a new interactive flow, it's solving a UX problem by adding UI chrome, which is the opposite of what this pattern is supposed to do.

**Facilitator-from-another-team.** The person hitting this wall may have zero prior relationship with this team or its admin. That's exactly why "contact your admin" fails — it assumes local knowledge the facilitator doesn't have. It also means the fix can't quietly assume "the facilitator will just ask around" — that's the exact behavior we're trying to eliminate. A specific mechanism (an address, a name) works precisely because it doesn't require local context.

One thing I want to flag explicitly so it doesn't drift: **"admin" here must resolve to an actual Application Admin, never to an Engineering Manager.** The TEAM-006 restriction exists because Q2 was resolved as admin-only — an EM cannot self-serve this even for their own team. If a future iteration of this fix "helpfully" routes the contact mechanism toward the team's own EM instead of an Application Admin, that quietly reopens the access question Q2 already closed. The TEAM-005 case is different and is discussed in §4 below — TEAM-005's authorized actors legitimately include the team's own EM, so pointing there is fine *for that endpoint specifically*. I don't want the two sites to get implemented as copies of each other without noticing they have different authorized-actor sets.

**[Added on review, per Priya's wrong-contact point]** Priya extended this caution in a direction I agree with: the failure mode isn't just "EM instead of Admin," it's "any adjacent-but-wrong contact." Whatever mechanism gets built must resolve to a contact who can *actually* act on the specific team in question — not a neighboring team's EM, not a stale cached name, not a contact who happened to hold the role at some earlier point. This is a correctness requirement on the query/lookup, not a UI concern, and I've folded it into the fallback-string guidance in §3a below.

---

## 3. What I found reading the actual code and specs

**The gap is real and narrowly scoped.** `MemberManagement.tsx:239-241` (TEAM-005) and `:445-447` (TEAM-006) both render "Contact your admin" with nothing after it. The TEAM-006 site even carries a code comment (`:215-226`) explicitly naming this as a tracked risk with my name — sorry, Rachel's condition — attached, and `tasks.md` task 4.2 is the only unchecked item in section 4. This isn't a rediscovery; it's a known, named, still-open gap.

**There's no existing admin-contact infrastructure to reuse.** I grepped for any config value (`ADMIN_EMAIL`, `SUPPORT_EMAIL`, etc.), any admin-roster endpoint, and any messaging/notification system. None exist. Whatever mechanism we pick, either the backend needs to start surfacing real Application Admin identity data it currently doesn't expose to non-admins, or someone needs to add a configured contact value that doesn't exist yet.

**There's a near-miss precedent worth learning from.** In the rate-limiting work (`tasks.md` task 3.10), the 429 error messages originally shipped with the literal placeholder text `[security/support channel]` copied verbatim from a decision doc — a bracket that was never filled in with a real destination. It was caught in post-implementation review and reworded to a generic, non-actionable phrase, with the real fix explicitly deferred to *this* issue (#15 / task 4.2). That's useful: it tells me the risk isn't hypothetical — the "invent a plausible-looking but non-functional contact string" failure mode has already happened once in this exact feature area. Whatever we ship here must be a real, resolvable value, not another placeholder.

**Security already blessed naming an admin, conditionally.** In the earlier TEAM-005 change (`design-review-security.md`), the security reviewer noted that surfacing the Application Admin's name and contact path discloses who holds the admin role, and called this acceptable "for this application's threat model — internal, small user population." That's a real precedent in our favor, but it was made in July against whatever the user population looked like then. I'd want that assumption re-confirmed rather than silently inherited two months later — worth a one-line check with the security analyst, not a re-litigation.

**The two escalation sites are not symmetric — one of them may already have the data on-page.** TEAM-005's authorized actors are Application Admins *or* an active EM for that specific team (`role-assignment/spec.md`). TEAM-006's authorized actor is Application Admin only (`manager-team-association/spec.md`). That means:
- For the TEAM-005 escalation, when the team *already has* an associated EM, that EM's name and email are already rendered a few lines down on the same page, in the "Associated Engineering Manager" section (`em.email`, `MemberManagement.tsx:469`). In that case a real contact mechanism may need zero new backend work — it's a matter of referencing data already fetched and displayed.
- When there's no associated EM (which is the TEAM-006 gap itself), or for the TEAM-006 escalation specifically, there's no EM to fall back to — an actual Application Admin contact is the only option, and that data isn't currently surfaced anywhere in the API response consumed by non-admins.

I think this asymmetry is worth designing around rather than flattening into one shared "escalation contact" component that treats both cases identically.

**The existing "passes" test doesn't actually verify a mechanism.** `MemberManagement.test.tsx`'s task-4.3 describe block (`:483-537`) asserts the escalation text matches `/Application Admin/i` and `/Contact your admin/i` — i.e., it tests for the presence of the *current, insufficient* wording, not for an email, link, or any other resolvable mechanism. This test will need to be rewritten, not just supplemented, or it'll keep passing against a component that still doesn't meet the spec.

---

## 3a. Facts resolved after Priya's and Marcus's review

Both reviewers converged on the same underlying complaint: too much of §5 (in the original draft) was "open question" when it should have been "resolved fact" or "explicitly deferred, and named as such." I went back into the schema, the bootstrap/seed code, and the specs to close as many of these as the repo will actually support. Some of these genuinely can't be closed from the repo — I've said so plainly rather than guessing.

### Does the escalation block session start, or is it a "fix later" notice? — **Resolved: it does not block.**

Priya's #1 was the one I most needed to check rather than assume. I read `sessions.ts`'s session-creation and session-join authorization logic end to end. It checks `users.global_role` and `team_memberships.role` in exactly one place — to exclude Engineering Managers from voting (`sessions.ts:83-119`, `:234-269`). Nothing in the session-creation path queries `checkAssignRolesAuthorization` or the manager-association state at all. A team with no associated EM, or a facilitator with no role-assignment permission, can still create and run a session today — the gap this issue is about is orthogonal to session start.

The existing shipped copy already reflects this correctly, which I hadn't credited on the first pass: `MemberManagement.tsx:240` reads "...Contact your admin to update this **before the session**" — that phrasing already implies the session proceeds and this is a fix-it-for-next-time item, not a hard gate. I'm treating this as confirmed, not just implied: **the escalation mechanism being added here is a "resolve before your next session" affordance, not a session-start blocker.** This should be stated explicitly in the proposal so it isn't re-litigated in design — and so nobody scopes a blocking-modal version of this fix, which would also violate the "no modal, passive text only" constraint from §2.

### Is zero Application Admins a reachable state? — **Resolved: yes, and more easily than a bootstrap-only edge case.**

Marcus asked for this to be checked against schema/bootstrap code rather than carried as a question. I checked `migrations/1_create_enums.sql`, `migrations/2_create_tables.sql`, and `migrations/4_seed_data.sql`. There is no `CHECK` constraint, trigger, or any other DB-level invariant requiring at least one `users.global_role = 'application_admin'` row to exist. More significantly: `global_role` is not admin-managed application state at all — it's an IdP role claim, re-asserted and overwritten on every sign-in (`account-resolver.ts:118-130`, the upsert sets `global_role = EXCLUDED.global_role` unconditionally on every login). There is no in-app UI anywhere in this codebase that promotes or demotes a user to/from `application_admin` — that authority lives entirely with whoever controls role-claim mapping in the IdP.

That means zero-admin isn't a hypothetical bootstrap gap, it's a live, ongoing possibility any time the IdP's role-claim configuration changes (a claim gets misconfigured, the one admin's claim is dropped, an IdP migration loses the mapping). **This must be designed for, not treated as assumed-impossible.**

One more finding that bears directly on this: the seed data (`migrations/4_seed_data.sql:16-25`) creates a sentinel "System" user (`id = 00000000-0000-0000-0000-000000000001`, `email = system@dipstick.internal`) with `global_role = 'application_admin'`, solely to own the default-topics sentinel team. **Any future query that lists Application Admins for the escalation mechanism must explicitly exclude this account by id**, or the "zero real admins" state will silently render a non-actionable `system@dipstick.internal` mailto link instead of the honest fallback — which is functionally the same failure as the task-3.10 placeholder bug, just produced by a different mechanism (a real-looking but non-human address instead of a literal bracket).

**Proposed fallback string** (for the proposal to adopt or improve on), in the same passive-text register as the rest of this pattern: *"No Application Admin is currently configured for this application. Contact your engineering leadership directly."* This satisfies Priya's requirement (#4) that the fallback not silently regress to "Contact your admin" — it names the actual state and gives a real, if generic, next step, rather than repeating the unhelpful phrase this whole fix exists to eliminate.

### Actual Application Admin count in the reference deployment — **Cannot be resolved from this repo. Flagging explicitly rather than guessing.**

I looked for this directly, since Marcus is right that it should decide Option A vs. Option B outright rather than staying an abstract tradeoff. This repository has no production or staging database, no admin-roster config, and no real user data — it's source and migrations only. The only two places anywhere in the repo where `global_role = 'application_admin'` appears attached to an identity are:

1. The seed sentinel `System` account described above — non-human, must be excluded from any real query, tells us nothing about headcount.
2. `docker/oidc/accounts.js`'s `admin-001` persona ("Riley Admin") — explicitly documented in that file's own header comment as one of "the four seeded **local-dev** accounts," used only to enable local login personas. It is not deployment data.

Neither is evidence of the real reference deployment's admin headcount. **This is a fact I cannot manufacture from the repo — it requires asking whoever administers the actual deployment's IdP role-claim assignments how many real people currently hold the Application Admin claim.** I'm carrying this forward as a named, specific question for the proposal stage (§5.1), not as vague hand-waving — someone with operational access to the real IdP/deployment needs to answer one question: *how many users currently authenticate with an `application_admin` role claim?*

In the absence of that number, my lean from §4 still holds and I'd defend it as the working default: given FR-1.6a's own framing and the July security review's "small user population" characterization, "enumerate all Application Admins as name + mailto, comma-separated, single line" (Marcus's suggested rewrite of open question #1) is the right default *unless* the real count comes back surprisingly large (double digits+), in which case Option B (a stable alias) becomes worth reconsidering. That threshold judgment is the one piece I'd want the actual number for before locking the mechanism in design.

### July security precedent ("internal, small user population") — **Partially resolved; the final word needs the security analyst, not me.**

I did what I can do from the repo: I checked for any evidence that the deployment model has changed since the July review — new multi-tenant support, external-facing access, SSO federation with an outside org, materially different team/user scale assumptions anywhere in `requirements/BRD.md` or the specs. I found none; the application is still designed and documented as a single-organization, internally-deployed tool with no external user class. So there's no in-repo signal that the assumption has become false.

That said, I'm a Principal Engineer and SME, not the security analyst who made that call, and "I didn't find contrary evidence" is not the same thing as "reconfirmed." Per Marcus's ask, this needs an actual one-line yes/still-true from whoever owns that threat-model context, done before the proposal is written — not carried forward as a parallel open question that gets resolved on some later, disconnected occasion. I'm marking this as a **blocking question for the proposal stage** (§5.2), same urgency Marcus assigned it, but I'm not going to write "confirmed" into these notes on my own authority.

### TEAM-005 stacked case (no permission AND no EM) — **Resolved: adopting Marcus's acceptance scenario as-is.**

Marcus is right that my §3/§4 prose implied this but never stated it as a testable scenario, which leaves room for an implementer to build Option C as "look for an EM, done" and miss the empty-EM branch. Adding this explicitly:

> **Scenario: TEAM-005 escalation falls back to Application Admin contact when no EM is associated**
> - **WHEN** a facilitator lacks TEAM-005 permission for a team **AND** no Engineering Manager is currently associated with that team
> - **THEN** the escalation message shows the Application Admin contact mechanism (Option A / the same mechanism TEAM-006 always uses)
> - **AND** no attempt is made to reference EM data, because none exists to reference

This should go into the proposal's acceptance criteria directly, not stay implicit in exploration prose.

### Does a `mailto:` link satisfy "email address" under FR-1.6a? — **Resolved: yes.**

FR-1.6a's exact text (`requirements/BRD.md:211`) is: "a specific contact path to reach that person (email address, in-application message path, or equivalent mechanism)." A `mailto:` link *is* an email address, rendered as an actionable link rather than plain text — it's the more specific, more useful form of "email address," not a weaker substitute needing to qualify under "equivalent mechanism." I don't think this needs further review-cycle litigation; stating it plainly in the proposal (per Marcus's #5) is enough to close it.

### Continuity across facilitators (Priya's #2) — **Explicitly out of scope for this fix, not silently dropped.**

Priya asked for this to be named one way or the other rather than left unaddressed. Naming it: **out of scope for this issue.** The reason isn't that it doesn't matter — it's a real continuity gap, and Priya's "does the next facilitator know I already escalated" scenario is a legitimate one. But closing it properly means some form of session-history or team-setup note ("EM association requested 2026-09-10, pending") — a persistent, visible tracking surface. That's a new feature with its own data model and its own UI surface, not a rewording of existing passive text. It's a close cousin of Option D (in-app messaging), which I already ruled out in §4 for the same reason: it's a bigger proposal than "add a real contact mechanism to two lines of text," and bundling it in here risks exactly the "too much UI chrome" failure mode I'm supposed to be guarding against. I'd rather this ship as a clean, fast fix for the actual named gap (#15) and have continuity tracked as its own follow-on issue, than have this fix balloon into a notification system and slip. Recommending it be filed separately, not solved here.

### Multi-admin rendering — **Constraining the format, not just the data shape.**

Priya's #3 is a real risk and I want to close the door on it explicitly rather than leave it to whoever writes the copy: however many Application Admins the enumerate-all approach surfaces, it renders as **one line of text in the same visual register as `access-model-statement`** — comma-separated names with inline `mailto:` links, no per-admin cards, no bulleted list, no vertical stacking. The moment it becomes a list with its own visual rhythm, it stops being "passive text" and starts being a directory, which is the thing Devon's original §2 constraint and Priya's #3 both rule out. If the real admin count (still unresolved, see above) turns out to make a single comma-separated line unreadable, that's itself a signal that Option B (alias) is the better answer — not a reason to let the enumeration spill into a list layout.

---

## 4. Candidate mechanisms

```
┌─────────────────────────────────────────────────────────────────────┐
│ Option                    │ New infra?  │ Handles N   │ Fits         │
│                           │             │ admins?     │ "background" │
├─────────────────────────────────────────────────────────────────────┤
│ A. Query real Application │ Small — new │ Ambiguous — │ Yes (text +  │
│    Admin(s) from users    │ field on    │ pick one?   │ link, no UI) │
│    table, show name+email │ TEAM-003    │ show all?   │              │
│    (mailto:)              │ response    │             │              │
├─────────────────────────────────────────────────────────────────────┤
│ B. Configured org-wide    │ New config  │ Yes — one   │ Yes          │
│    contact alias (email   │ value +     │ stable      │              │
│    or ticket address)     │ startup     │ address     │              │
│                           │ validation  │             │              │
├─────────────────────────────────────────────────────────────────────┤
│ C. Reuse on-page EM data  │ None, for   │ N/A (single │ Yes — literal│
│    when already present   │ TEAM-005    │ EM per      │ reuse of     │
│    (TEAM-005 only)        │ when EM     │ team)       │ existing UI  │
│                           │ exists      │             │              │
├─────────────────────────────────────────────────────────────────────┤
│ D. In-app "message an     │ Large — new │ Yes         │ No — this is │
│    admin" request flow    │ messaging/  │             │ a new        │
│                           │ notif.      │             │ interactive  │
│                           │ system      │             │ surface      │
└─────────────────────────────────────────────────────────────────────┘
```

D is out, in my view. It requires building a request/notification system that doesn't exist, for what should be a text-and-data fix — and a "compose a message" affordance is a much bigger piece of UI chrome than a mailto link. It also isn't what the spec is asking for: "an email address, an in-application message path, **or an equivalent mechanism**" reads to me as "any one specific, resolvable path," not "build messaging." If a future person wants to build real in-app messaging, that's a much bigger proposal on its own.

A and B are the live options, and they trade off against each other on exactly one axis: **what happens when there are zero or multiple Application Admins.** A is "free" in the sense that it needs no new configuration and can't go stale into a placeholder — the data already exists (`users.global_role = 'application_admin'`) and is already queried elsewhere in `teams.ts`. But it raises real questions: if there are three admins, do we show three names? One, arbitrarily chosen? If there are zero (a bootstrap/misconfiguration state), what renders — do we fall back to a generic message, which reintroduces exactly the "no mechanism" problem we're trying to close, just in an edge case? B sidesteps the N-admins ambiguity entirely by having one canonical address, but adds a new deployment-time configuration surface, and repeats the exact failure mode from the task 3.10 near-miss if that config is ever left unset — so it would need a startup-time validation or health-check guard, not a silent fallback to a placeholder string.

C isn't a full answer by itself, but it's close to free for the case it covers (TEAM-005, EM already associated), and it means the two escalation sites may end up with genuinely different implementations rather than a single shared component — which I think is correct given they have different authorized-actor sets, not an accident to be papered over.

My lean, not a hard prescription: **A for the cases that need it (TEAM-006 always; TEAM-005 when no EM is associated yet), C where it's free (TEAM-005 with an EM already on the team), skip B unless design surfaces a strong reason to prefer a stable alias over named individuals** (e.g., if the multi-admin case turns out to be common rather than an edge case). That's a design-phase call, not an exploration-phase one — I'm naming it as a lean, not locking it in.

---

## 5. Open questions to carry into proposal/design

Rewritten after review: what could be resolved from the repo has been moved into §3a as fact, with a concrete default recommendation. What's left below is only what genuinely cannot be answered without a human decision outside this exploration — each is now a specific, named ask rather than an abstract question.

1. **[BLOCKING] Real Application Admin headcount in the actual reference deployment.** Not discoverable from this repo (no production data exists here — see §3a). Needs one answer from whoever administers the real deployment's IdP role-claim assignments: how many users currently hold the `application_admin` claim? This decides whether "enumerate all, comma-separated, one line" (my working default) stays comfortably within "passive text," or whether the count is large enough that Option B (a stable alias) should be reconsidered instead.
2. **[BLOCKING] July security threat-model reconfirmation.** I checked for in-repo evidence the "internal, small user population" assumption has changed and found none, but that's not the same as a reconfirmation — it needs an explicit one-line answer from the security analyst before the proposal is finalized, not silently inherited two months later. See §3a for what I did and didn't check.
3. **[Design-phase, non-blocking] Exact rendered copy for the multi-admin line and the zero-admin fallback.** §3a constrains the *format* (single inline line, no directory-style layout; a specific non-generic fallback sentence, drafted in §3a) but the literal final wording should get a look before ship, per Priya's ask — she specifically wants to see the rendered copy, not just the data-shape decision.
4. **Should the TEAM-005 and TEAM-006 escalation sites share one contact-resolution mechanism, or are they legitimately different** (per §4, Option C only applies to TEAM-005)? I lean toward "legitimately different," and §3a's TEAM-005-stacked-case scenario makes this concrete — but the final call on whether to unify them into one shared component or keep them separate is still an architect/BA call once the data shape is settled.

Everything else that was open in the first draft — session-start blocking, zero-admin reachability, the TEAM-005 stacked-case scenario, whether `mailto:` satisfies "email address," and the task-4.3 rewrite requirement — is now resolved as stated fact in §3a and §6, not carried forward as a question.

---

## 6. Test requirement for task 4.3 (rewrite, not extend)

Confirmed again on this pass, with Marcus's addition folded in: `MemberManagement.test.tsx`'s task-4.3 describe block (`:483-537`) is titled "shows specific contact path... not just a grayed-out control" but its actual assertion is `toHaveTextContent(/Application Admin/i)` / `toHaveTextContent(/Contact your admin/i)` — i.e., it verifies the *old, insufficient* wording is present, not that a mechanism exists. A test with that title currently can't fail against the bug it's named for.

**Requirement for the proposal's task list:** the rewritten test must assert the presence of an actual resolvable mechanism — a `mailto:` `href` attribute, or an admin/EM identity string (name and/or email address) rendered in the escalation block — not a match against the literal phrase "Contact your admin." A future implementer must not be able to pass this test by leaving the old sentence in place and appending a name after it in a way that still doesn't resolve to anything actionable. This applies to both the TEAM-005 and TEAM-006 escalation tests, and should cover the zero-admin fallback case (§3a) and the TEAM-005 stacked-case scenario (§3a) as their own test cases, not folded silently into the existing ones.

---

## 7. What I'm explicitly *not* trying to settle here

Per how the equivalent question was handled in the prior `establish-manager-team-relationship` exploration (a facilitator reviewer asked essentially this same question and was told the literal UI mechanism is a design-phase decision, not an exploration-phase one) — I've gone further here than that prior round did, because this issue exists specifically to close that exact gap, and pure principle-restating a second time wouldn't move anything forward. But I'm stopping short of picking the final mechanism myself. That's a decision for the BA/architect in proposal and design, informed by the tradeoffs above — not something I should lock in unilaterally as the SME.

**One thing I'm deliberately not doing, on review:** I'm not expanding this fix to include facilitator-continuity tracking (Priya's #2), even though I agree it's a real gap. See §3a — it needs its own data model and UI surface, and bundling it here risks the exact "too much UI chrome" failure mode this fix is supposed to avoid. I'm naming it explicitly as out of scope and recommending a separate follow-on issue, rather than either silently dropping it or scope-creeping this fix to cover it.
