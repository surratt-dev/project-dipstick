# Facilitator Review — Exploration Notes (fix-isnewuser-atomic-upsert)

**Reviewed by:** Priya Nair, Facilitator (Subject Matter Expert)
**Reviewing:** `openspec/changes/fix-isnewuser-atomic-upsert/exploration-notes.md`

---

## Bottom line

This has essentially no facilitation or session-UX surface, and I don't want to manufacture concerns to justify a review just because I was asked for one. I facilitate Engineering Health Check sessions — voting, reveal, outlier flagging, session pacing. This change is a login-path data-integrity fix inside `resolveOrCreateAccount`. It doesn't touch the vote cast path, the reveal mechanic, the readiness grid, or anything a facilitator or participant sees during a live session. I'm signing off on the "no facilitation impact" framing rather than inventing a UX angle.

That said, I did check the one thing in my remit that's worth checking on any auth-adjacent change: **could this surface something confusing to a facilitator or admin?** Notes below.

## What I checked

I traced where `isNewUser` actually goes today, since the exploration notes claim "the current sole consumer... tolerates duplicates by design" and I wanted to verify there isn't a second consumer the notes missed that would put a duplicate in front of a human.

- `resolveOrCreateAccount` sets `isNewUser` → `packages/backend/src/routes/auth.ts`
- Consumed in exactly two places, both structured **logs**, not UI or admin-visible records:
  - `auth.first_access_created` audit event (fires only `if (user.isNewUser)`)
  - `auth.success` audit event, field `isFirstAccess: user.isNewUser` (always fires, just carries the flag)
- Neither is read back by any frontend code, admin view, or facilitator-facing dashboard — I grepped for `isFirstAccess` and `first_access_created` across the repo and found no consumer beyond the audit logger itself.

**Conclusion: no, a duplicate `isNewUser=true` cannot currently reach a facilitator or admin in a confusing way.** It's log-only, and audit logs aren't rendered anywhere a facilitator would see them during or after a session. This matches the exploration notes' claim in §1 — I just wanted to confirm "tolerates duplicates by design" wasn't quietly relying on nobody having built the admin view yet.

## One thing worth flagging for future work, not this change

The exploration notes are explicit (§2) that this change should not grow a new `isNewUser` consumer, and I agree — that's correct scope discipline and I'd object if it drifted. But I'll register this for whenever a real consumer gets designed: if a future feature ever surfaces "new user" status to a facilitator (e.g., "this is someone's first session, welcome them"), the *duplicate-emission* failure mode this fix closes is exactly the kind of thing that would have created an awkward moment — a facilitator being told to "welcome" the same person twice, or a system message firing twice in front of the room. That's a good example of why closing this now, before that feature exists, is the right call rather than a "why bother, nothing reads it yet" deferral. Nothing to act on today; just confirms the guardrail framing in the notes was aimed at a real risk.

## Answering the specific prompts

- **Real user pain points / workflow friction?** Not applicable — no facilitator or participant workflow touches this code path beyond the one-time login redirect, which is unaffected (notes §4 confirm `ResolvedUser`'s public shape and caller behavior in `auth.ts` don't change).
- **Usability concerns missing?** None that I can find. This is correctly scoped as backend plumbing.
- **Would this disappear into the background during sessions?** Trivially yes — it already is background; it runs once at login, before a session begins, and touches no session-time code path (vote casting, reveal, readiness grid, outlier flagging, trend dashboard are all untouched).

## Recommendation

No changes requested. This is not an area where my sign-off should carry weight beyond "I checked and there's genuinely nothing here for me" — treat this review as a documented pass-through rather than a substantive gate.
