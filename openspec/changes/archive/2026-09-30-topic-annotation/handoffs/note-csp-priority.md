Target: NEW issue (no existing CSP issue found; searched open and closed issues for "CSP", "content security policy", "Content-Security-Policy" on 2026-09-30. `app.ts` registers helmet with `contentSecurityPolicy: false // Deferred to a separate change`, which has no tracked issue.)

## Enable a Content-Security-Policy (priority raised by team definitions)

`packages/backend/src/app.ts` disables helmet's CSP ("Deferred to a separate change"). No issue tracks that deferral.

topic-annotation (#53) adds the first **team-authored free text that will be shown to every participant** in a live session: the team definition, once #57/#56 render `currentTopic.topicAnnotation`. Until a CSP exists, React's escaping is the only XSS control for that text. The session-display ACs on #56/#57 require plain-text rendering (no `dangerouslySetInnerHTML`, no Markdown/HTML, no `href`/`src`/`style` from the text), but a single regression there would have no second line of defence.

**Proposed:** prioritise a baseline CSP (at minimum `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`) before #57 ships, and verify it against the Vite build and the WebSocket origin.
