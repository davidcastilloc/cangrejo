# Security Policy & Zero-Knowledge Threat Model 🛡️

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `1.0.x` (`@cangrejo/*`) | :white_check_mark: Active Security Support |

---

## Cryptographic Architecture: *Bóveda Cero* (Zero-Knowledge Vault)

Cangrejo implements selective client-side Zero-Knowledge encryption (`packages/transforms/src/formats/MtgjJsonHandler.ts`) so forensic investigators can store or share graph topologies without exposing sensitive PII or classified indicators to cloud storage providers:

1. **Key Derivation (`PBKDF2-HMAC-SHA256`)**:
   - `600,000` iterations (OWASP 2024+ recommended minimum) with a cryptographically random `128-bit` salt.
   - Derives two independent `256-bit` keys via domain separation: $K_{\text{enc}}$ (Encryption Key) and $K_{\text{mac}}$ (Topological Authentication Key).
2. **Confidentiality & Length-Leakage Mitigation (`AES-256-GCM` + `PKCS#7` 256-Byte Block Padding)**:
   - Sensitive entity and link payloads (`value`, `properties`, `notes`, `displayInfo`) are padded to multiples of `256 bytes` prior to `AES-256-GCM` encryption with a unique `96-bit` IV, preventing traffic/storage length analysis.
3. **Whole-Graph Topological Integrity (`AES-GMAC`)**:
   - To prevent an untrusted server from silently dropping edges, swapping node IDs, or splicing foreign entities into an encrypted `.cgrj` document, Cangrejo computes an `AES-GMAC` tag over the canonical sorted list of all entity IDs and directed `(sourceId, linkId, targetId)` triples.

---

## Local CLI Transform Hardening

`LocalCliRunner` (`packages/transforms/src/execution/LocalCliRunner.ts`) enforces strict command-injection prevention:
- **Zero Shell Evaluation**: Always spawns child processes with `shell: false`.
- **State-Machine Tokenizer (`ArgvTokenizer`)**: Rejects unclosed quotes and dangerous shell metacharacters.
- **Process Supervision**: Enforces configurable execution timeouts (`SIGTERM` → `SIGKILL` grace period) and `stdout`/`stderr` byte caps.

---

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues. Instead, open a private GitHub Security Advisory in the repository's **Security** tab or contact the maintainers directly. We aim to acknowledge reports within **48 hours** and provide a remediation timeline within **7 days**.
