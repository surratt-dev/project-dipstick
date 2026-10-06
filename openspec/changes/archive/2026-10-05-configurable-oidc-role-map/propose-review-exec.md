# Proposal Review: Configurable OIDC role map (#243)

**Reviewer:** Rachel Okonkwo, VP Engineering (Executive Sponsor)
**Artifact:** `proposal.md`
**Lens:** Strategic alignment, adoption, and whether scope is proportional to value
**Verdict:** **Approve with minor changes.** The change is the right thing to build now. Most of the additions beyond the issue protect the access model I treat as non-negotiable, so they earn their place. Two are marginal, and I want them trimmed or explicitly treated as cheap.

The user's decision to ship #243 as written, with fixed precedence and a single-value `global_role`, is settled. I don't reopen it here.

---

## 1. Strategic alignment

This change sits directly on the adoption path. My first success criterion is three or more teams with six or more sessions each, and no team can run a session today because nobody can be made a facilitator through a supported path. Until that's fixed, the 01b decision exists only on paper. A team that has to ask us for a code change before its first session will not adopt the ritual on its own. Devon names that friction correctly in the Why section.

The second paragraph of the Why section is the reason I care personally. If a manager group is missing from the map, managers become engineers and can join sessions by link. That is the exact failure I've said would kill the ritual. The framing "make recognition configurable, never the constraints" is correct, and I want it kept as the organising principle.

**Priority check:** this ranks above polish work and above the #235 role-set rework. It unblocks real sessions, and #235 does not.

## 2. The additions beyond the issue, judged one by one

| Addition | Verdict | Reasoning |
|---|---|---|
| **Production boot fails if no key targets `engineering_manager`** | **Keep** | This protects the no-manager rule from a one-line config omission. That is the most likely way the rule fails open, and it fails silently. Friction at deploy time costs very little next to an engineer finding out that a manager sat in on their session. The issue already requires the map in production, so this is a small extension of an accepted break. **One ask:** `docs/deployment.md` should state the placeholder-group workaround for an org with no managers in the IdP in a single sentence, so it reads as a documented choice and not as a hack someone finds by trial and error. |
| **`engineer` is not a valid target** | **Keep** | It costs almost nothing, and it closes off "map the managers group to engineer" as a deliberate or accidental path. Behaviour is identical to the issue's identity default, since `engineer` is still the fallback. The error message should tell the operator *why* (e.g. "engineer is the default and cannot be mapped"). Otherwise the first operator who tries it files a bug. |
| **Duplicate-key rejection** (custom raw-text scanner, D3) | **Accept, but this is the weakest item. Keep it small.** | The risk is real but narrow: someone pastes a key twice in an env var and the later entry silently wins. The fix is a hand-written scanner on the auth startup path, which is new code to maintain and to put through security review for a rare mistake. I won't block it, because the design rejected a new dependency and the cost is bounded. Hold the line at "a few lines plus two tests". If it grows, or gets stuck in review, cut it to a follow-up. The per-target counts line already gives an operator a way to see the map didn't load as expected. |
| **`facilitatorDiscarded` warn log** | **Keep** | The facilitator is the champion I'm counting on for each team. "Why can't I run the session?" in front of a team is an adoption-killing moment. A value-free log line is a cheap way to answer it. |
| **`facilitatorDiscarded` audit-metadata flag** | **Trim or defer** | This adds a new field to a durable audit contract right where #241 will reconcile (EM + facilitator, audited and shown to the user). Shipping it means #241 has to inherit or migrate it. The log line already answers the operator's question. Recommendation: ship the log line now and leave the audit flag to #241, which owns the audit and user-facing side of this conflict. If the team feels strongly, I'll accept it, as long as the proposal names it as something #241 must reconcile and doesn't treat it as settled contract. |
| **Audit every role change, including demotion to `engineer`** | **Keep, strongly** | This goes beyond the issue, but it makes a claim we already made in 01b ("removing the claim demotes the user and the audit records it") actually true. Trust in the access model depends on an honest audit trail. |
| **Warnings for no `facilitator` / `application_admin` target, plus the counts info line** | **Keep** | Cheap, and they contain no values. The facilitator warning in plain words ("no one will be able to run a session") is the right tone. |
| **Local stub `facilitator-001` gets a real facilitator claim** | **Keep** | Our own team can't exercise session creation without it. Low cost. |
| **Required recorded security review sign-off** | **Keep** | This changes how privileged roles are granted. That's proportional. |

**Net scope assessment:** proportional. Apart from the duplicate scanner and the audit flag, every addition traces back to either the no-manager rule or a facilitator being able to run a session. Those are the two things that decide whether this product succeeds. I don't see gold-plating in the config surface itself: no case-insensitive matching, no configurable default, no display labels, no multi-role storage. That restraint is good.

## 3. Risks I want visible

1. **Breaking upgrade.** "A production deployment upgraded without the map will not boot. That is intentional." I agree. The release notes need to lead with it, not bury it. Before release, the release check should name each known deployment and its owner, not just say "confirm".
2. **Silent grants on upgrade.** Any IdP already sending `facilitator` or `senior_engineer` grants those roles at the next sign-in. The proposal already calls for a release check. Make it a release-blocking checklist item, not a note.
3. **Admin or manager group membership blocks facilitating.** Under the decided precedence, a senior engineer who is also in an admin group can't run sessions. The doc rule "don't put facilitators in admin/manager groups" is a key part of onboarding. It belongs in the facilitator checklist, where a champion standing up their first team will read it.
4. **#235/#241 collision.** This is acknowledged and correctly owned by #235/#241. Every extra contract surface we ship here (see the audit flag above) makes that reconciliation harder. That's the main reason I'm asking to defer the flag.
5. **Live session facilitator demoted on re-sign-in.** Listed as a follow-up. That's acceptable for the first team. It needs a ticket before a second team goes live, not "someday".

## 4. Surveillance check

No claim values or map keys in logs or audit, internal role names only, and team membership roles stay app-assigned. Nothing here gives leadership new visibility into individuals, which is what I need to see. The new demotion audit row records role transitions, not activity, and that's acceptable.

## 5. Requested changes (summary)

1. Defer the `facilitatorDiscarded` **audit metadata** to #241, and keep the warn log. Or, if it's kept, mark it explicitly as subject to #241 reconciliation.
2. Bound the duplicate-key scanner. If it grows past a small, well-tested function or stalls security review, move it to a follow-up.
3. Make the `engineer`-target error message explain that `engineer` is the fixed default.
4. Document the no-managers placeholder workaround and the "facilitators not in admin/manager groups" rule in the facilitator checklist.
5. Make the existing-IdP-values check a release-blocking item that names each deployment and its owner.
6. File the live-session demotion follow-up before a second team onboards.

None of these block moving to design and specs.
