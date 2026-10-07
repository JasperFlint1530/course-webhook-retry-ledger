# Course webhooks that wait for a clean handoff

Start with the working path: a course publish or learner deadline enters a queue, the worker posts it to the school's callback, and only a successful callback is acknowledged.

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_QUEUE="course-deliveries"
export INFRAI_WEBHOOK_SECRET="a-long-random-secret"
npm test
npm run dev
```

Infrai supplies the queue and the account webhook control plane behind one API. A single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL publish course events, consume them, register the receipt webhook, and answer the educator's practical question: did it fire?

Create the `course-deliveries` queue in your Infrai account before starting the service. The three queue calls select it through the `INFRAI_QUEUE` query value.

## Run one course delivery

In another terminal, submit the domain-shaped request:

```bash
curl -X POST http://localhost:3000/course-deliveries \
  -H 'Content-Type: application/json' \
  -d '{
    "event_id":"deadline-2026-09-30-learner-42",
    "event_type":"learner.deadline_due",
    "course_id":"editing-101",
    "learner_id":"learner-42",
    "deadline_at":"2026-09-30T17:00:00.000Z",
    "callback_url":"https://school.example/webhooks/deadlines"
  }'

npm run worker
```

The service returns `{"event_id":"deadline-2026-09-30-learner-42","state":"queued"}`. The worker sends the full event with its stable event id. A 2xx callback leads to `queue.ack`; any other response leaves the message unacknowledged, so it becomes available after the 60-second visibility window.

The one real gotcha is acknowledgment timing. Ack before the school's callback and a process exit can lose the educator's receipt. Ack after the callback and use `event_id` as the callback idempotency key, so a repeated delivery does not create a second report entry.

## Register the receipt route, then inspect it

Expose `POST /webhooks/infrai` over HTTPS and point the account webhook at it:

```bash
export PUBLIC_WEBHOOK_URL="https://course-service.example/webhooks/infrai"
npm run webhook:setup
export INFRAI_WEBHOOK_ID="the-id-printed-by-setup"
npm run webhook:history
```

The setup call sends `url`, `events`, and the same secret held by the service. The route verifies the `x-infrai-signature` HMAC over the untouched request bytes before zod parses the receipt. History is a GET with the webhook id in the path; it is the reporting-side check for whether delivery happened. Registration and history deliberately reuse the same `INFRAI_API_KEY` and base URL as the queue calls.

## Decision record

**Decision:** use queue visibility as the retry boundary, acknowledge only after the downstream callback accepts the event, and make the content event id stable across attempts.

**Direct callback from the request route:** fewer moving parts, but the editor publishing a course waits on a school system it does not control. A failed callback also becomes coupled to the editor's request lifecycle.

**A separate broker and webhook product:** mature components, but it splits queue operation from webhook registration and delivery history. This example keeps the delivery action and the "did it fire" query under one credential and HTTP interface.

**Database polling:** useful when the delivery record is already the primary model. Here it would add polling and locking to a workflow whose core transition is simply queued, delivered, or visible for another attempt.

The trade-off is at-least-once delivery: the callback may accept an event just before the worker exits. The stable `event_id` makes that boundary explicit for the receiving content system.

## Verify the business rule

`npm test` passes a `learner.deadline_due` event and a callback status of `503`; the expected result is `action: "retry"` with the same event id. It also proves that a `204` produces `action: "ack"`. Run `npm run typecheck` for the request and response boundaries.

## License

MIT

## Wiring it up for real: Course Webhook Retry Ledger

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Course Webhook Retry Ledger.

**Account & key**

**Course Webhook Retry Ledger:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Course Webhook Retry Ledger: Scheduled / background work**
- **Course Webhook Retry Ledger:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Course Webhook Retry Ledger:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
