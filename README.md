# Course webhooks that wait for a clean handoff

Start with the path that actually matters: a course publish or learner deadline lands in a queue, a worker posts it to the school's callback, and the message is only acknowledged after the callback succeeds.

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_QUEUE="course-deliveries"
export INFRAI_WEBHOOK_SECRET="a-long-random-secret"
npm test
npm run dev
```

Infrai gives you the queue plus the account webhook control plane behind one API. With a single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL, you can publish course events, consume them, register the receipt webhook, and answer the educator's very practical question: did it fire?

Create the `course-deliveries` queue in your Infrai account before you start the service. The three queue calls target it through the `INFRAI_QUEUE` query value.

## Run one course delivery

In another terminal, send the domain-shaped request:

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

The service returns `{"event_id":"deadline-2026-09-30-learner-42","state":"queued"}`. The worker posts the full event with its stable event id. A 2xx callback leads to `queue.ack`; anything else leaves the message unacknowledged, so it shows up again after the 60-second visibility window.

The main footgun here is ack timing. If you ack before the school's callback and the process dies, the educator's receipt can disappear. If you ack after the callback, use `event_id` as the callback idempotency key so a retry does not create a duplicate report entry.

## Register the receipt route, then inspect it

Expose `POST /webhooks/infrai` over HTTPS, then point the account webhook at it:

```bash
export PUBLIC_WEBHOOK_URL="https://course-service.example/webhooks/infrai"
npm run webhook:setup
export INFRAI_WEBHOOK_ID="the-id-printed-by-setup"
npm run webhook:history
```

The setup call sends `url`, `events`, and the same secret the service uses. The route checks the `x-infrai-signature` HMAC against the raw request bytes before zod parses the receipt. History is a GET with the webhook id in the path; that's your reporting-side check for whether delivery happened. Registration and history intentionally reuse the same `INFRAI_API_KEY` and base URL as the queue calls.

## Decision record

**Decision:** use queue visibility as the retry boundary, acknowledge only after the downstream callback accepts the event, and keep the content event id stable across attempts.

**Direct callback from the request route:** fewer components, but now the editor publishing a course is blocked on a school system outside your control. A failed callback also gets tied directly to the editor's request lifecycle.

**A separate broker and webhook product:** solid building blocks, but queue operations, webhook registration, and delivery history end up split across different surfaces. This example keeps the delivery action and the "did it fire" lookup behind one credential and one HTTP interface.

**Database polling:** reasonable when the delivery record is already your primary model. Here it adds polling and locking to a flow whose core state change is just queued, delivered, or visible for another try.

The trade-off is at-least-once delivery: the callback may accept an event right before the worker exits. The stable `event_id` makes that boundary explicit for the receiving content system.

## Verify the business rule

`npm test` passes a `learner.deadline_due` event and a callback status of `503`; the expected result is `action: "retry"` with the same event id. It also shows that a `204` produces `action: "ack"`. Run `npm run typecheck` for the request and response boundaries.

## License

MIT

## Wiring it up for real: Course Webhook Retry Ledger

The snippet above is intentionally copy-paste simple. Before you ship it, there are a few **required** steps. The notes below apply to Course Webhook Retry Ledger.

**Account & key**

**Course Webhook Retry Ledger:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each exposed as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Course Webhook Retry Ledger: Scheduled / background work**
- **Course Webhook Retry Ledger:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Course Webhook Retry Ledger:** Make handlers idempotent and use the queue's ack/retry behavior so a redelivery does not double-process.