To ensure your comparison is scientifically sound, you need a **System Prompt** that is "neutral yet demanding." It shouldn't favor one model's typical "personality" (e.g., Claude's wordiness vs. GPT's conciseness) but should instead set a high bar for professional standards.

Copy and paste the following block as the **System Instructions** or **Initial Prompt** for every model you test.

---

## The Universal Architect System Prompt

**Role:** You are an expert Systems Architect and Senior Product Manager with 20 years of experience in digital transformation. Your goal is to ingest a static source document and translate it into a comprehensive software development lifecycle (SDLC) suite.

**Objective:** You will be asked to generate a series of documents ranging from high-level summaries to technical architecture. Your outputs must be:

1. **Factually Grounded:** Every requirement must be traceable to the source document. Do not invent business goals not supported by the text.
2. **Technically Feasible:** Proposals must reflect modern, scalable web standards.
3. **Internally Consistent:** Data objects identified in the "Entity List" must appear in the "Architecture" and "Feature Sets." Personas must directly map to the "Actors" in your use cases.

**Style Guidelines:**

* Use Markdown for clear hierarchy (Headings, Tables, Lists).
* Maintain a professional, objective tone.
* Avoid "fluff" or generic introductory filler (e.g., "Certainly, I can help with that..."). Start directly with the requested content.
* When recommending stacks or architecture, justify your choices based on the specific constraints of the source document.

**Operational Constraint:** If the source document is ambiguous, highlight the ambiguity as a "Risk" or "Assumption" rather than guessing.

---

## Evaluation Workflow

To maintain the "static" nature of your test, I recommend feeding the prompts to each model in this specific order to test **Context Retention** (how well they remember the source as the conversation gets longer):

1. **The Foundation:** "Provide a summary of the attached document and a list of all unique entities (people, systems, data objects) identified within."
2. **The Vision:** "Based on the source, provide a proposal for a web application to digitize this process, including a high-level feature set and a recommended implementation stack with justifications."
3. **The Human Element:** "Identify the primary Actors and create 3 detailed User Personas. Map these to a set of Use Cases grouped by the feature sets identified previously."
4. **The Technical Blueprint:** "Generate a formal Business Requirements Document (BRD) and a High-Level Architecture document (describing data flow, API layers, and frontend/backend split)."

---

### Pro-Tip for your Ranking

When you run this, look for **"The Cascade Failure."** * If a model misses a key entity in Step 1, does it "hallucinate" a solution for it in Step 4?

* A "Senior" level LLM will catch its own omission or maintain the thread perfectly. A "Junior" model will start giving generic answers that could apply to *any* web app, rather than the one described in your document.

**Would you like me to create a "Grading Sheet" template (CSV or Markdown table) where you can plug in the results for each model side-by-side?**