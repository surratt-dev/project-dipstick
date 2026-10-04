# Facilitator Review: Exploration Notes for #238 (facilitator-reporting-chain-decision)

**Reviewed by:** Priya Nair (Facilitator persona, subject matter expert)
**Reviewing:** `exploration-notes.md` (Devon Calloway, 2026-10-04)
**Binding inputs respected:** decision-log rows 1–4. I am not reopening the conflict rule, the resolution to `engineering_manager`, "admin wins but is still flagged", or "decision record only, implementation after #235". Everything below is about how those decisions *land on people*.

I read this as someone who runs sessions for three teams on rotation, and who has watched managers wander into facilitation more than once. My question throughout was whether a facilitator would ever notice this rule in the room. If the rule is built well, the only people who notice it are the one person with the wrong roles and whoever fixes their IdP groups, and both of them notice it at a desk, not in front of a team.

---

## Observations

**O1. The ritual reasoning is right, and §1 says it better than the source does.** "There is no legitimate manager-who-also-facilitates profile" is true. In my experience the facilitator's whole value is that they hold no authority over anyone in the room. A manager in the chair changes what people say even if the manager is careful. Resolving to EM costs the ritual nothing. I also agree with §6.5: a peer from a sibling team under the same manager is a fine facilitator. "Reporting chain" means *above* the team. Please keep that sentence in the record, because I have had a team lead ask me this exact question.

**O2. The notes treat the conflict as a misconfiguration. In practice the most common path into it will be a promotion.** The realistic story isn't an IdP admin ticking two boxes at random. It's a senior engineer who has been facilitating for other teams being promoted to EM. Someone adds them to the EM group and nobody removes them from the facilitator group. That person is in the middle of a facilitation rotation: they have **teams that expect them next Tuesday and possibly drafts already set up**. §4 and §9 frame the user-facing side as "explain why you can't create a session". The real friction is "I had three sessions lined up and now I can't run any of them". The notes don't cover this workflow at all.

**O3. The worst moment for this to bite is "Open room", and today's code makes it bite exactly there.** `POST …/advance` re-checks the *live* `global_role` (`facilitator-sessions.ts:846-886`) and returns 403 **"Only a facilitator can open the room."** A newly conflicted facilitator who drafted a session last week will sign in on session day, probably on a screen the team can see, click Open room, and get a generic refusal in front of everyone. That is the opposite of disappearing into the background. The exploration lists the routes it read but doesn't call this one out. It is the single most important usability fact for the implementation issue.

**O4. A session that is already live is (correctly) not affected, and the record should say so on purpose.** Path 3 in `session-subscriber-access-helper.ts` grants live control by `sessions.facilitator_id`, not by `global_role`. So if the IdP flips someone to EM and they re-authenticate mid-session (possible under the 90-minute absolute lifetime and SEC-26), they keep control of the session that's running. From the ritual's side that is what I want. Pulling the facilitator out between lock-in and reveal would do far more damage than letting one session finish. But it is currently an emergent property of the code, not a decision. If nobody writes it down, a well-meaning hardening change later could "fix" it.

**O5. "Never shown inside a live session" (§4) is the right instinct, but the notes don't say how that is enforced.** The places it can leak:
- **Re-auth mid-session.** The `ReauthRequiredTreatment` flow returns the user to the session route. A post-sign-in notice keyed on "just signed in" would fire there, mid-ritual.
- **Pre-session sign-in on a shared or projected screen.** Facilitators often sign in at the front of the room a few minutes before starting. A notice saying "A manager can't facilitate" on a projector is a small public embarrassment for that person.
- **Toasts or banners that follow route changes**, if the notice is built as global chrome.

**O6. The draft copy in §4 is close, but it has three problems.**
1. "Identity provider" and "IdP administrator" are not words most engineers or managers use. They know "IT", "the access team", or a named group.
2. "Remove one of these roles" leaves a choice open that the ritual has already made. If you manage people, Facilitator is the role that goes. If you don't, Engineering Manager was assigned by mistake. Telling people which one saves a round trip with IT.
3. It doesn't say what still works (their EM access) or how to clear the notice once fixed. They have to sign out and back in, or wait for the session to expire. Without that, people will report "it's still broken" after IT has fixed it.

**O7. IdP admins have no workflow in these notes beyond "an audit row exists".** The `application_admin` who can read the app's audit log is usually *not* the person who manages IdP groups. The notes give the IdP admin an event name and an optional alert, but nothing they can act on without help. Examples: "who is currently conflicted?", "did my fix take?". The conflict fires on every sign-in (§4), which is good for persistence. But it also means one person shows up as many rows, and the admin needs to read that as one person, not N incidents.

**O8. The admin+EM+facilitator user is flagged (row 4), but the notes don't say what *they* see.** The §4 copy ("you're signed in as Engineering Manager") would be wrong for them, since they're signed in as admin. Either they see admin-specific copy or no user notice at all (audit only). Someone needs to choose.

**O9. Continuity for the teams on the conflicted person's rotation isn't mentioned.** My success criterion 3 is that another facilitator can pick up a team from history alone. History and trends are unaffected, which is good. But nothing tells the *teams* or a replacement facilitator that the session next Tuesday won't happen. Until the person notices, their drafts sit in `draft` status, unopenable by anyone.

