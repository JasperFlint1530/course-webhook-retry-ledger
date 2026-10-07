import { randomUUID } from "node:crypto";
import { infrai } from "./infrai.js";

const command = process.argv[2];

if (command === "register") {
  const url = process.env.PUBLIC_WEBHOOK_URL;
  const secret = process.env.INFRAI_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error("Set PUBLIC_WEBHOOK_URL and INFRAI_WEBHOOK_SECRET");
  const webhook = await infrai.account.webhooks.register(
    url,
    ["queue.delivery"],
    secret,
    `course-receipts-${randomUUID()}`
  );
  console.log(`registered webhook ${webhook.id}`);
} else if (command === "history") {
  const id = process.env.INFRAI_WEBHOOK_ID;
  if (!id) throw new Error("Set INFRAI_WEBHOOK_ID to the registered webhook id");
  console.log(JSON.stringify(await infrai.account.webhooks.deliveries(id), null, 2));
} else {
  throw new Error("Use register or history");
}
