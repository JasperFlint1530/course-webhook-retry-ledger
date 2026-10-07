import { courseDeliverySchema, decideDelivery } from "./delivery_decision.js";
import { infrai } from "./infrai.js";

export async function deliverNextBatch(): Promise<void> {
  const batch = await infrai.queue.consume(10, 60);
  for (const message of batch.items ?? []) {
    const event = courseDeliverySchema.parse(message.payload);
    const callback = await fetch(event.callback_url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": event.event_id },
      body: JSON.stringify(event)
    });
    const decision = decideDelivery(event, callback.status, new Date().toISOString());
    if (decision.action === "ack") await infrai.queue.ack(message.message_id);
    console.log(decision.report);
  }
}

await deliverNextBatch();
