import {
  EntityRegistry,
  StrategicGraphMerger,
  type EntityID,
  type GraphStore,
  type PartMergeStrategyMode,
} from '@cangrejo/core';
import {
  buildTransformV3RunRequest,
  parseTransformV3RunResponse,
  type TransformV3ChoicePrompt,
  type TransformV3RunResponseJson,
} from '../parsers/JsonV3EventParser.js';

export interface ProtocolV3Transport {
  startRun(
    transformId: string,
    requestBody: Record<string, unknown>
  ): Promise<{ runId: string; state: 'RUNNING' | 'COMPLETED' }>;
  pollResults(
    transformId: string,
    runId: string,
    eventPointer: number,
    eventLimit: number
  ): Promise<TransformV3RunResponseJson>;
  submitPrompt(
    transformId: string,
    runId: string,
    promptId: string,
    selectedValue: string
  ): Promise<void>;
  cancelRun(transformId: string, runId: string): Promise<void>;
}

/**
 * Transform Protocol v3 Asynchronous REST/JSON Streaming Client (`ProtocolV3Client`).
 * Orchestrates `POST /run` -> paginated delta polling (`GET /results`) -> interactive prompt resolution
 * (`POST /prompts/{id}`) -> `DELETE /run/{runId}` cleanup, streaming mutations into `GraphStore`.
 */
export class ProtocolV3Client {
  private readonly transport: ProtocolV3Transport;
  private readonly registry: EntityRegistry;
  private readonly merger: StrategicGraphMerger;

  public constructor(
    transport: ProtocolV3Transport,
    registry = new EntityRegistry(),
    merger = new StrategicGraphMerger()
  ) {
    this.transport = transport;
    this.registry = registry;
    this.merger = merger;
  }

  public async executeStreamingTransform(
    targetStore: GraphStore,
    inputEntityIds: readonly EntityID[],
    options: {
      transformId: string;
      limit?: number;
      transformSettings?: Array<{ name: string; value: string }>;
      mergeStrategy?: PartMergeStrategyMode;
      promptHandler?: (prompt: TransformV3ChoicePrompt) => Promise<string>;
      maxPolls?: number;
    }
  ): Promise<{
    runId: string;
    totalEventsProcessed: number;
    promptsHandled: number;
    uiMessages: Array<{ message: string; type: 'INFO' | 'WARN' | 'ERROR' }>;
  }> {
    const inputEntities = inputEntityIds.map((id) => targetStore.dataStore.getEntity(id));
    const reqBody = buildTransformV3RunRequest({
      entities: inputEntities,
      limit: options.limit ?? 255,
      transformSettings: options.transformSettings,
      graphId: targetStore.graphId.toString(),
    });

    const { runId } = await this.transport.startRun(options.transformId, reqBody);
    let eventPointer = 0;
    let promptsHandled = 0;
    const allUiMessages: Array<{ message: string; type: 'INFO' | 'WARN' | 'ERROR' }> = [];
    const maxPolls = options.maxPolls ?? 50;

    try {
      for (let pollIdx = 0; pollIdx < maxPolls; pollIdx++) {
        const pollResponse = await this.transport.pollResults(
          options.transformId,
          runId,
          eventPointer,
          100
        );
        const parsed = parseTransformV3RunResponse(pollResponse, this.registry);
        eventPointer = parsed.eventPointer;
        allUiMessages.push(...parsed.uiMessages);

        // Apply ADD / UPDATE / DELETE deltas inside a single atomic batch
        targetStore.runInBatch(() => {
          if (parsed.entitiesToUpsert.length > 0 || parsed.linksToUpsert.length > 0) {
            this.merger.merge(
              targetStore,
              {
                entities: parsed.entitiesToUpsert,
                links: parsed.linksToUpsert,
              },
              options.mergeStrategy ?? 'Merge'
            );
          }

          for (const delLinkId of parsed.linkIdsToDelete) {
            targetStore.removeLink(delLinkId);
          }
          for (const delEntityId of parsed.entityIdsToDelete) {
            targetStore.removeEntity(delEntityId);
          }
        });

        // Handle interactive prompts
        for (const prompt of parsed.prompts) {
          const chosen = options.promptHandler
            ? await options.promptHandler(prompt)
            : (prompt.defaultOptionId ?? prompt.options[0]?.id ?? '');
          await this.transport.submitPrompt(options.transformId, runId, prompt.id, chosen);
          promptsHandled++;
        }

        if (
          parsed.state === 'COMPLETED' ||
          parsed.state === 'FAILED' ||
          parsed.state === 'CANCELLED'
        ) {
          break;
        }
      }
    } finally {
      await this.transport.cancelRun(options.transformId, runId);
    }

    return {
      runId,
      totalEventsProcessed: eventPointer,
      promptsHandled,
      uiMessages: allUiMessages,
    };
  }
}
