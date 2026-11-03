import { z } from 'zod';
import type { ValidationOutcome } from './MtgjSchemaValidator.js';

/**
 * CSP-Safe Zod Schemas for CANGREJO (.cgrj / .mtgj v2.0.0 & Pesquisa HTTP Contracts).
 *
 * CRITICAL CONTRACT INVARIANT:
 * Every object schema MUST use `.passthrough()` so that custom OSINT provider attributes,
 * dynamic ontology properties, and enriched metadata are NEVER pruned or stripped during
 * validation or HTTP serialization.
 */

export const CgrjPropertySchema = z
  .object({
    name: z.string().min(1),
    displayName: z.string(),
    type: z.string(),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
    special: z.array(z.string()).optional(),
    matchingRule: z.string().optional(),
    hidden: z.boolean().optional(),
    readonly: z.boolean().optional(),
    nullable: z.boolean().optional(),
  })
  .passthrough();

export const CgrjEntitySchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    weight: z.number().int().min(1),
    position: z
      .object({
        x: z.number(),
        y: z.number(),
        z: z.number().optional(),
      })
      .passthrough()
      .optional(),
    pinned: z.boolean().optional(),
    bookmark: z.number().int().min(-1).max(23).optional(),
    notes: z
      .object({
        value: z.string(),
        show: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    displayInfo: z
      .array(
        z
          .object({
            title: z.string(),
            content: z.string(),
            type: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
    props: z.array(CgrjPropertySchema),
  })
  .passthrough();

export const CgrjLinkSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    reversed: z.boolean().optional(),
    weight: z.number().int().min(1).optional(),
    bookmark: z.number().int().min(-1).max(23).optional(),
    props: z.array(CgrjPropertySchema).optional(),
  })
  .passthrough();

export const CgrjEncryptionEnvelopeSchema = z
  .object({
    algorithm: z.literal('AES-GCM-256'),
    keyWrap: z.enum(['RSA-OAEP-256', 'ECDH-ES+A256KW']),
    salt: z.string().min(1),
    iterations: z.number().int().min(100_000),
    iv: z.string().min(1),
    tag: z.string().min(1),
    gmac: z.string().min(1),
    encryptedFields: z.array(z.string()),
  })
  .passthrough();

export const CgrjDocumentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    schemaVersion: z.literal('2.0.0'),
    metadata: z.record(z.string(), z.unknown()).optional(),
    entities: z.array(CgrjEntitySchema),
    links: z.array(CgrjLinkSchema),
    collections: z.array(z.record(z.string(), z.unknown())).optional(),
    encryption: CgrjEncryptionEnvelopeSchema.nullable().optional(),
  })
  .passthrough();

/**
 * HTTP Contract Schemas for Live Pesquisa OSINT Execution (`POST /api/transforms/run`).
 * Uses `.passthrough()` at every level to guarantee zero field pruning.
 */
export const PesquisaEntityItemSchema = z
  .object({
    typeName: z.string().min(1),
    value: z.string(),
    weight: z.number(),
    fields: z.record(z.string(), z.unknown()),
    linkLabel: z.string(),
    linkColor: z.string(),
  })
  .passthrough();

export const PesquisaRunResponseSchema = z
  .object({
    ok: z.boolean(),
    xmlRequest: z.string().optional(),
    xmlResponse: z.string().optional(),
    entities: z.array(PesquisaEntityItemSchema).optional(),
    messages: z
      .array(
        z
          .object({
            type: z.string(),
            text: z.string(),
          })
          .passthrough()
      )
      .optional(),
    v3Delta: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  })
  .passthrough();

/**
 * Validates a `.cgrj` / `.mtgj` v2.0.0 document using CSP-safe Zod schemas (no `eval` or `new Function`).
 * Preserves all extra properties via `.passthrough()`.
 */
export function validateCgrjWithZod(document: unknown): ValidationOutcome & { data?: unknown } {
  const parsed = CgrjDocumentSchema.safeParse(document);
  if (parsed.success) {
    return {
      valid: true,
      errors: [],
      data: parsed.data,
    };
  }
  const errors = parsed.error.issues.map(
    (issue) => `/${issue.path.join('/')} ${issue.message}`
  );
  return {
    valid: false,
    errors,
  };
}

/**
 * Odoo-Style Open-Core Edition & Entitlements Contracts (`COMMUNITY` vs `ORO_PRO` vs `PLATINO_ENTERPRISE`).
 * Every object schema strictly enforces `.passthrough()` to preserve additive metadata.
 */
export const CangrejoEditionTierSchema = z.enum([
  'COMMUNITY',
  'ORO_PRO',
  'PLATINO_ENTERPRISE',
]);

export const WhiteLabelBrandingSchema = z
  .object({
    organizationName: z.string().min(1),
    badgeTitle: z.string().min(1),
    watermarkEnabled: z.boolean(),
  })
  .passthrough();

