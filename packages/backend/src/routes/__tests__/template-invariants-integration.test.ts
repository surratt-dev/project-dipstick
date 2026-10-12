import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { probeInfra, requireInfraOrThrow, loadModules, SENTINEL_TEAM_ID } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import { acquireTemplateLock } from "./helpers/template-lock.js";
import {
  checkTemplateInvariants,
  messageFor,
  type BaselineTopic,
  type InvariantId,
  type TemplateRow,
  type Violation,
} from "./helpers/template-invariants.js";

// ---------------------------------------------------------------------------
// Template invariants -- harden-team-creation-topic-copy (#215) design.md D8,
// tasks.md 7.1/7.2. The CI-time substitute for the declined template write
// trigger. It detects a bad migration or seed; it runs against the CI
// database, so it does NOT detect a direct edit made in production.
//
// BASELINE SOURCE (7.1): packages/backend/migrations/11_default_topics_correction.sql,
// the up-migration that replaced migration 4's six rows with the twelve. The
// prompts agree character-for-character with the requirements list already
// asserted in default-topic-provisioning-integration.test.ts (4.4), and the
// hashes below equal SHA-256 of the migration text as stored in the seeded
// database (checked when this file was written). No fallback was needed: the
// prompt text is in the migration. Hashes (not prose) keep the file small; a
// diff shows only that content changed. F5 (#216) MUST update this list when
// it edits defaults.
// ---------------------------------------------------------------------------

const N = 12;

const BASELINE: BaselineTopic[] = [
  { name: "Production Code — Adding Features", voteType: "finger", promptSha256: "cf677abc9d23c9dda25c34ba248db8df3e76c840dbcf22fe022e2dd147edaed1", firstSessionDescriptionSha256: "45db06d42d639c8a051f707641c89c6a8c685874d34327d49aa8f96e46eddf09" },
  { name: "Production Code — Reasoning", voteType: "finger", promptSha256: "4aa18ec82f22b734adc6b638b2ebe70e63d2c8f820c0c5f7905e42e4b6aea1c3", firstSessionDescriptionSha256: "a65db4f6bf6aaa560847004467d1d40ed4f6bec0b9d7069555101bf29ecccd4c" },
  { name: "Production Code — Active Development", voteType: "finger", promptSha256: "ff4131e9b2fa5cb8d594995ee5494abbf18afc32098027165690259d4827acd1", firstSessionDescriptionSha256: "a4d1244ebf17923dce28a58915a2a51c185b0c6d6b7b7e5b6eca628b0e231306" },
  { name: "Production Code — Entire Project", voteType: "finger", promptSha256: "19a3ed832a8c1916cf5169acc554420a51b3d3df362560bdcb66695038fa0870", firstSessionDescriptionSha256: "23a46e6f00fe854921d70d0192b0e7439e4b799af94c35db2aa97f35246f5215" },
  { name: "Test Suite — Effectiveness", voteType: "finger", promptSha256: "1dcaac06d501187d174abd16e1b8f1ccd78f2946a05355032b44bb58a0e0982a", firstSessionDescriptionSha256: "519d5442fb002e55002d38fd4547cf64c7c035f436a4afbc83d6585b3f8e22db" },
  { name: "Test Suite — Consistency", voteType: "roman", promptSha256: "66d380874e7c61d3c2d77c492eea9fe72d0ea5646dd38959c861d81a5d071c3f", firstSessionDescriptionSha256: "7592846b25ee516af570c3913d82f9c82d3eb1b7a141606cd10d4d8c6a28ad52" },
  { name: "Test Suite — Active Development", voteType: "finger", promptSha256: "8d52978ae85b7e9726cbc609b654e35efb234daadc0fcd3dbe969409b2edf11c", firstSessionDescriptionSha256: "bc064fad760dfa2fedacaab3d651e77590572ed7d822e5b3c3531c969af30c69" },
  { name: "Test Suite — Entire Project", voteType: "finger", promptSha256: "a306a40e92c5dcb60a8c6374c12f1f08e3bd67cd68432820191f618f7d9e48e9", firstSessionDescriptionSha256: "144f145862724eb64b4bd9add28b6239743ff806e0242cb2cf6364215db846b3" },
  { name: "Pipeline", voteType: "finger", promptSha256: "efeab347a5d10eafa2505a050d6d3903d2770f03ce21464150991f039235a1b0", firstSessionDescriptionSha256: "5c9e8b71cf3c6ea4867ad1097e8f28c324bc9d5b59c13b5d3a9bc0cf5052b65c" },
  { name: "Technology Stack", voteType: "roman", promptSha256: "e4cdce0d00642a0a0c055bf945ee5ecb81e64a01405351fc4d16f232db78eed0", firstSessionDescriptionSha256: "65658c97b1909e8415fdc685a6f7f6f3763c0f6c869f5af22dcf09ca7fa2bfb4" },
  { name: "Pairing", voteType: "finger", promptSha256: "5b581e3956db2fb7ba5554b56759ac0d610cecfa1a9d9070e392f237dea5df8f", firstSessionDescriptionSha256: "6e55152d27e37d536e21fa62006e845ccbb30c4d0a7a7fa9e2a042c69f21521d" },
  { name: "Project Trend", voteType: "modified_roman", promptSha256: "89d9443d95ebb72f4dd45979256f17cd69df4ae4056b4b240a211e98db1851f5", firstSessionDescriptionSha256: "3e6d4dd5c93018c35408023cf9d4117d91b54a28367579910b3da1632b80373d" },
];

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "template-invariants-integration.test.ts");

describe.skipIf(!infraUp)("the template team holds the canonical baseline (#215 D8)", () => {
  let mods: Mods;
  let release: (() => Promise<void>) | undefined;
  let violations: Violation[];

  beforeAll(async () => {
    expect(BASELINE).toHaveLength(N);
    release = await acquireTemplateLock();
    mods = await loadModules();
    const rows = (
      await mods.db.query<TemplateRow>(
        `SELECT name, prompt, vote_type, display_order, status, is_default, first_session_description
           FROM topics WHERE team_id = $1`,
        [SENTINEL_TEAM_ID],
      )
    ).rows;
    const counts = await mods.db.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM team_memberships WHERE team_id = $1)
            + (SELECT count(*) FROM sessions WHERE team_id = $1) AS n`,
      [SENTINEL_TEAM_ID],
    );
    violations = checkTemplateInvariants(rows, BASELINE, Number(counts.rows[0]!.n));
  });

  afterAll(async () => {
    await mods?.redis.quit();
    await release?.();
  });

  const invariants: InvariantId[] = [
    "(a) active default count and names equal the baseline",
    "(b) active default positions are exactly 1..N",
    "(c) no non-active default",
    "(d) no non-default row on the template",
    "(f) baseline content (prompt, vote_type, first_session_description)",
    // (e) goes last so (a)-(d) and (f) report first; migration 23's CHECKs
    // already enforce it, so this is an intentional duplicate that names the
    // invariant in its failure message.
    "(e) no memberships or sessions on the template team",
  ];

  it.each(invariants)("%s", (invariant) => {
    expect(messageFor(violations, invariant), messageFor(violations, invariant)).toBe("");
  });
});
