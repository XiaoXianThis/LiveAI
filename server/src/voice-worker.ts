import path from "node:path";
import { fileURLToPath } from "node:url";
import { voice } from "@livekit/agents";
import { createLiveKitWorker, runLiveKitWorker } from "@mastra/livekit/worker";
import { SiliconFlowSTT, SiliconFlowTTS } from "./siliconflow";
import { mastra } from "./mastra";
import { agentId, agentName, siliconFlowConfig, sttModel, ttsModel, turnDetection, voiceConfigError } from "./models";

const silicon = siliconFlowConfig();
const stt = silicon ? new SiliconFlowSTT(silicon) : sttModel()?.descriptor;
const tts = silicon ? new SiliconFlowTTS(silicon) : ttsModel()?.descriptor;

export default createLiveKitWorker({
  mastra,
  agent: agentId,
  ...(stt ? { stt } : {}),
  ...(tts ? { tts } : {}),
  vad: "silero",
  turnDetection: turnDetection(),
  turnHandling: {
    interruption: { enabled: true },
    preemptiveGeneration: { enabled: false },
  },
  onSessionStart: ({ session, ctx }) => {
    const turn = { stt: 0, llm: 0, tts: 0 };
    session.on(voice.AgentSessionEventTypes.MetricsCollected, (event) => {
      const metrics = event.metrics;
      if (metrics.type === "stt_metrics") turn.stt = metrics.durationMs;
      if (metrics.type === "eou_metrics" && turn.stt === 0) turn.stt = metrics.transcriptionDelayMs;
      if (metrics.type === "llm_metrics" && !metrics.cancelled) turn.llm = metrics.ttftMs;
      if (metrics.type === "tts_metrics" && !metrics.cancelled && turn.tts === 0) turn.tts = metrics.ttfbMs;
    });
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (event) => {
      const item = event.item as { type?: string; role?: string };
      if (item.type !== "message" || item.role !== "assistant") return;
      const payload = JSON.stringify({
        e2e: turn.stt + turn.llm + turn.tts,
        stt: turn.stt,
        llm: turn.llm,
        tts: turn.tts,
      });
      turn.stt = 0;
      turn.llm = 0;
      turn.tts = 0;
      ctx.room.localParticipant?.sendText(payload, { topic: "latency" }).catch((error: unknown) => {
        console.error("发送延迟失败", error);
      });
    });
  },
});

function isDirectRun(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return path.resolve(invoked) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  const error = voiceConfigError();
  if (error) {
    console.error(error);
    setInterval(() => {}, 1 << 30);
  } else {
    runLiveKitWorker({ entry: import.meta.url, agentName });
  }
}
