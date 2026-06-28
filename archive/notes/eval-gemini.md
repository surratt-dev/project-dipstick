Since you are moving from a single source document into a full software development lifecycle (SDLC) suite, a "one-size-fits-all" score won't work. Your evaluation needs to pivot from **Accuracy** (in the summary phase) to **Creativity and Logic** (in the architecture phase).

Here is a recommended multi-phase rubric designed to grade this specific progression.

---

## Phase 1: Grounding & Extraction

*Applied to: Summary, Entity List, Business Requirements (BRD)*
These tasks are about **fidelity**. The model shouldn't invent new facts; it should condense existing ones.

| Criterion | Metric | Why it matters |
| --- | --- | --- |
| **Hallucination Rate** | Binary (Yes/No) | Did the model "invent" an entity or requirement not in the source? |
| **Granularity** | 1–5 Scale | Is the entity list just "Names" or does it include "Roles, Systems, and Data Objects"? |
| **Traceability** | 1–5 Scale | Can every requirement in the BRD be mapped back to a line in the source? |

---

## Phase 2: Synthesis & Solutioning

*Applied to: Proposal, Feature Set, Use Cases, Actors*
These tasks require the model to "bridge the gap" between a static document and a functional product.

| Criterion | Metric | Why it matters |
| --- | --- | --- |
| **Internal Consistency** | 1–5 Scale | Does the "Feature Set" actually support the "Use Cases" generated? |
| **Persona Empathy** | 1–5 Scale | Are the personas distinct individuals with pain points, or just generic job titles? |
| **Logical Leap** | 1–5 Scale | Does the web app proposal actually solve the problem described in the source? |

---

## Phase 3: Technical Maturity

*Applied to: Implementation Stack, High-Level Architecture*
This is where you grade the model’s "seniority" as an engineer.

| Criterion | Metric | Why it matters |
| --- | --- | --- |
| **Stack Justification** | 1–5 Scale | Did it pick a stack because it's "popular," or did it explain why it fits the source's constraints? |
| **Architectural Depth** | 1–5 Scale | Does the architecture include security, data flow, and API layers, or just a basic diagram description? |
| **Feasibility** | 1–5 Scale | Is the proposed solution over-engineered or realistically buildable? |

---

## The "Master Ranking" Formula

To get a final "Leaderboard" score for each LLM, use a weighted average. Not all documents are created equal:

$$Final Score = (Grounding \times 0.40) + (Logic \times 0.35) + (Technical \times 0.25)$$

* **Grounding (40%):** Because if the summary is wrong, the entire downstream project is flawed.
* **Logic (35%):** Because a software agent must be able to translate "business talk" into "feature talk."
* **Technical (25%):** Because stacks can be changed, but the core business logic is harder to fix.

---

### How to Execute the Test

1. **The "Frozen" Prompt:** Use the exact same system prompt for every model (e.g., "You are a Senior Systems Architect...").
2. **The Context Window Test:** As you move toward the "Architecture Document," see if the model "remembers" the specific entities it identified in Step 2. If it forgets a key entity, dock points for **Context Retention**.
3. **The Negative Constraint:** Tell the models: *"Do not use AWS if the source mentions on-premise requirements."* This is a "Pass/Fail" check for instruction following.

**Would you like me to draft a "System Prompt" that you can use across all models to ensure the playing field is level?**