**O10. On §6.6 (interim gate): I support "the implementation issue inherits the first-team-launch gate".** It isn't my call, but from the ritual side, launching a first team while the pair still resolves to facilitator means the one profile we agree should never facilitate is the one most likely to be in the chair for a team's first, most fragile session.

**O11. Overall: yes, this leads to a tool that stays in the background, as long as O3–O5 are handled.** The resolution direction, the audit design, the "every sign-in" persistence and the no-badge, no-persistent-chrome stance are all right. The risk sits entirely at the edges: the first session-day click after a role change, and a re-auth in the middle of a session.

---

## Questions

- **Q1.** When a conflicted user signs in and owns drafts they can no longer open, should the notice name those drafts (team + date), so they can arrange cover *before* session day? I think it should.
- **Q2.** Should the room-open 403 for a user whose live role was resolved by the conflict rule carry conflict-specific copy instead of "Only a facilitator can open the room."? Can it, without leaking raw claim values? The conflict flag is already allowlisted data.
- **Q3.** Is "an in-progress session continues under its original facilitator after the role flips" (O4) the intended behaviour? I'd like Security (Sana/whoever owns S4) to confirm it explicitly so it's a decision, not an accident.
- **Q4.** Can a conflicted user's drafts be handed to another facilitator, or does the replacement have to recreate them? If there is no reassignment today, is that acceptable for v1? (I can live with "recreate" if the notice tells the person to arrange cover.)
- **Q5.** How often does the user notice show: on every sign-in, or once per browser until dismissed? The audit row should fire on every sign-in. The *notice* shouldn't nag someone who has already filed the IT ticket.
- **Q6.** Who is the "ask your administrator" contact? Can the deployment configure it (a name, channel or URL), the same way other deployment-specific text is handled?
- **Q7.** What does the admin+EM+facilitator user see (O8)?

---

## Suggested additions

**To the decision record (propose stage):**

1. **Add a "how this shows up for people" section**, separate from the audit design. Three audiences, one line each: the conflicted person (one plain notice outside sessions), the IdP admin (event name + troubleshooting entry), everyone else including the team and participants (nothing, ever).
2. **State the live-session rule explicitly:** a role change resolved by the conflict rule never interrupts a session that is already past room-open. It takes effect at the next draft creation or room-open. Reason: interrupting a running ritual is worse than letting one session finish, and the audit row records it either way. (Subject to Q3.)
3. **State the "no surface during the ritual" constraint as a requirement, not a preference:** the conflict notice MUST NOT render on any live-session route (lobby, pre-session, active, wrap-up). That includes after a mid-session re-authentication. It is deferred to the next non-session page.
4. **Name the promotion path (O2)** as the expected common cause, alongside misconfiguration. It changes what the copy and the docs say: "if you've recently become a manager, this is expected. Ask IT to remove Facilitator".
5. **Add to Residual gaps / Consequences:** drafts owned by a newly conflicted user become unopenable. Nobody but that user is told. Mitigation is the user notice (Q1), plus the user arranging cover.

**To the follow-up implementation issue (§9 scope sketch):**

6. **The user notice:**
   - It appears on the landing or dashboard page after sign-in, never as a modal and never on session routes (O5).
   - It's dismissible and doesn't come back until the next sign-in (or per Q5).
   - It lists any drafts the user owns that they can no longer open (Q1).
   - Suggested starting copy (for EM-applied; I'm happy to iterate):
     > **You're signed in as an Engineering Manager.** Your account was given both the Engineering Manager and Facilitator roles. Managers don't facilitate Health Check sessions, so Facilitator has been turned off. You still have your usual Engineering Manager access.
     > If you manage people, ask {configured contact} to remove the Facilitator role. If you don't, ask them to remove Engineering Manager. Then sign out and back in.
     > {If drafts exist:} You can't open these upcoming sessions. Please arrange another facilitator: {team, date}…
   - Wording rules: no "IdP"/"OIDC"/"claim". Don't blame the user. Don't use wording that reads badly on a projector.
7. **Room-open 403 copy for conflicted users** (Q2): conflict-specific and actionable, for example "You can't open this session because your account is now set up as an Engineering Manager. Another facilitator will need to run it." Same principle as my #46 review: state the rule, offer a way forward, no workaround.
8. **Hide the session-creation entry points** for the resolved EM, as for any EM, so the 403 on `POST /draft` is unreachable in normal use. The notice explains why the entry is missing.
9. **IdP-admin troubleshooting entry** in `docs/deployment.md`:
   - The event name.
   - "One row per sign-in, so count distinct users, not rows."
   - How to confirm a fix: the next sign-in for that user produces `role_claim_mapped` without a conflict row.
   - The "remove Facilitator from managers" rule, restated.
10. **Tests and verification:**
    - The notice does not render on any session route, including after the re-auth return path (`reauthRequiredHostParity` is the place to extend).
    - The notice does render on the landing page.
    - The admin case gets the copy chosen in Q7 (or none).
11. **Usability check before first-team launch:** using the simulator persona carrying both roles (§9), walk the promotion scenario end to end with me. Sign in with drafts pending, read the notice, attempt room-open, have IT "fix" it, sign back in. I offered to test the facilitator view. This scenario belongs in that session.
