/** 语音供应商留空，由环境变量选择。未配置时不能进语音房间。 */

import { readFileSync } from "node:fs";
import path from "node:path";

function loadEnvFile() {
  const file = path.join(process.cwd(), ".env");
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

loadEnvFile();

export const agentName = "mastra-voice";
export const agentId = "assistant";

/** OpenAI Chat Completions。自定义 base URL 时走兼容接口，请求路径为 `${url}/chat/completions`。 */
export interface LlmConfig {
  providerId: "openai";
  modelId: string;
  url: string;
  apiKey: string;
  api: "chat";
}

export function llmModel(): LlmConfig {
  const modelId = process.env.LLM_MODEL?.trim() || "gpt-4o-mini";
  const apiKey = process.env.LLM_API_KEY?.trim() ?? "";
  const url = (process.env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
  if (!apiKey) {
    throw new Error("尚未配置语言模型。请设置 LLM_API_KEY，并按需修改 LLM_BASE_URL 和 LLM_MODEL。");
  }
  return {
    providerId: "openai",
    modelId,
    url,
    apiKey,
    api: "chat",
  };
}

export interface SpeechModel {
  provider: string;
  model: string;
  /** LiveKit 插件或 Inference 接受的模型字符串，例如 deepgram/nova-3 */
  descriptor: string;
}

function speechModel(providerKey: string, modelKey: string): SpeechModel | null {
  const provider = process.env[providerKey]?.trim() ?? "";
  const model = process.env[modelKey]?.trim() ?? "";
  if (!provider || !model) return null;
  const descriptor = model.includes("/") ? model : `${provider}/${model}`;
  return { provider, model, descriptor };
}

export function sttModel(): SpeechModel | null {
  return speechModel("STT_PROVIDER", "STT_MODEL");
}

export function ttsModel(): SpeechModel | null {
  return speechModel("TTS_PROVIDER", "TTS_MODEL");
}

export interface SiliconFlowConfig {
  apiKey: string;
  baseUrl: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
}

export function siliconFlowConfig(): SiliconFlowConfig | null {
  const apiKey = process.env.VOICE_API_KEY?.trim() ?? "";
  const sttModelName = process.env.VOICE_STT_MODEL?.trim() ?? "";
  const ttsModelName = process.env.VOICE_TTS_MODEL?.trim() ?? "";
  if (!apiKey || !sttModelName || !ttsModelName) return null;
  return {
    apiKey,
    baseUrl: (process.env.VOICE_API_BASE_URL?.trim() || "https://api.siliconflow.cn/v1").replace(/\/$/, ""),
    sttModel: sttModelName,
    ttsModel: ttsModelName,
    ttsVoice: (process.env.VOICE_TTS_VOICE?.trim() || "alex").includes(":")
      ? process.env.VOICE_TTS_VOICE!.trim()
      : `${ttsModelName}:${process.env.VOICE_TTS_VOICE?.trim() || "alex"}`,
    ttsFormat: process.env.VOICE_TTS_FORMAT?.trim() || "mp3",
  };
}

export function turnDetection(): "multilingual" | "english" | "vad" | "stt" | "manual" {
  const value = process.env.TURN_DETECTION?.trim() || "multilingual";
  if (value === "english" || value === "vad" || value === "stt" || value === "manual") return value;
  return "multilingual";
}

export function voiceConfigError(): string | null {
  if (siliconFlowConfig() || (sttModel() && ttsModel())) return null;
  return "尚未选择语音模型。请配置 VOICE_API_KEY、VOICE_STT_MODEL、VOICE_TTS_MODEL，或 STT_PROVIDER、STT_MODEL、TTS_PROVIDER、TTS_MODEL。";
}
