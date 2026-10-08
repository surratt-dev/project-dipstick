import type { TopicLockReason } from "@dipstick/shared";
import { hasCompletedFirstSession } from "./topic-lock-helper.js";
import { isTemplateTeam } from "../teams/template-team-guard.js";

// ---------------------------------------------------------------------------
// getTopicLockState(teamId) — template-team-not-usable (#214), design.md D6.
//
// The one lock-state function TOPIC-001 and TOPIC-002 (content.ts) both call,
// so isCustomizationLocked and lockReason can never disagree between them.
//
// The __default_topics__ template team holds the canonical default topics:
// it is locked with reason "canonical_defaults", without consulting session
// history (the template can have none, and frozen history must not unlock
// it). Every other team delegates, unchanged, to hasCompletedFirstSession.
//
// Deliberately NOT inside topic-lock-helper.ts: that file must stay
// template-agnostic (topic-customization-lock "The lock-check function stays
// template-agnostic"; a source test enforces it), and tests mock it as a
// whole module. The topic-write lock path (topics.ts) keeps calling
// hasCompletedFirstSession directly, because #188's guard refuses the
// template before the lock runs.
// ---------------------------------------------------------------------------
export async function getTopicLockState(
  teamId: string,
): Promise<{ isCustomizationLocked: boolean; lockReason: TopicLockReason }> {
  if (isTemplateTeam(teamId)) {
    return { isCustomizationLocked: true, lockReason: "canonical_defaults" };
  }
  const unlocked = await hasCompletedFirstSession(teamId);
  return unlocked
    ? { isCustomizationLocked: false, lockReason: null }
    : { isCustomizationLocked: true, lockReason: "first_session" };
}
