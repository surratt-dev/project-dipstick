# Champion Sign-Off: Sign-In Change

**Reviewer:** Devon Calloway, Internal Champion
**Date:** 2026-06-27
**Verdict:** Approved

---

## Sign-in is role-blind

The authentication boundary does not inspect, branch on, or filter by role. The callback handler in `auth.ts` resolves or creates an account from the IdP's subject claim and populates the session. That is all it does. No role check, no conditional redirect based on whether someone is a participant or an engineering manager. The middleware in `middleware.ts` validates session existence, enforces absolute lifetime, and refreshes tokens. It does not look at roles either. This is correct. Authentication answers "who are you," not "what are you allowed to do." Role enforcement belongs downstream, in session management, and it is not leaking backward into sign-in.

## The join flow works without me

An engineer receives a link, clicks it, authenticates through the IdP, and lands on their team -- or in an active session if one is running. If they are already a member, they get a transient notification and continue. If the link is expired, they get a plain-language message telling them to ask the facilitator for a new one. The join token survives the OIDC redirect via Redis-backed state, not localStorage or query parameter hacks. The unauthenticated path redirects to `/auth/login?joinToken=...` and the callback picks it up on the other side. I have walked people through this flow manually for over a year. The implementation captures the sequence correctly. I would not need to explain it.

## The no-team page communicates what matters

The `NoTeamPage` tells the user four things: who they are, that they have no team, that they need a join link from a facilitator, and that no further setup is required. It does not show empty dashboards, navigation chrome, or feature surfaces that would make a new user feel like something is broken. This is the right first impression. The page disappears the moment the user follows a join link, which is exactly how it should work.

## The default role on join is correct

Join link redemption inserts with `role = 'participant'`, matching the `membership_role` enum. The design originally said "Engineer" in natural language, the engineer review caught that the enum value is `'participant'`, and the implementation uses the correct value. No one joins as an engineering manager through a join link. Good.

## Core constraints are unaffected

This change does not touch:
- The no-manager-participation rule (session management scope)
- Simultaneous reveal (live voting scope)
- Facilitator-from-another-team requirement (session setup scope)

None of these constraints are weakened, made optional, or accidentally bypassed by the sign-in implementation. The authentication layer has no awareness of these rules, which is exactly the right separation. The constraints will be enforced where they belong -- in session lifecycle -- and this change gives them a clean foundation to build on.

## The change moves the application toward being self-sustaining

This is the first change where the application replaces me. Before this, every adoption conversation started with me explaining how to get into the system. Now, a facilitator generates a join link, shares it, and engineers are in. No spreadsheet, no desk visit, no Slack thread where I walk someone through the steps. The tool carries the knowledge I have been carrying manually. That is the entire point.

---

Devon Calloway
Principal Software Engineer
