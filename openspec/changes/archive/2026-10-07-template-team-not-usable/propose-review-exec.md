# Proposal Review: Executive Stakeholder

**Reviewer:** Rachel Okonkwo, VP Engineering (executive sponsor)
**Change:** `template-team-not-usable` (#214)
**Focus:** Strategic alignment with adoption goals; scope proportional to value
**Verdict:** **Approve with conditions** (two conditions, three advisories)

---

## Bottom line

Ship this. It is a small, defensible fix to a problem that could hurt both of the things I care
about most: making the first session easy, and making sure the data never looks like surveillance.
The scope is mostly proportionate. My conditions are about ownership and not losing an adoption
signal. They are not about the design.

## Strategic alignment

**1. It protects trust.** Devon names the risk I care about. Chain B produces completed sessions
with votes that belong to no team, with no reporting structure and no access boundary I can reason
about. My non-negotiable is that a team's data is visible only within that team's structure plus
the EM and the current facilitator. Data with no team breaks that rule by definition. If an
orphaned result ever turned up in an EM view or a trend chart, I could not explain to an engineer
whose data it was or who could see it. Closing this structurally, with a database backstop and not
a toggle, is the right level of seriousness. "No override" is the right call. I don't want a future
admin setting that reopens this.

**2. It removes friction from the first session.** Right now every facilitator's picker shows a
team called `__default_topics__`, and since #237 we send facilitators straight to that picker. The
first time a champion tries the tool, they see an internal artifact in a list of real teams. That
looks unfinished, and adoption stalls on moments like that. Removing it, and fixing the false "until
this team completes its first session" copy on Topic Management, are small changes that help how
the product is first perceived. These are the user-visible items in the change, so they should not
be cut.

**3. It keeps the defaults trustworthy.** The canonical topic set is the shared language I want
across teams (consistency is one of my reasons for sponsoring this). A "practice" session that
silently unlocks the template for edits would erode that language. Showing the defaults as
permanently locked, with honest copy, supports consistency across the org.

## Scope vs. value

**Proportionate:**
- The app guard, the picker exclusion, the database constraint and the cleanup migration are the
  core of the fix. Each one closes a real path.
- The structural, fail-closed route test is worth the cost. #188 already showed that per-route
  checks drift. A test that fails when someone adds a new team route is cheaper than a second
  security review.
- Reusing #188's "respond as if the team doesn't exist" pattern keeps the code consistent, so it
  is not new complexity.
- Explicitly ruling out a `teams.kind` column, read-model exclusion filters and a `topics`
  constraint (kept in #215) shows good restraint.

**Watch for gold-plating (advisory, not blocking):**
- **Anti-enumeration parity for a well-known id.** The template's UUID and name are in the repo and
  in migrations, so its existence is not a secret. Matching each endpoint's existing missing-team
  response is cheap, so keep it. But don't spend effort on timing-equivalence tests or
  header-by-header comparisons beyond what #188 already does for the missing-team branch. If parity
  tests start taking real time, stop at status code and body.
- **The audit operation.** One operation name with no dashboard or alert is fine, and the proposal
  already says no dashboard. Keep it that way. I don't need a report on this.
- **Read-surface verification (tasks section 8).** Verifying membership gating is right, but it
  should be a short checklist with a test per gate, not a new audit of every read model. If a
  surface turns out not to be gated, file it separately rather than growing this change.

Overall the artifact set (about 1,800 lines across proposal, design, specs and tasks for 28 tasks)
is heavy for the user-visible outcome. That reflects how carefully the security review was answered,
and I accept it here because this change is about access boundaries. It should not become the
template for routine changes.

## Conditions

**C1. H1 must have a named owner before deploy, not before archive.** This check has had no owner
since #188. "Not yet named" twice in a row means the process is relying on nobody. The migration is
safe either way, but the deploy timing rule ("no session running") depends on someone actually
running the count. Brian should name the owner when he approves this proposal. If nobody is
available, Devon owns it by default as the champion who framed the change.

**C2. Treat practice use as an adoption signal, not just a security finding.** If H1 finds any
template sessions, that tells me facilitators wanted to rehearse before running a real session.
That is exactly the first-session nervousness I worry about. The "Facilitator practice mode" issue
should be filed **and put in the backlog for my review alongside onboarding work**, not just linked
to #214 and forgotten. Even if H1 finds nothing, I'd like Devon to ask the current champions whether
they would have used a rehearsal mode. That is a five-minute conversation, not a build.

## H2 (keep vs. delete historical template sessions)

I support the default: **keep them, frozen**. I have said full history should be kept
indefinitely, and deleting data that can't be recovered in order to tidy up is the wrong instinct.
The one condition is the one the proposal already states: these rows must never surface in any EM,
facilitator or trend view. Membership gating plus the "no members can ever exist" constraint gives
me that assurance.

## Not BREAKING

I agree. No legitimate client uses the template as a team, and real teams are unchanged.

---

**Summary for Brian:** Approved. Name the H1 owner, route any practice-mode finding into onboarding
planning, and keep parity and verification work at the size it is now.
