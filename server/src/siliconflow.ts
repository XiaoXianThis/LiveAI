import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { audioFramesFromFile, stt, tts } from "@livekit/agents";
import type { AudioBuffer } from "@livekit/agents";
import { AudioFrame, combineAudioFrames } from "@livekit/rtc-node";

export interface SiliconFlowOptions {
  apiKey: string;
  baseUrl: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
}

function wavBytes(frame: AudioFrame): Uint8Array {
  const pcm = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
  const header = Buffer.alloc(44);
  const channels = frame.channels;
  const sampleRate = frame.sampleRate;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function siliconFlowError(response: Response): Promise<string> {
  const body = await response.text();
  return `硅基流动请求失败 ${response.status}：${body.slice(0, 300)}`;
}

export class SiliconFlowSTT extends stt.STT {
  label = "siliconflow.STT";

  constructor(private readonly options: SiliconFlowOptions) {
    super({ streaming: false, interimResults: false });
  }

  override get model(): string {
    return this.options.sttModel;
  }

  override get provider(): string {
    return "siliconflow";
  }

  protected async _recognize(frame: AudioBuffer, abortSignal?: AbortSignal): Promise<stt.SpeechEvent> {
    const merged = combineAudioFrames(Array.isArray(frame) ? frame : [frame]);
    const form = new FormData();
    form.set("model", this.options.sttModel);
    form.set("file", new Blob([wavBytes(merged)], { type: "audio/wav" }), "speech.wav");
    const response = await fetch(`${this.options.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      body: form,
      signal: abortSignal,
    });
    if (!response.ok) throw new Error(await siliconFlowError(response));
    const payload = (await response.json()) as { text?: string };
    return {
      type: stt.SpeechEventType.FINAL_TRANSCRIPT,
      alternatives: [
        {
          language: "zh",
          text: payload.text?.trim() ?? "",
          startTime: 0,
          endTime: 0,
          confidence: 1,
        },
      ],
    };
  }

  stream(): stt.SpeechStream {
    throw new Error("硅基流动识别按句提交，由语音活动检测分段");
  }
}

class SiliconFlowChunkedStream extends tts.ChunkedStream {
  label = "siliconflow.ChunkedStream";

  constructor(
    text: string,
    tts: SiliconFlowTTS,
    private readonly options: SiliconFlowOptions,
    abortSignal?: AbortSignal,
  ) {
    super(text, tts, undefined, abortSignal);
  }

  protected async run(): Promise<void> {
    const response = await fetch(`${this.options.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.ttsModel,
        input: this.inputText,
        voice: this.options.ttsVoice,
        response_format: this.options.ttsFormat,
      }),
      signal: this.abortSignal,
    });
    if (!response.ok) throw new Error(await siliconFlowError(response));
    const audio = Buffer.from(await response.arrayBuffer());
    const directory = await mkdtemp(path.join(tmpdir(), "sf-tts-"));
    const file = path.join(directory, `speech.${this.options.ttsFormat}`);
    try {
      await writeFile(file, audio);
      const frames = audioFramesFromFile(file, {
        sampleRate: 24000,
        numChannels: 1,
        format: this.options.ttsFormat,
        abortSignal: this.abortSignal,
      });
      const reader = frames.getReader();
      const pending: AudioFrame[] = [];
      const emit = (frame: AudioFrame, final: boolean) => {
        const packet: tts.SynthesizedAudio = {
          requestId: "siliconflow",
          segmentId: "siliconflow",
          frame,
          final,
        };
        this.queue.put(packet);
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (pending.length > 0) emit(pending.shift()!, false);
        pending.push(value);
      }
      for (let index = 0; index < pending.length; index += 1) {
        emit(pending[index]!, index === pending.length - 1);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export class SiliconFlowTTS extends tts.TTS {
  label = "siliconflow.TTS";

  constructor(private readonly options: SiliconFlowOptions) {
    super(24000, 1, { streaming: false });
  }

  override get model(): string {
    return this.options.ttsModel;
  }

  override get provider(): string {
    return "siliconflow";
  }

  synthesize(text: string, _connOptions?: unknown, abortSignal?: AbortSignal): tts.ChunkedStream {
    return new SiliconFlowChunkedStream(text, this, this.options, abortSignal);
  }

  stream(): tts.SynthesizeStream {
    throw new Error("硅基流动合成按句返回，由框架切句后调用");
  }
}
