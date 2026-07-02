# PLAN DE EJECUCIÓN DE LAS MEJORAS — App Registry v2.0
## Memoria temporal + Time-slider + Watcher en vivo + Chat estilo NotebookLM + Espejo NotebookLM
Fecha: 2026-07-02 · Para: arquitecto Claude Code LOCAL en Windows (repo C:\Users\carlo\repos\registry\app)
Protocolo obligatorio: el ciclo de 6 pasos de PLAN-EJECUCION-MAESTRO.md § 0 (analizar → planificar
→ implementar → verificar adversarial → gate con evidencia → commit). Referencias de código
verificadas en AUDITORIA-2026-07-02.md.

> PRERREQUISITO: v1.0 cerrada (Pasos 1-3 de la auditoría: AsyncFileDialog, verificación F5,
> MSIX reproducible, password purgado, tag v1.0). NO empezar M1 sin el tag v1.0.

> ORDEN: M1 → M2 → M3 → M4 → M5(opcional) → M6. M1 es la base técnica de todo: no saltártela.

═══════════════════════════════════════════════════════════════════
## FASE M1 — PIPELINE ÚNICO DEL GRAFO (la base, ~1 día)
═══════════════════════════════════════════════════════════════════
**Por qué primero**: hoy el grafo se construye DOS veces al cargar (GraphCanvas.tsx: effect
[data] líneas ~140-154 + effect de filtros ~156-201) y cada rebuild asigna posiciones
Math.random() a nodos sin x/y (hooks/useGraph.ts:68-69) → los nodos SALTAN. Con updates en
vivo (M2) y snapshots (M3) esto se convierte en un grafo que baila constantemente. Se arregla
ANTES de construir encima.

**1. ANALIZAR (2 agentes read-only en paralelo):**
- Agente A: mapa completo del flujo de datos: App.tsx (adaptRawGraph, setGraph) → appStore →
  GraphCanvas (todos los useEffect, con líneas) → hooks/useGraph.ts (buildGraphologyGraph).
  Entregable: diagrama de quién dispara qué y cuántas veces se construye el grafo por acción
  (cargar / filtrar / seleccionar / fit).
- Agente B: inventario de estado muerto y duplicado: isLayoutPaused + atajo Space
  (useKeyboard.ts:52-56), hoveredNodeId sin lectores, NODE_TYPE_COLORS triplicado
  (hooks/useGraph.ts, NodeDetailPanel.tsx, ¿FilterBar?), paletas de comunidad desalineadas
  (12 colores canvas vs 10 UI).

**2. IMPLEMENTAR (1 solo agente, estos archivos):**
- hooks/useGraph.ts: `buildGraphologyGraph` acepta `positionCache: Map<nodeId,{x,y}>`.
  Nodos con posición cacheada la reutilizan; solo los NUEVOS reciben posición (radial/aleatoria).
  Devolver también el cache actualizado.
- GraphCanvas.tsx: UN solo useEffect [data, filtros] que construye el grafo una vez con el
  cache persistente en un useRef. Eliminar la doble construcción.
- Limpieza aprovechando el paso: borrar isLayoutPaused + Space + hoveredNodeId muertos;
  unificar NODE_TYPE_COLORS y paleta de comunidades en UN módulo `src/constants/colors.ts`
  importado por todos.
**3. VERIFICAR (3 adversariales):** (a) lente regresión: filtrar/desfiltrar 10 veces → las
posiciones NO cambian; seleccionar+fit siguen funcionando; (b) lente rendimiento: cargar
C:\Carlos (grafo grande) → una sola construcción (console.time), sin doble render;
(c) lente correctness: nodos que aparecen tras desfiltrar conservan su posición original.
**4. GATE:** `npx tsc --noEmit` limpio + los 3 adversariales sin refutación + vídeo/descripción
de Carlos: "filtro y los nodos ya no saltan". COMMIT + tag `m1-pipeline-unico`.

