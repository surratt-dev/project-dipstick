import { randomUUID } from "node:crypto";
import { redis } from "../redis.js";

// ---------------------------------------------------------------------------
// Shared Redis sliding-window rate-limit mechanism.
//
// harden-topic-write-endpoints (#184) design.md Decision 1. Two scripts live
// here, and they are DELIBERATELY different -- do not "harmonise" them:
//
//   SLIDING_WINDOW_LUA (TEAM-006, moved byte-for-byte from routes/teams.ts,
//   task 4.1): trim, ZADD, then count. The caller compares `count > LIMIT`,
//   so every request -- including one about to be rejected -- is recorded.
//   TEAM-006 counts its rejections on purpose (admin-only, low volume).
//
//   CONDITIONAL_DUAL_WINDOW_LUA (topic writes, task 4.2): trim and count two
//   windows, and ZADD to both ONLY IF `burstCount < burstLimit AND
//   dailyCount < dailyLimit`, tested BEFORE the add. A rejected request is
//   not recorded, so a facilitator who clicks again on a 429 does not push
//   their own wait further out (Decision 4). Swapping either comparison for
//   the other script's would be an off-by-one.
//
// The scripts return mechanism only. Callers choose codes, messages and
// Retry-After (Decision 7a).
//
// Importers are allow-listed by a structural test (task 5.7): this module
// may be imported only by routes/teams.ts, routes/topic-write-rate-limit.ts
// and tests -- never by session, voting or WebSocket runtime code.
// ---------------------------------------------------------------------------

// Atomically: drop entries older than the window, record this request, and
// return the resulting count plus the oldest surviving entry's timestamp
// (used to compute a precise Retry-After). PEXPIRE bounds how long an idle
// key lingers in Redis once an actor stops making requests.
export const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local member = ARGV[3]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
local count = redis.call('ZCARD', key)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestScore = now
if oldest[2] then
  oldestScore = oldest[2]
end
return {count, oldestScore}
`;

export interface SlidingWindowResult {
  count: number;
  oldestEntryMs: number;
}

export async function recordAndCountSlidingWindow(
  key: string,
  nowMs: number,
  windowMs: number,
): Promise<SlidingWindowResult> {
  const member = `${nowMs}-${crypto.randomUUID()}`;
  const result = (await redis.eval(
    SLIDING_WINDOW_LUA,
    1,
    key,
    nowMs,
    windowMs,
    member,
  )) as [number | string, number | string];

  return {
    count: Number(result[0]),
    oldestEntryMs: Number(result[1]),
  };
}

export function retryAfterSeconds(
  window: SlidingWindowResult,
  nowMs: number,
  windowMs: number,
): number {
  return Math.max(1, Math.ceil((window.oldestEntryMs + windowMs - nowMs) / 1000));
}

// ---------------------------------------------------------------------------
// CONDITIONAL_DUAL_WINDOW_LUA — topic-write limiter (#184 Decision 1, task 4.2)
//
// KEYS[1] burst window ZSET      KEYS[3] burst breach-episode marker
// KEYS[2] daily window ZSET      KEYS[4] daily breach-episode marker
// ARGV: now, burstWindowMs, burstLimit, dailyWindowMs, dailyLimit, member
//
// One EVAL, so admission, recording and episode detection are atomic:
//   1. Trim both windows (entries with score <= now - window leave).
//   2. Count both. For each window that has room, DEL its marker: the episode
//      on that window has ended (it normally expired by TTL already; this
//      keeps the "episode ends when the window has room" rule exact even
//      under clock skew between app servers).
//   3. Admit iff burstCount < burstLimit AND dailyCount < dailyLimit (tested
//      BEFORE the add). On admit: ZADD the same member to both and PEXPIRE
//      both to their window length.
//   4. On reject: nothing is added and the window TTLs are NOT refreshed.
//      For each window at its limit: SET marker 1 NX PX <oldest + window -
//      now>. If the SET succeeds this 429 opens a new breach episode on that
//      window (...EpisodeNew = 1). If the marker already exists, INCR it
//      (INCR keeps the TTL) and report how many 429s in this episode have
//      been suppressed from the audit table so far (INCR result - 1, so the
//      first suppressed 429 reports 1). The marker expires exactly when the
//      window next has room, which ends the episode (security C1).
//
// Returns {admitted, burstCount, burstOldestMs, dailyCount, dailyOldestMs,
//          burstEpisodeNew, dailyEpisodeNew, burstSuppressed, dailySuppressed}
// with counts AFTER the add when admitted. An empty window reports
// oldest = now.
// ---------------------------------------------------------------------------
export const CONDITIONAL_DUAL_WINDOW_LUA = `
local now = tonumber(ARGV[1])
local burstWindow = tonumber(ARGV[2])
local burstLimit = tonumber(ARGV[3])
local dailyWindow = tonumber(ARGV[4])
local dailyLimit = tonumber(ARGV[5])
local member = ARGV[6]

