import { describe, expect, it, vi } from "vitest";

import { sendBinaryPollPrompt } from "../../../src/transport/PollPrompt.js";

describe("sendBinaryPollPrompt", () => {
  it("sends a default yes/no poll", async () => {
    const sendPoll = vi.fn().mockResolvedValue(undefined);

    await sendBinaryPollPrompt(
      { sendPoll },
      {
        groupId: "group-1",
        question: "Does Saturday work?",
      }
    );

    expect(sendPoll).toHaveBeenCalledTimes(1);
    expect(sendPoll).toHaveBeenCalledWith({
      groupId: "group-1",
      title: "Does Saturday work?",
      options: ["Yes", "No"],
    });
  });

  it("supports custom option labels", async () => {
    const sendPoll = vi.fn().mockResolvedValue(undefined);

    await sendBinaryPollPrompt(
      { sendPoll },
      {
        groupId: "group-1",
        question: "Can you make 2pm?",
        yesLabel: "Works",
        noLabel: "Cannot",
      }
    );

    expect(sendPoll).toHaveBeenCalledWith({
      groupId: "group-1",
      title: "Can you make 2pm?",
      options: ["Works", "Cannot"],
    });
  });

  it("rejects blank questions", async () => {
    const sendPoll = vi.fn().mockResolvedValue(undefined);

    await expect(
      sendBinaryPollPrompt(
        { sendPoll },
        {
          groupId: "group-1",
          question: "   ",
        }
      )
    ).rejects.toThrow("poll question cannot be empty");

    expect(sendPoll).not.toHaveBeenCalled();
  });

  it("rejects identical options", async () => {
    const sendPoll = vi.fn().mockResolvedValue(undefined);

    await expect(
      sendBinaryPollPrompt(
        { sendPoll },
        {
          groupId: "group-1",
          question: "Does Saturday work?",
          yesLabel: "maybe",
          noLabel: "MAYBE",
        }
      )
    ).rejects.toThrow("poll options must be distinct");
  });
});