export const CangrejoEntitlementsSchema = z
  .object({
    oneClickCloudOsint: z.boolean(),
    whiteLabelDossier: z.boolean(),
    multiAnalystCollab: z.boolean(),
    continuousRadar24x7: z.boolean(),
    maxEntitiesPerExpediente: z.number().int().min(1),
  })
  .passthrough();

export const CangrejoEditionStatusResponseSchema = z
  .object({
    ok: z.boolean(),
    editionTier: CangrejoEditionTierSchema,
    editionLabel: z.string(),
    licenseKeyMasked: z.string().nullable(),
    creditsRemaining: z.number().int().min(0),
    creditsTotal: z.number().int().min(0),
    whiteLabel: WhiteLabelBrandingSchema,
    entitlements: CangrejoEntitlementsSchema,
    updatedAt: z.number(),
  })
  .passthrough();

export const LicenseActivationRequestSchema = z
  .object({
    licenseKey: z.string().optional(),
    tier: CangrejoEditionTierSchema.optional(),
    organizationName: z.string().optional(),
    badgeTitle: z.string().optional(),
  })
  .passthrough();

/**
 * Gate 8 Commercial Schemas:
 * 1. HMAC-SHA256 Signed License Issuance & Billing Webhooks (Stripe / LemonSqueezy)
 * 2. Radar Cangrejo 24/7 Continuous Infrastructure Drift Detection
 * 3. BYOK / Cloud Pool Commercial OSINT Provider Keys (Shodan, VirusTotal, AbuseIPDB)
 * 4. Smart IOC Paste-to-Graph Raw Text Ingestion
 * All object schemas strictly enforce `.passthrough()`.
 */
