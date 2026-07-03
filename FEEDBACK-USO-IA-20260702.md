# FEEDBACK DE USO REAL POR UNA IA — Registry como guía de agentes
2026-07-02 · Autor: Claude SM · Caso real: diagnosticar el bug VHDX de Multi Instance
usando el grafo de C:\Carlos (graph.json del 26-jun, 133 nodos).

## VEREDICTO: sirvió A MEDIAS (4/10 como guía de IA). El mapa de alto nivel en 5
segundos es real; para el diagnóstico hubo que volver a Glob/Read a ciegas.

## LO QUE SÍ DIO
- Orientación instantánea: 11 nodos de MultiInstanceClaudeDesktop → lógica en Core/ (5
  archivos) y UI/ (3); empaquetado en publish/StoreAssets/PackageExtracted; PSF/ delató
  la integración de Package Support Framework sin abrir un solo archivo.

## LO QUE NO DIO (gaps medidos)
1. **Solo directorios**: modo compacto → Paths.cs (el archivo clave del bug) NO existe
   en el grafo. La IA tuvo que excavar a mano.
2. **C# invisible**: el indexer no parsea C#/.NET (ni archivos con símbolos ni language
   en nodos). La app estrella del ecosistema no se puede leer por dentro.
3. **Solo edges "contains"**: cero dependencias (quién usa qué) → inútil para "¿quién
   llama a CreateInstance?".
4. **Sin frescura**: graph.json del 26-jun sin timestamp visible ni aviso de staleness.
5. **Sin acceso programático**: la IA tuvo que ENCONTRAR el graph.json en el filesystem.
   No hay endpoint/MCP de consulta (el AI Bridge :44444 aún no sirve el grafo).

## MEJORAS QUE ESTE TEST VALIDA (para el backlog, orden de impacto)
1. **Parser C#/.NET en indexer.rs** (NUEVA — no estaba en ningún plan) — clases, métodos,
   using→imports. Sin esto el Registry no entiende la mitad del portfolio de Sypnose.
2. **Profundizar bajo demanda**: acción "index deeply" sobre una subcarpeta del grafo
   (archivos+símbolos de ESA carpeta) sin re-indexar la raíz enorme.
3. **API de consulta para IAs** = M4/Mejora 4 ya planificada → SUBIR PRIORIDAD: este
   test demuestra que es LA pieza que convierte el Registry de visor humano en guía de
   agentes ("dame el grafo de X", "qué archivos dependen de Y").
4. **Edges de dependencia en modo compacto** (dir→dir por imports agregados).
5. **Timestamp/staleness en graph.json** (+ el watcher M2 ya mantiene fresca la carpeta
   abierta; M3 añade la historia).

## CONCLUSIÓN PARA EL ARQUITECTO
La visión ("humanos e IAs saben qué hay y qué conecta con qué") está a 2 piezas de ser
real para IAs: parser C# + API de consulta. El resto ya está en marcha (M2/M3/M4).
Añadir 1 y 2 al backlog v2.1 con prioridad alta.
