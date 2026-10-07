import assert from "node:assert/strict";
import test from "node:test";
import { courseDeliverySchema, decideDelivery } from "../src/delivery_decision.js";

const deadlineEvent = courseDeliverySchema.parse({
  event_id: "deadline-2026-09-30-learner-42",
  event_type: "learner.deadline_due",
  course_id: "editing-101",
  learner_id: "learner-42",
  deadline_at: "2026-09-30T17:00:00.000Z",
  callback_url: "https://school.example/webhooks/deadlines"
});

test("keeps a failed deadline delivery available for another attempt", () => {
  assert.deepEqual(decideDelivery(deadlineEvent, 503, "2026-09-23T10:00:00.000Z"), {
    action: "retry",
    report: {
      event_id: "deadline-2026-09-30-learner-42",
      retry_after_visibility_timeout: true
    }
  });
});

test("acknowledges a delivered deadline exactly once", () => {
  assert.deepEqual(decideDelivery(deadlineEvent, 204, "2026-09-23T10:00:00.000Z"), {
    action: "ack",
    report: {
      event_id: "deadline-2026-09-30-learner-42",
      delivered_at: "2026-09-23T10:00:00.000Z"
    }
  });
});
