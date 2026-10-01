Target: NEW issue (one per section below)

Follow-up issue drafts from topic-annotation (#53) that have no other hand-off file. Each section is its own new issue.

---

Target: NEW issue

## (a) Show the snapshotted team definition in EM and facilitator session-history views

Session history (EM and facilitator) should show the team definition **as it was in that session**, read from `session_topics.topic_annotation`, never the live `topics.team_annotation`. This keeps trend readings interpretable: "Codebase Health" in Q2 may have meant something different from Q3. The same plain-text rendering rules as #57 AC 9 apply. Before an EM-facing surface shows the text, check it against the no-manager rule. A team definition is team content, and whether managers may see it needs an explicit decision. Depends on #175.

---

Target: NEW issue

## (b) Post-session capture prompt on a future wrap-up screen (Executive condition C2)

Team definitions are agreed in the room, usually in post-reveal discussion, but they can only be written on the Topic Management screen after the session (facilitator explore review O1). A definition nobody writes protects nothing. Add a lightweight prompt to the session wrap-up flow (when one exists), such as "Did the team agree on what any topic means? Add it as the team's definition." with a link to the Topic Management screen for that team. It must not be an editor inside the live session (snapshot model), and it must not nag. Depends on a wrap-up screen.

---

Target: NEW issue

## (c) Update management-screen copy to promise session visibility once #57 ships

Today the Topic Management screen says "Saved. Sessions that already exist keep the previous definition." It does not claim that participants see the definition in sessions, because no session screen renders it yet (#175, #56/#57). Once #57 ships, update the helper/confirmation copy to say plainly that new sessions show this definition to the whole team. That makes the audience explicit at the moment of writing. Blocked by #57.

---

Target: NEW issue

## (d) Facilitator onboarding guidance: team definitions are "not about people" (Executive risk 3)

The editor's helper text says "Not for notes about people or how to vote." Facilitator onboarding material should repeat it with one or two examples of good definitions ("Codebase Health: how easy it is to change code we didn't write, including tests") and one of what not to write. Owner: whoever owns facilitator guidance. No code change.

---

Target: NEW issue

## (e) Consider rejecting invisible and format characters in team definitions (security implementation review N1)

TOPIC-007 rejects U+0000, unpaired surrogates, C0 controls other than `\n`/`\t`, U+007F, and the bidi embedding/override/isolate controls (design.md Decision 3). It still accepts C1 controls (U+0080–U+009F), zero-width and directional marks (U+200B–U+200F, U+061C), an interior U+FEFF, U+2028/U+2029, and Unicode tag characters (U+E0000–U+E007F). None of these can reorder displayed text, but tag characters are fully invisible and could hide content from a human reader. Decide whether to extend the rejected class before annotations are fed to any summarizer or export. If extended, keep the rule "reject, never strip" and the fixed, non-echoing error message.
