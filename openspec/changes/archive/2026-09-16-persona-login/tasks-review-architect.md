# Architecture Review: tasks.md ordering and completeness (persona-login)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Task ordering and completeness of `tasks.md` against the finalized `design.md` (through D12). Not a re-review of the design decisions themselves — those were accepted in the design-stage review.

## Verdict

Approve with one required reordering fix in Section 5. Translation of D9–D12 into tasks is otherwise complete and accurate.

## D9–D12 translation check

- **D9 (new public `/auth/dev-login` route, outside `ProtectedRoute`):** Present and correct — task 5.4 registers it in `App.tsx` "alongside `/auth/error` and `/auth/loading` — outside `ProtectedRoute`, no shared layout," matching design.md's reasoning for option (b) over growing `AuthProvider` itself. Task 5.3 correctly restricts `AuthContext`'s role to "decide where to navigate," not render. Content is right; sequencing is not (see Finding 1).
- **D10 (interaction handler must resolve both `login` and `consent`):** Present and correct. Task 3.3 explicitly calls out resolving *both* reasons via `provider.interactionFinished()` and states the `offline_access` consent-prompt rationale from design.md. Task 3.6 manually verifies no intermediate consent screen appears — this is the one behavioral check that would actually catch a partial implementation (login-only resolution), so its presence matters and it's here.
- **D11 (loopback-only OIDC port binding):** Present and correct. Task 4.1 matches the exact mapping change (`"4011:4011"` → `"127.0.0.1:4011:4011"`) and explicitly carries forward the design's scope boundary that `postgres`/`redis` bindings are excluded. No ordering dependency on any other section — correctly free-standing.
- **D12 (`loginHint` validated against closed account-id set, else `400`):** Present and correct. Task 2.2 validates before task 2.3 forwards it as `login_hint` — the right order (validate, then use). Task 2.6 tests the `400` path.

No D9–D12 content was dropped or mistranslated. This was a real risk given how late these decisions landed in the design, and it checks out.

## Finding 1 (required): Section 5 internal ordering — frontend tasks reference artifacts not yet created

Section 5 ("Frontend: persona login landing page") is sequenced as:

- 5.1–5.2: wire `AuthContext` to call `/auth/dev-login-options` with a timeout
- 5.3: on success, `useNavigate()` to `/auth/dev-login`
- 5.4: *register* the `/auth/dev-login` route in `App.tsx`
- 5.5: *build* the landing page component
- 5.6: styling isolation
- 5.7: wire persona buttons (which live in the 5.5 component) to `/auth/login?loginHint=...`

Task 5.3 has an engineer writing a `useNavigate("/auth/dev-login")` call before the route it targets exists (5.4), and before the component that route renders exists (5.5). Task 5.7 wires buttons inside a component that, per the checklist order, hasn't been built yet. This is the same class of problem the design review process flagged for backend/frontend sequencing (a frontend task assuming a backend contract that isn't built yet) — here it recurs *within* the frontend, across the same section.

In practice a competent engineer implementing "Section 5" as one unit won't literally stall on this, but the checklist's stated order doesn't reflect a buildable sequence, and if tasks are checked off and reviewed incrementally (which is the point of a numbered tasks.md), 5.1–5.3 land as unreviewable/unrunnable until 5.4–5.5 exist.

**Recommended reorder within Section 5:**
1. 5.4 (register route)
2. 5.5 (build landing page component)
3. 5.6 (styling isolation)
4. 5.7 (wire buttons)
5. 5.1 (AuthContext calls dev-login-options)
6. 5.2 (timeout-as-404 handling)
7. 5.3 (navigate to the now-existing route)

This also reads better end-to-end: build the destination first, then build the thing that navigates to it.

## Minor / non-blocking note

Task 1.1.1 (export `isPrivateAddress`) is numbered as a sub-task of 1.1 (the gated endpoint), even though the export must exist before 1.1's route code can import it. This is a defensible convention — sub-bullets under a parent task are commonly read as "steps to accomplish the parent," not strict execution order — and unlike Finding 1, it doesn't cross into a different section or component. Not requesting a change, just noting it for consistency: if Finding 1 is fixed by promoting 5.4/5.5 ahead of 5.1, consider whether 1.1.1 should similarly move to a standalone 1.0 for the same reason. Optional.

## Everything else

- Cross-section ordering is sound: Section 2 (backend `loginHint` passthrough) precedes Section 5 (frontend, which consumes it) and Section 3 (stub, which is passthrough-agnostic and has no real dependency on Section 2's ordering). Section 1 (gated options endpoint) precedes Section 5 (frontend, which calls it) and Section 6 (logout gating, which reuses the same check). Section 6 correctly follows Section 5, since logout needs `/auth/dev-login` to already exist as a navigation target. Section 7 (verification) and Section 8 (docs) correctly close out the list.
- Section 4 (docker-compose port binding) is correctly free-standing with no false dependencies.
- Spec deltas (`specs/persona-login/spec.md`, `specs/oidc-auth/spec.md`, `specs/local-dev-environment/spec.md`) already exist in the change folder from the propose stage — tasks.md correctly does not duplicate that work as an implementation task.

## Out of scope for this review

Domain/UX judgment calls (landing page copy, button labels), and re-litigating D1–D8, which were not the subject of this pass.
