# SIGUIENTE ETAPA — Arquitecto Registry (leer al cerrar el gate de M3)
2026-07-02 · SM. Protocolo §0 de PLAN-EJECUCION-MAESTRO.md sigue OBLIGATORIO en todo.
Reglas permanentes: PROHIBIDO git push (lo hace el SM tras revisión) · informe con evidencia
en cada gate y PARAR · un archivo un dueño · tags por fase.

## ORDEN DE TRABAJO (continuo, sin esperar entre fases salvo los gates)

### 1. AHORA (si no está hecho): MSIX v1.1 — Ola 1
Generar MSIX con v1.0+M1+M2 (script reproducible), instalarlo localmente, SHA256,
dejar artefacto listo para que Carlos lo suba a la Store. GATE: instalación local OK.

### 2. M3 — Memoria temporal + time-slider (plan detallado en PLAN-MEJORAS-EJECUCION.md § M3)
Al terminar: gate con evidencia → informe → PARAR para auditoría del SM.
El vídeo del time-slider funcionando es la media de la Ola 2: al cerrar el gate, avisar
para grabar la demo (patrón ffmpeg del SM) ANTES de seguir.

### 3. M4 — Chat con Claude (plan en PLAN-MEJORAS-EJECUCION.md § M4)
Recordatorio: extender ai_bridge.rs existente; API key del usuario en Settings, jamás
hardcodeada; citas de entity_id clicables que centran el nodo. Gate → informe → PARAR.

### 4. M5 — Espejo NotebookLM: PREGUNTAR A CARLOS antes de arrancarla (es opcional).
Si dice no, saltar a 5.

### 5. M6 — Release v2.0
- MSIX v2.0 con el script + prueba de instalación limpia
- README.md mundial (EN primero): qué es, GIF del watcher (media/registry-live-demo)
  + GIF del slider, instalación Store/GitHub/sideload con el .cer, licencia MIT
- .github/workflows/release.yml: en cada tag v* → build → Release con MSIX+NSIS+SHA256
- DEJAR TODO COMMITEADO Y TAGGEADO. El push a github.com/sypnose-cloud/registry lo
  ejecuta el SM tras su revisión final de secretos. GATE FINAL: el SM audita el repo
  completo y ejecuta el push + Carlos sube v2.0 a la Store.

### 5-bis. VISIÓN STORE — "cualquier IA se conecta al Registry" (decisión de Carlos 2026-07-02)
La app va a la Microsoft Store para el mundo. La integración con IAs NO va dentro del
chat (el chat se queda como está: key del usuario en Settings). La vía es la planeada:
- **AI Bridge (:44444) como API abierta del Registry**: endpoints de consulta
  (grafo actual, timeline, whats_changed, buscar entidad) para que CUALQUIER IA del
  usuario (Claude Code, ChatGPT, la que sea — con su suscripción vía CLIProxy si la
  tiene) se conecte al Registry y lo use como guía. Documentar los endpoints en el
  README (sección "Connect your AI").
- **CLIProxy es un producto/instalación APARTE** (corre en la máquina del usuario y
  envuelve sus suscripciones LLM). No se incrusta en la app; a futuro puede ser otro
  MSIX de la tienda o un instalador acompañante. La app nunca depende de él.
- Prioridad respaldada por FEEDBACK-USO-IA-20260702.md (test real: la API de consulta
  es LA pieza que convierte el Registry en guía de agentes) + parser C# del mismo doc.

### 6. BACKLOG v2.1 (después de M6, si Carlos no redirige)
De la auditoría 2026-07-02 (AUDITORIA-2026-07-02.md):
- Incrementalidad fina del watcher (re-index parcial por archivo)
- ForceAtlas2/layout en WebWorker si grafos >2K nodos se sienten lentos
- Limpieza cosmética: borrar stubs src/graph/*, tipos muertos en types/graph.ts,
  unificar paletas de comunidad (canvas 12 vs UI 10)
- Decisión broadFileSystemAccess documentada en el manifest canónico
- Preparar Parte B del PLAN-EJECUCION-MAESTRO (Registry servidor Linux): el código
  (tablas SQLite + endpoint hooks + MCP FastMCP) se puede desarrollar y testear en
  local; el despliegue lo hará un arquitecto en el servidor 67.

## AL CERRAR CADA GATE
Informe: qué se hizo + evidencia (comandos+outputs) + desviaciones §11 + feedback §4.1.
El SM audita con spot-checks contra el código. No autoconcederse gates.
