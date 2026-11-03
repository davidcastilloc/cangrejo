import {
  formatLocalTransformFieldArg,
  parseLocalTransformFieldArg,
} from '@cangrejo/platform-bridge';

const TOKENIZER_REGEX = /[^\s"']+|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;

const SAFE_AMBIENT_ENV_KEYS = new Set<string>([
  'PATH',
  'HOME',
  'USERPROFILE',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
]);

/**
 * Escapes a single key or value token following Maltego's sequential escaping rules:
 * 1. `\` -> `\\`
 * 2. `=` -> `\=`
 * 3. `#` -> `\#`
 */
export function escapeTransformToken(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/#/g, '\\#');
}

/**
 * Unescapes a token previously escaped with `escapeTransformToken`.
 */
export function unescapeTransformToken(escaped: string): string {
  return escaped.replace(/\\([\\=#])/g, '$1');
}

export { formatLocalTransformFieldArg, parseLocalTransformFieldArg };

/**
 * Tokenizes a CLI parameter string while preserving single- and double-quoted segments.
 */
export function tokenizeCommandArgs(rawArgs: string): string[] {
  const tokens: string[] = [];
  if (!rawArgs || rawArgs.trim().length === 0) return tokens;

  TOKENIZER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKENIZER_REGEX.exec(rawArgs)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    } else if (match[2] !== undefined) {
      tokens.push(match[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
    } else {
      tokens.push(match[0]);
    }
  }
  return tokens;
}

/**
 * Validates that a transform executable path contains no directory traversal (`..`),
 * null bytes, or command-chaining shell metacharacters, and optionally checks an allowlist.
 */
export function validateTransformExecutablePath(
  executablePath: string,
  allowedExecutables?: ReadonlySet<string>
): { valid: boolean; reason?: string } {
  const trimmed = executablePath.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'Executable path cannot be empty.' };
  }
  if (trimmed.includes('\0')) {
    return { valid: false, reason: 'Null byte detected in executable path.' };
  }
  if (trimmed.includes('..')) {
    return { valid: false, reason: 'Path traversal (..) detected in transform executable path.' };
  }
  if (/[;&|`$<>]/.test(trimmed)) {
    return {
      valid: false,
      reason: 'Forbidden shell metacharacter detected in transform executable path.',
    };
  }
  if (allowedExecutables && allowedExecutables.size > 0) {
    const baseName = trimmed.split(/[/\\]/).pop() ?? trimmed;
    if (!allowedExecutables.has(trimmed) && !allowedExecutables.has(baseName)) {
      return {
        valid: false,
        reason: `Executable '${trimmed}' is not in the permitted transform binary allowlist.`,
      };
    }
  }
  return { valid: true };
}

/**
 * Scrubs the host's ambient environment variables so local transform subprocesses
 * never inherit sensitive workstation secrets (API keys, cloud credentials, tokens),
 * retaining only minimal OS runtime variables and explicitly passed transform variables.
 */
export function scrubTransformEnvironment(
  ambientEnv: Record<string, string | undefined>,
  explicitTransformEnv: Record<string, string> = {}
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(ambientEnv)) {
    if (val === undefined) continue;
    const upper = key.toUpperCase();
    if (SAFE_AMBIENT_ENV_KEYS.has(upper)) {
      clean[key] = val;
    }
  }
  for (const [k, v] of Object.entries(explicitTransformEnv)) {
    clean[k] = v;
  }
  return clean;
}
