# PLAN DEFINITIVO — Registry v1.0

## Vision
Registry: abre cualquier carpeta en Windows y ve todo su contenido como un grafo interactivo. Codigo, documentos, datos, configs, assets — todo mapeado visualmente. Instala desde Microsoft Store, cero configuracion.

---

## FASE 0 — LIMPIAR MUERTOS (sin dependencias)

Eliminar todo el codigo muerto antes de tocar nada. Reduce ruido y confusion.

### Archivos a BORRAR
- `src/graph/useGraph.ts` — hook alternativo nunca importado
- `src/graph/nodeReducer.ts` — reducer nunca usado (GraphCanvas usa inline)
- `src/graph/edgeReducer.ts` — idem
- `src/graph/useLayout.ts` — supervisor ForceAtlas2 nunca llamado
- `src/graph/useSearch.ts` — busqueda alternativa nunca usada
- `src/data/sample-graph.json` — datos demo (solo para dev, no produccion)

### Paquetes npm a DESINSTALAR
- `@react-sigma/core` — nunca importado
- `@radix-ui/react-dropdown-menu` — nunca importado
- `@radix-ui/react-popover` — nunca importado
- `@radix-ui/react-tooltip` — nunca importado
- `graphology-communities-louvain` — solo usado en src/graph/useGraph.ts (borrado)

### Tipos muertos a ELIMINAR de `types/graph.ts`
- NodeType: quitar `'route' | 'table' | 'module' | 'interface' | 'variable'` (nunca producidos)
- EdgeType: quitar `'calls' | 'extends' | 'implements' | 'references' | 'queries' | 'routes'` (nunca producidos)
- GraphNode: quitar `async` y `description` (nunca poblados)

### ACCEPTANCE
- [ ] `src/graph/` directorio no existe
- [ ] `npm ls` no lista los 5 paquetes
- [ ] `types/graph.ts` solo tiene tipos que el indexer realmente produce
- [ ] `npm run build` compila sin error
- [ ] No hay imports rotos

---

## FASE 1 — CORREGIR MOTOR (Gaps 1, 2, 4, 5, 6, 8, 12)

Arreglar todo lo que "parece funcionar pero no hace nada". Orden por archivo.

### T1.1 — Filtros funcionales (Gap 1)
**Archivo:** `src/components/GraphCanvas.tsx`
**Cambio:** En `buildGraphologyGraph()`, ANTES de pasar nodos a Sigma, leer `activeTypeFilters`, `activeCommunityFilters`, `activeLanguageFilters` del store. Si un filtro esta activo y el nodo NO pertenece a ese tipo/community/language, no agregarlo al grafo Graphology. Re-ejecutar `buildGraphologyGraph` cuando cambien los filtros.
**Acceptance:** Toggle filtro "document" → nodos document desaparecen del canvas

### T1.2 — Seleccion visible en canvas (Gap 2)
**Archivo:** `src/components/GraphCanvas.tsx`
**Cambio:** En el `nodeReducer` inline del constructor Sigma, ademas del hover, detectar `selectedNodeId` y pintar el nodo seleccionado con borde grueso + color highlight. Usar `selectedRef` (mismo patron que `hoveredRef`).
**Acceptance:** Click en nodo → borde visible alrededor del nodo en el canvas

### T1.3 — Zoom display correcto (Gap 4)
**Archivo:** `src/components/StatusBar.tsx`
**Cambio:** Sigma ratio 1 = 100%. Ratio < 1 = zoom in (deberia mostrar >100%). Formula: `Math.round((1 / stats.zoom) * 100)` en vez de `stats.zoom * 100`.
**Acceptance:** Zoom in muestra 200%, 300%, etc. Zoom out muestra 50%, 25%.

### T1.4 — Degree computation (Gap 5)
**Archivo:** `src/App.tsx` → funcion `adaptRawGraph()`
**Cambio:** Despues de crear `nodes` y `edges`, computar degree por nodo: contar edges donde node.id == source o target. Guardar en `node.degree`, `node.inDegree`, `node.outDegree`.
**Acceptance:** SearchPalette "top nodes" muestra nodos con mas conexiones primero

