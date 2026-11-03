export interface HubSeedItem {
  id: string;
  name: string;
  provider: string;
  description: string;
  seedUrl: string;
  protocolVersion: '2.0' | '3.0';
  requiresApiKey: boolean;
  requiresOAuth: boolean;
  supportedInputTypes: string[];
}

export interface JsonHubResponse {
  version: string;
  timestamp: number;
  items: HubSeedItem[];
}

/**
 * Transform Distribution Server (TDS) & Transform Hub Discovery Client (`HubClient`).
 */
export class HubClient {
  private readonly seeds = new Map<string, HubSeedItem>();

  public ingestHubCatalog(catalogJson: string | JsonHubResponse): HubSeedItem[] {
    const parsed: JsonHubResponse =
      typeof catalogJson === 'string'
        ? (JSON.parse(catalogJson) as JsonHubResponse)
        : catalogJson;

    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error('Invalid JsonHubResponse: missing items array.');
    }

    const added: HubSeedItem[] = [];
    for (const item of parsed.items) {
      if (!item.id || !item.seedUrl) continue;
      const normalized: HubSeedItem = {
        id: item.id,
        name: item.name,
        provider: item.provider,
        description: item.description ?? '',
        seedUrl: item.seedUrl,
        protocolVersion: item.protocolVersion ?? '2.0',
        requiresApiKey: Boolean(item.requiresApiKey),
        requiresOAuth: Boolean(item.requiresOAuth),
        supportedInputTypes: [...(item.supportedInputTypes ?? [])],
      };
      this.seeds.set(normalized.id, normalized);
      added.push(normalized);
    }

    return added;
  }

  public getAllSeeds(): HubSeedItem[] {
    return Array.from(this.seeds.values());
  }

  public findSeedsForEntityType(entityTypeName: string): HubSeedItem[] {
    return Array.from(this.seeds.values()).filter(
      (s) =>
        s.supportedInputTypes.includes('*') ||
        s.supportedInputTypes.includes(entityTypeName)
    );
  }
}
