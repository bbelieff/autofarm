export type ProviderId = "claude" | "codex" | "muse" | "gemini";

export type AuthMode = "subscription" | "api";

export type Effort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";

export interface ModelInfo {
  id: string;
  label: string;
  efforts: Effort[];
  defaultEffort?: Effort;
  hidden?: boolean;
  source: "static" | "cli-cache" | "api";
}

export interface ProviderConfig {
  provider: ProviderId;
  mode: AuthMode;
  /** api mode */
  apiKey?: string;
  /** api mode override */
  baseUrl?: string;
  /** subscription mode override (default "claude" | "codex" | "muse") */
  cliPath?: string;
  /** e.g. ["wsl","-d","OpenClawGateway","-u","openclaw","--"] to run muse via WSL */
  cliPrefix?: string[];
  env?: Record<string, string>;
}

export interface GenerateRequest {
  model: string;
  effort?: Effort;
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  purpose?: string;
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface GenerateResult {
  text: string;
  provider: ProviderId;
  mode: AuthMode;
  model: string;
  effort: Effort | null;
  usage: Usage | null;
  usageReason?: string;
  elapsedMs: number;
}

export interface UsageRecord extends Omit<GenerateResult, "text"> {
  ok: boolean;
  errorKind?: string;
  purpose?: string;
  at: Date;
}

export type AiErrorKind =
  | "config"
  | "auth"
  | "rate_limited"
  | "timeout"
  | "bad_response"
  | "cli_failed"
  | "unsupported";

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;

  constructor(message: string, kind: AiErrorKind, status?: number) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export interface AiProvider {
  id: ProviderId;
  mode: AuthMode;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  listModels(): Promise<ModelInfo[]>;
}

export interface RunCliOpts {
  input?: string;
  timeoutMs: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface RunCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type RunCli = (
  cmd: string,
  args: string[],
  opts: RunCliOpts,
) => Promise<RunCliResult>;

export interface Deps {
  fetch?: typeof fetch;
  /**
   * Default implementation uses node:child_process spawn (no shell),
   * kills on timeout, prompt passed via stdin.
   */
  runCli?: (
    cmd: string,
    args: string[],
    opts: RunCliOpts,
  ) => Promise<RunCliResult>;
  now?: () => number;
  readFile?: (path: string) => Promise<string>;
  /** Called once per generate(), success or failure (never includes prompt/response text). */
  onUsage?: (r: UsageRecord) => void;
}
