declare module "agentium" {
  export interface IEngine {
    init(): Promise<IEngine>;
    createSession(options?: { systemPrompt?: string }): Promise<ISession>;
    createGrammar(schema: Record<string, unknown>): Promise<IGrammar>;
    createBuiltinGrammar(format: string): Promise<IGrammar>;
    tokenize(text: string): number[];
    detokenize(tokens: number[]): string;
    dispose(): Promise<void>;
  }

  export interface ISession {
    prompt(message: string, options?: Record<string, unknown>): Promise<string>;
    dispose(): Promise<void>;
  }

  export interface IGrammar {
    parse(response: string): unknown;
  }

  export function createEngine(config: {
    modelPath: string;
    gpuLayers?: number | "auto";
    contextSize?: number | "auto";
  }): Promise<IEngine>;
}