═══════════════════════════════════════════════════════════════════
## FASE M2 — WATCHER EN VIVO 🔴 (el "wow", ~2 días)
═══════════════════════════════════════════════════════════════════
**Qué es**: la app observa la carpeta abierta; cuando algo cambia (tú o un agente de Claude
Code tocáis archivos), el grafo se actualiza SOLO en <3 segundos. Ver a los agentes trabajar
en tiempo real sobre el mapa.

**1. ANALIZAR (2 agentes):**
- Agente A (Rust): indexer.rs — puntos de entrada del indexado (index_project en lib.rs:90),
  cuánto tarda un re-index completo de un repo mediano (medirlo), qué estructuras devuelve.
- Agente B (docs+web): crate `notify` v6+ en Windows: debouncing recomendado, eventos
  duplicados NTFS, exclusiones (node_modules, .git, target, dist — reutilizar las que ya
  tenga el indexer).

**2. IMPLEMENTAR:**
- Rust (src-tauri): nuevo módulo `watcher.rs`:
  - Comandos `start_watch(path)` / `stop_watch()` (State con el watcher activo; matar el
    anterior al abrir otra carpeta).
  - notify con debounce de 1.5-2s (acumular eventos, re-indexar UNA vez por ráfaga).
  - v1 pragmática: re-index COMPLETO con el indexer existente (ya tarda <5s en repos de
    código según F5) — la incrementalidad fina es v2.1, no bloquea.
  - Al terminar: `app_handle.emit("graph-updated", graph_json)`.
  - Excluir SIEMPRE graphify-out/ (¡el indexer escribe ahí — bucle infinito si no!).
- React: en App.tsx, `listen("graph-updated")` → adaptRawGraph → setGraph (el pipeline M1 con
  positionCache hace que la actualización sea suave, sin saltos). Toggle UI en StatusBar:
  "🔴 Live" on/off (default ON al abrir carpeta).
**3. VERIFICAR (3 adversariales + 1 E2E real):** (a) crear/borrar/renombrar archivos en
ráfaga → una sola actualización, sin crash; (b) carpeta enorme (C:\Carlos) → el watch no
come CPU en reposo (Task Manager <1%); (c) abrir otra carpeta → el watcher viejo muere
(no quedan dos vivos); (d) E2E: abrir el repo TraductorLive en la app, pedirle a una sesión
de Claude Code que edite 3 archivos → verlos aparecer/cambiar en el grafo en <3s cada uno.
**4. GATE:** el E2E (d) grabado/descrito por Carlos + adversariales sin refutación.
COMMIT + tag `m2-watcher-vivo`.

═══════════════════════════════════════════════════════════════════
## FASE M3 — MEMORIA TEMPORAL + TIME-SLIDER 🕰️ (el diferenciador, ~3 días)
═══════════════════════════════════════════════════════════════════
**Qué es**: cada indexación (manual o del watcher) guarda un snapshot con fecha/hora y el
DIFF (qué apareció, cambió, desapareció). Un slider en la UI reconstruye el grafo COMO ERA
en cualquier momento: verde=nuevo, rojo=borrado, ámbar=modificado. La app gana memoria.

**1. ANALIZAR (2 agentes):**
- Agente A: formato exacto del graph JSON que emite indexer.rs (nodos: id/tipo/lines/language;
  edges: source/target/type) — el diff se define sobre ESE formato real.
- Agente B (web+docs): rusqlite en Tauri 2 (bundled feature, sin instalar nada en el sistema)
  vs JSONL por snapshot. DECISIÓN POR DEFECTO: **SQLite con rusqlite bundled**, esquema
  compatible con el del servidor (ver MEJORAS-CLAUDE § 3 "un cerebro dos caras"):
  `scans(scan_id, ts, project_path)` · `change_events(ts, scan_id, entity_id, change_type
  added|modified|removed, payload_json)` · snapshot completo comprimido por scan.
  Ubicación: `<carpeta>/graphify-out/history.db` (excluida del watcher e ignorada por git
  vía .gitignore que la app añade si no existe).

