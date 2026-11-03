import {
  EntityRegistry,
  StrategicGraphMerger,
  type EntityID,
  type GraphStore,
  type MergeResult,
  type PartMergeStrategyMode,
} from '@cangrejo/core';
import {
  buildTransformV2RequestXml,
  parseTransformV2ResponseXml,
  type ParsedTransformV2Response,
} from '../parsers/XmlV2MessageParser.js';

export type HttpV2Transport = (
  url: string,
  xmlBody: string,
  headers: Record<string, string>
) => Promise<{ status: number; bodyText: string }>;

/**
 * Transform Protocol v2 HTTP/XML Client (`ProtocolV2Client`).
 * Dispatches `<MaltegoTransformRequestMessage>` envelopes, parses `<MaltegoTransformResponseMessage>`,
 * and merges discovered entities and links into `GraphStore` via `StrategicGraphMerger`.
 */
export class ProtocolV2Client {
  private readonly transport: HttpV2Transport;
  private readonly registry: EntityRegistry;
  private readonly merger: StrategicGraphMerger;

  public constructor(
    transport?: HttpV2Transport,
    registry = new EntityRegistry(),
    merger = new StrategicGraphMerger()
  ) {
    this.registry = registry;
    this.merger = merger;
    this.transport =
      transport ??
      (async (url, xmlBody, headers) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=utf-8', ...headers },
          body: xmlBody,
        });
        return { status: res.status, bodyText: await res.text() };
      });
  }

  public async runTransform(
    targetStore: GraphStore,
    sourceEntityId: EntityID,
    options: {
      serverUrl: string;
      transformName: string;
      transformFields?: Record<string, string>;
      softLimit?: number;
      hardLimit?: number;
      mergeStrategy?: PartMergeStrategyMode;
      headers?: Record<string, string>;
    }
  ): Promise<{
    requestXml: string;
    parsedResponse: ParsedTransformV2Response;
    mergeResult: MergeResult;
  }> {
    const sourceEntity = targetStore.dataStore.getEntity(sourceEntityId);
    const requestXml = buildTransformV2RequestXml({
      entities: [sourceEntity],
      transformFields: options.transformFields,
      softLimit: options.softLimit ?? 12,
      hardLimit: options.hardLimit ?? 255,
    });

    const separator = options.serverUrl.includes('?') ? '&' : '?';
    const fullUrl = `${options.serverUrl}${separator}Command=_RUN&TransformToRun=${encodeURIComponent(options.transformName)}`;

    const httpRes = await this.transport(fullUrl, requestXml, options.headers ?? {});
    if (httpRes.status >= 400) {
      throw new Error(`Protocol v2 HTTP ${httpRes.status} error from ${fullUrl}`);
    }

    const parsedResponse = parseTransformV2ResponseXml(httpRes.bodyText, {
      sourceEntityId,
      registry: this.registry,
      hardLimit: options.hardLimit ?? 255,
    });

    if (parsedResponse.isException) {
      const msg = parsedResponse.exceptions.map((e) => `[${e.code}] ${e.message}`).join('; ');
      throw new Error(`Protocol v2 Transform Exception: ${msg}`);
    }

    const mergeResult = this.merger.merge(
      targetStore,
      {
        entities: parsedResponse.entities,
        links: parsedResponse.links,
      },
      options.mergeStrategy ?? 'Merge'
    );

    return {
      requestXml,
      parsedResponse,
      mergeResult,
    };
  }
}
