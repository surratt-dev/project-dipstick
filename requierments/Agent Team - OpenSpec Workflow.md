# Agent Team: OpenSpec Workflow

A multi-agent workflow where each stage of the OpenSpec process is executed by an agent adopting a persona from the implementation team, then reviewed by one or more agents adopting complementary personas.

---

## Personas Available

| Persona | Name | Strength |
|---------|------|----------|
| Internal Champion | Devon Calloway | Domain intent, ritual constraints, "why" behind requirements |
| Business Analyst | Marcus Delgado | Requirements precision, gap analysis, acceptance criteria |
| Solution Architect | Ingrid Sollenberger | Technical decisions, system boundaries, security controls |
| Full Stack Engineer | Marcus Oyelaran | Implementation feasibility, boundary correctness, maintainability |
| Security Analyst | Tomás Ferreira | Threat modeling, access control, audit logging |
| Executive Stakeholder | Rachel Okonkwo | Strategic alignment, adoption risk, success metrics |
| Facilitator | Priya Nair | End-user perspective, usability, workflow friction |

---

## Workflow Stages

### 1. Explore (`opsx:explore`)

**Purpose:** Think through ideas, investigate problems, clarify requirements before proposing a change.

| Role | Persona | Rationale |
|------|---------|-----------|
| **Execute** | Internal Champion (Devon Calloway) | Devon holds the domain knowledge and original intent. He is the right person to frame the problem space, articulate why a change matters, and identify which ritual constraints are in play. |
| **Review** | Facilitator (Priya Nair) | Priya validates that the exploration captures real user pain points and workflow friction, not just abstract concerns. |
| **Review** | Business Analyst (Marcus Delgado) | Marcus checks that the exploration surfaces requirements that are specific enough to act on and flags anything too vague to carry forward. |

**Handoff:** Exploration notes passed to the Propose stage. Reviewers may add questions that become input for the proposal.

---

### 2. Propose (`opsx:propose`)

**Purpose:** Create a change proposal with design, specs, and tasks in one step.

| Role | Persona | Rationale |
|------|---------|-----------|
| **Execute** | Internal Champion (Devon Calloway) | Devon writes the "why" and "what changes" sections of the proposal. He defines the capabilities being added or modified and frames the impact in terms of the ritual's intent. |
| **Review** | Business Analyst (Marcus Delgado) | Marcus reviews for requirement clarity — are the capabilities specific enough to implement? Are acceptance criteria implicit or explicit? He flags vague language and suggests concrete conditions. |
| **Review** | Executive Stakeholder (Rachel Okonkwo) | Rachel validates strategic alignment — does this change serve the adoption goals? Is the scope proportional to the value? She flags scope creep or misaligned priorities. |

**Handoff:** Approved proposal (with BA clarifications incorporated) moves to Design.

---

### 3. Design (`opsx:propose` — design artifact)

**Purpose:** Make technical decisions, define goals/non-goals, and resolve architectural questions.

| Role | Persona | Rationale |
|------|---------|-----------|
| **Execute** | Solution Architect (Ingrid Sollenberger) | Ingrid translates the proposal into technical decisions — technology choices, system boundaries, data flow, and integration points. She documents rationale for each decision. |
| **Review** | Full Stack Engineer (Marcus Oyelaran) | Marcus validates that the design is implementable — are the boundaries clean? Are the technology choices practical? Are there hidden coupling risks or missing error paths? |
| **Review** | Security Analyst (Tomás Ferreira) | Tomás reviews for security implications — authentication flows, data access boundaries, audit logging requirements, and threat model impact. |

**Handoff:** Approved design (with engineering and security feedback incorporated) moves to Task Breakdown.

---

### 4. Task Breakdown (`opsx:propose` — tasks artifact)

**Purpose:** Break the design into ordered, implementable tasks with clear completion criteria.

| Role | Persona | Rationale |
|------|---------|-----------|
| **Execute** | Full Stack Engineer (Marcus Oyelaran) | Marcus breaks the design into tasks sized for implementation — he knows what constitutes a meaningful unit of work and where task boundaries should fall for clean commits and testability. |
| **Review** | Solution Architect (Ingrid Sollenberger) | Ingrid verifies that the task ordering respects architectural dependencies — no task assumes something that hasn't been built yet. |
| **Review** | Business Analyst (Marcus Delgado) | Marcus confirms that the tasks, taken together, cover all the capabilities described in the proposal. Nothing was lost in translation from requirements to tasks. |

