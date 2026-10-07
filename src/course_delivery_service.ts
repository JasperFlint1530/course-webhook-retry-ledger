import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { courseDeliverySchema } from "./delivery_decision.js";
import { InfraiError, infrai } from "./infrai.js";

const inboundReceiptSchema = z.object({
  event_id: z.string().min(1),
  status: z.enum(["delivered", "retrying"]),
  occurred_at: z.string().datetime()
});

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function validSignature(body: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const supplied = signature.replace(/^sha256=/, "");
  return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/course-deliveries") {
      const event = courseDeliverySchema.parse(JSON.parse((await readBody(request)).toString("utf8")));
      await infrai.queue.publish(event, event.event_id);
      json(response, 202, { event_id: event.event_id, state: "queued" });
      return;
    }

    if (request.method === "POST" && request.url === "/webhooks/infrai") {
      const body = await readBody(request);
      const secret = process.env.INFRAI_WEBHOOK_SECRET;
      if (!secret) throw new Error("Set INFRAI_WEBHOOK_SECRET before receiving webhooks");
      if (!validSignature(body, request.headers["x-infrai-signature"] as string | undefined, secret)) {
        json(response, 401, { error: "invalid signature" });
        return;
      }
      const receipt = inboundReceiptSchema.parse(JSON.parse(body.toString("utf8")));
      console.log("educator delivery receipt", receipt);
      json(response, 200, { accepted: true });
      return;
    }

    json(response, 404, { error: "route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      json(response, 400, { error: "invalid request", details: error.flatten() });
      return;
    }
    if (error instanceof InfraiError) {
      json(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
        error: error.code,
        message: error.message
      });
      return;
    }
    console.error(error);
    json(response, 500, { error: "service error" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`course delivery service listening on http://localhost:${port}`));
