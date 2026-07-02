# PLAN MAESTRO DE EJECUCIÓN — Sypnose Registry
## App Windows MSIX (mundial) + Registry Servidor Linux — ambos instalables desde GitHub
Fecha: 2026-07-02 · Autor del protocolo: Claude (SM) · Diseño del producto: Carlos
Para: arquitectos ejecutores (Claude Code en Windows para Parte A; Claude Code en servidor Linux para Parte B)

═══════════════════════════════════════════════════════════════════
# 0. EL PROTOCOLO — CÓMO SE TRABAJA CADA TAREA (innegociable)
═══════════════════════════════════════════════════════════════════

Este plan no solo dice QUÉ hacer: dice CÓMO. Cada fase sigue el mismo ciclo de 6 pasos.
Si una fase no pasó por los 6 pasos, la fase NO está hecha, aunque el código exista.

## El ciclo (por fase)

```
1. ANALIZAR    → agentes read-only EN PARALELO mapean el terreno ANTES de tocar nada
2. PLANIFICAR  → 1 plan corto con archivos exactos a tocar (anti-colisión)
3. IMPLEMENTAR → cambios quirúrgicos, SOLO los archivos del plan, estilo del código existente
4. VERIFICAR   → build/tests + verificadores ADVERSARIALES en paralelo (intentan romperlo)
5. GATE        → acceptance con EVIDENCIA (comando + output pegado). Sin evidencia = no pasó
6. COMMIT      → atómico, mensaje descriptivo, y tag al cerrar cada fase
```

## Reglas de oro (las mías, ahora tuyas)

1. **Nunca tocar código sin análisis previo.** El paso 1 no es opcional. Leer antes de escribir.
2. **Los verificadores intentan REFUTAR, no confirmar.** Prompt del verificador: "intenta
   demostrar que esto está roto / que falta un caso". Si no puede refutar con evidencia, pasa.
3. **"Hecho" requiere evidencia**: el comando ejecutado y su output pegados en el informe.
   "Compila" sin el output de compilación = no compila.
4. **Backup antes de cada fase**: `git tag pre-<fase>` — SIEMPRE. Rollback barato = valentía barata.
5. **Anti-colisión**: cada archivo tiene UN dueño por fase. Dos agentes jamás editan el mismo
   archivo en paralelo. El mapa de archivos por fase está en cada Parte.
6. **Si algo del plan no encaja con la realidad del repo: corrígelo y repórtalo** (Ley del
   Arquitecto §11). El plan sirve a la realidad, no al revés.
7. **Un fallo de verificación NO se parchea a ciegas**: se diagnostica causa raíz primero
   (un día de diagnóstico vale más que una semana de parches).
8. **Informe final de fase** con: qué se hizo, evidencia de acceptance, qué se desvió del plan
   y por qué, y feedback al SM (§4.1: sistema/prompt/proceso — o "0 hallazgos").

## Cómo replicar mis herramientas con las tuyas

| Lo que hago yo | Cómo lo haces tú (arquitecto Claude Code) |
|---|---|
| Workflow con N lectores en paralelo | N subagentes Task/Explore lanzados EN UN SOLO mensaje |
| Revisión adversarial multi-agente | 3+ subagentes con el prompt adversarial de abajo, en paralelo |
| Verificación E2E real | Scripts de test que ejecutas TÚ y pegas el output |
| Investigación web con fuentes | Subagentes con WebSearch, citando URL en el informe |

## Plantillas de prompts para tus subagentes

**ANALIZADOR (read-only, N en paralelo, uno por área):**
> "READ-ONLY, no modifiques nada. Analiza <área> en <ruta>. Devuelve: (1) mapa de archivos
> y funciones relevantes con file:línea, (2) dependencias/imports de cada uno, (3) riesgos
> concretos si se toca X, (4) lo que el plan asume y NO es verdad en este código."

