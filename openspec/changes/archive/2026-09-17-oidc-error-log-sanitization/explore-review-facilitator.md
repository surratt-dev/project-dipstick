# Facilitator Review: OIDC Error Log Sanitization — Exploration Notes

**Reviewed by:** Priya Nair (Facilitator persona)
**Reviewing:** `exploration-notes.md` (Devon Calloway)
**Lens applied:** This isn't a ritual-integrity review — there's no reveal, no vote, no
facilitator view here. I'm applying the same underlying instincts to the people who
actually touch this system: the on-call engineer reading a log at 2am trying to figure
out why a login failed, and the end user staring at an error page during that same
failure. Both are "in the room" for this change even though neither shows up in the
notes.

Overall: this is a rigorous, evidence-first investigation, and I want to say that
plainly before the "but." Devon didn't trust the library's docs, reproduced the leak
empirically, and traced the enumerability distinction down to the spec level. That's
the same discipline I'd want applied to a claim like "the reveal is simultaneous" —
verify, don't assume. My concerns below are about who this document leaves out, not
about the quality of what's in it.

---

## Observation 1: The notes describe what gets removed, never what an operator needs to keep

Every finding is framed as "does X leak" — message, cause, error_description. None of
it is framed as "what does someone diagnosing a failed login actually need to see in
the log to do their job." That's the same trap I watch teams fall into with the
facilitator view: they design the *restriction* first and only notice afterward that
they've also deleted the thing the primary user depended on.

Concretely: if `error_description` is dropped entirely (one of the two options Devon
proposes), what's left for someone triaging "why are logins failing for this one
customer" at the point they're staring at `request.log.error`? The OAuth `error` code
(`invalid_grant`) tells you *a* category but not *which* invalid_grant — expired code,
reused code, revoked session, and a misconfigured client redirect URI can all surface
as the same enum. The AADSTS-prefixed number specifically (not the full description)
is often the part an operator actually pattern-matches on when triaging Entra issues.

**Suggested addition to design-stage open questions:** before deciding "drop entirely
vs. truncate/redact," someone should enumerate the diagnostic questions an operator
would ask during a real login-failure incident, and check the proposed sanitized shape
against that list — not just against the leak list.

## Observation 2: "Categorize, don't relay" is the right principle — but who builds the category list, and how do they know it's incomplete?

Devon rightly holds up `error-handler.ts`'s existing discipline (keyword-match to
categorize, never echo raw text to the user) as the precedent to extend into the log
path. I'd flag one thing from the ritual side: a categorization scheme is only as good
as its coverage, and an incomplete one *fails silently* — an uncategorized error just
falls into whatever the catch-all bucket is, and nobody notices the bucket is growing
until someone goes looking.

This is the same shape as outlier flagging in the health-check tool: it's advisory,
and it has to *stay legible when it doesn't fire* — an outlier that goes undetected
because the flagging logic missed a case is worse than no flagging, because it creates
false confidence. Here: if a new IdP throws an error shape the categorizer doesn't
recognize, does it fail closed (redact everything, log a "saw an error class I don't
know how to categorize" signal) or fail open (fall through to logging the raw object,
silently reintroducing the leak)? The notes don't say, and given the explicit
multi-provider trajectory, this is exactly the seam a second IdP will hit first.

**Suggested addition:** design stage should specify fail-closed behavior for
unrecognized error shapes, and ideally a loud (not silent) signal when it happens —
something a maintainer would actually see, not just a redacted-and-forgotten log line.

## Observation 3: A redacted field should say it was redacted, not just disappear

This is a direct analogy to "readiness without spoilers" — the facilitator needs the
*presence* of information (someone has locked in) even when the *content* is withheld
(how they voted). Two distinct pieces of information, surfaced separately, deliberately.

If `error_description` is simply omitted from the logged object, an operator debugging
at 2am who doesn't know this redaction scheme exists may reasonably think logging
broke, or that a field is missing due to a bug — not that it was withheld on purpose.
That's a trust cost, and it's avoidable. A structured marker (`error_description:
"[redacted]"` or a sibling field like `redacted: ["error_description"]`) preserves the
*fact* that something was withheld without leaking the *content* — same separation
Priya requires for locked-in status vs. vote content.