export const BillingWebhookPayloadSchema = z
  .object({
    provider: z.enum(['stripe', 'lemonsqueezy', 'manual']).optional(),
    eventType: z.string().optional(),
    type: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const ProviderKeyUpdateSchema = z
  .object({
    provider: z.enum(['shodan', 'virustotal', 'abuseipdb', 'securitytrails', 'censys']),
    apiKey: z.string().min(4),
  })
  .passthrough();

export const RadarWatchRequestSchema = z
  .object({
    id: z.string().optional(),
    targetValue: z.string().min(1),
    entityType: z.string().default('maltego.Domain'),
    expedienteId: z.string().optional(),
    baselineIndicators: z.array(z.string()).optional(),
  })
  .passthrough();

export const RadarScanRequestSchema = z
  .object({
    watchId: z.string().min(1),
    observedIndicators: z.array(z.string()).optional(),
  })
  .passthrough();

export const RawTextIngestRequestSchema = z
  .object({
    text: z.string().min(1),
    incidentTitle: z.string().optional(),
    centerX: z.number().optional(),
    centerY: z.number().optional(),
  })
  .passthrough();

/**
 * Gate 9 Schemas: Cloudflare Workers AI & Forensic AI Engine (F1–F5).
 * Hardware-agnostic (Edge Workers AI + Local CPU/Wasm fallback, zero NPU assumption).
 * Every object schema strictly enforces `.passthrough()`.
 */
export const AiExecutionMetaSchema = z
  .object({
    modelId: z.string(),
    executionBackend: z.enum([
      'CLOUDFLARE_WORKERS_AI_BINDING',
      'CLOUDFLARE_WORKERS_AI_REST',
      'LOCAL_CPU_DETERMINISTIC',
    ]),
    estimatedNeurons: z.number().int().min(0),
    estimatedCostUsd: z.number().min(0),
    bovedaCeroSanitized: z.boolean(),
    hardwareRequirement: z.literal('NONE_UNIVERSAL_CPU_OR_EDGE'),
  })
  .passthrough();

export const AiUnpackIocsRequestSchema = z
  .object({
    text: z.string().min(1),
    sanitizeClassified: z.boolean().optional(),
  })
  .passthrough();

export const AiUnpackedIocItemSchema = z
  .object({
    rawFragment: z.string(),
    canonicalValue: z.string(),
    typeName: z.string(),
    wasDefanged: z.boolean(),
    startByteOffset: z.number().int().min(0),
    endByteOffset: z.number().int().min(0),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
  })
  .passthrough();

export const AiUnpackIocsResponseSchema = z
  .object({
    ok: z.boolean(),
    unpackedCount: z.number().int().min(0),
    items: z.array(AiUnpackedIocItemSchema),
    aiMeta: AiExecutionMetaSchema,
  })
  .passthrough();

export const AiLatentLinksRequestSchema = z
  .object({
    expedienteId: z.string().optional(),
    entities: z.array(z.record(z.string(), z.unknown())),
    links: z.array(z.record(z.string(), z.unknown())).optional(),
    topK: z.number().int().min(1).max(25).optional(),
  })
  .passthrough();

export const AiLatentLinkSuggestionSchema = z
  .object({
    sourceEntityId: z.string(),
    targetEntityId: z.string(),
    sourceValue: z.string(),
    targetValue: z.string(),
    suggestedLabel: z.string(),
    rrfScore: z.number().min(0),
    vectorCosineSimilarity: z.number().min(0).max(1),
    lexicalOverlapScore: z.number().min(0).max(1),
    evidenceExplanation: z.string(),
  })
  .passthrough();

export const AiLatentLinksResponseSchema = z
  .object({
    ok: z.boolean(),
    vectorizeNamespace: z.string().max(63),
    rrfConstantK: z.literal(60),
    suggestions: z.array(AiLatentLinkSuggestionSchema),
    aiMeta: AiExecutionMetaSchema,
  })
  .passthrough();

export const AiAnomalyClusterRequestSchema = z
  .object({
    entities: z.array(z.record(z.string(), z.unknown())),
    links: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();

export const AiAnomalyFindingSchema = z
  .object({
    patternId: z.string(),
    patternType: z.enum([
      'FAST_FLUX_INFRASTRUCTURE',
      'CRYPTO_PEEL_CHAIN_LAUNDERING',
      'SHARED_C2_CERTIFICATE_PIVOT',
      'HIGH_CENTRALITY_HUB_ANOMALY',
    ]),
    severity: z.enum(['CRITICO', 'ALTO', 'MEDIO']),
    involvedEntityIds: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    forensicExplanation: z.string(),
  })
  .passthrough();

export const AiAnomalyClusterResponseSchema = z
  .object({
    ok: z.boolean(),
    anomalies: z.array(AiAnomalyFindingSchema),
    aiMeta: AiExecutionMetaSchema,
  })
  .passthrough();

export const AiDaubertSynthesisRequestSchema = z
  .object({
    expedienteId: z.string().optional(),
    title: z.string().optional(),
    leadAnalyst: z.string().optional(),
    entities: z.array(z.record(z.string(), z.unknown())),
    links: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export const AiDaubertSynthesisResponseSchema = z
  .object({
    ok: z.boolean(),
    standard: z.literal('DAUBERT_FRE_702_VERIFIED'),
    contextPruned: z.boolean(),
    examinedNodeCount: z.number().int().min(0),
    executiveNarrative: z.string(),
    citedEntityIds: z.array(z.string()),
    attestation: z
      .object({
        algorithm: z.literal('Ed25519'),
        canonicalSha256Hex: z.string(),
        signatureHex: z.string(),
        publicKeyPem: z.string(),
        signedAtIso: z.string(),
      })
      .passthrough(),
    aiMeta: AiExecutionMetaSchema,
  })
  .passthrough();

export const AiForensicCopilotRequestSchema = z
  .object({
    prompt: z.string().min(1),
    entities: z.array(z.record(z.string(), z.unknown())),
    links: z.array(z.record(z.string(), z.unknown())).optional(),
    selectedEntityIds: z.array(z.string()).optional(),
  })
  .passthrough();

export const AiForensicCopilotResponseSchema = z
  .object({
    ok: z.boolean(),
    answer: z.string(),
    citedEntityIds: z.array(z.string()),
    suggestedToolCalls: z.array(
      z
        .object({
          toolName: z.string(),
          transformId: z.string(),
          targetValue: z.string(),
          reason: z.string(),
        })
        .passthrough()
    ),
    aiMeta: AiExecutionMetaSchema,
  })
  .passthrough();

export const AiAutoInvestigateRequestSchema = z
  .object({
    expedienteId: z.string().optional(),
    maxHops: z.number().int().min(1).max(3).optional(),
    maxTargetsPerHop: z.number().int().min(1).max(5).optional(),
    entities: z.array(z.record(z.string(), z.unknown())),
    links: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export const AiAutoInvestigateStepSchema = z
  .object({
    hop: z.number().int().min(1),
    sourceEntityId: z.string(),
    sourceValue: z.string(),
    sourceTypeName: z.string(),
    transformId: z.string(),
    discoveredCount: z.number().int().min(0),
    rationale: z.string(),
  })
  .passthrough();

export const AiAutoInvestigateResponseSchema = z
  .object({
    ok: z.boolean(),
    hopsExecuted: z.number().int().min(1),
    executedSteps: z.array(AiAutoInvestigateStepSchema),
    discoveredEntities: z.array(z.record(z.string(), z.unknown())),
    discoveredLinks: z.array(z.record(z.string(), z.unknown())),
    anomalies: z.array(AiAnomalyFindingSchema),
    summary: z.string(),
    aiMeta: AiExecutionMetaSchema,
  })
  .passthrough();
