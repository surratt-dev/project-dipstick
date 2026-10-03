## ADDED Requirements

### Requirement: A rate-limited or temporarily unavailable topic write reads as a pause, not a failure, and keeps the facilitator's input

When any topic-write request from the Topic Management screen (add, archive pre-flight, archive confirm, restore, reorder save, definition save or clear) receives `429` with `error.code` `TOPIC_WRITE_BURST_LIMIT_EXCEEDED` or `TOPIC_WRITE_DAILY_LIMIT_EXCEEDED`, or `503` with `TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE`, the screen SHALL show the message in the error region that control already uses: the archive/restore confirmation's error area, the reorder save-error region, the definition editor's error area or the add form's error area. It SHALL NOT add a page-wide banner. It SHALL NOT replace the screen with the page-level load error.

The screen SHALL choose rate-limit copy by `error.code`, not by matching text in the server's message. For a `429` with `TOPIC_WRITE_BURST_LIMIT_EXCEEDED` and a parseable `Retry-After`, the screen SHALL show the burst message from the shared constant that the backend also uses (`@dipstick/shared`), with "a few minutes" replaced by "about N minutes", where N is `ceil(Retry-After / 60)`, minimum 1, with "minute" in the singular when N is 1. When `Retry-After` is missing or unparseable, the server's `error.message` SHALL be shown unchanged. Reading `Retry-After` SHALL NOT throw when the response has no headers. A daily `429` and the `503` SHALL show the server's `error.message` unchanged. The screen SHALL never show raw seconds and SHALL NOT retry automatically.

Unsaved input SHALL survive the response: add-form fields, the reorder draft (still marked unsaved, Save order enabled) and the definition editor text SHALL be kept. Restores and archives are separate single-topic actions, each with its own confirmation, and each successful one triggers the screen's existing post-write refetch. When a `429` or `503` arrives on the k-th of a series of such actions, the topics changed by the k−1 earlier actions SHALL still be shown as changed, and the failing action's confirmation SHALL show the message in its error area.

On the archive `?confirm=true` call, a `429` or `503` SHALL keep the escalated confirmation (the `awaiting_open_items_confirmation` state) open, with its open-action-items list, and show the message in an error field of that state. This is a new UI state: today any non-OK confirm response moves to the generic error state and drops the list.

#### Scenario: Burst limit on restore shows minutes in the restore dialog's error area
- **WHEN** a restore receives `429 TOPIC_WRITE_BURST_LIMIT_EXCEEDED` with `Retry-After: 290`
- **THEN** the restore confirmation's error area shows "You've made a lot of topic changes in a short time. Changes so far are saved. Please wait about 5 minutes and try again."
- **AND** no page-wide banner appears and no request is retried automatically

#### Scenario: Missing Retry-After keeps "a few minutes"
- **WHEN** a reorder save receives `429 TOPIC_WRITE_BURST_LIMIT_EXCEEDED` without a `Retry-After` header
- **THEN** the save-error region shows the server's message containing "a few minutes"
- **AND** the draft remains displayed, marked unsaved, with Save order enabled

#### Scenario: Definition text survives a 429
- **WHEN** a definition save receives `429`
- **THEN** the editor stays open with the typed text and shows the rate-limit message

#### Scenario: Add form input survives a 503
- **WHEN** an add submission receives `503 TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE`
- **THEN** the add form stays open with every typed field intact and shows "Topic changes are temporarily unavailable. This change wasn't saved; changes you made earlier are kept. Please try again shortly."

#### Scenario: Limited part-way through a series of restores
- **WHEN** a facilitator restores k−1 topics one after another through single restore confirmations, each succeeding and refetching the list, and the k-th restore receives `429`
- **THEN** the k-th restore's confirmation shows the rate-limit message, which states that changes so far are saved, in its error area
- **AND** the active list still shows the k−1 restored topics and the archived list no longer shows them

#### Scenario: Archive confirm call limited
- **WHEN** the `?confirm=true` archive call receives `429`
- **THEN** the escalated confirmation stays open and shows the rate-limit message in its error area
- **AND** the open-action-items list is still shown and Confirm is enabled
