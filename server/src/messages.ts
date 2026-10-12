type Part = { type?: string; text?: string };

function partsOf(content: unknown): Part[] {
  if (!content || typeof content !== "object") return [];
  const record = content as { parts?: Part[]; content?: unknown };
  if (Array.isArray(record.parts)) return record.parts;
  if (typeof record.content === "string") return [{ type: "text", text: record.content }];
  return [];
}

export function messageText(message: { content?: unknown; role?: string }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  return partsOf(content)
    .filter((part) => !part.type || part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

export function toChatMessage(message: { id?: string; role?: string; content?: unknown; createdAt?: Date | string }) {
  const role = message.role === "assistant" ? "assistant" : "user";
  return {
    id: message.id ?? "",
    role,
    text: messageText(message),
    createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt ?? null,
  };
}