**Suggested addition:** whatever the sanitized log shape ends up being, make the
redaction visible in the log line itself, not just absent from it.

## Observation 4: Devon's own "debug-level capture" idea deserves to be pulled forward, not left as a footnote

The open-questions section raises, then immediately defers, the idea of capturing
`error_description` at a lower-cardinality, explicitly non-production debug level.
I want to second this strongly from the operator-usability side. Dropping the
information for good vs. making it available through a different, clearly-labeled,
access-controlled channel are very different outcomes for whoever has to resolve a
provider-specific integration bug six months from now. This is the same principle as
outlier flagging being advisory rather than prescriptive: the system should surface a
path to the fuller picture when a human genuinely needs it, without making that the
default, ambient behavior.

This is explicitly called out as "a call for whoever owns log retention/access
policy" — agreed that Devon shouldn't decide it unilaterally, but I'd push for the
design stage to actually resolve it rather than let it drift into an implicit "we
just dropped it" default because nobody owned the decision.

## Observation 5: Nothing here confirms the end-user error page is unaffected

The notes correctly stay backend-log-scoped per the issue's framing, and the one
sentence that touches the user-facing side ("`error-handler.ts` ... never echoes the
raw message back to the user") is reassuring but asserted in passing, not verified
with the same rigor as everything else in this document. Given how thoroughly Devon
verified the logging leak empirically, the equivalent claim about the user-facing path
being unaffected reads, by contrast, as an assumption.

**Suggested addition:** design or implementation stage should explicitly verify (the
same way Finding 1/2 were verified — by exercising the actual code path, not reasoning
from it) that tightening what reaches the log has zero effect on what reaches the
`/auth/callback` error redirect and the frontend error page. It would be an easy,
avoidable mistake to have someone "harden the error path" in a way that touches both
the log call and the user-facing categorization function since they're adjacent code,
and quietly make the user-facing message less specific in the process. The two audiences
here — operator-in-a-log and user-on-a-screen — need to be treated as two separate
success criteria in the design doc, not one.

## Observation 6: No first-touch support for the next engineer who has to extend this

Analogous to first-session support for a new facilitator: when a second IdP is
onboarded, whoever does that work needs to know this sanitization scheme exists at
all, what invariant it depends on (the enumerability distinction is genuinely
non-obvious — I'd bet most engineers on this team don't know Node's native
`Error(msg, {cause})` sets a non-enumerable property), and what checklist to run
against a new provider's error classes before assuming they're safe.

The notes already flag the *technical* follow-up (a regression test pinning the
enumerability invariant) — good, that should stay. But a test catches drift in the
existing classes; it doesn't tell a future engineer what to check when oauth4webapi
adds a *new* error class, or when a genuinely new IdP library gets added for a
provider that doesn't go through oauth4webapi at all.

**Suggested addition:** a short, explicit note (in code comment or a doc) at the
sanitization wrapper itself, stating the invariant it depends on and what to verify
before trusting a new error class — so the next person extends the scheme instead of
rediscovering the leak.

## Question for the design stage

Is there a plan to validate the final shape against a real (or realistic simulated)
incident — e.g., deliberately trigger an expired-auth-code replay against a test IdP
and confirm (a) the log still gives an operator enough to diagnose it, (b) the user
sees a sane error page, (c) nothing sensitive is present? I'd want that walkthrough
before calling this done, the same way I insist on a facilitator usability pass before
a health-check session goes live with a real team — a sanitization scheme that's
correct in isolated unit tests can still fail its actual users if nobody exercises it
end-to-end as a human would encounter it.

## What I'm not flagging

The multi-provider framing, the incidental-vs-structural safety distinction for
`OperationProcessingError`, and the decision to key off error *class* rather than
string-matching provider prefixes are all exactly right and don't need anything added
— that section already does what I'd ask for: don't build something that's "close
enough" under today's one provider and quietly wrong under the next one.
