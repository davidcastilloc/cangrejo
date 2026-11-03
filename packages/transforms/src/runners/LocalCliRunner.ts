import {
  EntityRegistry,
  StrategicGraphMerger,
  getPartPrimaryValue,
  type EntityID,
  type GraphStore,
  type MergeResult,
  type PartMergeStrategyMode,
} from '@cangrejo/core';
import type { IPlatformBridge } from '@cangrejo/platform-bridge';
import {
  formatLocalTransformFieldArg,
  scrubTransformEnvironment,
  tokenizeCommandArgs,
  validateTransformExecutablePath,
} from '../parsers/ArgvTokenizer.js';
import {
  parseTransformV2ResponseXml,
  type ParsedTransformV2Response,
} from '../parsers/XmlV2MessageParser.js';

export interface LocalTransformRunConfig {
  executable: string;
  rawParameters?: string;
  workingDirectory?: string;
  timeoutMs?: number;
  explicitEnv?: Record<string, string>;
  ambientEnv?: Record<string, string | undefined>;
  allowedExecutables?: ReadonlySet<string>;
  hardLimit?: number;
  mergeStrategy?: PartMergeStrategyMode;
}

export interface LocalTransformExecutionOutcome {
  exitCode: number;
  stderr: string;
  durationMs: number;
  parsedResponse: ParsedTransformV2Response;
  mergeResult: MergeResult;
  scrubbedEnvUsed: Record<string, string>;
  argvDispatched: string[];
}

/**
 * Local CLI Transform Subprocess Runner (`LocalCliRunner`).
 * Enforces executable path whitelisting, ambient environment secret scrubbing,
 * sequential field escaping (`\\`, `\=`, `\#`), XML v2 parsing, and atomic `StrategicGraphMerger` ingestion.
 */
export class LocalCliRunner {
  private readonly bridge: IPlatformBridge;
  private readonly registry: EntityRegistry;
  private readonly merger: StrategicGraphMerger;

  public constructor(
    bridge: IPlatformBridge,
    registry = new EntityRegistry(),
    merger = new StrategicGraphMerger()
  ) {
    this.bridge = bridge;
    this.registry = registry;
    this.merger = merger;
  }

  public async executeOnEntity(
    targetStore: GraphStore,
    sourceEntityId: EntityID,
    config: LocalTransformRunConfig
  ): Promise<LocalTransformExecutionOutcome> {
    const pathValidation = validateTransformExecutablePath(
      config.executable,
      config.allowedExecutables
    );
    if (!pathValidation.valid) {
      throw new Error(`Security violation in LocalCliRunner: ${pathValidation.reason}`);
    }

    const sourceEntity = targetStore.dataStore.getEntity(sourceEntityId);
    const entityValue = getPartPrimaryValue(sourceEntity);

    const fieldMap: Record<string, string> = {};
    for (const [k, v] of sourceEntity.properties.values.entries()) {
      if (v !== undefined && v !== null) {
        fieldMap[k] = String(v);
      }
    }

    const escapedFieldArg = formatLocalTransformFieldArg(fieldMap);
    const baseTokens = config.rawParameters ? tokenizeCommandArgs(config.rawParameters) : [];
    const argvDispatched = [...baseTokens, entityValue, escapedFieldArg];

    const ambient =
      config.ambientEnv ??
      (typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {});
    const scrubbedEnvUsed = scrubTransformEnvironment(ambient, config.explicitEnv ?? {});

    const subprocRes = await this.bridge.executeLocalTransformSubprocess({
      command: config.executable,
      args: argvDispatched,
      workingDirectory: config.workingDirectory,
      timeoutMs: config.timeoutMs ?? 30_000,
      env: scrubbedEnvUsed,
    });

    if (!subprocRes.ok) {
      throw subprocRes.error;
    }

    const { exitCode, stdout, stderr, durationMs } = subprocRes.value;
    if (exitCode !== 0) {
      throw new Error(
        `Local transform '${config.executable}' exited with non-zero code ${exitCode}: ${stderr}`
      );
    }

    const parsedResponse = parseTransformV2ResponseXml(stdout, {
      sourceEntityId,
      registry: this.registry,
      hardLimit: config.hardLimit ?? 255,
    });

    if (parsedResponse.isException) {
      const msg = parsedResponse.exceptions.map((e) => `[${e.code}] ${e.message}`).join('; ');
      throw new Error(`Transform returned exception envelope: ${msg}`);
    }

    const mergeResult = this.merger.merge(
      targetStore,
      {
        entities: parsedResponse.entities,
        links: parsedResponse.links,
      },
      config.mergeStrategy ?? 'Merge'
    );

    return {
      exitCode,
      stderr,
      durationMs,
      parsedResponse,
      mergeResult,
      scrubbedEnvUsed,
      argvDispatched,
    };
  }
}
