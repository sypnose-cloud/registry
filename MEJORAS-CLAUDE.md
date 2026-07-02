# MEJORAS PROPUESTAS — aporte de Claude sobre el diseño de Carlos
Fecha: 2026-07-02 · Complementa (no sustituye) PLAN.md v1.0
Base: investigación verificada 2026 (docs oficiales Claude Code, NotebookLM, Tauri, precedentes OSS)

El diseño (app MSIX "abre carpeta → grafo" + Registry servidor) es de Carlos.
Esto es lo que YO añadiría, ordenado por valor/esfuerzo.

---

## ⭐ MEJORA 1 — Memoria temporal + TIME-SLIDER en la app (el diferenciador)
**Qué añade a tu diseño:** hoy la app indexa al abrir y muestra el presente. Con esto,
cada indexación se guarda como snapshot (SQLite embebido vía rusqlite en `indexer.rs`,
cero dependencias externas) y se computa el diff: añadido/modificado/borrado por fecha/hora.
En la UI: un slider temporal en GraphCanvas — arrastras y ves la carpeta COMO ERA
en cualquier fecha (verde=nuevo, rojo=borrado, ámbar=modificado).
**Por qué vale la pena:** ninguna app de la Store lo hace. CodeSee (el único comercial
que hacía "mapas con historia") cerró en 2024 — nicho vacío. Es EL feature de la ficha
de la Store: "viaja en el tiempo por tus carpetas".
**Esfuerzo:** ~3-4 días (2 Rust + 1-2 React). DESPUÉS de v1.0.

## ⭐ MEJORA 2 — Grafo EN VIVO (watcher)
**Qué añade:** con el crate `notify` en Rust, la app observa la carpeta abierta y
re-indexa incremental al detectar cambios → los nodos aparecen/cambian de color EN VIVO.
**Por qué:** combinado con Claude Code trabajando en ese proyecto, VES a los agentes
tocar archivos en tiempo real sobre el grafo. Demo hipnótica (Store + LinkedIn) y
utilidad real: supervisar a los agentes sin leer logs.
**Esfuerzo:** ~2 días. Sinergia directa con Mejora 1 (cada cambio = evento con timestamp).

## ⭐ MEJORA 3 — Un cerebro, dos caras: esquema compartido app ↔ servidor
**Qué añade:** definir UNA tabla de eventos común (`change_events`: ts, entity, change_type,
diff_json, source) usada por el indexer Rust (app) Y por scanner.py (servidor).
Consecuencia mágica: la app MSIX gana un botón "Open remote Registry" que consume la API
:7008 de cualquier servidor tuyo → la app Windows se convierte en el VISOR de escritorio
de TODOS tus servidores Linux, no solo de carpetas locales.
**Por qué:** una sola arquitectura de datos, dos productos. El server dashboard (:7009)
queda para acceso web; la app da la experiencia premium.
**Esfuerzo:** ~1 día de acordar esquema + ~2 días del modo remoto en la app.

## ⭐ MEJORA 4 — Los agentes alimentan y consultan el Registry (Claude Code)
**Qué añade (servidor y Windows — misma técnica):**
- ALIMENTAR: hooks oficiales de Claude Code (`~/.claude/settings.json`, PostToolUse
  matcher "Edit|Write|MultiEdit" con `type: http` → POST al Registry). Cada archivo que
  toca cualquier agente queda en el timeline en <5s, con sesión y proyecto. Config
  exacta verificada contra docs 2026 (está en REGISTRY-V2-PLAN.md § 2).
- CONSULTAR: servidor MCP "registry" (Python FastMCP, :7010) con tools
  `whats_changed(since)`, `timeline(project)`, `query_registry(q)` — registrado una vez
  con `claude mcp add --scope user`, todos tus arquitectos lo ven como mcp__registry__*.
**Por qué:** cierra el círculo humanos+IA de tu visión: los agentes escriben la memoria
y la leen antes de tocar código. Precedentes funcionando: disler/claude-code-hooks-
multi-agent-observability y DeusData/codebase-memory-mcp (83% calidad, 10x menos tokens).
**Esfuerzo:** ~1 día hooks+endpoint, ~1-2 días MCP.

## ⭐ MEJORA 5 — Distribución GitHub para las DOS (además de la Store)
**App Windows:**
- GitHub Actions (`windows-latest`): `tauri build` → MSIX + instalador NSIS .exe →
  Release automática en cada tag `vX.Y.Z` con checksums SHA256.
- Tauri Updater activado SOLO en el canal GitHub (la Store se auto-actualiza sola).
- Manifest para **winget** (PR a microsoft/winget-pkgs) → `winget install SypnoseRegistry`
  gratis y sin Store.
- Firma: la Store firma por su lado; para el canal GitHub, certificado propio o
  instrucciones de sideload en el README.
**Servidor Linux:**
- Releases etiquetadas: `curl -fsSL .../vX.Y.Z/install.sh | bash` (versión pinneada,
  no siempre master) + checksum publicado.
- CI que prueba el instalador en un container Ubuntu virgen en cada tag (hoy esa prueba
  es manual — automatizarla evita romper a quien instala desde GitHub).
**Esfuerzo:** ~2 días una vez, después es gratis para siempre.

## MEJORA 6 — Chat "pregúntale a tu carpeta" en la app
Panel React → Claude API con el grafo + eventos como contexto ("¿qué cambió esta semana?",
"¿qué usa esta función?"). La experiencia NotebookLM dentro de tu producto, local.
API key del usuario en la config de la app (no incluida). ~2-3 días. Va después de Mejoras 1-2.

## MEJORA 7 — Espejo NotebookLM (opcional, lo que pediste, en versión que no se rompe)
Vía A (oficial): job diario → digests Google Docs en Drive → auto-sync de NotebookLM.
Vía B (turbo, no crítica): teng-lin/notebooklm-py (17k stars) para subir/refrescar y hasta
consultar el notebook desde Claude Code vía su MCP. ⚠️ no-oficial, jamás pieza crítica.

## MEJORAS MENORES (rápidas, dentro de v1.0 o justo después)
- ForceAtlas2 en WebWorker (`graphology-layout-forceatlas2/worker`) — ya lo tenías anotado
  para v1.1; el paquete existe, el cambio es pequeño y elimina el riesgo de UI congelada.
- En change_events guardar SIEMPRE el JSON crudo del evento (campo diff_json): si Anthropic
  o el formato cambian, no se pierde nada — se re-parsea.
- Dedupe en la CONSULTA, no en la ingesta (hook + git + scanner pueden reportar lo mismo):
  ingesta append-only siempre.
- Seguridad servidor: :7008/:7010 solo localhost/tailnet; si se exponen, Cloudflare Access
  con service token (como tus otros 23 endpoints).
- SQLite: compactar eventos >90 días en resúmenes diarios + VACUUM programado.

---

## ORDEN QUE YO SEGUIRÍA
1. Terminar PLAN.md v1.0 (tuyo, intacto) → app estable
2. Mejora 5 (distribución GitHub) → las dos instalables desde GitHub
3. Mejoras 1+2 (memoria + vivo) → el diferenciador
4. Mejora 4 (hooks + MCP) → los agentes entran al círculo
5. Mejora 3 (modo remoto) → un producto, dos caras
6. Mejoras 6-7 (chat + espejo NotebookLM)
