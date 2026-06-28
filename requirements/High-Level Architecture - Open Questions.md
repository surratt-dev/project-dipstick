# Open Questions — Engineering Health Check: High-Level Architecture

*Each item requires a decision before the relevant component is implemented.*

---

## Real-Time Layer

### 1. Reveal latency bound
> What is the acceptable latency bound for the simultaneous reveal? All participants must receive the reveal event within some window — what is that window, and how is it tested?
> — Marcus Oyelaran

**Answer:**

15 seconds will be acceptable.  We can test it by having the reveal event include a server side timestamp of when the event was created.  The client side will use that timestamp to calculate a latency.  

---

### 2. Facilitator disconnection behavior
> What is the defined behavior when the facilitator disconnects mid-session? Is the session paused? Can a co-facilitator take over? Who can un-pause it?
> — Ingrid Sollenberger

**Answer:**

Since the session was created by the when they reconnect and are authenticated, they will be able to rejoin the session they created.

---

### 3. Redis unavailability recovery
> What is the recovery path when Redis is unavailable mid-session? Is the session abandoned? Are partially submitted votes preserved?
> — Marcus Oyelaran

**Answer:**

Use a back off retry mechanism on the server sideto write to votes to redis.  If redis  is unavailable for 5 minutes, the session will be abandoned.
---

## Authentication

### 4. Session cookie expiry and OIDC token refresh
> What is the session cookie expiry period? What is the OIDC token refresh strategy for sessions that span longer than the token lifetime?
> — Tomás Ferreira

**Answer:**

I'm not familair with this problem space or technolofy.  recommend a practice or setting to resolve this question.  The session should normally be approxiatelmy 30 minutes, but we need to accomodite an 90 minute session.

---

### 10. OIDC provider availability in test environment
> Will a second OIDC provider be available in a test environment for verifying the abstraction layer before production, or does this need to be simulated?
> — Tomás Ferreira, Ingrid Sollenberger

**Answer:**

Use a similuated OIDC provider for all local / development machine testing.  We will only integrate with real providrs in deployed environments (QA, Prod, etc)

---

## Data Architecture

### 5. Outlier detection thresholds
> What are the outlier detection thresholds — individual outlier and trend outlier — and are they configurable at deployment time or at team configuration time?
> — Marcus Delgado

**Answer:**

an outlier will be considered a deviatio of plus or minus 1.5 the average

trend outliers are out of scope at this time

---

### 6. Data retention policy
> What is the data retention policy for session data, votes, and action items? Is there a defined deletion timeline?
> — Tomás Ferreira

**Answer:**

15 months / 5 quarters

---

### 9. Trend dashboard empty states
> What is the "zero sessions" and "one session" state for the trend dashboard? How does the UI present trend charts before there is sufficient data to make them meaningful?
> — Marcus Delgado

**Answer:**

when there is insufficient data present a blank graph with the text "insufficient data" as a placeholder 

---

## Deployment

### 7. Secrets management mechanism
> What secrets management mechanism is available in the target deployment environment? (Vault, cloud secrets manager, environment injection via orchestration layer?)
> — Marcus Oyelaran

**Answer:**

secrets will be injected as environment variables at start up

---

### 8. Confirmed deployment target
> Is Docker Compose the confirmed deployment target for the first production deployment, or is a managed orchestration layer already in scope?
> — Ingrid Sollenberger

**Answer:**

deployment environment will be k8s

---
