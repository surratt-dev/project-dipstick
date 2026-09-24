# Security Review — `join-link-display-copy`

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Reviewed:** `design.md`, `proposal.md` (as of this review)
**Scope of this review:** authentication flows, data access boundaries, audit logging, threat-model impact of clipboard exposure. I do not have opinions on visual styling, copy timing, or the `SessionLobbyPage` routing gap (#164) — those are outside my remit.

---

## Finding 1 (Blocking): The token this change makes prominent and one-click-copyable does not appear to be a working join credential

This is not a clipboard/exposure question — it's a "verify the thing you're building on actually does what the design assumes it does" question, and I don't think it's been checked.

`design.md`'s Context section states `joinToken` comes from `FacilitatorSessionStateResponse` and cites `packages/shared/src/types/team-content-access.ts:226`. I traced where that value originates and where (if anywhere) it's validated:

- **Origin:** `packages/backend/src/routes/facilitator-sessions.ts:303` — `crypto.randomUUID().replace(/-/g, "").substring(0, 8)`, stored in `sessions.join_token`. The inline comment at line 302 reads: *"join_token is required but not meaningful for draft sessions."*
- **Consumption:** I grepped the entire backend (`grep -rn "join_token" packages/backend/src`) for every place this column is read back and compared against an incoming request. There isn't one. It is written at session creation and returned verbatim by `facilitator-state` (line 1995). Nothing validates it.
- **The URL built from it** (`DraftSessionHost.tsx:184`, unchanged by this proposal): `` `${window.location.origin}/join/${data.joinToken}` ``.
- **The only actual join-redemption route in the codebase** is `GET /api/join/:token` (`packages/backend/src/routes/join-links.ts:138`, registered with no prefix — the literal path is `/api/join/:token`). It validates against the **`join_links`** table, whose `token` column is a *different* value: 32 bytes of `randomBytes`, base64url-encoded, created via `POST /api/teams/:teamId/join-links` and governed by `openspec/specs/join-link/spec.md` (7-day expiry, `revoked_at`, dedicated `join.link_created`/`join.link_redeemed` audit rows).
- I also checked the frontend router (`App.tsx`) and the dev proxy (`vite.config.ts`) for anything that could make a bare `/join/:token` path resolve — there is no such route and no such proxy rule. Only `/api` and `/auth/(login|callback|logout|session|dev-login-options)` are proxied to the backend.

Put together: the link this change is about to make full-emphasis-styled and one-click-copyable is built from a column the code's own comment calls "not meaningful," at a URL path (`/join/...`, no `/api` prefix) that no route in this application serves. As far as I can tell, **this link does not currently work** — a participant who receives it will hit a 404 or the SPA's fallback, not the join flow.

**Why this belongs in a security review, not just a bug report:** `design.md`'s entire risk framing for this change rests on the premise "this data is already exposed via facilitator-state, we're just adding a copy button to it" (Decisions D1–D3, the Risks section's first bullet). That framing is only valid if the exposed value is the thing it's assumed to be — a live, redeemable join credential equivalent to what `join-link`'s spec describes. If `sessions.join_token` is in fact dead/vestigial data that happens to look like a token, then:
- The actual security-relevant token (`join_links.token`) is **not** what's being exposed by this change at all, and the review of clipboard/DOM exposure below needs to be re-scoped once that's confirmed.
- If it turns out `sessions.join_token` *is* meant to be live (e.g., there's a planned but unbuilt validation path, or this is a half-migrated feature), then it's a second, parallel, unaudited, low-entropy (8 hex chars ≈ 32 bits, truncated from a UUID rather than generated for this purpose) bearer-credential scheme sitting alongside the hardened one `join-link`'s spec already built — with no expiry enforcement, no revocation, and no audit trail. That would be a materially worse thing to be making prominent and copyable than the `join_links` token is.

Either way, I don't think `design.md` can accurately reason about threat-model impact until this is resolved. **I'd want this confirmed with whoever owns `facilitator-sessions.ts` before implementation starts** — this may already be tracked as a known gap, but if so it isn't referenced anywhere in this change's design or proposal, including the "Non-Goals" and "Not in scope" sections, both of which explicitly wave off "join-link token generation/validation" as unchanged and out of scope. That's true of the *route* `join-links.ts` — but it sidesteps the fact that the token actually rendered on screen isn't that route's token.

If this turns out to be a known, accepted issue (e.g., #164's routing gap is the umbrella tracking item, or there's a separate ticket), say so explicitly in `design.md` and I'll drop this to non-blocking. As written, the design doesn't show evidence this was checked.

---

## Finding 2 (Non-blocking, scoped answer to the specific question asked): clipboard write is a real but modest threat-model delta from DOM exposure — name it explicitly rather than folding it into "not a new risk"

The brief asked me to specifically weigh whether writing the token to the OS clipboard changes the threat model versus its existing DOM exposure in `draft-control-view` / the facilitator-state response. `design.md`'s Risks section addresses this once, in the first bullet, and concludes it's "not a new risk this change introduces — a Facilitator could already manually select and copy the muted text today; this just adds a button for the same action." I'd sharpen that rather than reject it:

- **What's genuinely unchanged:** the token was already server-rendered into the DOM (`draft-control-view`, today, pre-change) and was already manually copyable by anyone with access to that screen. `live-readiness-view` gaining the same DOM exposure is the same class of thing extended to a second branch, not a new mechanism.
- **What's genuinely new:** a programmatic `navigator.clipboard.writeText()` call. The OS clipboard is a system-wide resource — its contents are readable by *any other process on the same machine* for as long as they remain there (other apps, browser extensions with clipboard permissions, clipboard-history/sync tools like OS-level clipboard managers or cross-device clipboard sync, e.g. a user with iCloud/Windows clipboard sync enabled could push the token to a second device). Manual text-selection copy has this same property once it's copied — the delta isn't "clipboard vs. no clipboard," it's **making the copy one click instead of a deliberate select-and-copy gesture**, which measurably lowers the bar for a token ending up on the clipboard incidentally (e.g., a Facilitator clicking the button to "see what it does" during `draft`, per D3, with no intention to share yet).
- **Why I'm not blocking on this:** the token in question is, per `join-link`'s spec (assuming Finding 1 resolves to "the real token"), a low-privilege, team-scoped, time-bounded (7-day) bearer credential whose worst-case misuse is an unauthorized user joining one team as a `participant` — not an account takeover, not cross-team data access, not privilege escalation. That's a real but bounded blast radius, consistent with `join-link`'s own accepted decision to defer revocation (spec: "the 7-day expiry provides time-bounded protection sufficient for initial deployment"). A one-click copy of that same credential doesn't change its blast radius, only its distribution friction.
- **What I want in the design doc:** replace "not a new risk" with something like "the clipboard write lowers copy friction versus manual selection, which is the point of the feature; the credential's existing blast radius (team-scoped, single-role, time-bounded, revocation deferred by `join-link`'s spec) is unchanged." That's a more honest statement of what's actually being accepted, and it'll read correctly the next time someone (me, in six months) has to re-evaluate this after a real incident.

---

## Finding 3 (Non-blocking, flag for the record): no audit signal on token distribution, and it's not discussed

`join-link`'s spec treats `join.link_created` and `join.link_redeemed` as durably audited, transactional events — real investment in auditability for this exact credential. This change adds a new, lower-friction distribution path for what a Facilitator perceives as "the join link" (whichever token it turns out to actually be, per Finding 1) and emits **no** audit event when that happens — not for the copy action, and (already true today, unchanged by this proposal) not for the `facilitator-state` fetch that exposes the token to the DOM in the first place.

I'm not asking for this to block the change — auditing a clipboard write is unusual and `facilitator-state` reads are already unaudited today, so this isn't a regression. But per my own standing concern about auditability as a control: if there's ever an incident involving an unexpected team join, "was this credential displayed/copied by its owning facilitator, and when" is exactly the kind of question the audit log exists to answer, and today it can't be answered for this token at all — only for its downstream redemption (`join.link_redeemed`, and only if Finding 1 resolves such that redemption is actually reachable). This is worth one sentence in `design.md`'s Risks section as a consciously-accepted gap, not silently absorbed. Right now it isn't mentioned.

---

## What's solid

- **Server-side authorization is correctly scoped and isn't touched by this change.** `facilitator-state` (`facilitator-sessions.ts:1951`) checks `sr.facilitator_id !== userSession.userId` server-side before returning `joinToken`, independent of anything the frontend renders. This change adds no new endpoint and doesn't alter that check. Good — this is exactly the "authorization enforced where it cannot be bypassed" property I look for, and it was already true before this change.
- **`document.execCommand('copy')` is correctly rejected (D2).** The design explicitly avoids a fallback that can report false success, and collapses "API unavailable" and "write rejected" into one `"unavailable"` status so the UI has no path to a false-positive confirmation. That's the right call for a control the application can't independently verify.
- **No backend changes, confirmed by grep, not just asserted.** I independently verified `join-links.ts`, `executeJoinFlow`, and the `join-link` spec's redirect rule are untouched by anything this change proposes. The Non-Goals section holds up for the pieces of the system I checked — my Finding 1 concern is about a piece the design didn't check, not about anything it claims incorrectly regarding `join-links.ts` itself.
- **Secure-context dependency is implicit but correct.** `navigator.clipboard.writeText` requires a secure context (HTTPS) by browser default — an insecure-context caller falls into D2's `"unavailable"` branch automatically, no extra handling needed. Worth one line in `design.md` confirming this is understood rather than accidental, but it's not a gap in behavior.

---

## Recommendation

Resolve Finding 1 before implementation — confirm with whoever owns `facilitator-sessions.ts` whether `sessions.join_token` is meant to be a live credential, dead/vestigial data, or mid-migration, and update `design.md`'s Context section to state which, with a citation. Once that's settled, Finding 2's threat-model language should be tightened in the Risks section per the wording above. Finding 3 is a one-sentence documentation ask, not a code change. None of this should require re-litigating D1–D6 as written — they're reasonable given what the design assumed was true; I just don't think that assumption was checked.
