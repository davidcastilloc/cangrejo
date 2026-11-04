export type ThemeMode = 'dark' | 'light';

export interface ThemePaletteTokens {
  mode: ThemeMode;
  surfaceCanvas: string;
  surfacePanel: string;
  surfacePanelElevated: string;
  surfaceSunken: string;
  surfaceOverlay: string;
  borderSubtle: string;
  borderDefault: string;
  borderStrong: string;
  borderFocus: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textSubtle: string;
  accentPrimary: string;
  accentHover: string;
  canvasGridDots: string;
  nodeCardBg: string;
  nodeCardBgSelected: string;
  nodeCardBorder: string;
  nodeCollectionPlinthBg: string;
  nodeCollectionPlinthBorder: string;
  edgeDefault: string;
  edgeProxy: string;
  edgeLabelBg: string;
  edgeLabelBorder: string;
  edgeLabelText: string;
  minimapBg: string;
  minimapViewportStroke: string;
}

export const DARK_TOKENS: ThemePaletteTokens = {
  mode: 'dark',
  surfaceCanvas: '#0A0B0D',
  surfacePanel: '#111317',
  surfacePanelElevated: '#181B20',
  surfaceSunken: '#15181E',
  surfaceOverlay: 'rgba(17, 19, 23, 0.94)',
  borderSubtle: '#22262E',
  borderDefault: '#2B303B',
  borderStrong: '#3D4452',
  borderFocus: '#EAB308',
  textPrimary: '#F4F4F6',
  textSecondary: '#A1A7B3',
  textMuted: '#A1A7B3',
  textSubtle: '#D4D8E0',
  accentPrimary: '#EAB308',
  accentHover: '#FACC15',
  canvasGridDots: 'rgba(255, 255, 255, 0.06)',
  nodeCardBg: '#14171C',
  nodeCardBgSelected: '#1F1D14',
  nodeCardBorder: '#2B303B',
  nodeCollectionPlinthBg: '#181B20',
  nodeCollectionPlinthBorder: '#EAB308',
  edgeDefault: 'rgba(161, 167, 179, 0.52)',
  edgeProxy: '#EAB308',
  edgeLabelBg: 'rgba(17, 19, 23, 0.95)',
  edgeLabelBorder: '#2B303B',
  edgeLabelText: '#D4D8E0',
  minimapBg: 'rgba(14, 16, 19, 0.92)',
  minimapViewportStroke: '#EAB308',
};

export const LIGHT_TOKENS: ThemePaletteTokens = {
  mode: 'light',
  surfaceCanvas: '#F8FAFC',
  surfacePanel: '#FFFFFF',
  surfacePanelElevated: '#F1F5F9',
  surfaceSunken: '#E2E8F0',
  surfaceOverlay: 'rgba(255, 255, 255, 0.94)',
  borderSubtle: 'rgba(15, 23, 42, 0.07)',
  borderDefault: 'rgba(15, 23, 42, 0.13)',
  borderStrong: 'rgba(15, 23, 42, 0.24)',
  borderFocus: '#2563EB',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#475569',
  textSubtle: '#334155',
  accentPrimary: '#2563EB',
  accentHover: '#1D4ED8',
  canvasGridDots: 'rgba(15, 23, 42, 0.09)',
  nodeCardBg: '#FFFFFF',
  nodeCardBgSelected: '#EFF6FF',
  nodeCardBorder: 'rgba(15, 23, 42, 0.18)',
  nodeCollectionPlinthBg: '#F1F5F9',
  nodeCollectionPlinthBorder: '#2563EB',
  edgeDefault: 'rgba(71, 85, 105, 0.60)',
  edgeProxy: '#2563EB',
  edgeLabelBg: 'rgba(255, 255, 255, 0.96)',
  edgeLabelBorder: 'rgba(15, 23, 42, 0.16)',
  edgeLabelText: '#1E293B',
  minimapBg: 'rgba(255, 255, 255, 0.92)',
  minimapViewportStroke: '#2563EB',
};

export interface CategoryVisualToken {
  id: string;
  label: string;
  colorDark: string;
  colorLight: string;
  /** Crisp 2-3 char vector monogram / code used inside micro-badge icon wells (zero OS emojis) */
  code: string;
  svgPath: string;
}

