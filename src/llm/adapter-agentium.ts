import { existsSync, mkdirSync, renameSync, createWriteStream } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import type { ILLMAdapter, LLMRequestParams, LLMResponse } from "./types.js";
import { buildSystemPrompt, buildUserMessage } from "./prompt.js";

const DEFAULT_MODEL_DIR = join(homedir(), ".auspex", "models");
const DEFAULT_MODEL_FILENAME = "Qwen2.5-7B-Instruct-Q4_K_M.gguf";
const DEFAULT_MODEL_URL =
  `https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/${DEFAULT_MODEL_FILENAME}`;

const ACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string" },
    selector: { type: "string" },
    text: { type: "string" },
    value: { type: "string" },
    key: { type: "string" },
    url: { type: "string" },
    ms: { type: "integer" },
    direction: { type: "string" },
    amount: { type: "integer" },
    result: { type: "string" },
    query: { type: "string" },
  },
};

export interface AgentiumAdapterConfig {
  modelPath?: string;
  modelDir?: string;
  gpuLayers?: number | "auto";
  contextSize?: number | "auto";
  temperature?: number;
  maxTokens?: number;
}

let agentiumModule: typeof import("agentium") | null = null;

async function loadAgentium() {
  if (!agentiumModule) {
    try {
      agentiumModule = await import("agentium");
    } catch {
      throw new Error(
        '[auspex] The "agentium" package is required for provider: "agentium". Install it with: npm install agentium',
      );
    }
  }
  return agentiumModule;
}

interface SharedEngine {
  engine: any;
  grammar: any;
  modelPath: string;
}

const engineCache = new Map<string, SharedEngine>();
let engineCacheInitLock: Promise<void> | null = null;

async function downloadFile(url: string, destPath: string): Promise<void> {
  const dir = resolve(destPath, "..");
  mkdirSync(dir, { recursive: true });

  const tmpPath = destPath + ".tmp";

  console.log(`[auspex] Downloading model from ${url}`);
  console.log(`[auspex] Saving to ${destPath}`);

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `[auspex] Model download failed: HTTP ${response.status} ${response.statusText}.\n` +
      `Download the model manually and set modelPath in config.`,
    );
  }

  if (!response.body) {
    throw new Error("[auspex] Model download failed: empty response body.");
  }

  const contentLength = response.headers.get("content-length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  let downloadedBytes = 0;

  const writer = createWriteStream(tmpPath);
  const reader = response.body.getReader();
  let lastLog = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      writer.write(value);
      downloadedBytes += value.length;

      const now = Date.now();
      if (totalBytes > 0 && now - lastLog > 5_000) {
        const pct = Math.round((downloadedBytes / totalBytes) * 100);
        const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
        const totalMb = (totalBytes / 1024 / 1024).toFixed(1);
        console.log(`[auspex] Downloading: ${pct}% (${mb} / ${totalMb} MB)`);
        lastLog = now;
      }
    }
  } finally {
    writer.end();
  }

  await new Promise<void>((res, rej) => {
    writer.on("finish", res);
    writer.on("error", rej);
  });

  renameSync(tmpPath, destPath);

  const finalMb = (downloadedBytes / 1024 / 1024).toFixed(1);
  console.log(`[auspex] Model download complete (${finalMb} MB).`);
}

export class AgentiumAdapter implements ILLMAdapter {
  private config: AgentiumAdapterConfig;
  private engine: any = null;
  private grammar: any = null;
  private initPromise: Promise<void> | null = null;

  constructor(config: AgentiumAdapterConfig) {
    this.config = config;
  }

  ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.init();
    }
    return this.initPromise;
  }

  private async init(): Promise<void> {
    if (this.engine) return;

    const modelDir = this.config.modelDir ?? DEFAULT_MODEL_DIR;
    let modelPath = this.config.modelPath ?? join(modelDir, DEFAULT_MODEL_FILENAME);

    if (!isAbsolute(modelPath)) {
      modelPath = resolve(modelPath);
    }

    const cached = engineCache.get(modelPath);
    if (cached) {
      this.engine = cached.engine;
      this.grammar = cached.grammar;
      return;
    }

    while (engineCacheInitLock) {
      await engineCacheInitLock;
      const pending = engineCache.get(modelPath);
      if (pending) {
        this.engine = pending.engine;
        this.grammar = pending.grammar;
        return;
      }
    }

    engineCacheInitLock = (async () => {
      try {
        const { createEngine } = await loadAgentium();

        if (!existsSync(modelPath)) {
          if (this.config.modelPath) {
            throw new Error(
              `[auspex] Model file not found: ${modelPath}.\n` +
              `Download it manually or remove modelPath to use the default model with auto-download.`,
            );
          }
          await downloadFile(DEFAULT_MODEL_URL, modelPath);
        }

        console.log(`[auspex] Loading model from ${modelPath} ...`);
        const engine = await createEngine({
          modelPath,
          gpuLayers: this.config.gpuLayers ?? "auto",
          contextSize: this.config.contextSize ?? "auto",
        });

        const grammar = await engine.createGrammar(ACTION_JSON_SCHEMA);

        engineCache.set(modelPath, { engine, grammar, modelPath });

        this.engine = engine;
        this.grammar = grammar;

        console.log("[auspex] Model loaded successfully.");
      } finally {
        engineCacheInitLock = null;
      }
    })();

    await engineCacheInitLock;

    const entry = engineCache.get(modelPath);
    if (entry && !this.engine) {
      this.engine = entry.engine;
      this.grammar = entry.grammar;
    }
  }

  async decideAction(params: LLMRequestParams): Promise<LLMResponse> {
    await this.ensureInitialized();

    if (params.screenshot) {
      console.warn("[auspex] Screenshots are not supported with provider: agentium (local models). The screenshot will be ignored.");
    }

    const systemPrompt = buildSystemPrompt(false, !!params.searchAvailable);
    const userMessage = buildUserMessage(
      params.prompt,
      params.snapshot,
      params.history,
      params.schemaDescription,
      params.timeStatus,
    );

    const session = await this.engine.createSession({ systemPrompt });

    try {
      const response = await session.prompt(userMessage, {
        grammar: this.grammar,
        temperature: this.config.temperature ?? 0,
        maxTokens: this.config.maxTokens ?? 2048,
      });

      let parsed: unknown;
      try {
        parsed = this.grammar.parse(response);
      } catch {
        parsed = JSON.parse(response);
      }

      let promptTokens = 0;
      let completionTokens = 0;
      try {
        promptTokens = this.engine.tokenize(systemPrompt + userMessage).length;
        completionTokens = this.engine.tokenize(response).length;
      } catch {
        promptTokens = Math.round((systemPrompt.length + userMessage.length) / 4);
        completionTokens = Math.round(response.length / 4);
      }

      return {
        data: parsed,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
      };
    } finally {
      await session.dispose().catch(() => {});
    }
  }

  async dispose(): Promise<void> {
    // Shared engine is never disposed — reused across runs, freed on process exit.
  }
}