### T1.5 — Colores para nuevos tipos (Gap 6)
**Archivos:** `src/hooks/useGraph.ts`, `src/components/NodeDetailPanel.tsx`
**Cambio:** Anadir a NODE_TYPE_COLORS en ambos archivos:
```
document: '#6366f1',
data: '#0891b2',
config: '#78716c',
asset: '#f59e0b'
```
**Acceptance:** Nodos document/data/config/asset tienen colores correctos, no gris

### T1.6 — Space bar layout toggle (Gap 8)
**Archivo:** `src/components/GraphCanvas.tsx`
**Cambio:** Leer `isLayoutPaused` del store. Si true, detener ForceAtlas2. Si false, reiniciar. Reaccionar a cambios del store.
**Acceptance:** Pulsar Space pausa/reanuda la animacion del layout

### T1.7 — WelcomeScreen hover bug (Gap 12)
**Archivo:** `src/components/WelcomeScreen.tsx`
**Cambio:** `onMouseLeave` resetea a `'#2563eb'` (no `'#4da3ff'`).
**Acceptance:** Boton vuelve a azul oscuro despues de hover

### ACCEPTANCE FASE 1
- [ ] Filtros ocultan/muestran nodos en el canvas
- [ ] Nodo seleccionado resaltado visualmente
- [ ] Zoom muestra porcentaje correcto
- [ ] Top nodes en busqueda ordenados por degree real
- [ ] 4 tipos nuevos con colores correctos
- [ ] Space pausa/reanuda layout
- [ ] Boton hover correcto

---

## FASE 2 — UI VIVA (Gaps 3, 7 residual, 15)

Hacer que cada elemento de UI que existe realmente funcione o borrarlo.

### T2.1 — Boton Fit funcional (Gap 3)
**Archivo:** `src/components/StatusBar.tsx`
**Cambio:** Importar Sigma ref o usar store para trigger. onClick: `sigma.getCamera().animatedReset({ duration: 500 })`.
Alternativa: crear `fitRequestId` en store, StatusBar lo incrementa, GraphCanvas reacciona.
**Acceptance:** Click "Fit" → camara centra todo el grafo

### T2.2 — Boton Settings (Gap 3)
**Archivo:** `src/components/Toolbar.tsx`
**Cambio:** Opciones: si no hay funcionalidad real, BORRAR el boton. No dejar UI muerta.
Decision: BORRAR — v1.0 no necesita settings.
**Acceptance:** No hay icono de settings en el toolbar

### T2.3 — Compact mode labels (Gap 15)
**Archivo:** `src/components/NodeDetailPanel.tsx`
**Cambio:** Si el nodo tiene `node_type == 'dir'` o el id empieza con `dir:`, mostrar "Files:" en vez de "Lines:".
**Acceptance:** Carpeta agrupada muestra "Files: 47" no "Lines: 47"

### T2.4 — Textos WelcomeScreen actualizados
**Archivo:** `src/components/WelcomeScreen.tsx`
**Cambio:**
- Subtitle: "Open any folder to automatically analyze and visualize everything inside."
- Hint: "Works with code, documents, data, images, configs, and more"
- Boton: "Open Folder" (no "Open Project Folder")
**Acceptance:** Textos reflejan que no es solo para codigo

### ACCEPTANCE FASE 2
- [ ] Fit centra la camara
- [ ] No hay botones muertos
- [ ] Compact mode muestra "Files" no "Lines"
- [ ] Textos de bienvenida correctos

---

## FASE 3 — ESTABILIDAD RUST (Gap 9)

### T3.1 — rfd async dialog
**Archivo:** `src-tauri/src/lib.rs`
**Cambio:** Cambiar `rfd::FileDialog::new().pick_folder()` por `rfd::AsyncFileDialog::new().pick_folder().await`. Hacer el comando `async`. Agregar `tokio` a Cargo.toml si necesario.
**Acceptance:** Abrir dialogo de carpeta no causa panic en ningun escenario

### T3.2 — Error en carpeta read-only
**Archivo:** `src-tauri/src/indexer.rs`
**Cambio:** Si `fs::create_dir_all(graphify-out)` falla (carpeta read-only), devolver el grafo en memoria sin escribir a disco. No fallar.
**Acceptance:** Abrir C:\Program Files no crashea — muestra grafo en memoria

