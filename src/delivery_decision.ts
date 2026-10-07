import { z } from "zod";

export const courseDeliverySchema = z.object({
  event_id: z.string().min(1),
  event_type: z.enum(["course.published", "learner.deadline_due"]),
  course_id: z.string().min(1),
  learner_id: z.string().min(1),
  deadline_at: z.string().datetime(),
  callback_url: z.string().url()
});

export type CourseDelivery = z.infer<typeof courseDeliverySchema>;

export type DeliveryDecision =
  | { action: "ack"; report: { event_id: string; delivered_at: string } }
  | { action: "retry"; report: { event_id: string; retry_after_visibility_timeout: true } };

export function decideDelivery(event: CourseDelivery, responseStatus: number, deliveredAt: string): DeliveryDecision {
  if (responseStatus >= 200 && responseStatus < 300) {
    return { action: "ack", report: { event_id: event.event_id, delivered_at: deliveredAt } };
  }
  return {
    action: "retry",
    report: { event_id: event.event_id, retry_after_visibility_timeout: true }
  };
}
