# Original User Request

## Initial Request — 2026-11-05T20:50:45Z

Levantar un equipo para que pruebe la aplicación Cangrejo y todo su ecosistema, intentando usarla para lo que es para QA y también ver errores o bugs ocultos.

Working directory: /home/dcastillo/Projects/cangrejo
Integrity mode: development

## Requirements

### R1. Pruebas end-to-end simulando casos de uso reales de OSINT
Ejecutar pruebas funcionales y de exploración simulando flujos reales de analista de inteligencia de fuentes abiertas en los dos entornos del proyecto: local (Bun/Vite en `/home/dcastillo/Projects/cangrejo`) y producción desplegada (`https://cangrejo-osint-workstation.pc911itservices.workers.dev`). Probar de forma equilibrada los cuatro subsistemas del ecosistema:
1. Interfaz interactiva y lienzo de grafo (catálogo de 107 entidades, creación/edición/inversión de enlaces, inspector de propiedades dinámicas, búsqueda omnicanal ⌘K y exportaciones).
2. Pesquisas OSINT en vivo y conectores de red (DNS, crt.sh, RDAP, RIPEstat, Shodan InternetDB, Mempool, ThreatFox, VirusTotal y AbuseIPDB).
3. Persistencia y bóvedas (BunSqliteVault, Cloudflare D1 + R2, Bóveda Cero con cifrado AES-256-GCM/GMAC, importación/exportación .cgrx y STIX 2.1, dossier forense).
4. Servidor MCP multi-tenant y sesiones (/api/mcp, Durable Object CangrejoSessionRoomDO, inyección de transforms y Code Mode).

### R2. Auditoría y detección de errores ocultos
Identificar fallos funcionales, errores silenciosos, condiciones de carrera en sincronización de estado, fallos de renderizado WebGPU/Canvas, vulnerabilidades o inconsistencias de esquema que no sean detectadas por las suites de pruebas unitarias existentes.

### R3. Reporte exhaustivo de QA
Consolidar todos los hallazgos en un informe estructurado de control de calidad (`QA_FINDINGS_REPORT.md`) que clasifique cada problema detectado por severidad (Crítica, Alta, Media, Baja), detalle los pasos exactos para reproducirlo de forma determinista, señale el comportamiento esperado frente al observado, e identifique el componente o código responsable y la causa raíz diagnosticada.

## Verification Resources
- Suites de pruebas y compuertas arquitectónicas existentes en el monorepo (Gates 0 a 11): ejecución mediante `bun test`, `bun run typecheck` y `bun run moon:check`.
- Despliegue en producción accesible en `https://cangrejo-osint-workstation.pc911itservices.workers.dev`.

## Acceptance Criteria

### Cobertura de Pruebas
- [ ] Los 4 subsistemas (Lienzo/UI, Pesquisas OSINT, Persistencia/Bóvedas, Servidor MCP) han sido probados tanto en el entorno local como contra el despliegue de producción.
- [ ] Las pruebas de uso real validan los flujos de creación/manipulación de entidades y enlaces, invocación de pesquisas, exportación/importación de grafos y llamadas a la API/MCP sin alterar los tests existentes.
- [ ] Todas las pruebas automatizadas existentes del proyecto (`bun test`, `bun run typecheck`) continúan ejecutándose y pasando limpiamente sin regresiones introducidas.

### Informe de Hallazgos
- [ ] El archivo `QA_FINDINGS_REPORT.md` existe en la raíz del proyecto y contiene el registro estructurado de todos los errores y bugs detectados.
- [ ] Cada hallazgo incluye obligatoriamente: identificador único, subsistema afectado, entorno donde ocurre (local, producción o ambos), nivel de severidad, pasos reproducibles paso a paso, comportamiento observado vs. esperado, y análisis de causa raíz técnica.
- [ ] En caso de que un subsistema no presente bugs detectados tras las pruebas, el informe documenta explícitamente los casos de prueba y flujos ejecutados que validaron su correcto funcionamiento.