**VERIFICADOR ADVERSARIAL (3 en paralelo tras implementar, lentes distintas):**
> "Tu trabajo es REFUTAR. El cambio <descripción> en <archivos> dice lograr <acceptance>.
> Lente: [correctness / regresión / casos límite]. Lee el código real y encuentra el escenario
> concreto (inputs/estado exacto) donde falla. Si no encuentras fallo con evidencia, di
> 'NO PUDE REFUTAR' y lista qué probaste."

**Regla de decisión**: 3 verificadores → si ≥2 encuentran fallo real confirmado, se corrige y
se re-verifica. Si 3 dicen "no pude refutar", la tarea pasa al gate.

═══════════════════════════════════════════════════════════════════
# PARTE A — APP WINDOWS MSIX (repo: C:\Users\carlo\repos\registry\app)
Meta: app estable, MSIX regenerado, publicada en GitHub Releases para el mundo
═══════════════════════════════════════════════════════════════════

> Ejecuta las fases EN ORDEN. A4 (Rust) puede ir en paralelo con A2+A3 (archivos distintos).
> Referencia de detalle de tareas: PLAN.md v1.0 (diseño de Carlos) — este plan añade el CÓMO.

## FASE A0 — Línea base (½ día)
**Pasos:**
1. `git tag pre-v1-execution` + `git status` limpio.
2. ANALIZAR (3 agentes en paralelo, read-only):
   - Agente 1: inventario real de `src/` — ¿existen los archivos que PLAN.md F0 manda borrar?
     ¿Alguno SÍ está importado? (grep de cada nombre en todo src/)
   - Agente 2: `npm run build` y `npx tauri build --debug` — ¿compila HOY? Pegar output.
     Inventario de dependencias reales vs package.json.
   - Agente 3: estado del src-tauri: versión de Tauri, indexer.rs, lib.rs — mapa de comandos
     expuestos y riesgos.
3. GATE A0: informe con el build actual OK/KO + lista verificada de muertos reales.
   **Si algo que PLAN.md manda borrar SÍ se usa → se anota y NO se borra (§11).**

## FASE A1 — Limpieza (F0 del PLAN.md) (½-1 día)
**Pasos:**
1. IMPLEMENTAR: borrar SOLO lo confirmado muerto en A0 (archivos, paquetes npm, tipos).
2. VERIFICAR: `npm run build` limpio + 1 verificador adversarial: "encuentra un import roto
   o referencia colgante a lo borrado" (grep sistemático).
3. GATE (los del PLAN.md F0): src/graph/ no existe · npm ls sin los 5 paquetes · build OK.
4. COMMIT: `chore: F0 limpieza de codigo muerto` + informe.

## FASE A2 — Motor (F1 del PLAN.md: 7 gaps) (2-3 días)
**Pasos:**
1. ANALIZAR (2 agentes): GraphCanvas.tsx a fondo (cómo construye el grafo, dónde entran
   los filtros/selección/layout) + el store (qué estados existen ya).
2. IMPLEMENTAR en 3 tandas para no chocar (un dueño por archivo):
   - Tanda 1: GraphCanvas.tsx (T1.1 filtros + T1.2 selección + T1.6 space toggle) — UN agente
   - Tanda 2: App.tsx (T1.4 degree) + StatusBar.tsx (T1.3 zoom) — UN agente
   - Tanda 3: useGraph.ts + NodeDetailPanel.tsx (T1.5 colores) + WelcomeScreen.tsx (T1.7) — UN agente
3. VERIFICAR: build + 3 adversariales (lentes: filtros con estados combinados;
   degree con grafos vacíos/self-loops; regresión de lo que ya funcionaba).
4. VERIFICACIÓN HUMANA (Carlos, 10 min): abrir la app → checklist F1 del PLAN.md a mano.
5. GATE: los 7 acceptance de F1 con evidencia (captura o descripción del resultado).
6. COMMIT por tanda + tag `f1-motor-ok`.

## FASE A3 — UI viva (F2) (1 día) — SECUENCIAL tras A2 (comparte archivos)
Igual ciclo: implementar T2.1-T2.4 → build + 2 adversariales → checklist F2 → commit.