**2. IMPLEMENTAR (2 tandas):**
- Tanda Rust: módulo `history.rs`: tras cada index (manual o watcher) → diff contra el
  último scan (por entity_id: nodos y edges añadidos/quitados; modificado = mismo id con
  lines/hash distinto) → INSERT scan + events + snapshot. Comandos:
  `get_history(path) -> [scans con ts y contadores]`, `get_snapshot(scan_id) -> graph_json`,
  `get_changes(scan_id) -> events`.
- Tanda React: componente `TimeSlider.tsx` (bajo el StatusBar, visible solo si history>1):
  marcas por scan, tooltip con fecha/hora y "+12 ~3 -1". Al arrastrar → get_snapshot →
  setGraph con positionCache (M1: las posiciones no saltan entre fechas) + pintar overlay
  de colores con get_changes (verde/ámbar/rojo vs el scan anterior). Botón "HOY" vuelve
  al presente y re-activa el watcher (en el pasado, watcher pausa la vista, no el fondo).
**3. VERIFICAR (3 adversariales + E2E):** (a) integridad: 10 scans simulados → cada
snapshot reconstruye EXACTAMENTE el grafo de su momento (comparación por hash del JSON);
(b) borde: primer scan (sin anterior), carpeta con 0 cambios entre scans (no debe crear
eventos), history.db corrupta/borrada (la app no crashea, empieza de cero); (c) tamaño:
100 scans de un repo mediano → history.db < 50MB (si no: activar compresión del snapshot);
(d) E2E Carlos: trabajar 1 hora con el watcher ON, luego arrastrar el slider y VER la
película de su hora de trabajo.
**4. GATE:** E2E (d) + adversariales. COMMIT + tag `m3-memoria-slider`.

═══════════════════════════════════════════════════════════════════
## FASE M4 — CHAT ESTILO NOTEBOOKLM 💬 (~2-3 días)
═══════════════════════════════════════════════════════════════════
**Qué es**: panel de chat DENTRO de la app: "¿qué cambió esta semana?", "¿qué archivos
dependen de X?", "resúmeme esta carpeta". Respuestas de Claude con el grafo + la memoria
(M3) como contexto. La experiencia NotebookLM, local, con TUS datos.

**VENTAJA DESCUBIERTA EN LA AUDITORÍA**: ya existe `ai_bridge.rs` (HTTP :44444) con
get_ai_status/get_ai_highlights y AiBridgeBadge en la UI — media infraestructura hecha.

**1. ANALIZAR (2 agentes):**
- Agente A: ai_bridge.rs completo — qué endpoints tiene, cómo se gestiona el State, cómo
  extenderlo sin romper lo existente.
- Agente B (web): API de Anthropic 2026 para este uso: modelo recomendado para chat con
  contexto de grafo (Sonnet actual), streaming SSE, prompt-caching para no re-pagar el grafo
  en cada pregunta, manejo de API key de usuario.

**2. IMPLEMENTAR (2 tandas):**
- Tanda Rust: en ai_bridge o comando Tauri directo `ask_claude(question, scope)`:
  construye contexto = resumen del grafo actual (nodos por tipo, top-degree, árbol de dirs)
  + change_events del rango pedido + (si scope=archivo) contenido del archivo; llama a la
  API de Anthropic (key desde settings de la app, guardada con tauri-plugin-store o archivo
  en AppData — NUNCA hardcodeada) con streaming; system prompt: "Eres el analista de esta
  carpeta. Responde SOLO con base en el contexto. Cita entity_ids".
- Tanda React: `ChatPanel.tsx` (panel lateral derecho, toggle en Toolbar): historial de la
  sesión, streaming visible, y BONUS-NotebookLM: al citar Claude un entity_id, click →
  selecciona y centra ese nodo en el grafo (usa selectedNodeId + fitRequestId existentes).
  Pantalla mínima de Settings para la API key (validar con un ping al cargar).
