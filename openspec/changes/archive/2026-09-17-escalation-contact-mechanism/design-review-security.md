# Security Review: Escalation Contact Mechanism

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-09-16
**Documents reviewed:** `design.md`, `proposal.md`, `tasks.md`, `specs/role-assignment/spec.md`, `specs/manager-team-association/spec.md`
**Source reviewed:** `packages/backend/src/routes/teams.ts`, `packages/backend/src/auth/account-resolver.ts`, `packages/frontend/src/components/MemberManagement.tsx`
**Scope:** Authorization boundaries for the new Application Admin / EM identity disclosure, audit logging, threat-model impact, and whether the TEAM-006 admin-only contact boundary is enforced at a layer that resists silent regression. Also asked to reconfirm or decline to reconfirm the July 2026 threat-model assumption named in Open Question #2.

---

## Summary

The mechanics of this change are sound: query-level exclusion of the `System` sentinel (not a display filter), server-computed `canAssignRoles`/`canAssociateManagers` driving both the UI and (correctly, if implemented as I assume below) the data-inclusion decision, and a deliberate decision to keep TEAM-005/TEAM-006 resolution as separate code paths so a future "simplification" doesn't quietly reopen Q2. Those are the right instincts and consistent with patterns already established elsewhere in this file (`teams.ts`'s existing admin-read audit trail, the TEAM-006 rate limiter's fail-closed posture).

That said, I am not giving an unconditional reconfirmation of the July 2026 threat-model assumption — see below — and I have one Required finding: the design describes *when* Admin identity enters the response payload in terms of team state, not explicitly in terms of the requesting viewer's own authorization state. Those two framings happen to coincide today, but the coincidence should be made an explicit, tested rule, not an emergent property of how the query happens to be written. Everything else is Recommended or Observation.

---

## Open Question #2: July 2026 threat-model reconfirmation — **Conditional, not unconditional**

I made the original call (`archive/2026-07-06-assign-role-to-team-member/design-review-security.md`, line 30): "the escalation UX exposes organizational structure... For this application's threat model — internal, small user population — this is acceptable." I'm not walking that back. But I want to be precise about what I actually blessed, because this design extends it further than that finding evaluated, and "internal app" is a different-risk category, not a lower-risk one — I don't rubber-stamp scope creep on an old finding just because it's the same *kind* of disclosure.

What July evaluated: **one** Application Admin's identity, shown **only at the moment** a Facilitator hit a permission dead end.

What this design does: enumerates **the full Application Admin roster** (name + email, comma-separated, potentially several people in one line), and — for TEAM-006 specifically — renders it to **every non-admin team member, on every view** of a team lacking an EM or lacking admin standing, not only at the point someone actually tries and fails to act. That's a materially larger blast radius on two axes: roster completeness (one name → all names) and exposure frequency (on-demand → ambient/passive).

Why that matters beyond "more PII visible": Application Admin is the highest-privilege role in this system — it can assign any role and establish any EM/team relationship, and `teams.ts`'s own TEAM-006 rate limiter comment already states the threat model's attacker as "a compromised credential." A roster that lets any authenticated employee learn, in one place, the complete list of accounts worth compromising to get that privilege is a direct increase in the spear-phishing/targeting surface for the accounts that matter most in this application. That's not hypothetical — it's the textbook reason privileged-account rosters aren't normally published broadly even inside a trusted perimeter.