**Handoff:** Approved task list moves to Implementation.

---

### 5. Implement (`opsx:apply`)

**Purpose:** Execute tasks sequentially, writing code and tests.

| Role | Persona | Rationale |
|------|---------|-----------|
| **Execute** | Full Stack Engineer (Marcus Oyelaran) | Marcus implements each task, writing code that satisfies the design decisions and task completion criteria. |
| **Review (per task)** | Solution Architect (Ingrid Sollenberger) | Ingrid reviews each completed task for architectural compliance — does the implementation match the design? Are boundaries respected? |
| **Review (security-sensitive tasks)** | Security Analyst (Tomás Ferreira) | Tomás reviews tasks involving authentication, authorization, data access controls, or audit logging. Not every task requires security review — only those flagged in the design. |

**Handoff:** All tasks complete. Implementation moves to Spec Sync.

---

### 6. Sync Specs (`opsx:sync`)

**Purpose:** Update main specs with the delta specs from the change.

| Role | Persona | Rationale |
|------|---------|-----------|
| **Execute** | Business Analyst (Marcus Delgado) | Marcus merges the change's delta specs into the living specification documents, ensuring the specs accurately reflect what was built (not just what was planned). |
| **Review** | Solution Architect (Ingrid Sollenberger) | Ingrid verifies that the synced specs match the actual implementation — no drift between documentation and code. |

**Handoff:** Specs updated. Change moves to Archive.

---

### 7. Archive (`opsx:archive`)

**Purpose:** Archive the completed change for historical reference.

| Role | Persona | Rationale |
|------|---------|-----------|
| **Execute** | Business Analyst (Marcus Delgado) | Marcus archives the change, ensuring the proposal, design, and task artifacts are preserved with their final state. |
| **Review** | Internal Champion (Devon Calloway) | Devon does a final check — did the completed change preserve the ritual's intent? This is the bookend to his initial exploration and proposal. |

---

## Execution Model

Each stage follows the same pattern:

1. **Spawn executor agent** with the stage's persona loaded as system context and the appropriate `opsx:` skill invoked.
2. **Executor produces artifacts** (exploration notes, proposal, design, tasks, code, or spec updates).
3. **Spawn reviewer agent(s)** with their persona loaded. Each reviewer reads the artifacts and produces structured feedback: approvals, requested changes, or questions.
4. **Executor incorporates feedback** and resubmits. Reviewers re-review only the changes.
5. **Stage completes** when all reviewers approve. Artifacts are handed to the next stage.

### Agent Prompt Structure

Each agent receives:
- The full persona document from `requirements/implementation team personas/`
- The openspec change context (prior artifacts from earlier stages)
- A role directive: "You are executing this stage" or "You are reviewing this stage's output"
- Stage-specific instructions (e.g., "Focus on requirement clarity" for BA review of a proposal)

### Parallelism

- Reviewers within a stage run in parallel (they review the same artifact independently).
- Stages run sequentially (each depends on the prior stage's output).
- Security review during implementation is conditional — only triggered for tasks flagged in the design.

---

## Summary Matrix

| Stage | Skill | Executor | Reviewer 1 | Reviewer 2 |
|-------|-------|----------|------------|------------|
| Explore | `opsx:explore` | Internal Champion | Facilitator | Business Analyst |
| Propose | `opsx:propose` | Internal Champion | Business Analyst | Executive Stakeholder |
| Design | `opsx:propose` | Solution Architect | Full Stack Engineer | Security Analyst |
| Tasks | `opsx:propose` | Full Stack Engineer | Solution Architect | Business Analyst |
| Implement | `opsx:apply` | Full Stack Engineer | Solution Architect | Security Analyst (conditional) |
| Sync | `opsx:sync` | Business Analyst | Solution Architect | — |
| Archive | `opsx:archive` | Business Analyst | Internal Champion | — |

---

## Invocation

The pipeline is available as a Claude Code skill:

```
/agent-team [description of what you want to build]
```

Example:
```
/agent-team add session facilitation workflow with real-time voting
```

The skill runs each stage sequentially, spawning executor and reviewer agents with the appropriate personas. It pauses between stages for your approval before proceeding.
