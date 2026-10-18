# Security Review: Reorder Topics Drag-and-Drop (#181)

Reviewer: Tomás Ferreira, Senior Application Security Analyst
Documents reviewed: proposal.md, design.md
Scope: authentication flows, data access boundaries, audit logging, threat model impact, deferred or implicit security decisions.

## Verdict

Approve with conditions. This is a client-only change that adds a second input gesture to an existing local-draft path. It introduces no new endpoint, credential, or data flow, and I agree the incremental attack surface is very small. The design's claim in Risk 6 ("none new") is substantially correct. My conditions are about making several implicit assumptions explicit and verifiable, not about redesign. Nothing below is blocking except S-1 and S-2, which I want recorded as verified before merge.

## What I agree with

- Client gating (handle absent when locked or under two topics, inert when `movesDisabled`) is presentational. The design says so and names the server `409 TOPIC_CUSTOMIZATION_LOCKED` as authoritative. That is the correct posture. UI-layer gating is UX, not access control.
- No new runtime dependency is the best supply-chain outcome available. The rejected candidates were evaluated on license, recency and `npm audit`; the audit result is a point-in-time scratch install, which the design correctly labels. I accept the decision. If Decision 1 is reopened, a dependency must pass my dependency-hygiene criteria (tracked advisories, lockfile, automated scanning), not only the 12-month rule.
- Drag adds no new conflict scenario and uses the same `PUT { orderedTopicIds }`.
- Declining adoption telemetry is correct; no new data collection.

## Findings

### S-1 (Must verify, implicit decision): Server-side authorization of the reorder PUT is assumed, not evidenced

The design and proposal assert "the server's lock/authz checks are authoritative" and "backend audit confirmed outside the frontend tests" (proposal, R-AUDIT disposition). Neither document cites the backend tests or code that prove this. Since this change makes the reorder gesture easier and faster to invoke, the property that matters is that the endpoint independently enforces: authenticated identity, facilitator role for that team (including the admin-without-membership and facilitator-who-is-also-a-member rules referenced in the spec scenarios), first-session lock, and that every submitted ID belongs to the team.

