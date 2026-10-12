import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { agentId, llmModel } from "./models";

const databaseUrl = process.env.DATABASE_URL?.trim() || "file:../data/liveai.db";

export const assistant = new Agent({
  id: agentId,
  name: "Assistant",
  instructions: `你是实时语音和文字助手。用口语短句回答，适合直接朗读。不要使用 Markdown、列表符号或表情。`,
  model: llmModel(),
  memory: new Memory({
    options: { lastMessages: 30 },
  }),
});

export const mastra = new Mastra({
  agents: { assistant },
  storage: new LibSQLStore({
    id: "liveai",
    url: databaseUrl,
  }),
});
