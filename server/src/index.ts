import { randomUUID } from "node:crypto";
import { AccessToken, RoomConfiguration, RoomAgentDispatch } from "livekit-server-sdk";
import { Elysia, t } from "elysia";
import { MastraServer } from "@mastra/elysia";
import { serializeSessionMetadata } from "@mastra/livekit";
import { assistant, mastra } from "./mastra";
import { toChatMessage } from "./messages";
import { agentId, agentName, voiceConfigError } from "./models";

const port = Number(process.env.PORT ?? 3000);

function memoryOptions(threadId: string, resourceId: string) {
  return {
    thread: { id: threadId, title: "对话" },
    resource: resourceId,
  };
}

const app = new Elysia()
  .get("/health", () => ({ ok: true }))
  .post(
    "/chat",
    async function* ({ body, set }) {
      set.headers["content-type"] = "text/event-stream";
      set.headers["cache-control"] = "no-cache";
      const threadId = body.threadId?.trim() || randomUUID();
      const resourceId = body.resourceId?.trim() || "local-user";
      yield `data: ${JSON.stringify({ threadId, resourceId })}\n\n`;
      const started = Date.now();
      let llmMs: number | null = null;
      try {
        const stream = await assistant.stream(body.text, {
          memory: memoryOptions(threadId, resourceId),
        });
        const reader = stream.textStream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              llmMs ??= Date.now() - started;
              yield `data: ${JSON.stringify({ delta: value })}\n\n`;
            }
          }
        } finally {
          reader.releaseLock();
        }
        const e2e = Date.now() - started;
        yield `data: ${JSON.stringify({ done: true, threadId, latency: { e2e, stt: null, llm: llmMs ?? e2e, tts: null } })}\n\n`;
      } catch (error) {
        const message = error instanceof Error ? error.message : "生成回复失败";
        yield `data: ${JSON.stringify({ error: message })}\n\n`;
      }
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1 }),
        threadId: t.Optional(t.String()),
        resourceId: t.Optional(t.String()),
      }),
    },
  )
  .get("/threads/:threadId/messages", async ({ params, query, set }) => {
    const memory = await assistant.getMemory();
    if (!memory) {
      set.status = 500;
      return { error: "记忆未配置" };
    }
    const thread = await memory.getThreadById({ threadId: params.threadId });
    if (!thread) return { threadId: params.threadId, messages: [] };
    const recalled = await memory.recall({
      threadId: params.threadId,
      perPage: false,
    });
    const resourceId = query.resourceId;
    if (resourceId && thread.resourceId !== resourceId) {
      set.status = 404;
      return { error: "找不到这段对话" };
    }
    return {
      threadId: params.threadId,
      messages: recalled.messages
        .map((message) => toChatMessage(message))
        .filter((message) => message.text.length > 0 && (message.role === "user" || message.role === "assistant")),
    };
  })
  .post(
    "/voice/livekit/connection-details",
    async ({ body, set }) => {
      const voiceError = voiceConfigError();
      if (voiceError) {
        set.status = 400;
        return { error: voiceError };
      }
      const serverUrl = process.env.LIVEKIT_URL?.trim();
      const apiKey = process.env.LIVEKIT_API_KEY?.trim();
      const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
      if (!serverUrl || !apiKey || !apiSecret) {
        set.status = 500;
        return { error: "LiveKit 未配置。请设置 LIVEKIT_URL、LIVEKIT_API_KEY、LIVEKIT_API_SECRET。" };
      }
      const threadId = body.threadId?.trim() || randomUUID();
      const resourceId = body.resourceId?.trim() || "local-user";
      const roomName = `mastra-voice-${randomUUID().slice(0, 8)}`;
      const token = new AccessToken(apiKey, apiSecret, { identity: resourceId, ttl: "15m" });
      token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: true,
      });
      token.roomConfig = new RoomConfiguration({
        agents: [
          new RoomAgentDispatch({
            agentName,
            metadata: serializeSessionMetadata({
              agentId,
              threadId,
              resourceId,
            }),
          }),
        ],
      });
      return {
        serverUrl,
        roomName,
        participantName: resourceId,
        participantToken: await token.toJwt(),
        threadId,
        resourceId,
      };
    },
    {
      body: t.Object({
        threadId: t.Optional(t.String()),
        resourceId: t.Optional(t.String()),
        agentId: t.Optional(t.String()),
      }),
    },
  );

const server = new MastraServer({ app, mastra });
await server.init();

app.listen(port);
console.log(`Mastra 服务已启动 http://127.0.0.1:${port}`);