**My position:** the "internal, small user population" assumption still holds as a characterization of the deployment (I have no evidence it's changed), and I am not asking for the mechanism to be re-architected. But the reconfirmation is **conditional on Open Question #1's headcount answer, evaluated against the expanded scope above, not the original single-admin scope**:
- If headcount is small (single digits), full-roster comma-separated disclosure is a proportionate extension of the July precedent and I reconfirm it.
- If headcount is large enough that Decision 3's single line becomes a long list of named privileged accounts, that is exactly the signal — independently of readability — to take the configured-alias alternative (Option B, Decision 1) seriously, because at that point the design is publishing a substantial fraction of the org's privileged-account directory to every ordinary user, which is a different decision than the one July made.

Record this as the task 1.2 answer: **conditionally reconfirmed, gated on OQ1's headcount outcome being evaluated against full-roster/ambient-exposure scope, not re-litigated against the original single-admin/on-demand scope.**

---

## Findings

### Finding 1 (Required): Admin-identity inclusion must be gated explicitly on the viewer's own authorization state, not implied by team state

Decision 1 says Admin identity is added to the response "for the escalation cases that need it," and tasks.md 2.2 operationalizes this as "always for TEAM-006's view... for TEAM-005's view when no EM is associated." Both of those are **team-state** conditions (does this team have an EM), not **viewer-state** conditions (can *this specific caller* already act). They happen to coincide today only because `canAssociateManagers` is `true` exclusively for admins (who already legitimately see this data) and `canAssignRoles` follows the same shape when no EM exists. That coincidence is correct today but it is not stated as a rule anywhere, which makes it exactly the kind of thing that erodes silently: a future change to `canAssignRoles`'s definition (e.g., a new authorized-actor category) would decouple "team has no EM" from "this viewer lacks permission," and the query would keep shipping Admin PII to a payload without anyone having decided that was still correct.

Per my own standing position (UI-layer access control is UX, not access control), this cannot be a property the frontend enforces by choosing not to render a field it received. **Require:** the query/endpoint contract states explicitly — as a tested invariant, not implementation incidental — that Admin identity is included in a given response if and only if the *requesting caller's own* `canAssignRoles`/`canAssociateManagers` for that request is `false`. Add a backend test asserting an Application Admin's own request never needs to rely on this field being absent-because-unused — it should be verifiably scoped to non-admin callers at the response-construction layer, independent of what the admin's frontend happens to do with it.

### Finding 2 (Recommended): No decision recorded on audit logging for non-admin reads of Admin identity

`teams.ts` already has an established, deliberate convention (Decision 2/Option B in the original TEAM-003 work) of writing an `audit_log` row plus a structured `emitAuditEvent` whenever an Application Admin reads membership/team-detail data (`admin.membership_list_accessed`, `admin.team_detail_accessed`, both gated on `actorGlobalRole === 'application_admin'`). This proposal introduces the **inverse** and previously nonexistent case — non-admin callers reading Application Admin PII — and neither `design.md` nor `tasks.md` mentions whether that read is worth an audit trail entry.

I'm not requiring a row-per-pageview here; given the ambient nature of this disclosure (Finding in OQ2 above), logging every render would be noisy and its value is genuinely debatable. But "debatable and therefore unaddressed" is not the same as "debated and explicitly declined." Given that this file already treats privileged-data reads as an audit-worthy event class, the absence of a decision here should be closed explicitly one way or the other before this ships — even if the answer is "no, and here's why the existing rate-limiting + roster-size caution is the compensating control instead." Silent omission is the thing I'd flag in any review, not the specific answer.

### Finding 3 (Observation): TEAM-006's admin-only contact boundary is enforced by code separation and tests, not by a structural barrier — name this as the accepted control, don't treat it as equivalent to real authz enforcement

Decision 2's mitigation for "a future edit collapses the two resolution paths" is: separate functions/queries, kept intentionally un-shared, backstopped by a test (tasks.md 3.3, 5.6) asserting TEAM-006 never renders EM identity. This is *not* an access-control boundary in the sense the rest of this document treats seriously — nobody gains data they're not authorized to see either way, since `engineeringManagers` is already rendered elsewhere on the same page regardless of which contact the escalation message shows. It's a copy/framing policy decision (which already-visible identity gets labeled "the person to contact") riding in the same component as the EM data it must not casually reach for.

Given that, test-plus-code-separation is a reasonably matched control for what this actually is — but it is weaker than the kind of enforcement I'd insist on for a real authorization boundary, and the design should say so plainly rather than implying via "kept as two separate code paths" that this is structurally locked down. Concretely: nothing stops a future contributor from grabbing `engineeringManagers[0].email` inside the TEAM-006 block by copy-paste, because the variable is sitting right there in scope and looks like the obvious shortcut. The test catches it *only if it runs and CI is required on this path* — that's an assumption worth confirming (task 6.2 checks spec-scenario coverage; confirm the TEAM-006-never-EM test is actually wired into the required CI gate, not just present in the suite). If a stronger guarantee is wanted cheaply, typing the TEAM-006 admin-contact data as a distinct shape (e.g., `applicationAdminContacts: AdminContact[]`, not `TeamMember[]`) would make an accidental EM substitution a type error rather than a silent behavioral regression caught only by a specific test remembering to assert it. Not blocking — the current plan is acceptable — but call it what it is in the design doc.

### Finding 4 (Strength): Query-level `System` exclusion is the right default

Excluding the seed `System` account by id at the query layer (Decision 1, Context) rather than in the display layer is exactly the secure-default pattern I look for — it fails safe for every future consumer of that query, not just this one screen. Good.

### Finding 5 (Recommended): Feed the phishing-surface consideration back into the OQ1 headcount decision and the OQ3 copy review

Tie this to Finding under OQ2 above: when task 1.1's headcount answer comes back, evaluate it with "how many named, privileged accounts are we willing to make ambiently discoverable to every employee" as an explicit input, not only "is one line of text readable." If the answer is large, prefer Option B (configured alias) over the enumeration format even if a long comma-separated line would technically still render — readability was never the only reason that alternative existed.

### Finding 6 (Required — scope clarity, not a security defect): Pin down which endpoint(s) actually get extended

Proposal `Impact` and tasks.md 2.2 both hedge with "`GET /api/v1/teams/:teamId` / `GET /api/v1/teams/:teamId/members` as appropriate." `MemberManagement.tsx`'s own header comment states the legacy `/members` endpoint "is no longer used here," which suggests it may still be live for other consumers. For a change whose entire subject is *new PII disclosure*, "as appropriate" is the wrong level of precision to leave in a tasks document — if the legacy endpoint is in scope, it needs the same viewer-state gating as Finding 1, evaluated independently (its `canAssignRoles` flag has different semantics and no EM/Admin branch today); if it's out of scope, say so explicitly and confirm no other current caller of that endpoint would newly receive Admin identity through it. Either answer is fine; the ambiguity itself is the finding.

---

## Non-findings (checked, no issue)

- **Enumeration/scraping risk:** bounded by existing team-membership authorization on the endpoint (`is_member` or `application_admin` required); this isn't a new anonymous-enumeration vector, only a broadening of what already-authorized members see.
- **Rate limiting:** the new data rides on existing GET reads with no state change; TEAM-006's write-path rate limiter is unaffected and doesn't need to cover this.
- **XSS via rendered name/email:** React's default escaping applies; no raw HTML injection path introduced by this change.
- **`mailto:` as the mechanism:** agree with `design.md`'s framing that this is a more actionable rendering of "email address," not a weaker substitute.

---

## Disposition

Not blocking on Findings 2–6 — advisory, should be closed before ship but don't require redesign. Finding 1 I'd like made explicit and tested before implementation, not after. OQ2 is answered above (conditionally) rather than left open; OQ1's answer should be read against the expanded-scope framing in that answer, not the original July framing.
