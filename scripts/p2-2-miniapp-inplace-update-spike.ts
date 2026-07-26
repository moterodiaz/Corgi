import { app as appCard, edit, Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const TRIGGER = process.env.P2_TRIGGER ?? "!p2-2-card-update";
const INITIAL_URL =
  process.env.P2_INITIAL_URL ?? "https://example.com/corgi/p2-2?step=initial";
const UPDATED_URL =
  process.env.P2_UPDATED_URL ?? "https://example.com/corgi/p2-2?step=updated";
const UPDATE_DELAY_MS = Number.parseInt(process.env.P2_UPDATE_DELAY_MS ?? "4000", 10);
const DEBUG_ALL_INBOUND = process.env.P2_DEBUG_ALL_INBOUND === "1";
const TRIGGER_MODE = process.env.P2_TRIGGER_MODE ?? "exact";

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function isTriggerMatch(text: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedTrigger = normalizeText(TRIGGER);

  if (TRIGGER_MODE === "contains") {
    return normalizedText.includes(normalizedTrigger);
  }

  return normalizedText === normalizedTrigger;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const app = await Spectrum({
    projectId: process.env.SPECTRUM_PROJECT_ID,
    projectSecret: process.env.SPECTRUM_PROJECT_SECRET,
    providers: [imessage.config()],
  });

  console.log("[P2-2] listening for trigger:", TRIGGER);
  console.log("[P2-2] initial URL:", INITIAL_URL);
  console.log("[P2-2] updated URL:", UPDATED_URL);
  console.log("[P2-2] update delay ms:", UPDATE_DELAY_MS);
  console.log("[P2-2] debug inbound:", DEBUG_ALL_INBOUND ? "enabled" : "disabled");
  console.log("[P2-2] trigger mode:", TRIGGER_MODE);

  for await (const [space, message] of app.messages) {
    if (DEBUG_ALL_INBOUND) {
      const preview =
        message.content.type === "text"
          ? message.content.text.slice(0, 120)
          : `<${message.content.type}>`;

      console.log("[P2-2][debug] inbound event", {
        direction: message.direction,
        contentType: message.content.type,
        spaceId: space.id,
        messageId: message.id,
        sender: message.sender?.id ?? "unknown",
        preview,
      });
    }

    if (message.direction === "outbound") continue;
    if (message.content.type !== "text") continue;

    const text = message.content.text;
    if (!isTriggerMatch(text)) continue;

    console.log("[P2-2] trigger received", {
      platform: message.platform,
      inboundMessageId: message.id,
      spaceId: space.id,
      sender: message.sender?.id ?? "unknown",
    });

    const sentCard = await space.send(
      appCard(INITIAL_URL, {
        live: true,
      })
    );

    if (!sentCard) {
      console.error("[P2-2] failed: card send returned undefined");
      await space.send("P2-2 failed: app card send returned undefined.");
      continue;
    }

    console.log("[P2-2] sent initial card", {
      outboundMessageId: sentCard.id,
      platform: sentCard.platform,
    });

    await sleep(UPDATE_DELAY_MS);

    await space.send(
      edit(
        appCard(UPDATED_URL, {
          live: true,
        }),
        sentCard
      )
    );

    console.log("[P2-2] edit invoked against original card", {
      targetMessageId: sentCard.id,
    });

    await space.send(
      "P2-2 spike: attempted in-place card update. Confirm whether the original bubble changed instead of posting a new bubble."
    );
  }
}

main().catch((error: unknown) => {
  console.error("[P2-2] fatal error", error);
  process.exit(1);
});