## FASE A4 — Rust estable (F3) (1 día) — PARALELIZABLE con A2/A3
**Pasos:**
1. ANALIZAR (1 agente): lib.rs + indexer.rs — dónde está el pick_folder síncrono, qué pasa
   con carpetas read-only HOY (leer el código, no suponer).
2. IMPLEMENTAR: rfd async + manejo de carpeta read-only (grafo en memoria sin escribir).
3. VERIFICAR: `cargo build` + `cargo clippy` + test manual: abrir C:\Program Files → no crash.
4. GATE F3 + commit.

## FASE A5 — Empaquetado MSIX (F4) (1-2 días)
**Pasos:**
1. ANALIZAR (1 agente + web): ¿el Tauri instalado soporta MSIX nativo o va el script
   makeappx+signtool? Verificar contra docs de la versión REAL del repo.
2. IMPLEMENTAR: webviewInstallMode embedBootstrapper + script `scripts/build-msix.ps1`
   (build → staging → makeappx → signtool) + broadFileSystemAccess en el manifest.
3. VERIFICAR: generar el .msix, instalarlo en ESTA máquina, abrir C:\ y una carpeta de usuario.
4. GATE F4: un comando produce el .msix · instala offline · abre cualquier carpeta.
5. COMMIT + tag `msix-v1.0.0-rc`.

## FASE A6 — Verificación final (F5) (½ día)
Los 4 tests del PLAN.md (C:\Carlos grande / repo pequeño / carpeta vacía / instalación limpia)
ejecutados y documentados con tiempos reales. Si CUALQUIERA falla: causa raíz → fase que
corresponda → repetir A6 entero. GATE: 4/4 PASS con evidencia.

## FASE A7 — GITHUB PARA EL MUNDO (1-2 días)
**Pasos:**
1. IMPLEMENTAR (2 agentes en paralelo, archivos distintos):
   - Agente release: `.github/workflows/release.yml` — en cada tag `v*`: windows-latest,
     `npm ci` + `tauri build` → MSIX + NSIS .exe → GitHub Release con SHA256SUMS.
   - Agente docs: README.md mundial (EN primero, ES después): qué es, GIF/screenshot,
     instalación (Store / GitHub Release / winget futuro), sideload del MSIX explicado,
     requisitos, LICENSE MIT visible, sección servidor Linux con su one-liner.
2. VERIFICAR: push tag `v1.0.0-rc1` → el Action corre VERDE y la Release aparece con
   artefactos descargables. Descargar el .msix desde GitHub en limpio e instalarlo.
3. 1 adversarial sobre el README: "instálalo siguiendo SOLO el README, como un extraño.
   ¿Dónde te atascas?"
4. GATE FINAL A: cualquier persona del mundo puede: entrar al repo → entender qué es en
   30 segundos → descargar → instalar → abrir una carpeta y ver su grafo.
5. Tag `v1.0.0` → Release pública.

═══════════════════════════════════════════════════════════════════
# PARTE B — REGISTRY SERVIDOR LINUX (scanner.py + backstage-api + dashboard)
Meta: memoria temporal + agentes integrados + instalable desde GitHub versionado
═══════════════════════════════════════════════════════════════════

> Ejecutor: arquitecto Claude Code EN el servidor (67 o 217). Anti-colisión con Parte A:
> Parte B NO toca `app/`. Comparten solo README.md — lo edita Parte A; Parte B aporta su
> sección por PR/parche que integra el agente docs de A7.

## FASE B0 — Línea base (½ día)
`git tag pre-v2-memoria` · verificar que el Registry actual corre (curl a :7008/:7009 con
output pegado) · ANALIZAR (2 agentes): esquema SQLite actual de ~/.registry-data +
flujo completo de scanner.py (dónde escribe, qué pisa). GATE: mapa real del estado.

## FASE B1 — Event store temporal (2-3 días) ⭐ el corazón
**Pasos:**
1. IMPLEMENTAR: 3 tablas (scans / entity_versions SCD-2 / change_events append-only) +
   scanner.py diffea contra is_current=1: cierra versión, abre nueva, emite evento.
   Guardar SIEMPRE el JSON crudo en diff_json. Índices (project, ts).