### ACCEPTANCE FASE 3
- [ ] Dialog async, no panic
- [ ] Carpetas read-only funcionan

---

## FASE 4 — EMPAQUETADO MSIX (Gaps 10, 11)

### T4.1 — WebView2 embedido (Gap 11)
**Archivo:** `src-tauri/tauri.conf.json`
**Cambio:** Agregar `"webviewInstallMode": { "type": "embedBootstrapper" }` en seccion `bundle.windows`.
**Acceptance:** Instalador funciona offline (no descarga WebView2)

### T4.2 — MSIX en targets (Gap 10)
**Archivo:** `src-tauri/tauri.conf.json`
**Cambio:** Investigar si Tauri 2.x soporta target MSIX nativo. Si no, mantener el script manual con makeappx+signtool.
Crear script `scripts/build-msix.sh` que:
1. `npx tauri build`
2. Copia exe a staging
3. Copia assets
4. `makeappx pack`
5. `signtool sign`
**Acceptance:** Un comando produce .msix firmado e instalable

### T4.3 — broadFileSystemAccess
**Archivo:** `AppxManifest.xml` (staging)
**Cambio:** Agregar `<rescap:Capability Name="broadFileSystemAccess" />` para que el MSIX sandboxed pueda abrir cualquier carpeta.
**Acceptance:** MSIX instalado puede abrir C:\Carlos sin error de permisos

### ACCEPTANCE FASE 4
- [ ] .msix se genera con un comando
- [ ] Se instala en Windows limpio sin internet
- [ ] Puede abrir cualquier carpeta del disco

---

## FASE 5 — VERIFICACION FINAL

### T5.1 — Test C:\Carlos
Abrir la app, seleccionar C:\Carlos. Debe:
- Indexar en <30 segundos (modo compacto)
- Mostrar grafo con nodos de colores correctos por tipo
- Filtros funcionan
- Busqueda encuentra carpetas
- Click en nodo muestra detalles
- Fit centra todo

### T5.2 — Test carpeta pequena (proyecto codigo)
Abrir un repo como registry/app. Debe:
- Indexar en <5 segundos (modo detallado)
- Mostrar archivos individuales + funciones + clases
- Imports como edges
- Todo funcional

### T5.3 — Test carpeta vacia
Abrir carpeta vacia. Debe mostrar error amigable, no crash.

### T5.4 — Test instalacion limpia
Instalar MSIX en otro usuario Windows (o desinstalar/reinstalar). Debe funcionar sin configuracion previa.

---

## MAPA DE ARCHIVOS POR FASE (anti-colision)

| Fase | Archivos |
|------|----------|
| F0 | src/graph/*, package.json, types/graph.ts |
| F1 | GraphCanvas.tsx, StatusBar.tsx, App.tsx, useGraph.ts, NodeDetailPanel.tsx, WelcomeScreen.tsx |
| F2 | StatusBar.tsx*, Toolbar.tsx, NodeDetailPanel.tsx*, WelcomeScreen.tsx* |
| F3 | lib.rs, indexer.rs, Cargo.toml |
| F4 | tauri.conf.json, AppxManifest.xml, scripts/build-msix.sh |

*F1 y F2 comparten archivos (StatusBar, NodeDetailPanel, WelcomeScreen) — F2 NO puede correr en paralelo con F1.

## ORDEN DE EJECUCION

```
F0 (limpieza) → F1 (motor) → F2 (UI) → F3 (Rust) → F4 (MSIX) → F5 (verificacion)
                                          ↗
F3 puede correr en paralelo con F1+F2 ──┘
```

## RIESGOS

| Riesgo | Severidad | Mitigacion |
|--------|-----------|------------|
| rfd async rompe el dialogo en Windows | Alta | Probar en dev antes de build |
| ForceAtlas2 bloquea UI en grafos medianos (2K-5K nodos) | Media | Considerar WebWorker en v1.1, no v1.0 |
| MSIX sandbox bloquea acceso a carpetas | Alta | broadFileSystemAccess + probar instalacion real |
| Tauri 2 no soporta MSIX nativo | Baja | Script manual funciona, ya probado |
| WebView2 embedido sube el instalador a ~150MB | Baja | Aceptable para app desktop |
