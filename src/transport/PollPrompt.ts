export interface PollPromptInput {
  groupId: string;
  question: string;
  yesLabel?: string;
  noLabel?: string;
}

export interface PollPromptSender {
  sendPoll(input: {
    groupId: string;
    title: string;
    options: string[];
  }): Promise<void>;
}

export async function sendBinaryPollPrompt(
  sender: PollPromptSender,
  input: PollPromptInput
): Promise<void> {
  const question = input.question.trim();

  if (!question) {
    throw new Error("poll question cannot be empty");
  }

  const yes = (input.yesLabel ?? "Yes").trim();
  const no = (input.noLabel ?? "No").trim();

  if (!yes || !no) {
    throw new Error("poll options cannot be empty");
  }

  if (yes.toLowerCase() === no.toLowerCase()) {
    throw new Error("poll options must be distinct");
  }

  await sender.sendPoll({
    groupId: input.groupId,
    title: question,
    options: [yes, no],
  });
}
