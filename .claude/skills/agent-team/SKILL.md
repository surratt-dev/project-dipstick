---
name: agent-team
description: Run the full OpenSpec workflow using persona-driven agent teams. Each stage is executed by an agent adopting a team persona, then reviewed by agents adopting complementary personas. Use when the user wants to build a feature end-to-end with the agent team process.
license: MIT
metadata:
  author: dipstick
  version: "1.0"
---

Run the full OpenSpec pipeline with persona-driven agent teams.

Each stage is executed by one agent adopting a persona, then reviewed by other persona-agents. The pipeline runs continuously, stage to stage, without pausing for confirmation: Explore → Propose → Design/Tasks → Implement → Sync → Archive → Verify & PR. It only stops early if a stopping condition (see below) requires the user's input.

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

2. **Create an isolated branch**

   Before any work begins, run the following git commands to create a fresh branch off of main:

   ```bash
   git fetch origin
   git checkout main
   git pull origin main
   git checkout -b agent-team/[name]
   ```

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

10. **Verify and open PR**

    Once archive and sign-off are clean, verify the change before publishing it:

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
    git push -u origin agent-team/[name]
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
- The champion sign-off at archive raises concerns rather than a clean pass
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