2. VERIFICAR: correr el scanner 2 veces con un cambio manual entre medias →
   el evento aparece con timestamp correcto. 3 adversariales: (a) ¿qué pasa con archivos
   borrados?, (b) ¿renombrados?, (c) ¿scanner interrumpido a mitad — corrompe el estado?
3. GATE: `curl ':7008/api/timeline?project=X&since=24h'` (endpoint mínimo de lectura)
   devuelve los eventos del test con fechas correctas. Output pegado.

## FASE B2 — Hooks de Claude Code (1 día)
**Pasos:**
1. IMPLEMENTAR: endpoint POST /api/events/claude-code en backstage-api (inserta en
   change_events, source='claude-hook') + bloque hooks en ~/.claude/settings.json del
   servidor (PostToolUse Edit|Write|MultiEdit + SessionStart/End/Stop, type http,
   timeout 5; fallback type command async con curl si la versión no soporta http).
2. VERIFICAR: abrir una sesión Claude Code, editar un archivo cualquiera → el evento
   aparece en el timeline en <5s. Adversarial: ¿un hook caído bloquea al agente? (no debe:
   timeout 5 + async).
3. GATE: evidencia del evento del hook con session_id real.

## FASE B3 — MCP server :7010 (1-2 días)
**Pasos:**
1. IMPLEMENTAR: FastMCP Python sobre el mismo SQLite: query_registry(q), timeline(project,
   since), whats_changed(since), session_summary(id). systemd unit. Bind localhost.
2. Registro: `claude mcp add --transport http registry http://localhost:7010/mcp --scope user`.
3. VERIFICAR: desde una sesión Claude Code NUEVA preguntar "¿qué cambió en <proyecto> esta
   semana?" → el agente DEBE responder usando mcp__registry__whats_changed sin leer archivos.
4. GATE: transcript de esa respuesta como evidencia.

## FASE B4 — Timeline en el dashboard (1-2 días)
Pestaña nueva en :7009: lista de eventos filtrable por proyecto/fecha/source (scanner/
hook/git). Simple y útil antes que bonito. GATE: Carlos ve en el navegador qué tocó cada
agente hoy. (El mapa temporal con slider = v2.1, no bloquea.)

## FASE B5 — GITHUB VERSIONADO PARA EL MUNDO (1 día)
**Pasos:**
1. IMPLEMENTAR: releases etiquetadas (`v2.0.0`) con install.sh pinneado por versión +
   SHA256; `.github/workflows/test-install.yml`: en cada tag, container Ubuntu virgen →
   `curl … | bash` → curl a :7008/:7009 verdes.
2. VERIFICAR: el Action en verde ES la verificación.
3. GATE FINAL B: un desconocido con un VPS Ubuntu instala el Registry v2 con un comando
   y tiene timeline + MCP funcionando.

═══════════════════════════════════════════════════════════════════
# ORDEN GLOBAL Y ROLES
═══════════════════════════════════════════════════════════════════

- Parte A y Parte B corren EN PARALELO (máquinas y archivos distintos).
- Dentro de cada parte: fases en orden, salvo A4 (paralelizable con A2/A3).
- **Rol del SM (Claude, esta sesión u otra)**: audita el informe de CADA fase antes del gate.
  El arquitecto NO se autoconcede gates: presenta evidencia, el SM (o Carlos) la valida.
- **Rol de Carlos**: verificaciones humanas marcadas (A2 paso 4, A6, B4) — son minutos, no horas.
- Cadencia de informe: al cerrar cada fase, informe con formato §4.1 (qué se hizo + evidencia
  + desviaciones + feedback al SM). Sin informe = fase no cerrada.

## Estimación total honesta
- Parte A: ~7-10 días de trabajo de arquitecto (v1.0 completa + GitHub).
- Parte B: ~6-9 días.
- En paralelo: ~1.5-2 semanas de calendario. Con verificación real incluida — no es lo que
  tarda escribir el código, es lo que tarda que FUNCIONE para cualquier persona del mundo.