export const CATEGORY_VISUAL_TOKENS: Record<string, CategoryVisualToken> = {
  infrastructure: {
    id: 'infrastructure',
    label: 'Infrastructure',
    colorDark: '#38BDF8',
    colorLight: '#0284C7',
    code: 'NET',
    svgPath: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm-1 17.93A8 8 0 0 1 4.07 13H11zM4.07 11A8 8 0 0 1 11 4.07V11zm8.93 8.93V13h6.93A8 8 0 0 1 13 19.93zM13 11V4.07A8 8 0 0 1 19.93 11z',
  },
  devices: {
    id: 'devices',
    label: 'Devices',
    colorDark: '#818CF8',
    colorLight: '#4F46E5',
    code: 'DEV',
    svgPath: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm-2 14h20v2H2z',
  },
  groups: {
    id: 'groups',
    label: 'Groups & Orgs',
    colorDark: '#F43F5E',
    colorLight: '#E11D48',
    code: 'ORG',
    svgPath: 'M3 21V3h12v6h6v12H3zm2-2h4v-4H5v4zm0-6h4V9H5v4zm0-6h4V5H5v2zm6 12h4v-4h-4v4zm0-6h4V9h-4v4zm0-6h4V5h-4v2zm6 12h2v-8h-2v8z',
  },
  people: {
    id: 'people',
    label: 'People',
    colorDark: '#FB923C',
    colorLight: '#EA580C',
    code: 'PER',
    svgPath: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z',
  },
  locations: {
    id: 'locations',
    label: 'Locations',
    colorDark: '#34D399',
    colorLight: '#059669',
    code: 'GEO',
    svgPath: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 2.5-2.5 2.5 2.5 0 0 1-2.5 2.5z',
  },
  events: {
    id: 'events',
    label: 'Events & Incidents',
    colorDark: '#FBBF24',
    colorLight: '#D97706',
    code: 'EVT',
    svgPath: 'M13 2L3 14h7l-1 8 10-12h-7l1-8z',
  },
  tracking: {
    id: 'tracking',
    label: 'Tracking & Codes',
    colorDark: '#A78BFA',
    colorLight: '#7C3AED',
    code: 'TRK',
    svgPath: 'M12 8a4 4 0 1 0 4 4 4 4 0 0 0-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2z',
  },
  socialnetwork: {
    id: 'socialnetwork',
    label: 'Social Network',
    colorDark: '#60A5FA',
    colorLight: '#2563EB',
    code: 'SOC',
    svgPath: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7a3.27 3.27 0 0 0 0-1.39l7.05-4.11A2.99 2.99 0 1 0 15 5a3.27 3.27 0 0 0 .09.7L8.04 9.81a3 3 0 1 0 0 4.38l7.12 4.16c-.05.21-.08.43-.08.65a2.92 2.92 0 1 0 2.92-2.92z',
  },
  weapons: {
    id: 'weapons',
    label: 'Threat & Malware',
    colorDark: '#EF4444',
    colorLight: '#DC2626',
    code: 'THR',
    svgPath: 'M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z',
  },
  personal: {
    id: 'personal',
    label: 'Personal ID',
    colorDark: '#F472B6',
    colorLight: '#DB2777',
    code: 'PID',
    svgPath: 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 3a3 3 0 1 1-3 3 3 3 0 0 1 3-3zm6 11H6v-1c0-2 4-3.1 6-3.1s6 1.1 6 3.1z',
  },
  transportation: {
    id: 'transportation',
    label: 'Transportation',
    colorDark: '#2DD4BF',
    colorLight: '#0D9488',
    code: 'TRN',
    svgPath: 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z',
  },
  common: {
    id: 'common',
    label: 'Common Artifacts',
    colorDark: '#94A3B8',
    colorLight: '#475569',
    code: 'DOC',
    svgPath: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z',
  },
};

export function resolveCategoryVisual(category: string): CategoryVisualToken {
  const key = category.toLowerCase().replace(/\s+/g, '');
  return CATEGORY_VISUAL_TOKENS[key] ?? CATEGORY_VISUAL_TOKENS['infrastructure']!;
}

export type ThemeChangeListener = (mode: ThemeMode, tokens: ThemePaletteTokens) => void;

/**
 * Dynamic Theme Bridge (`ThemeBridge`) synchronizing DOM `[data-theme]` attributes
 * with the HTML5 Canvas 2D / WebGPU Scenegraph in < 1 ms.
 */
export class ThemeBridge {
  private static instance: ThemeBridge | null = null;
  private mode: ThemeMode = 'dark';
  private readonly listeners = new Set<ThemeChangeListener>();

  public static getInstance(): ThemeBridge {
    if (!ThemeBridge.instance) {
      ThemeBridge.instance = new ThemeBridge();
    }
    return ThemeBridge.instance;
  }

  public getMode(): ThemeMode {
    return this.mode;
  }

  public getTokens(): ThemePaletteTokens {
    return this.mode === 'light' ? LIGHT_TOKENS : DARK_TOKENS;
  }

  public setMode(nextMode: ThemeMode): void {
    this.mode = nextMode;
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', nextMode);
    }
    const tokens = this.getTokens();
    for (const listener of this.listeners) {
      listener(nextMode, tokens);
    }
  }

  public toggleMode(): ThemeMode {
    const next: ThemeMode = this.mode === 'dark' ? 'light' : 'dark';
    this.setMode(next);
    return next;
  }

  public subscribe(listener: ThemeChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.mode, this.getTokens());
    return () => {
      this.listeners.delete(listener);
    };
  }
}