**3. VERIFICAR (3 adversariales + E2E):** (a) sin API key / key inválida / sin internet →
mensajes claros, cero crash; (b) inyección: una pregunta maliciosa no puede hacer que la app
ejecute nada (el chat solo LEE contexto); (c) coste: una pregunta típica < $0.05 con
prompt-caching activo (medir con usage de la respuesta); (d) E2E: 5 preguntas de Carlos
sobre un repo real con respuestas correctas verificables contra el grafo/eventos.
**4. GATE:** E2E + adversariales. COMMIT + tag `m4-chat`.

═══════════════════════════════════════════════════════════════════
## FASE M5 — ESPEJO NOTEBOOKLM (opcional, ~1 día)
═══════════════════════════════════════════════════════════════════
**Qué es**: botón "Export digest" que genera un Markdown-resumen de la carpeta (estructura,
cambios recientes con fechas, top archivos) listo para NotebookLM de Google.
- Vía A (oficial, no se rompe): exportar a una carpeta local que Carlos tiene sincronizada
  con Google Drive → NotebookLM auto-sync lo re-indexa (Docs nativos: convertir con Drive).
- Vía B (turbo, no crítica): integración opcional con teng-lin/notebooklm-py (17k stars):
  la app llama al CLI si está instalado (`notebooklm-py upload ...`) para subir/refrescar
  el digest directamente. ⚠️ Marcada EXPERIMENTAL en la UI: usa APIs no oficiales de Google.
**VERIFICAR:** digest generado legible + (si B) subida real a un notebook de prueba.
**GATE:** Carlos pregunta a NotebookLM "¿qué hay en esta carpeta?" y responde bien.
COMMIT + tag `m5-espejo-notebooklm`.

═══════════════════════════════════════════════════════════════════
## FASE M6 — RELEASE v2.0 (~½ día)
═══════════════════════════════════════════════════════════════════
Regenerar MSIX con el script canónico (paso 3 de la auditoría) → probar instalación →
GitHub Release `v2.0.0` (MSIX + .cer + SHA256 + notas destacando: grafo en vivo, viaje en
el tiempo, chat) → actualizar README con GIFs de las 3 features. GATE: un desconocido
instala desde GitHub y usa las 3 features siguiendo solo el README.

═══════════════════════════════════════════════════════════════════
## MAPA ANTI-COLISIÓN (un dueño por archivo y fase)
═══════════════════════════════════════════════════════════════════
| Fase | Archivos que toca |
|---|---|
| M1 | hooks/useGraph.ts, GraphCanvas.tsx, appStore.ts, useKeyboard.ts, constants/colors.ts (nuevo), NodeDetailPanel.tsx, FilterBar.tsx |
| M2 | src-tauri: watcher.rs (nuevo), lib.rs (registro), Cargo.toml (notify) · React: App.tsx, StatusBar.tsx |
| M3 | src-tauri: history.rs (nuevo), lib.rs, Cargo.toml (rusqlite) · React: TimeSlider.tsx (nuevo), App.tsx, GraphCanvas.tsx (overlay colores) |
| M4 | src-tauri: ai_bridge.rs, lib.rs · React: ChatPanel.tsx (nuevo), Toolbar.tsx, Settings (nuevo) |
| M5 | src-tauri: export.rs (nuevo) · React: Toolbar.tsx |
M2 y M3 comparten App.tsx/lib.rs → SECUENCIALES. M4 puede empezar su análisis en paralelo a M3.

## ESTIMACIÓN HONESTA
M1: 1d · M2: 2d · M3: 3d · M4: 2-3d · M5: 1d · M6: ½d → **~9-10 días de arquitecto** con
verificación real incluida. Cada fase termina con tag: se puede parar en cualquier gate y
lo hecho queda usable.

## RECORDATORIOS AL ARQUITECTO (§11 aplica)
- Si el código real difiere de lo que este plan asume: corrige el plan, no fuerces el código,
  y repórtalo en el informe de fase.
- Cada fase: informe con evidencia (comandos + outputs) + feedback §4.1.
- El SM (Claude) audita cada gate. No te autoconcedas gates.