local function oldestScore(key)
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if oldest[2] then
    return tonumber(oldest[2])
  end
  return now
end

local function breach(markerKey, oldest, window)
  local ttl = oldest + window - now
  if ttl < 1 then
    ttl = 1
  end
  if redis.call('SET', markerKey, 1, 'NX', 'PX', ttl) then
    return 1, 0
  end
  return 0, redis.call('INCR', markerKey) - 1
end

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - burstWindow)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - dailyWindow)
local burstCount = redis.call('ZCARD', KEYS[1])
local dailyCount = redis.call('ZCARD', KEYS[2])

if burstCount < burstLimit then
  redis.call('DEL', KEYS[3])
end
if dailyCount < dailyLimit then
  redis.call('DEL', KEYS[4])
end

if burstCount < burstLimit and dailyCount < dailyLimit then
  redis.call('ZADD', KEYS[1], now, member)
  redis.call('ZADD', KEYS[2], now, member)
  redis.call('PEXPIRE', KEYS[1], burstWindow)
  redis.call('PEXPIRE', KEYS[2], dailyWindow)
  return {1, burstCount + 1, oldestScore(KEYS[1]), dailyCount + 1, oldestScore(KEYS[2]), 0, 0, 0, 0}
end

local burstOldest = oldestScore(KEYS[1])
local dailyOldest = oldestScore(KEYS[2])
local burstNew, burstSuppressed, dailyNew, dailySuppressed = 0, 0, 0, 0
if burstCount >= burstLimit then
  burstNew, burstSuppressed = breach(KEYS[3], burstOldest, burstWindow)
end
if dailyCount >= dailyLimit then
  dailyNew, dailySuppressed = breach(KEYS[4], dailyOldest, dailyWindow)
end
return {0, burstCount, burstOldest, dailyCount, dailyOldest, burstNew, dailyNew, burstSuppressed, dailySuppressed}
`;

export interface DualWindowKeys {
  burst: string;
  daily: string;
  burstMarker: string;
  dailyMarker: string;
}

export interface DualWindowLimits {
  burstLimit: number;
  burstWindowMs: number;
  dailyLimit: number;
  dailyWindowMs: number;
}

export interface DualWindowResult {
  admitted: boolean;
  burstCount: number;
  burstOldestMs: number;
  dailyCount: number;
  dailyOldestMs: number;
  burstEpisodeNew: boolean;
  dailyEpisodeNew: boolean;
  burstSuppressed: number;
  dailySuppressed: number;
}

/**
 * Typed wrapper around CONDITIONAL_DUAL_WINDOW_LUA. `nowMs` is injectable
 * (default Date.now()) so counting tests can drive the windows without fake
 * timers; production passes the app server's clock, as TEAM-006 does.
 * Rejects if Redis errors; the caller decides what that means (the topic
 * limiter fails closed, Decision 6) and bounds the wait itself.
 */
export async function admitConditionalDualWindow(
  keys: DualWindowKeys,
  limits: DualWindowLimits,
  nowMs: number = Date.now(),
): Promise<DualWindowResult> {
  const member = `${nowMs}-${randomUUID()}`;
  const r = (await redis.eval(
    CONDITIONAL_DUAL_WINDOW_LUA,
    4,
    keys.burst,
    keys.daily,
    keys.burstMarker,
    keys.dailyMarker,
    nowMs,
    limits.burstWindowMs,
    limits.burstLimit,
    limits.dailyWindowMs,
    limits.dailyLimit,
    member,
  )) as Array<number | string>;

  return {
    admitted: Number(r[0]) === 1,
    burstCount: Number(r[1]),
    burstOldestMs: Number(r[2]),
    dailyCount: Number(r[3]),
    dailyOldestMs: Number(r[4]),
    burstEpisodeNew: Number(r[5]) === 1,
    dailyEpisodeNew: Number(r[6]) === 1,
    burstSuppressed: Number(r[7]),
    dailySuppressed: Number(r[8]),
  };
}
