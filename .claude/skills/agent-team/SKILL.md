---
name: agent-team
description: Run the OpenSpec workflow using persona-driven agent teams, classifying each change into a full 7-stage pipeline or a lightweight 3-stage pipeline based on scope and risk. Each stage is executed by an agent adopting a team persona, then reviewed by agents adopting complementary personas. Use when the user wants to build a feature end-to-end with the agent team process.
license: MIT
metadata:
  author: dipstick
  version: "1.1"
---

Run the OpenSpec pipeline with persona-driven agent teams, on one of two tracks:

- **Full track** (default): Explore → Propose → Design/Tasks → Implement → Sync → Archive → Verify & PR
- **Light track** (small, bounded, no-design-decision changes only): Assess → Implement → Sync & Archive → Verify & PR

Each stage is executed by one agent adopting a persona, then reviewed by other persona-agents. Track classification happens once, at kickoff (Step 1c) — the user always confirms it before any branch or board state changes. Once a track is chosen, its pipeline runs continuously, stage to stage, without pausing for confirmation. It only stops early if a stopping condition (see below) requires the user's input.

---

**Input**: A description of what the user wants to build or a use case name.

**Steps**

1. **Get the use case description**

   If the user didn't provide a description, use **AskUserQuestion** to ask:
   > "What do you want to build? Describe the use case or feature."

   Derive a kebab-case change name from the description.

   Determine whether this run corresponds to a specific, already-filed GitHub
   issue — the user named one directly (e.g. "issue #109", a pasted issue
   URL), or the use case description is clearly that issue restated. If it's
   ambiguous whether one applies, don't guess — treat it as not tied to an
   issue rather than asking, since most exploratory `agent-team` runs (a use
   case description with no issue reference) have no corresponding issue at
   all. Call this `[issue]` (a bare number, e.g. `109`) when one applies.

   **1c. Classify track**

   Before creating the branch, check the change against these six criteria.
   This is a hard, conjunctive gate — all six must hold for the light track;
   if even one is unclear or fails, default to the full track. Over-scoping a
   small change to the full pipeline wastes ceremony; under-scoping a real
   change to the light track ships a defect with less review — bias toward
   the expensive-but-safe path when in doubt.

   - **Bounded scope** — touches a small, enumerable set of files known up
     front (single feature area, no new files except tests/specs)
   - **No new capability** — doesn't add a capability, endpoint, UI surface,
     or data model; only corrects, tightens, or clarifies something that
     already exists
   - **No design decision required** — the "how" is unambiguous from reading
     the issue/description; there's no architectural choice to make
   - **No ritual/session-mechanics surface** — doesn't touch the no-manager
     rule, simultaneous reveal, facilitator assignment, or anything a
     participant/facilitator would perceive during a live session
   - **No security-sensitive surface** — doesn't touch authentication,
     authorization, or data access boundaries (how something is logged or
     labeled is fair game; what's exposed is not)
   - **Low-priority / clarity-labeled, or equivalent** — the issue is scoped
     that way (label, title prefix like `[Clarity]`, or an explicit
     "no security/correctness impact" statement), or the user's own
     description is equivalently narrow

   Never silently route — always confirm with **AskUserQuestion**:

   > "This looks like a light-track change: [criteria that passed]. Run the
   > lightweight pipeline (~6 agent spawns) instead of the full 7-stage
   > pipeline (~20 spawns)?"
   > - Yes, light track
   > - No, run the full pipeline
   > - Let me describe the scope differently first

   If any criterion is unclear or fails, propose the full track instead and
   say which criterion tripped it, so the user can override with reasoning
   rather than a gut call.

   Record the answer as `[track]` (`full` or `light`). This determines
   whether Steps 3–9 (**Full Track**) or Steps 3L–5L (**Light Track**) run
   below — both converge on Step 10 (Verify and open PR).

2. **Create an isolated branch**

   Before any work begins, run the following git commands to create a fresh branch off of main:

   ```bash
   git fetch origin
   git checkout main
   git pull origin main
   git checkout -b agent-team/[branch-name]
   ```

   Where `[branch-name]` is `[issue]-[name]` if `[issue]` was identified in
   Step 1 (e.g. `109-reauth-required-client-prompt`), or just `[name]`
   otherwise. The issue number, when present, is always the prefix — never
   append it or bury it elsewhere in the branch name.

   Report the branch name to the user so they know where changes will land.

   If `[issue]` was identified in Step 1, mark it **In Progress** on the
   project board now, before any stage work begins — this is what tells
   anyone glancing at the board that the team has picked it up:

   ```bash
   gh project item-edit 1 --owner surratt-dev \
     --url https://github.com/surratt-dev/project-dipstick/issues/[issue] \
     --field "Status" --value "In Progress"
   ```

   (Project 1 — "Project Dipstick" — is this repo's only project board; its
   Status field has Todo / In Progress / Done options.) If the command fails
   because the issue isn't tracked on the board (no matching item), note that
   to the user and continue — don't add it to the board yourself or block the
   pipeline on this. This status update only ever moves forward to In
   Progress here; nothing in this skill moves it to Done — that's a separate,
   human call about whether the issue is actually resolved.

   Branch creation and board update above run identically regardless of
   `[track]`. If `[track]` is `light`, skip ahead to **Light Track** (Steps
   3L–5L) below; otherwise continue with **Full Track** (Steps 3–9).

**Full Track**

3. **Stage 1: Explore** (`opsx:explore`)

   Spawn an **executor agent** with this prompt structure:

   ```
   You are Devon Calloway, the Internal Champion. Read and fully adopt the persona from:
   requirements/implementation team personas/Internal Champion - Persona.md

   Your task: Explore the following use case using the opsx:explore skill.
   Use case: [description]

   Think through the problem space from Devon's perspective — what ritual constraints
   are in play, what the intent is, what could go wrong if the design drifts.
   Read relevant requirements documents in requirements/ for context.

   Write your exploration notes to a file: openspec/changes/[name]/exploration-notes.md
   ```

   After the executor finishes, spawn **two reviewer agents in parallel**:

   **Reviewer 1 — Facilitator (Priya Nair):**
   ```
   You are Priya Nair, the Facilitator. Read and fully adopt the persona from:
   requirements/implementation team personas/Facilitator - Persona.md

   Review the exploration notes at: openspec/changes/[name]/exploration-notes.md

   Focus on: Does this capture real user pain points and workflow friction?
   Are there usability concerns missing? Would this exploration lead to
   a tool that disappears into the background during sessions?

   Write your review to: openspec/changes/[name]/explore-review-facilitator.md
   Format: list of observations, questions, and suggested additions.
   ```

   **Reviewer 2 — Business Analyst (Marcus Delgado):**
   ```
   You are Marcus Delgado, the Business Analyst. Read and fully adopt the persona from:
   requirements/implementation team personas/Business Analyst - Persona.md

   Review the exploration notes at: openspec/changes/[name]/exploration-notes.md

   Focus on: Are the ideas specific enough to become requirements?
   Flag anything too vague to carry into a proposal. Suggest concrete
   acceptance conditions where the exploration is hand-wavy.

   Write your review to: openspec/changes/[name]/explore-review-ba.md
   Format: list of clarifications needed, vague areas, and suggested rewrites.
   ```

   After reviewers finish, spawn the **executor again** to incorporate feedback:
   ```
   You are Devon Calloway. Read and adopt your persona from:
   requirements/implementation team personas/Internal Champion - Persona.md

   Read the reviewer feedback:
   - openspec/changes/[name]/explore-review-facilitator.md
   - openspec/changes/[name]/explore-review-ba.md

   Update openspec/changes/[name]/exploration-notes.md to address the feedback.
   Only incorporate feedback that aligns with the ritual's intent — push back
   on suggestions that would compromise core constraints.
   ```

4. **Stage 2: Propose** (`opsx:propose`)

   Spawn **executor agent — Internal Champion (Devon Calloway):**
   ```
   You are Devon Calloway. Read and adopt your persona from:
   requirements/implementation team personas/Internal Champion - Persona.md

   Read the exploration notes at: openspec/changes/[name]/exploration-notes.md

   Now run the opsx:propose skill for change name "[name]".
   The change directory may already exist from exploration — if so, continue it.

   Frame the proposal from Devon's perspective: why this change matters,
   what capabilities are being added, and what constraints must be preserved.
   Read relevant requirements in requirements/ for context.
   ```

   After proposal artifacts are created, spawn **two reviewer agents in parallel**:

   **Reviewer 1 — Business Analyst (Marcus Delgado):**
   ```
   You are Marcus Delgado, the Business Analyst. Read and adopt your persona from:
   requirements/implementation team personas/Business Analyst - Persona.md

   Review the proposal at: openspec/changes/[name]/proposal.md

   Focus on: Are capabilities specific enough to implement? Are acceptance
   criteria explicit or implicit? Flag vague language. Suggest concrete
   conditions for each capability. Check against requirements in requirements/.

   Write your review to: openspec/changes/[name]/propose-review-ba.md
   ```

   **Reviewer 2 — Executive Stakeholder (Rachel Okonkwo):**
   ```
   You are Rachel Okonkwo, the Executive Stakeholder. Read and adopt your persona from:
   requirements/implementation team personas/Executive Stakeholder - Persona.md

   Review the proposal at: openspec/changes/[name]/proposal.md

   Focus on: Strategic alignment — does this serve adoption goals?
   Is scope proportional to value? Flag scope creep or misaligned priorities.

   Write your review to: openspec/changes/[name]/propose-review-exec.md
   ```

   After reviewers finish, spawn **executor** to incorporate proposal feedback and update proposal.md.

5. **Stage 3: Design Review**

   The design.md was created during the propose step. Spawn **two reviewer agents in parallel**:

   **Reviewer 1 — Full Stack Engineer (Marcus Oyelaran):**
   ```
   You are Marcus Oyelaran, the Full Stack Engineer. Read and adopt your persona from:
   requirements/implementation team personas/Full Stack Engineer - Persona.md

   Review the design at: openspec/changes/[name]/design.md
   Also read the proposal at: openspec/changes/[name]/proposal.md

   Focus on: Is this implementable? Are boundaries clean? Are technology
   choices practical? Hidden coupling risks? Missing error paths?
   Check against existing code patterns in packages/.

   Write your review to: openspec/changes/[name]/design-review-engineer.md
   ```

   **Reviewer 2 — Security Analyst (Tomás Ferreira):**
   ```
   You are Tomás Ferreira, the Security Analyst. Read and adopt your persona from:
   requirements/implementation team personas/Security Analyst - Persona.md

   Review the design at: openspec/changes/[name]/design.md
   Also read the proposal at: openspec/changes/[name]/proposal.md

   Focus on: Authentication flows, data access boundaries, audit logging,
   threat model impact. Flag any security decisions that are deferred or implicit.

   Write your review to: openspec/changes/[name]/design-review-security.md
   ```

   After reviewers finish, spawn **Solution Architect (Ingrid Sollenberger)** to incorporate design feedback and update design.md.

6. **Stage 4: Task Review**

   The tasks.md was created during the propose step. Spawn **two reviewer agents in parallel**:

   **Reviewer 1 — Solution Architect (Ingrid Sollenberger):**
   ```
   You are Ingrid Sollenberger, the Solution Architect. Read and adopt your persona from:
   requirements/implementation team personas/Solution Architect - Persona.md

   Review the tasks at: openspec/changes/[name]/tasks.md
   Also read design.md and proposal.md in the same directory.

   Focus on: Does the task ordering respect architectural dependencies?
   No task should assume something that hasn't been built yet.
   Flag tasks that should be split or reordered.

   Write your review to: openspec/changes/[name]/tasks-review-architect.md
   ```

   **Reviewer 2 — Business Analyst (Marcus Delgado):**
   ```
   You are Marcus Delgado, the Business Analyst. Read and adopt your persona from:
   requirements/implementation team personas/Business Analyst - Persona.md

   Review the tasks at: openspec/changes/[name]/tasks.md
   Also read proposal.md in the same directory.

   Focus on: Do the tasks, taken together, cover all capabilities in the proposal?
   Is anything lost in translation from requirements to tasks?

   Write your review to: openspec/changes/[name]/tasks-review-ba.md
   ```

   After reviewers finish, spawn **Full Stack Engineer (Marcus Oyelaran)** to incorporate task feedback and update tasks.md.

7. **Stage 5: Implement** (`opsx:apply`)

   Spawn **executor agent — Full Stack Engineer (Marcus Oyelaran):**
   ```
   You are Marcus Oyelaran, the Full Stack Engineer. Read and adopt your persona from:
   requirements/implementation team personas/Full Stack Engineer - Persona.md

   Run the opsx:apply skill for change "[name]".
   Implement each task according to the design decisions in design.md.
   ```

   After implementation is complete, spawn **Solution Architect (Ingrid Sollenberger)** to review:
   ```
   You are Ingrid Sollenberger, the Solution Architect. Read and adopt your persona from:
   requirements/implementation team personas/Solution Architect - Persona.md

   Review the implementation for change "[name]".
   Read design.md to understand architectural decisions.
   Check that the implementation matches the design — are boundaries respected?
   Are patterns consistent with existing code in packages/?

   Write your review to: openspec/changes/[name]/implementation-review-architect.md
   ```

   If the design flagged security-sensitive tasks, also spawn **Security Analyst (Tomás Ferreira)** to review those specific areas.

8. **Stage 6: Sync Specs** (`opsx:sync`)

   Spawn **executor agent — Business Analyst (Marcus Delgado):**
   ```
   You are Marcus Delgado, the Business Analyst. Read and adopt your persona from:
   requirements/implementation team personas/Business Analyst - Persona.md

   Run the opsx:sync skill for change "[name]".
   Ensure the specs reflect what was actually built, not just what was planned.
   ```

   After sync, spawn **Solution Architect (Ingrid Sollenberger)** to verify no drift between docs and code.

9. **Stage 7: Archive** (`opsx:archive`)

   Spawn **executor agent — Business Analyst (Marcus Delgado):**
   ```
   You are Marcus Delgado, the Business Analyst. Read and adopt your persona from:
   requirements/implementation team personas/Business Analyst - Persona.md

   Run the opsx:archive skill for change "[name]".
   ```

   After archive, spawn **Internal Champion (Devon Calloway)** for final review:
   ```
   You are Devon Calloway, the Internal Champion. Read and adopt your persona from:
   requirements/implementation team personas/Internal Champion - Persona.md

   The change "[name]" has been implemented and archived.
   Read the final artifacts in openspec/changes/archive/[name]/.

   Final check: Did this change preserve the ritual's intent?
   Were the core constraints (no-manager rule, simultaneous reveal,
   facilitator-from-another-team) respected or unaffected?

   Write a brief sign-off or concerns to: openspec/changes/archive/[name]/champion-signoff.md
   ```

   If the sign-off raises unresolved concerns, treat that as a stopping condition
   (see **Stopping Conditions**) rather than continuing to verification.

   Full track complete — continue to Step 10.

**Light Track**

*(Runs instead of Steps 3–9 when `[track]` is `light`. Same personas, same
execute → review → incorporate principle, far fewer stages — see the
requirements doc's Light Track section for the eligibility criteria and
rationale.)*

3L. **Stage 1: Assess**

   Spawn **executor agent — Internal Champion (Devon Calloway):**
   ```
   You are Devon Calloway, the Internal Champion. Read and fully adopt the persona from:
   requirements/implementation team personas/Internal Champion - Persona.md

   Your task: Assess the following use case for the light track — a merged
   Explore + Propose pass for a small, bounded change with no design decision
   required.
   Use case: [description]

   Produce a single artifact covering: what the change is, why it matters,
   the acceptance criteria, and confirmation that no architectural decision
   is needed (state explicitly why not). Read relevant requirements documents
   in requirements/ for context. If you discover a real design decision is
   needed, say so plainly — don't invent one to keep moving.

   Write it to: openspec/changes/[name]/assess.md
   ```

   After the executor finishes, spawn exactly **one reviewer**, chosen by the
   shape of the change (not asked of the user):

   - **Business Analyst (Marcus Delgado)** if the change is requirements-shaped (does the fix match what the issue describes, is anything ambiguous)
   - **Full Stack Engineer (Marcus Oyelaran)** if the change is implementation-shaped (is the described fix correct/complete against the real code)
   - **Security Analyst (Tomás Ferreira)** if the change touches audit logging or error surfaces, even without touching auth logic itself

   Skip the Facilitator and Executive Stakeholder by default — reintroduce
   the Facilitator only if the bounded-scope check turns up a session/UI
   file touched, and the Executive only if the user raises a strategic
   question themselves.

   Example reviewer prompt (substitute persona/file/focus per the selection above):
   ```
   You are Marcus Delgado, the Business Analyst. Read and fully adopt the persona from:
   requirements/implementation team personas/Business Analyst - Persona.md

   Review the assessment at: openspec/changes/[name]/assess.md

   Focus on: Does the fix actually match what the issue describes? Is
   anything ambiguous or missing? Confirm this genuinely has no design
   decision to make.

   Write your review to: openspec/changes/[name]/assess-review.md
   ```

   If the reviewer surfaces a real design decision, an unexpected security
   surface, or coupling into session mechanics, treat this as an
   **escalation** (see Stopping Conditions) rather than continuing on the
   light track: assess.md becomes the seed for a full Explore/Propose pass,
   and the reviewers dropped at kickoff (Facilitator, Executive, and
   whichever of BA/Engineer/Security wasn't used here) are looped in from
   this point forward. Report the escalation to the user before continuing —
   don't decide silently.

   Otherwise, spawn the **executor again** to incorporate reviewer feedback
   into assess.md, then run the `opsx:propose` skill for change name "[name]"
   using assess.md as the source, so `design.md` and `tasks.md` exist for the
   Implement stage (design.md should stay minimal — there's no decision to
   document).

4L. **Stage 2: Implement** (`opsx:apply`)

   Identical to Step 7 (Full Track's Implement stage): spawn the Full Stack
   Engineer (Marcus Oyelaran) as executor, then the Solution Architect
   (Ingrid Sollenberger) to review. Code-correctness review is cheap and
   always worth it regardless of change size. If the design flagged
   security-sensitive tasks, also spawn the Security Analyst for those.

5L. **Stage 3: Sync & Archive**

   Spawn **executor agent — Business Analyst (Marcus Delgado):**
   ```
   You are Marcus Delgado, the Business Analyst. Read and adopt your persona from:
   requirements/implementation team personas/Business Analyst - Persona.md

   Run the opsx:sync skill for change "[name]", then the opsx:archive skill
   for the same change. Ensure the specs reflect what was actually built,
   not just what was planned.
   ```

   No separate sign-off stage — the Assess-stage reviewer's approval already
   stands as the record. There is no champion-signoff.md on the light track.

   Light track complete — continue to Step 10.

10. **Verify and open PR** (shared by both tracks)

    Once the full track's archive and sign-off are clean, or the light
    track's Sync & Archive step is complete, verify the change before publishing it:

    ```bash
    npm run lint
    npm run test
    npm run build
    ```

    If any of these fail and the fix isn't a small, obvious correction consistent
    with the design (e.g. a lint nit), treat it as a stopping condition — don't
    loop indefinitely trying to make verification pass.

    Once verification is clean, push the branch and open the PR:

    ```bash
    git push -u origin agent-team/[branch-name]
    gh pr create --title "..." --body "..."
    ```

    Summarize what the change does and reference `[issue]` (if any) with
    `Closes #[issue]` in the PR body. Report the PR URL to the user and stop —
    this is the end of the run.

**Continuous Flow**

Stages run one after another without pausing for confirmation between them.
After each stage (and after each executor/reviewer step within it), report
to the user in the same format as before:
- What the executor produced
- Summary of reviewer feedback
- How feedback was incorporated

Do not ask "Ready to proceed?" — move directly into the next stage once the
report is posted. Keep going, stage after stage, until either the PR is
opened (success) or a stopping condition is hit.

**Stopping Conditions**

Stop processing and wait for the user's input — do not guess or push through —
when any of the following happens. Report clearly what triggered the stop and
what you need from the user:

- Reviewers raise conflicting concerns that the executor cannot resolve with a
  reasoned, persona-consistent judgment call
- A persona's review surfaces a genuine security, compliance, or ritual-intent
  concern that isn't a straightforward fix (e.g. an unresolved threat-model gap,
  a violation of a core constraint like the no-manager rule)
- The champion sign-off at archive raises concerns rather than a clean pass (full track)
- On the light track, the Assess-stage reviewer or the Implement-stage
  architect determines the change is bigger than it looked — a real design
  decision, an unexpected security surface, or coupling into session
  mechanics (Step 3L/4L escalation)
- Lint, test, or build fails during final verification and the fix isn't a
  small, obvious correction
- A required file, persona, or upstream artifact is missing and can't be
  reasonably inferred (e.g. exploration notes never got written)
- The `gh project item-edit` or `gh pr create` calls fail for a reason other
  than "issue not tracked on the board" (e.g. auth/permission errors)
- Anything else that genuinely requires a human decision rather than a
  persona-consistent judgment call

Routine things are NOT stopping conditions and should be handled by the
executor and noted in the progress report: ordinary reviewer suggestions,
feedback the executor reasonably accepts or rejects with rationale, or a
project board item that simply isn't tracked (per Step 2).

**Guardrails**

- Every agent MUST read its full persona file before starting work
- Reviewers work independently — they do not see each other's reviews
- The executor incorporates feedback selectively, with rationale for anything rejected
- If reviewers raise conflicting concerns the executor cannot resolve, stop per **Stopping Conditions**
- All review artifacts are preserved in the change directory for traceability
- Stages run sequentially and continuously (see **Continuous Flow**); reviewers within a stage run in parallel
- When the run is tied to a filed GitHub issue, that issue's project status moves to In Progress at branch creation (Step 2) — before any persona work starts, not after
- The run only ends in one of two ways: a PR is opened (Step 10), or processing stops early on a **Stopping Condition**
- Track classification (Step 1c) is a hard, conjunctive gate — all six criteria must hold for the light track — and always requires explicit user confirmation via **AskUserQuestion** before branch creation; it is never silently routed
- The light track never skips the two hard review gates: an independent reviewer before code is written (Assess), and an independent reviewer after (Implement) — only the surrounding ceremony is cut
- A light-track run that escalates (Step 3L/4L) reuses its Assess artifact as the seed for a full Explore/Propose pass rather than discarding it, and reports the escalation to the user
