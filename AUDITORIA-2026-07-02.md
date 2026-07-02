# AUDITORÍA APP MSIX — estado real contra PLAN.md v1.0
2026-07-02 · 4 auditores en paralelo + síntesis · Evidencia = file:línea verificado

## VEREDICTO: Fase 4 casi cerrada, Fase 5 (verificación) sin ejecutar
La app COMPILA LIMPIA (tsc+vite 3.61s, 0 errores; cargo check 0 warnings) y hay MSIX
firmados funcionales del 1-jul. Lo que falta es CIERRE DE INGENIERÍA, no features.

## SEMÁFORO POR TAREA
| Tarea | Estado | Evidencia |
|---|---|---|
| F0 paquetes npm muertos | ✅ HECHO | package.json:12-23 limpio |
| F0 src/graph/* | 🟡 PARCIAL | vaciados a stubs `export {}`, no borrados |
| F0 sample-graph.json | ⚠️ YA NO BORRABLE | ahora es demo fallback VIVO (App.tsx:16,208,279) |
| F0 tipos muertos NodeType | 🟡 PARCIAL | types/graph.ts:3 conserva 5 tipos muertos |
| T1.1 filtros | ✅ | GraphCanvas.tsx:156-201 |
| T1.2 selección visible | ✅ | GraphCanvas.tsx:78-86 (ámbar + size 1.4x) |
| T1.3 zoom | ✅ | StatusBar.tsx:60 |
| T1.4 degree | ✅ | App.tsx:48-64 + SearchPalette.tsx:110-113 |
| T1.5 colores 4 tipos | ✅ | useGraph.ts:17-20 |
| T1.6 Space pausa layout | ⚠️ OBSOLETO | ya no hay FA2 vivo (layout radial precomputado); Space es un no-op — decisión: borrar flag+atajo |
| T1.7 hover welcome | ✅ | WelcomeScreen.tsx:184-185 |
| T2.1 botón Fit | ✅ | fitRequestId (appStore:182 → StatusBar:186 → GraphCanvas:208) |
| T2.2 Settings borrado | ✅ | Toolbar solo Back/Search/Filter |
| T2.3 "Files:" en dirs | ✅ | NodeDetailPanel.tsx:464, validado contra indexer.rs |
| T2.4 textos welcome | 🟡 PARCIAL | falta subtitle (:177 tiene branding AI Bridge) |
| T3.1 AsyncFileDialog | ❌ NO HECHO | lib.rs:52-55 sigue síncrono — riesgo Alta del propio PLAN |
| T3.2 read-only folders | ✅ | indexer.rs:850-858 y 1035-1043 (best-effort) |
| T4.1 WebView2 embed | ✅ | tauri.conf.json:44 |
| T4.2 script MSIX | 🟡 DIVERGIDO | los MSIX reales salieron de do-sign.ps1 + src-tauri/msix-staging; build-msix.sh roto en checkout limpio (no copia AppxManifest) |
| T4.3 broadFileSystemAccess | 🟡 PERDIDO | ningún .msix vigente lo lleva (runFullTrust compensa) |
| F5 verificación completa | ❌ NUNCA EJECUTADA | T5.1-T5.4 pendientes |

## EXTRAS ENCONTRADOS (no estaban en ningún plan)
- **AI Bridge**: servidor HTTP en :44444 (ai_bridge.rs) + comandos get_ai_status/get_ai_highlights
  + AiBridgeBadge en la UI → ¡media infraestructura del CHAT ya construida!
- Layout radial mindmap propio (reemplazó al FA2 animado)
- Fallback .drift/graph.json en read_graph_json
- Botón "Load Demo Graph" con sample-graph.json

## HALLAZGOS DE SEGURIDAD (antes de pushear a GitHub público)
1. 🔴 Password de certificado "123456" hardcodeado en scripts/build-msix.sh:12 → PURGAR
   (do-sign.ps1 lo hace bien: lee D:/CERTIFICADO/pass.txt)
2. 🔴 app/ estaba UNTRACKED → asegurado en commit 00b65fa (2026-07-02). Push pendiente de purga.
3. 🟡 Cert autofirmado: la instalación en Windows limpio exige instalar el .cer en el trust
   store primero. "Cero configuración" real = Microsoft Store o certificado comprado.

## BUGS UX CONOCIDOS (no bloqueantes)
- Togglear filtros re-layouta el grafo con Math.random (useGraph.ts:68-69) → los nodos saltan
- El grafo se construye 2 veces al cargar (effects [data] + filtros en GraphCanvas)
- Paletas de comunidad desalineadas: canvas 12 colores vs UI 10
- NODE_TYPE_COLORS triplicado en 3 archivos

## PLAN AJUSTADO (desde la realidad)
- **PASO 0 — HECHO 2026-07-02**: commit de app/ + PLAN.md (00b65fa)
- **PASO 1 — Cierre v1.0 (medio día)**: T3.1 AsyncFileDialog · subtitle T2.4 ·
  cachear posiciones al filtrar · borrar isLayoutPaused+Space · purgar password de build-msix.sh
- **PASO 2 — Verificación F5 (1-2h)**: C:\Carlos <30s · repo código <5s · carpeta vacía ·
  smoke completo. Registrar resultados
- **PASO 3 — MSIX reproducible (1-2h)**: UN script PowerShell canónico (patrón do-sign.ps1,
  pass desde archivo, AppxManifest incluido) + decisión broadFileSystemAccess → **TAG v1.0** + push
- **PASO 4 — Funciones nuevas (en este orden, waves separadas)**:
  1. **Watcher en vivo** (notify en Rust → re-index incremental → evento Tauri).
     ANTES: unificar el pipeline de construcción del grafo (hoy se construye 2 veces)
  2. **Memoria temporal + time-slider** encima del watcher (snapshots en graphify-out/history/)
  3. **Chat con Claude** extendiendo el AI Bridge :44444 que YA existe
- **PASO 5 — Release GitHub v1.1**: Action de release (MSIX + .cer + SHA256 + instrucciones)
  + limpieza cosmética como PR separado

Regla: cada paso con el protocolo del PLAN-EJECUCION-MAESTRO.md (analizar → implementar →
verificar adversarial → gate con evidencia → commit).
