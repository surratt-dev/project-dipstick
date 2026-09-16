# Architecture Review: tasks.md — fix-local-oidc-login

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope of this review:** task ordering and dependency validity only, per the request. I did not re-review the design decisions themselves (host vs. hostname, JWKS key retention) — those are closed per design.md and outside what I was asked to look at here.

## Verdict

Task ordering is sound. No task assumes something that hasn't been built. I verified the two load-bearing assumptions against the actual repository state rather than taking the docs at their word, since a task list that assumes a dependency is "already done" is exactly the kind of implicit decision I'd otherwise have to catch later, in production, when it's expensive:

- `packages/backend/src/routes/auth.ts` GET `/callback` handler does construct the URL from `request.hostname` at the location described (confirmed in the current file).
- Commit `4cd06e3` does contain the JWKS 2048-bit fixed-key fix in `docker/oidc/server.js`, with an inline comment documenting the incident — this dependency that task 2.1 and the verification section implicitly rely on is real, not aspirational.
- `trustProxy: 1` is set in `app.ts`, supporting the design.md claim that `request.host` and `request.hostname` are equivalent in production.

Given a one-line fix with no data migration and no multi-service coordination, there isn't much room for a dependency-ordering defect, but I checked for the failure mode anyway: a verification task that can't actually pass because something it assumes was already fixed. It isn't present here.

## Section-by-section

### Section 1 (Fix)
1.1 → 1.2 → 1.3 is correctly sequential: the comment in 1.2 refers to "that line," so it must land after 1.1's edit exists to comment on. 1.3 is a "don't write more" instruction, not an implementation step, so it has no ordering constraint of its own — fine where it sits.

### Section 2 (Documentation, no re-fix)
2.1 is a scope-check, not a code change: "confirm no task in this list touches `docker/oidc/server.js`." This is really a standing invariant over the whole task list rather than a step in a sequence — it doesn't produce an artifact and nothing downstream depends on it running at a particular time. It can't be ordered "wrong" because it isn't ordering-sensitive, but placing it before Section 3 is still the right call: if this check ever fails in the future (someone adds a task touching that file), you want to know before you invest in running the verification stack, not after.

One dependency I checked explicitly, because task 2.1's entire justification rests on it: is the JWKS fix actually present at HEAD, or only claimed to be? Confirmed present (see Verdict). If it were not, Section 3 verification would fail for a reason this task list doesn't account for — that would have been a real gap. It is not a gap.

### Section 3 (Verification)
3.1 → 3.2 → 3.3 correctly comes after Section 1, not before — you cannot verify a fix that hasn't been applied yet, and the task list respects that. 3.2 and 3.3 are two assertions about the same verification run rather than independent steps, which is appropriate: they're really one test with two "don't accept this as a pass" conditions, not two ordered steps with a dependency between them.

## Things I did not flag, and why

- I did not ask for a task to independently re-verify the "production is unaffected" claim (default-port HTTPS behind an ingress). That's a design-level architectural claim, not a task-ordering issue, and design.md already scopes it out with reasoning I find sound for a one-line, behaviorally-inert-in-production change. Flagging it here would be re-litigating a closed decision under a different heading.
- I did not ask for a task splitting the comment (1.2) out from the code change (1.1) into separate commits/PRs — for a one-line fix plus a one-sentence comment on the same line, splitting would be process overhead with no dependency benefit.
- No task in this list touches session state authority, access control, Redis/Postgres boundaries, or observability — the concerns I'd normally scrutinize hardest on this project. That's correct for this change: it's a request-URL reconstruction bug in existing, already-reviewed auth plumbing, not new architectural surface. Nothing here changes what I signed off on for the broader system.

## Recommendation

No reordering or splitting required. Tasks.md is ready to proceed as sequenced.
