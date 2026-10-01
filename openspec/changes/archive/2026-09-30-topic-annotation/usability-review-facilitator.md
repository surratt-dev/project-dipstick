# Usability Review: Team Definition Editor (Facilitator)

**Reviewer:** Priya Nair (Facilitator, SME), persona review
**Reviewed:** the editor as built on `agent-team/53-topic-annotation` (`TopicManagementPage.tsx`, walked through via its component tests and markup)
**Method:** Persona walkthrough of the branch's code and test scenarios. This was not a live usability session and is not a merge gate (tasks.md 8.7).
**Lens:** Can I capture the team's wording after a session quickly, without losing it, and without the screen inviting the wrong kind of text?

---

## What I walked through

1. Open Topic Management for a team I facilitate after its third session. Add a definition to "Codebase Health" from my notes.
2. Fix a typo in an existing definition that another facilitator wrote.
3. Clear a definition the team said no longer fits.
4. Start a definition, get interrupted, and try to reorder topics or remove one.
5. View the same screen on a team that hasn't finished its first session, and as an admin colleague would see it.

## Findings

### Label: "Our team's definition" works

It reads as the team's words, not mine and not an admin's. "Add team definition" on an empty row is clear about what will happen. I never see the word "annotation", which is right: nobody on a team would call it that.

### Helper text sets the right expectation

"What this topic means for this team, in the team's words. Not for notes about people or how to vote." is short enough that people will actually read it, and the second sentence is the one that matters. I'd keep it exactly as is. Onboarding guidance should repeat the "not about people" point (already a follow-up).

### Clear-confirm is in the right place, and only there

The inline "Remove this team's definition? This can't be undone." appears only when I'm about to wipe something that exists. Fixing a typo saves straight away with no prompt, which is what I want: a confirm on every edit would teach me to click through confirms. Cancel puts me back in the editor with my text, so it doesn't punish a misclick.

### Provenance placement is right

"Last edited Sep 30, 2026 by Dana Ruiz" sits directly under the text, muted. When I pick up a team from another facilitator, this is the line that tells me whether the wording is fresh or stale, and who to ask. It stays visible while I edit, so I can see what I'm replacing. That matters because there is no undo.

### "Saved. Sessions that already exist keep the previous definition."

Good. This is the one thing I'd otherwise get wrong: editing on Monday for a session already created for Thursday. The message tells me exactly what happens. It stays until I do something else on that row, so I don't miss it if I look away.

### My words are protected

- If the save fails, my text stays in the box with the server's message. I can copy it.
- If I start a definition and then go to reorder or remove a topic, those controls are disabled with "Save or cancel your definition changes first." That's the right call. I'd rather be told to finish than lose a sentence the team agreed on.
- If I click Edit on a second topic while the first has unsaved text, I'm sent back to the first one with "Save or cancel this definition first." Nothing is lost.
- Closing the tab with unsaved text gets the browser's prompt.

### Locked and admin views are calm

On a team before its first session, the lock notice now ends with "Team definitions can be added after the team's first session." That answers the question before I ask it. Admins see definitions and who wrote them but get no edit control, which avoids offering a button that would only fail.

## Minor suggestions (not blocking)

1. **Counter colour.** The `n / 500` counter turns red at the limit with "500 character limit reached." That's fine. In practice I'd expect definitions to be one or two sentences, far from 500, so this will rarely show.
2. **Where the editor opens.** The editor appears under the existing definition, above the description. On a long list on a laptop, the Save button can sit below the fold for the last row. Not a problem at today's topic counts. Worth checking if teams grow to 15+ topics.
3. **Capture timing.** The real gap is still that definitions get agreed in the room and written down later (my exploration review O1). This screen is the right place to write them, but the post-session capture prompt follow-up is what will make people actually do it.

## Verdict

The editor does what a facilitator needs: it's quick for the routine case, asks only when I'm about to destroy something, keeps my words when anything goes wrong, and shows me who last touched the definition. No changes requested before merge.
