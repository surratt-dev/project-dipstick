# Persona: Security Analyst

## Identity

**Name:** Tomás Ferreira
**Title:** Senior Application Security Analyst
**Reports To:** Director of Information Security
**Scope:** Application security reviews across all internally developed software; primary subject matter expert for web application security and identity provider integrations

---

## Background

Tomás has been in application security for eleven years, the first four as a developer who got increasingly interested in how his own code could be broken. He holds a handful of certifications he rarely mentions and a mental catalog of breach post-mortems he references constantly. He has done penetration testing, threat modeling, code review, and incident response — enough of each to know where theory and practice diverge.

His most formative experience was a security incident at a previous employer involving an internal tool that had been in production for three years with essentially no security review. The tool was "just internal," used by maybe forty employees, handling nothing customer-facing. It was also storing session tokens in plaintext, logging full request bodies including authentication headers, and running with overprivileged service account credentials that had never been rotated. The attacker who found it didn't care that it was internal. They used it as a pivot point to reach systems that were customer-facing. Tomás spent six weeks on the incident response. He has not forgotten it.

He joined this company's security team two years ago, specifically to build out the application security review practice. He is now the person every engineering team goes through before a new application reaches production. He is methodical, not theatrical — he does not enjoy finding vulnerabilities for sport, he enjoys ensuring they are not there to find.

---

## Motivations

### "Internal" Is a Trust Boundary, Not a Risk Exemption

Tomás's foundational position — the one he will state plainly to anyone who implies otherwise — is that internal applications are not a lower-risk category, they are a different-risk category. External applications are attacked by strangers; internal applications are attacked by compromised credentials, malicious insiders, and lateral movement from other compromised systems. The attack surface is different. The threat model is different. The controls need to be designed accordingly, not skipped because the user count is small.

### Identity Provider Integrations Done Right

OIDC and OAuth2 are well-specified protocols with well-understood failure modes. They are also consistently misimplemented in ways that are hard to spot in code review and devastating in practice: token validation that skips signature verification, redirect URIs that are too permissive, refresh token handling that creates persistent session exposure, claims that are trusted without being verified. Tomás has seen all of these. An application that delegates authentication to an external identity provider is only as secure as the integration it builds around that delegation. He reviews these integrations with particular care.

### Authorization Enforced Where It Cannot Be Bypassed

He has reviewed enough applications to know that UI-layer access control is not access control — it is UX. The data it hides is still returned by the API; anyone with a browser dev tool or a curl command can see it. Authorization must be enforced at the API layer, independently of what the frontend chooses to render. On an application where some users explicitly should not see other users' data — and this application has exactly that requirement — a failure in server-side authorization is not a minor finding.

### Auditability as a Security Control

Tomás treats audit logging as a security control, not an operational nicety. When something goes wrong — a data access that shouldn't have happened, a session that behaved unexpectedly, a permission that was exercised in a suspicious pattern — the audit log is how you reconstruct what happened. An application without meaningful audit logging is an application where incidents are harder to detect, harder to scope, and harder to explain to anyone who asks afterward.

### Secure Defaults That Don't Require Discipline to Maintain

The security controls Tomás trusts most are the ones that do not depend on developers remembering to do the right thing. A framework that validates tokens automatically is more reliable than a developer who validates tokens manually. A configuration that requires explicit opt-out from secure headers is more reliable than one that requires opt-in. He looks for these patterns in every review, and he flags their absence as a finding.

---

## Relationship to the Project

Tomás conducts a formal security review of every new internal application before it reaches production. For this application, he was engaged during the design phase — earlier than he often is — because the authentication integration and the real-time session architecture both warranted early input. He has reviewed the tech stack recommendation and the web application proposal and has a preliminary set of findings he will carry into a formal threat modeling session with the implementation team.

He is not a member of the implementation team and does not attend sprint ceremonies. He is available for consultation during development, particularly on authentication implementation and the authorization model, and will conduct a pre-production security review before the application goes live with any team.

The security properties he is most focused on:

- **Token validation:** The OIDC integration must validate ID token signatures, expiry, audience, and issuer on every request. Claims must not be trusted without verification. He will review the specific library being used and how it is configured.
- **Server-side authorization:** Every API endpoint must enforce authorization independently. The fact that the frontend does not render certain data to certain users is not a substitute. He will test this directly.
- **WebSocket authentication:** A WebSocket connection established after authentication does not remain authorized automatically. The application must validate that the connected user is still authorized for the session at meaningful intervals, not only at connection time.
- **Session data sensitivity:** Votes, trends, and action items are sensitive within the organization. The application must apply appropriate data classification, ensure this data is not logged unnecessarily, and ensure it is not accessible via unprotected endpoints or misconfigured CORS policies.
- **Secrets management:** Database credentials, Redis connection strings, and any identity provider client secrets must be managed as secrets — not hardcoded, not in environment files checked into source control, not logged. He will verify this in the deployment configuration.
- **Dependency hygiene:** Third-party dependencies are an attack surface. He expects a process for tracking known vulnerabilities in the application's dependency tree, not a one-time review at launch.

He does not have opinions on the domain model, the ritual, or the UX. His scope is the security posture of the system.

---

## Success Criteria

Tomás will consider this project successful when:

1. The threat model produced during design is revisited against the implemented application before production deployment — not treated as a one-time artifact
2. The OIDC integration is reviewed against the specification and found to correctly validate all required claims and handle token expiry and revocation appropriately
3. Server-side authorization is verified independently of the frontend, and no endpoint returns data that the requesting user is not authorized to see
4. The application has a defined data retention and deletion policy, and that policy is implemented — not deferred
5. There is a process for dependency vulnerability tracking that does not require a human to remember to run it

---

## Concerns and Risks

- **"It's just an internal app" becomes the answer to every security question.** Tomás has heard this phrase used to justify skipping token validation, omitting audit logging, hardcoding credentials, and using self-signed certificates in production. He will not accept it as a rationale for any of these things. The application stores data that employees have a reasonable expectation will be kept within defined access boundaries. That expectation is a security obligation.
- **The WebSocket connection is not re-authorized after establishment.** A long-lived WebSocket connection opened at session start may outlast the user's authorization — if a user's access is revoked mid-session, or if a token expires, the connection may remain open and functional. He wants explicit handling for this case.
- **The real-time architecture creates new logging gaps.** Application logs for HTTP requests are well-understood. WebSocket event logs often are not. He wants to confirm that security-relevant events over the WebSocket channel — joins, vote submissions, reveals — are captured in the audit log with the same fidelity as HTTP events.
- **The identity provider abstraction is tested for correctness but not for security.** A provider swap is a configuration change, per the tech stack design. Tomás wants confirmation that the security controls — particularly token validation — are verified against the new provider configuration, not assumed to carry over automatically.
- **Secrets land in source control before anyone notices.** This happens on almost every project that doesn't have automated secret scanning in the CI pipeline. He will recommend a scanner be added before the first commit reaches the repository's main branch.
