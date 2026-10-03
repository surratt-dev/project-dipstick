import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { probeInfra, requireInfraOrThrow } from "./helpers/real-db.js";
import type * as Limiter from "../../auth/sliding-window-limiter.js";
import type * as RedisModule from "../../redis.js";

// ---------------------------------------------------------------------------
// harden-topic-write-endpoints (#184) task 4.3 — CONDITIONAL_DUAL_WINDOW_LUA
// against real Redis, with randomUUID() keys and an injected nowMs.
//
// Real-Redis file (calls probeInfra / requireInfraOrThrow). The limiter
// module is imported dynamically, after real-db.ts has applied its env
// fallbacks, so redis.js connects to the docker compose Redis.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "sliding-window-limiter-integration.test.ts");

const TEN_MIN = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const LIMITS = { burstLimit: 120, burstWindowMs: TEN_MIN, dailyLimit: 400, dailyWindowMs: DAY };

describe.skipIf(!infraUp)("CONDITIONAL_DUAL_WINDOW_LUA — real Redis (#184 task 4.3)", () => {
  let limiter: typeof Limiter;
  let redis: (typeof RedisModule)["redis"];
  const used: string[] = [];

  function freshKeys() {
    const id = randomUUID();
    const keys = {
      burst: `dipstick:ratelimit:topic-write-test:{${id}}:burst`,
      daily: `dipstick:ratelimit:topic-write-test:{${id}}:daily`,
      burstMarker: `dipstick:ratelimit:topic-write-test:{${id}}:breach-audited:burst`,
      dailyMarker: `dipstick:ratelimit:topic-write-test:{${id}}:breach-audited:daily`,
    };
    used.push(...Object.values(keys));
    return keys;
  }

  async function seed(key: string, scores: number[]) {
    const pipeline = redis.pipeline();
    scores.forEach((score, i) => pipeline.zadd(key, score, `seed-${i}-${randomUUID()}`));
    await pipeline.exec();
  }

  beforeAll(async () => {
    limiter = await import("../../auth/sliding-window-limiter.js");
    redis = (await import("../../redis.js")).redis;
  });

  afterEach(async () => {
    if (used.length) await redis.del(...used.splice(0));
  });

  afterAll(async () => {
    redis.disconnect();
  });

  it("burst boundary: 120 are admitted, the 121st is rejected", async () => {
    const keys = freshKeys();
    const t0 = 1_800_000_000_000;
    for (let i = 0; i < 120; i++) {
      const r = await limiter.admitConditionalDualWindow(keys, LIMITS, t0 + i);
      expect(r.admitted).toBe(true);
      expect(r.burstCount).toBe(i + 1);
    }
    const r121 = await limiter.admitConditionalDualWindow(keys, LIMITS, t0 + 120);
    expect(r121).toMatchObject({ admitted: false, burstCount: 120, dailyCount: 120, burstEpisodeNew: true, dailyEpisodeNew: false });
  });

  it("daily boundary: 400 spread over more than 40 minutes are admitted, the 401st is rejected (burst never full)", async () => {
    const keys = freshKeys();
    const t0 = 1_800_000_000_000;
    const step = 7_000; // 400 x 7 s = 46.7 min; at most ~86 in any 10-minute window
    for (let i = 0; i < 400; i++) {
      const r = await limiter.admitConditionalDualWindow(keys, LIMITS, t0 + i * step);
      expect(r.admitted).toBe(true);
    }
    const r401 = await limiter.admitConditionalDualWindow(keys, LIMITS, t0 + 400 * step);
    expect(r401.admitted).toBe(false);
    expect(r401.dailyCount).toBe(400);
    expect(r401.burstCount).toBeLessThan(120);
    expect(r401).toMatchObject({ dailyEpisodeNew: true, burstEpisodeNew: false });
  });

  it("an admit adds the same member to both windows and sets both TTLs", async () => {
    const keys = freshKeys();
    const now = Date.now();
    const r = await limiter.admitConditionalDualWindow(keys, LIMITS, now);
    expect(r).toMatchObject({ admitted: true, burstCount: 1, dailyCount: 1, burstOldestMs: now, dailyOldestMs: now });
    const [burstMembers, dailyMembers] = await Promise.all([redis.zrange(keys.burst, 0, -1), redis.zrange(keys.daily, 0, -1)]);
    expect(burstMembers).toHaveLength(1);
    expect(dailyMembers).toEqual(burstMembers);
    expect(await redis.pttl(keys.burst)).toBeGreaterThan(TEN_MIN - 5_000);
    expect(await redis.pttl(keys.daily)).toBeGreaterThan(DAY - 5_000);
  });

  it("a rejected call adds no entry to either window and does not refresh the window TTLs", async () => {
    const keys = freshKeys();
    const now = Date.now();
    await seed(keys.burst, Array.from({ length: 120 }, () => now - 1_000));
    await seed(keys.daily, Array.from({ length: 120 }, () => now - 1_000));
    await redis.pexpire(keys.burst, 60_000);
    await redis.pexpire(keys.daily, 60_000);

    for (let i = 0; i < 5; i++) {
      const r = await limiter.admitConditionalDualWindow(keys, LIMITS, now + i);
      expect(r.admitted).toBe(false);
    }
    expect(await redis.zcard(keys.burst)).toBe(120);
    expect(await redis.zcard(keys.daily)).toBe(120);
    expect(await redis.pttl(keys.burst)).toBeLessThanOrEqual(60_000);
    expect(await redis.pttl(keys.daily)).toBeLessThanOrEqual(60_000);
  });

  it("the first reject opens an episode; later rejects only increment the suppressed count", async () => {
    const keys = freshKeys();
    const now = Date.now();
    await seed(keys.burst, Array.from({ length: 120 }, () => now - 1_000));

    const first = await limiter.admitConditionalDualWindow(keys, LIMITS, now);
    expect(first).toMatchObject({ admitted: false, burstEpisodeNew: true, burstSuppressed: 0 });
    const later = [];
    for (let i = 1; i <= 3; i++) later.push(await limiter.admitConditionalDualWindow(keys, LIMITS, now + i));
    expect(later.map((r) => [r.burstEpisodeNew, r.burstSuppressed])).toEqual([
      [false, 1],
      [false, 2],
      [false, 3],
    ]);
    // The marker lives exactly until the oldest entry leaves the window.
    const ttl = await redis.pttl(keys.burstMarker);
    expect(ttl).toBeGreaterThan(TEN_MIN - 1_000 - 5_000);
    expect(ttl).toBeLessThanOrEqual(TEN_MIN - 1_000);
  });

  it("the marker expires when the window has room; the next request is admitted and a later breach opens a new episode", async () => {
    const keys = freshKeys();
    const now = Date.now();
    // Oldest entry leaves the burst window in ~300 ms of real time.
    await seed(keys.burst, [now - TEN_MIN + 300, ...Array.from({ length: 119 }, () => now)]);

    const breach = await limiter.admitConditionalDualWindow(keys, LIMITS, now);
    expect(breach).toMatchObject({ admitted: false, burstEpisodeNew: true });
    expect(await redis.exists(keys.burstMarker)).toBe(1);

    await new Promise((r) => setTimeout(r, 450));
    expect(await redis.exists(keys.burstMarker)).toBe(0);

    const admitted = await limiter.admitConditionalDualWindow(keys, LIMITS, Date.now());
    expect(admitted.admitted).toBe(true);
    const nextBreach = await limiter.admitConditionalDualWindow(keys, LIMITS, Date.now());
    expect(nextBreach).toMatchObject({ admitted: false, burstEpisodeNew: true, burstSuppressed: 0 });
  });

  it("the oldest scores give a Retry-After of at least 1 s at the window edge, and the exact wait elsewhere", async () => {
    const keys = freshKeys();
    const now = 1_800_000_000_000;
    // Edge: the oldest entry leaves in 1 ms.
    await seed(keys.burst, [now - TEN_MIN + 1, ...Array.from({ length: 119 }, () => now - 1)]);
    const edge = await limiter.admitConditionalDualWindow(keys, LIMITS, now);
    expect(edge.admitted).toBe(false);
    expect(edge.burstOldestMs).toBe(now - TEN_MIN + 1);
    expect(limiter.retryAfterSeconds({ count: edge.burstCount, oldestEntryMs: edge.burstOldestMs }, now, TEN_MIN)).toBe(1);

    const keys2 = freshKeys();
    await seed(keys2.burst, [now - 290_000, ...Array.from({ length: 119 }, () => now)]);
    const mid = await limiter.admitConditionalDualWindow(keys2, LIMITS, now);
    expect(limiter.retryAfterSeconds({ count: mid.burstCount, oldestEntryMs: mid.burstOldestMs }, now, TEN_MIN)).toBe(310);
  });
});
