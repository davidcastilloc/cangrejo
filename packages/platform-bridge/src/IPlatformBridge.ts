import type { Result } from '@cangrejo/core';
import { ok, err } from '@cangrejo/core';

export type RuntimeEnvironment = 'tauri-desktop' | 'web-pwa' | 'node-test';

export interface SubprocessExecutionOptions {
  command: string;
  args: string[];
  workingDirectory?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface SubprocessExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface EnvironmentTelemetry {
  runtime: RuntimeEnvironment;
  platform: string;
  hardwareConcurrency: number;
  supportsWebGPU: boolean;
  supportsSubprocesses: boolean;
}

/**
 * Hexagonal Platform Port (`IPlatformBridge`) abstracting differences between
 * Tauri v2 Desktop (Windows/macOS/Linux) and Web PWA runtimes.
 */
export interface IPlatformBridge {
  getEnvironmentTelemetry(): EnvironmentTelemetry;
  readFileBytes(filePath: string): Promise<Result<Uint8Array, Error>>;
  writeFileBytes(filePath: string, data: Uint8Array): Promise<Result<void, Error>>;
  executeLocalTransformSubprocess(
    options: SubprocessExecutionOptions
  ): Promise<Result<SubprocessExecutionResult, Error>>;
}

/**
 * Escapes local transform entity property parameters following Maltego's `LocalTransformRunner` contract:
 * `\` -> `\\`, `=` -> `\=`, `#` -> `\#`
 */
export function formatLocalTransformFieldArg(fields: ReadonlyMap<string, string> | Record<string, string>): string {
  const entries = fields instanceof Map ? Array.from(fields.entries()) : Object.entries(fields);
  const escapePart = (val: string): string =>
    val.replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/#/g, '\\#');
  return entries.map(([k, v]) => `${escapePart(k)}=${escapePart(String(v ?? ''))}`).join('#');
}

/**
 * Parses a Maltego local transform field argument string (`k1=v1#k2=v2`) respecting escaped `\=`, `\#`, and `\\`.
 */
export function parseLocalTransformFieldArg(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) return result;
  const pairs: string[] = [];
  let current = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === '\\' && i + 1 < raw.length) {
      current += ch + raw[i + 1]!;
      i++;
    } else if (ch === '#') {
      pairs.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) pairs.push(current);

  const unescapePart = (val: string): string =>
    val.replace(/\\([\\=#])/g, '$1');

  for (const pair of pairs) {
    let splitIdx = -1;
    for (let i = 0; i < pair.length; i++) {
      if (pair[i] === '\\') {
        i++;
      } else if (pair[i] === '=') {
        splitIdx = i;
        break;
      }
    }
    if (splitIdx !== -1) {
      const k = unescapePart(pair.slice(0, splitIdx));
      const v = unescapePart(pair.slice(splitIdx + 1));
      result[k] = v;
    }
  }
  return result;
}

/**
 * In-memory / test adapter implementing `IPlatformBridge` for deterministic testing and Web PWA fallback.
 */
export class InMemoryPlatformBridge implements IPlatformBridge {
  private readonly virtualFs = new Map<string, Uint8Array>();
  private readonly runtime: RuntimeEnvironment;
  private subprocessHandler?: (
    options: SubprocessExecutionOptions
  ) => Promise<SubprocessExecutionResult>;

  public constructor(
    runtime: RuntimeEnvironment = 'node-test',
    subprocessHandler?: (options: SubprocessExecutionOptions) => Promise<SubprocessExecutionResult>
  ) {
    this.runtime = runtime;
    this.subprocessHandler = subprocessHandler;
  }

  public getEnvironmentTelemetry(): EnvironmentTelemetry {
    return {
      runtime: this.runtime,
      platform: typeof process !== 'undefined' ? process.platform : 'browser',
      hardwareConcurrency: 8,
      supportsWebGPU: true,
      supportsSubprocesses: this.runtime !== 'web-pwa',
    };
  }

  public async readFileBytes(filePath: string): Promise<Result<Uint8Array, Error>> {
    const found = this.virtualFs.get(filePath);
    if (!found) {
      return err(new Error(`ENOENT: File not found in virtual filesystem: ${filePath}`));
    }
    return ok(new Uint8Array(found));
  }

  public async writeFileBytes(filePath: string, data: Uint8Array): Promise<Result<void, Error>> {
    this.virtualFs.set(filePath, new Uint8Array(data));
    return ok(undefined);
  }

  public async executeLocalTransformSubprocess(
    options: SubprocessExecutionOptions
  ): Promise<Result<SubprocessExecutionResult, Error>> {
    if (this.runtime === 'web-pwa') {
      return err(
        new Error('Local CLI Transform subprocess execution is disabled in Web PWA mode; use Tauri Desktop or Cloud Proxy.')
      );
    }
    if (!this.subprocessHandler) {
      return err(new Error(`No subprocess handler configured for command: ${options.command}`));
    }
    try {
      const res = await this.subprocessHandler(options);
      return ok(res);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
