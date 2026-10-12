import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const root = path.resolve(import.meta.dir, "..");
const serverDir = path.join(root, "server");
const binDir = path.join(root, "bin");
const children: ChildProcess[] = [];

function start(command: string, args: string[], cwd: string) {
  const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0) console.error(`${command} 退出，代码 ${code}`);
  });
  return child;
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function ensureLiveKit(): Promise<string> {
  const fromEnv = process.env.LIVEKIT_BIN?.trim();
  if (fromEnv && (await exists(fromEnv))) return fromEnv;
  const bundled = path.join(binDir, "livekit-server.exe");
  if (await exists(bundled)) return bundled;
  await mkdir(binDir, { recursive: true });
  const release = await fetch("https://api.github.com/repos/livekit/livekit/releases/latest", {
    headers: { "user-agent": "liveai-dev", accept: "application/vnd.github+json" },
  });
  if (!release.ok) throw new Error(`无法获取 livekit-server 版本：${release.status}`);
  const body = (await release.json()) as { assets?: { name: string; browser_download_url: string }[] };
  const asset = body.assets?.find((item) => item.name.includes("windows_amd64") && item.name.endsWith(".zip"));
  if (!asset) throw new Error("GitHub 发布里没有 Windows 版 livekit-server");
  console.log(`正在下载 ${asset.name}`);
  const zipResponse = await fetch(asset.browser_download_url);
  if (!zipResponse.ok || !zipResponse.body) throw new Error(`下载失败：${zipResponse.status}`);
  const zipPath = path.join(binDir, asset.name);
  await pipeline(Readable.fromWeb(zipResponse.body), createWriteStream(zipPath));
  const extract = spawn("powershell", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${binDir}'`,
  ]);
  await new Promise<void>((resolve, reject) => {
    extract.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("解压 livekit-server 失败"))));
  });
  if (!(await exists(bundled))) throw new Error(`解压后找不到 ${bundled}`);
  return bundled;
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const livekit = await ensureLiveKit();
const workerOut = path.join(serverDir, ".worker-dist");
await mkdir(workerOut, { recursive: true });
const built = spawnSync(
  process.execPath,
  ["build", "src/voice-worker.ts", "--target", "node", "--packages=external", "--outdir", workerOut],
  { cwd: serverDir, stdio: "inherit" },
);
if (built.status !== 0) throw new Error("语音 worker 打包失败");
start(livekit, ["--dev", "--bind", "127.0.0.1"], serverDir);
start(process.execPath, ["src/index.ts"], serverDir);
start("node", [path.join(workerOut, "voice-worker.js"), "dev"], serverDir);
