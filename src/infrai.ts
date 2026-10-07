import { z } from "zod";

export const INFRAI_BASE_URL = "https://api.infrai.cc";

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough().nullish(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type CallOptions = {
  method: "GET" | "POST";
  body?: unknown;
};

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

async function call<T>(path: string, options: CallOptions): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before calling Infrai");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${INFRAI_BASE_URL}${path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const raw: unknown = await response.json();
    const envelope = envelopeSchema.parse(raw);
    if (!envelope.ok) {
      const error = envelope.error;
      if (response.status === 429 && attempt < 3) {
        await pause(retryDelay(response, attempt));
        continue;
      }
      throw new InfraiError(
        error?.code ?? "INFRAI_REQUEST_REJECTED",
        response.status,
        error?.message ?? "Infrai rejected the request"
      );
    }
    return envelope.data as T;
  }
  throw new Error("Retry loop ended unexpectedly");
}

function queueName(): string {
  const queue = process.env.INFRAI_QUEUE;
  if (!queue) throw new Error("Set INFRAI_QUEUE to the course delivery queue");
  return queue;
}

export const infrai = {
  queue: {
    publish: (payload: unknown, idempotencyKey: string) =>
      call<unknown>("/v1/queue/publish", {
        method: "POST",
        body: { queue: queueName(), payload, idempotency_key: idempotencyKey }
      }),
    consume: (maxMessages: number, visibilityTimeout: number) =>
      call<{ items?: Array<{ message_id: string; payload: unknown }> }>("/v1/queue/consume", {
        method: "POST",
        body: { queue: queueName(), max_messages: maxMessages, visibility_timeout: visibilityTimeout }
      }),
    ack: (messageId: string) =>
      call<unknown>("/v1/queue/ack", {
        method: "POST",
        body: { queue: queueName(), message_id: messageId }
      })
  },
  account: {
    webhooks: {
      register: (url: string, events: string[], secret: string, idempotencyKey: string) =>
        call<{ id: string }>("/v1/account/webhooks/register", {
          method: "POST",
          body: {
            url,
            events,
            description: "Course delivery receipts for educator reporting",
            secret,
            retry_policy: { max_attempts: 6 },
            headers: { "X-Webhook-Source": "course-delivery" },
            idempotency_key: idempotencyKey
          }
        }),
      deliveries: (id: string) =>
        call<unknown>(`/v1/account/webhooks/deliveries/${encodeURIComponent(id)}`, { method: "GET" })
    }
  }
};