Requirement: before merge, cite the existing backend tests (file and test name) covering non-facilitator 403s (the recent #263/#264/#265 work suggests these exist), the lock 409, and cross-team ID rejection. If any is missing, open an issue; it is not this change's scope to fix but it must not be assumed.

### S-2 (Must verify): Payload integrity of `orderedTopicIds` against crafted input

Drag changes how the client builds the array, but the server cannot trust that the client built it honestly. The design states "the server ignores archived rows in reorder." That is a behavior statement about the server that I read as: archived IDs in the payload are tolerated. I need the actual contract confirmed: what does the server do with duplicate IDs, IDs from another team, unknown IDs, a partial list, or an archived ID mixed in? Silent ignoring of foreign-team IDs is a data access boundary question (does the response or error leak existence of another team's topic ID?). Confirm the server validates the set equals the team's active set, or documents the intended tolerance, and that a foreign ID yields the same response as an unknown ID.

### S-3 (Should): Stale-conflict check is the only concurrency control; confirm it is not bypassable

Decision 7 relies on `409 TOPIC_ORDER_STALE`. Confirm the staleness token is server-derived and checked server-side on every PUT, not a client-supplied flag the client may omit. A client that omits the token should be rejected, not treated as fresh. Again an existing-behavior verification, but drag makes long deliberate drafts more likely, which increases exposure to stale-write overwrite between facilitators. Integrity impact is low (ordering only), so I accept this as a verify-not-change.

### S-4 (Should): Audit logging is correct but only partially specified

Constraint 4 says `topic.reordered` is the only trace and a cancelled or no-op drag writes none. Good: audit records state changes, and a client gesture is not one. Gaps:

1. The audit row is written at Save, not at drop. A facilitator's drag produces no security-relevant event until Save, which is right, but the document should state that the audit row records actor, team, and resulting order (or before/after), and that this is unchanged. Confirm the row captures the actor identity from the validated token, not from the request body.
2. Failed attempts: a rejected PUT (lock 409, authz 403, stale 409) should be logged as a denied event. The #263-#265 work addressed 403 codes; confirm denied reorder attempts are captured, since a hand-built drag UI does not change that, but a script posting to the endpoint does.
3. R-AUDIT is described as an "unchanged-endpoint check." That wording could pass without actually asserting anything. Make it concrete: a test or manual check that one Save after a drag yields exactly one `topic.reordered` row, and that zero rows exist after cancel, no-op, and Discard.

### S-5 (Should): Client-side event handling and unintended side effects

Low severity, but the hand-built pointer code is new code I will not see a library maintainer vet:

- The Escape listener and pointer listeners are attached to `window`/document while dragging. Confirm they are removed on every exit path (including component unmount mid-drag, which is not in the listed cancel set). A leaked listener holding a stale closure that later calls `onDrop` against an old `draftOrder` is a state-integrity bug with a small but real data impact (wrong order saved). Add unmount to the cancel list and test it.
- Pointer capture: `pointercancel` and lost capture are covered. Add `setPointerCapture` failure handling, since a thrown exception there can leave the drag state active.
- Drop handler receives `(topicId, toIndex)`. Validate in `applyNewOrder`/`moveToIndex` that `topicId` is present in the current `displayedOrder` and `toIndex` is in bounds; reject (treat as cancel) otherwise. A derived index from DOM geometry should not be trusted blindly. This also guards against refetch-under-drag, which the proposal explicitly leaves "unspecified beyond not corrupting the draft." That sentence needs an enforcement mechanism, and this validation is it.
- The tooltip and any topic names rendered in the drop line or announcement: confirm names go through React text nodes (no `dangerouslySetInnerHTML`, no string-concatenated HTML or `aria-label` injection). Topic names are user-supplied facilitator content, and the live-region announcement interpolates the name. React escapes by default; just state it and do not regress it.

### S-6 (Consider): Deferred decisions that should be tracked rather than left implicit

| Deferred or implicit decision | Where | Ask |
|---|---|---|
| Server authz/audit coverage "confirmed outside the frontend tests" | proposal, R-AUDIT | Cite evidence (S-1, S-4) |
| Server handling of malformed `orderedTopicIds` | design Decision 3 | Confirm contract (S-2) |
| Behavior on refetch while dragging | proposal, "Declined or deferred" | Enforce via index/ID validation (S-5) |
| Dependency vulnerability process if Decision 1 reopens | design Decision 1 | Add: dependency must enter lockfile and the automated advisory scan; point-in-time `npm audit` is insufficient |
| Draft lost on stale conflict | design Decision 7 | Acceptable; not a security issue, noted as integrity-neutral |
| Touch drag follow-up | design Decision 8 | When taken up, re-review: `touch-action`, long-press/context-menu suppression, and any gesture that could trigger unintended drops are input-handling changes I want to see |

### S-7 (Informational): Threat model impact

Against the application's threat model, this change touches only the client-state-tampering and request-forgery surfaces, both of which already assume a hostile client:

- Spoofing / elevation of privilege: unchanged. Authentication (OIDC token validation) and facilitator authorization are enforced server-side on the unchanged PUT. The drag handle does not create a path around either.
- Tampering: a user can already craft any `orderedTopicIds` with curl. Drag does not widen this; S-2 confirms the server's response to it.
- Repudiation: audit via `topic.reordered` unchanged (S-4).
- Information disclosure: no new data read or displayed. No new logging of client data. Do not add console logging of drag state or topic names in the hook; the persona's concern about logging sensitive content applies even to dev-only debug statements left behind.
- Denial of service: pointermove hit-testing is client-local; no server amplification. Dragging does not call the API until Save, so no request flood.
- Real-time channel: this screen does not use the session WebSocket, and the design correctly states existing open sessions are unaffected. No WebSocket authorization impact.

No update to the threat model document is required beyond noting this change as in scope for the existing "facilitator topic management" surface. If there is a living threat model, add one line referencing #181 and "no new trust boundary."

## Conditions for security sign-off

1. Evidence cited for S-1, S-2 and S-3 (existing backend tests or an issue filed for gaps).
2. Unmount added to the cancel set, with index/ID validation in the drop path (S-5).
3. R-AUDIT made concrete (S-4.3).
4. If Decision 1 is reopened, dependency intake includes lockfile pinning and automated advisory scanning.

No pre-production re-review is needed for this change specifically, provided the above are met; it will be covered by the standard pre-production review.
