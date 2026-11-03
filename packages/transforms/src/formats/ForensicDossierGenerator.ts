import {
  analyzeExpedienteForensics,
  getPartPrimaryValue,
  type EntityID,
  type ForensicAnalyticsReport,
  type GraphStore,
} from '@cangrejo/core';
import { CloudflareWorkersAiEngine } from '../ai/CloudflareWorkersAiEngine.js';
import { Stix21Exporter, type Stix21Bundle } from './Stix21Exporter.js';

export interface ForensicDossierOptions {
  expedienteId?: string;
  expedienteTitle?: string;
  caseTier?: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
  leadAnalyst?: string;
  sourceId?: EntityID;
  targetId?: EntityID;
  timestampIso?: string;
  editionTier?: 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE';
  organizationName?: string;
  badgeTitle?: string;
  watermarkEnabled?: boolean;
}

export interface GeneratedForensicDossier {
  expedienteId: string;
  title: string;
  caseTier: 'PLATINO' | 'ORO' | 'PLATA' | 'BRONCE';
  editionTier: 'COMMUNITY' | 'ORO_PRO' | 'PLATINO_ENTERPRISE';
  organizationName: string;
  watermarkEnabled: boolean;
  sha256CustodyDigest: string;
  stixBundleId: string;
  generatedAt: string;
  analytics: ForensicAnalyticsReport;
  daubertSynthesis: {
    standard: 'DAUBERT_FRE_702_VERIFIED';
    executiveNarrative: string;
    citedEntityIds: string[];
    attestation: {
      algorithm: 'Ed25519';
      canonicalSha256Hex: string;
      signatureHex: string;
      publicKeyPem: string;
      signedAtIso: string;
    };
  };
  html: string;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates a self-contained, WCAG AAA print-ready HTML5 Forensic Dossier (`ForensicDossierGenerator`)
 * inspired by Venezuela's scientific criminalistics heritage (*Expediente Pericial — Caso Cangrejo*).
 */
export class ForensicDossierGenerator {
  public static generateFromStore(
    store: GraphStore,
    options?: ForensicDossierOptions
  ): GeneratedForensicDossier {
    const generatedAt = options?.timestampIso ?? new Date().toISOString();
    const expedienteId = options?.expedienteId ?? `EXP-CGRJ-${store.graphId.toString().slice(-6)}`;
    const title = options?.expedienteTitle ?? 'Expediente Pericial de Inteligencia OSINT — CANGREJO';
    const caseTier = options?.caseTier ?? 'ORO';
    const leadAnalyst = options?.leadAnalyst ?? 'Comisario L. Yerena (Unidad CANGREJO)';
    const editionTier = options?.editionTier ?? 'COMMUNITY';
    const organizationName =
      options?.organizationName ??
      'CANGREJO — Unidad de Criminalística Digital & OSINT (Herencia Cangrejo de Oro)';
    const badgeTitle =
      options?.badgeTitle ??
      (editionTier === 'COMMUNITY'
        ? 'CANGREJO COMMUNITY EDITION'
        : `RANGO ${caseTier} · ${editionTier}`);
    const watermarkEnabled = options?.watermarkEnabled ?? editionTier === 'COMMUNITY';
    const communityWatermarkBannerHtml = watermarkEnabled
      ? `<div class="community-watermark">Generado con <strong>CANGREJO Community Edition (Open-Core Apache-2.0)</strong> — Actualice a <em>Cangrejo de Oro / Platino Enterprise</em> para Dossiers Periciales en Marca Blanca.</div>`
      : '';

    const analytics = analyzeExpedienteForensics(store, {
      sourceId: options?.sourceId,
      targetId: options?.targetId,
    });

    const stixBundle: Stix21Bundle = Stix21Exporter.exportFromStore(store, {
      expedienteTitle: title,
      caseTier,
      timestampIso: generatedAt,
    });

    const sha256CustodyDigest = stixBundle.x_cangrejo_custody.canonicalDigestHex;

    const rankingRowsHtml = analytics.pageRank.rankings
      .map((item, idx) => {
        const ent = store.dataStore.tryGetEntity(item.entityId);
        const val = ent ? getPartPrimaryValue(ent) : item.entityId.toString();
        const typeName = ent?.typeName ?? 'maltego.Unknown';
        return `
          <tr>
            <td class="mono">#${idx + 1}</td>
            <td><strong>${escapeHtml(val)}</strong></td>
            <td class="mono">${escapeHtml(typeName)}</td>
            <td class="mono">${item.inDegree} / ${item.outDegree}</td>
            <td class="mono">${item.score.toFixed(4)} (${item.percentile}%)</td>
            <td><span class="tier-badge tier-${item.suggestedTier.toLowerCase()}">${item.suggestedTier}</span></td>
          </tr>`;
      })
      .join('\n');

    const shortestPathHtml =
      analytics.shortestPath && analytics.shortestPath.found
        ? analytics.shortestPath.entityPath
            .map((id) => {
              const ent = store.dataStore.tryGetEntity(id);
              return `<code>${escapeHtml(ent ? getPartPrimaryValue(ent) : id.toString())}</code>`;
            })
            .join(' &rarr; ')
        : '<em>No se especificó par de extremos o no existe ruta conectada.</em>';

    const cyclesHtml =
      analytics.cycles.length > 0
        ? analytics.cycles
            .map((c) => {
              const labels = c.entityIds.map((id) => {
                const ent = store.dataStore.tryGetEntity(id);
                return escapeHtml(ent ? getPartPrimaryValue(ent) : id.toString());
              });
              return `<li><strong>${escapeHtml(c.cycleId)} (${c.length} saltos):</strong> <code>${labels.join(' &rarr; ')}</code></li>`;
            })
            .join('\n')
        : '<li><em>Cero anillos cíclicos detectados en la topología actual.</em></li>';

    const daubertResult = CloudflareWorkersAiEngine.synthesizeDaubertForensicNarrativeSync(store, {
      expedienteId,
      expedienteTitle: title,
      leadAnalyst,
    });

    const daubertNarrativeHtml = daubertResult.executiveNarrative
      .split('\n\n')
      .map((para) => `<p>${escapeHtml(para)}</p>`)
      .join('\n');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} — ${escapeHtml(expedienteId)}</title>
  <style>
    :root {
      --bg: #ffffff;
      --ink: #0f172a;
      --muted: #475569;
      --border: #cbd5e1;
      --surface: #f8fafc;
      --gold: #d97706;
      --cobalt: #1d4ed8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: var(--ink);
      background: var(--bg);
      line-height: 1.5;
    }
    .dossier-container {
      max-width: 980px;
      margin: 0 auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 32px;
    }
    .dossier-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid var(--ink);
      padding-bottom: 18px;
      margin-bottom: 24px;
    }
    .brand-kicker {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--gold);
    }
    h1 {
      font-size: 22px;
      margin: 6px 0 4px 0;
    }
    .meta-line {
      font-size: 12px;
      color: var(--muted);
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .kpi-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px 14px;
    }
    .kpi-label {
      font-size: 11px;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 600;
    }
    .kpi-value {
      font-size: 20px;
      font-weight: 700;
      font-family: "JetBrains Mono", monospace;
      margin-top: 4px;
    }
    h2 {
      font-size: 15px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 1px solid var(--border);
      padding-bottom: 6px;
      margin-top: 26px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
      margin-top: 10px;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 8px 10px;
      text-align: left;
    }
    th {
      background: var(--surface);
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
    }
    .mono {
      font-family: "JetBrains Mono", monospace;
    }
    .tier-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      font-family: "JetBrains Mono", monospace;
    }
    .tier-platino { background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; }
    .tier-oro { background: #fef3c7; color: #b45309; border: 1px solid #fcd34d; }
    .tier-plata { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
    .tier-bronce { background: #ffedd5; color: #9a3412; border: 1px solid #fdba74; }
    .custody-box {
      margin-top: 24px;
      padding: 16px;
      background: #f8fafc;
      border: 1px solid var(--border);
      border-left: 4px solid var(--cobalt);
      border-radius: 6px;
      font-size: 12px;
    }
    .community-watermark {
      margin-top: 18px;
      padding: 10px 14px;
      background: #fffbeb;
      border: 1px dashed #f59e0b;
      border-radius: 6px;
      font-size: 11.5px;
      color: #92400e;
      text-align: center;
    }
    @media print {
      body { padding: 0; }
      .dossier-container { border: none; padding: 0; }
    }
  </style>
</head>
<body>
  <article class="dossier-container">
    <header class="dossier-header">
      <div>
        <div class="brand-kicker">${escapeHtml(organizationName)}</div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta-line">
          Expediente: <strong class="mono">${escapeHtml(expedienteId)}</strong> &bull;
          Investigador Jefe: <strong>${escapeHtml(leadAnalyst)}</strong> &bull;
          Emitido: <span class="mono">${escapeHtml(generatedAt)}</span>
        </div>
      </div>
      <div>
        <span class="tier-badge tier-${caseTier.toLowerCase()}">${escapeHtml(badgeTitle)}</span>
      </div>
    </header>

    <section class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Entidades (IOCs)</div>
        <div class="kpi-value">${analytics.nodeCount}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Enlaces Dirigidos</div>
        <div class="kpi-value">${analytics.edgeCount}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Saltos Eslabón Dorado</div>
        <div class="kpi-value">${analytics.shortestPath?.hopCount ?? 0}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Anillos Cíclicos</div>
        <div class="kpi-value">${analytics.cycles.length}</div>
      </div>
    </section>

    <section>
      <h2>1. El Eslabón Dorado (Camino Forense Más Corto)</h2>
      <p>${shortestPathHtml}</p>
    </section>

    <section>
      <h2>2. Matriz de Centralidad PageRank (Índice Cangrejo de Oro)</h2>
      <table>
        <thead>
          <tr>
            <th>Rango</th>
            <th>Indicador / Entidad</th>
            <th>Tipo Ontológico</th>
            <th>Grado (In / Out)</th>
            <th>Score PageRank</th>
            <th>Clasificación Sugerida</th>
          </tr>
        </thead>
        <tbody>
          ${rankingRowsHtml}
        </tbody>
      </table>
    </section>

    <section>
      <h2>3. Detección de Anillos y Ciclos Dirigidos</h2>
      <ul>
        ${cyclesHtml}
      </ul>
    </section>

    <section>
      <h2>4. Dictamen Pericial Automatizado (Estándar Daubert / FRE 702) &amp; Firma Ed25519</h2>
      ${daubertNarrativeHtml}
      <div class="custody-box" style="margin-top: 12px; border-left-color: var(--gold)">
        <strong>Atestación Criptográfica Judicial (${escapeHtml(daubertResult.standard)})</strong><br />
        <span>Algoritmo de Firma Asimétrica: <code class="mono">${escapeHtml(daubertResult.attestation.algorithm)}</code></span><br />
        <span>Digest Narrativo SHA-256: <code class="mono">${escapeHtml(daubertResult.attestation.canonicalSha256Hex)}</code></span><br />
        <span>Firma Digital Ed25519: <code class="mono" style="word-break: break-all">${escapeHtml(daubertResult.attestation.signatureHex)}</code></span>
      </div>
    </section>

    <section class="custody-box">
      <strong>Certificado de Cadena de Custodia Criptográfica (OASIS STIX 2.1 + FIPS 180-4 SHA-256)</strong><br />
      <span>Organización Emisora: <strong>${escapeHtml(organizationName)}</strong></span><br />
      <span>Bundle ID: <code class="mono">${escapeHtml(stixBundle.id)}</code></span><br />
      <span>SHA-256 Digest Canónico: <code class="mono">${escapeHtml(sha256CustodyDigest)}</code></span><br />
      <span>Objetos STIX 2.1 Exportados: <code class="mono">${stixBundle.objects.length}</code></span>
    </section>
    ${communityWatermarkBannerHtml}
  </article>
</body>
</html>`;

    return {
      expedienteId,
      title,
      caseTier,
      editionTier,
      organizationName,
      watermarkEnabled,
      sha256CustodyDigest,
      stixBundleId: stixBundle.id,
      generatedAt,
      analytics,
      daubertSynthesis: {
        standard: daubertResult.standard,
        executiveNarrative: daubertResult.executiveNarrative,
        citedEntityIds: daubertResult.citedEntityIds,
        attestation: daubertResult.attestation,
      },
      html,
    };
  }
}
