# Guia de Usuario — Registry

## Que es Registry

Registry convierte cualquier carpeta de tu ordenador en un **mapa visual e interactivo**: cada archivo y subcarpeta se dibuja como un circulo, y las lineas muestran como se relacionan entre si. Ademas, el mapa esta **vivo**: se actualiza solo cuando algo cambia en la carpeta, guarda una "foto" de cada momento para que puedas viajar en el tiempo, y se puede conectar con asistentes de IA como Claude o NotebookLM.

En resumen: es una forma de entender un proyecto entero de un vistazo, sin abrir archivo por archivo.

---

## Primeros pasos: abrir una carpeta

### Que hace
Al arrancar la app veras una pantalla de bienvenida con el titulo **"Registry"** y un boton azul grande **"Open Folder"** en el centro. Al pulsarlo se abre el explorador del sistema para que elijas cualquier carpeta. En cuanto la eliges, la app la convierte en un mapa visual. Si esa carpeta ya se habia analizado antes, se abre al instante; si es la primera vez, la app la analiza sola (veras una barra de progreso).

### Para que sirve
Es el punto de partida de todo. Sirve para ver de un vistazo como esta organizada una carpeta o un proyecto entero sin abrir nada a mano. Ideal cuando llegas a un proyecto nuevo y quieres entender que hay dentro y como se conecta.

### Como se usa
1. Pulsa el boton azul **"Open Folder"**.
2. Elige una carpeta en el explorador.
3. Espera a que se dibuje el mapa.
4. Debajo del boton, si ya habias abierto proyectos antes, aparece la lista **"Recent Projects"**: pulsa cualquiera para volver a abrirlo con un solo clic.

> **[VIDEO: wizard]** — Aqui encaja bien la grabacion del arranque y primer analisis de una carpeta.

---

## Entender el mapa

### Los colores y tamanos de los circulos (nodos)

**Que hace.** Cada circulo (llamado "nodo") es un archivo o una carpeta.
- El **COLOR** indica a que grupo pertenece: la app agrupa por color las partes muy relacionadas entre si, para que veas a simple vista los "barrios" del proyecto.
- El **TAMANO** indica lo conectado que esta ese archivo: cuanto mas grande el circulo, mas lineas entran o salen de el, o sea, mas importante o central es.
- Cada nodo tiene ademas un fino **borde de otro color** que indica su TIPO (archivo, funcion, clase, documento, dato, configuracion, imagen, etc.).

**Para que sirve.** Te permite entender un proyecto sin leer nada: los circulos grandes son las piezas clave (lo que mas usa todo el mundo) y las zonas del mismo color son partes que trabajan juntas. Asi localizas de un golpe lo importante y lo relacionado.

**Como se usa.** No hay que hacer nada, es automatico. Como referencia rapida de tipos por color de borde:
- **Azul** = archivo
- **Verde** = funcion
- **Naranja/ambar** = clase o imagen
- **Rojo** = ruta
- **Morado** = tabla
- **Indigo** = documento
- **Cian** = datos
- **Gris** = configuracion

Para saber el color exacto de cada grupo o tipo, pon el raton sobre un nodo o pulsalo para ver su ficha.

### Las "communities" (grupos de color)

**Que hace.** Una community es un grupo de archivos muy conectados entre si, como un "barrio" o "modulo" del proyecto. La app los detecta automaticamente y da a cada uno un color distinto. En la barra de abajo se cuenta cuantas communities tiene el proyecto.

**Para que sirve.** Te ayudan a ver la estructura de alto nivel: en vez de mirar cientos de archivos sueltos, ves un punado de bloques de color, y cada bloque suele corresponder a una parte funcional (la parte visual, la de datos, etc.).

**Como se usa.** Se ven solas por los colores del mapa. Ademas puedes filtrar por community desde la barra de filtros (mas abajo): aparecen pastillas de color con el nombre de cada grupo y al pulsarlas dejas ver solo ese grupo. La ficha de cada nodo tambien indica a que community pertenece.

---

## Moverte por el mapa: zoom, arrastrar y "Fit"

### Que hace
El mapa es un lienzo que puedes recorrer:
- **Zoom** con la rueda del raton (acercar/alejar).
- **Desplazarte** arrastrando con el raton sobre una zona vacia.
- **Boton "Fit"** (abajo a la derecha): reencuadra automaticamente todo el mapa para que quepa entero en pantalla.
- Al pasar el raton **por encima de un nodo**, la app resalta ese nodo y sus vecinos y atenua el resto, para que veas con quien se conecta.

### Para que sirve
Para explorar comodamente proyectos de cualquier tamano: acercarte a una zona, pasearte por el mapa y volver a la vista general con un clic cuando te pierdes. El resaltado al pasar el raton deja ver relaciones sin hacer clic.

### Como se usa
- Rueda del raton para el zoom (el porcentaje se muestra abajo a la derecha).
- Arrastra sobre una zona vacia para desplazarte.
- Pon el raton sobre un nodo para ver sus vecinos iluminados.
- Pulsa **"Fit"** para encajar todo el mapa. Al abrir un proyecto o quitar filtros, la app hace este encuadre sola.

---

## Buscar un archivo o funcion (Ctrl+K)

### Que hace
Abre una ventana de busqueda en el centro de la pantalla. Escribes un nombre y te muestra al instante los nodos que coinciden, agrupados por tipo (ARCHIVOS, FUNCIONES, etc.). Prioriza las coincidencias exactas y las que empiezan por lo que escribiste. Si no escribes nada, te sugiere los 20 nodos mas conectados del proyecto (los mas importantes).

### Para que sirve
En un proyecto grande con miles de nodos, encontrar algo a ojo es imposible. La busqueda te lleva directo al archivo o funcion que buscas y lo centra en el mapa para verlo en su contexto.

### Como se usa
1. Pulsa **Ctrl+K** (o Cmd+K en Mac), o el boton **"Search"** arriba a la derecha.
2. Empieza a escribir.
3. Muevete por los resultados con las flechas **arriba/abajo** del teclado y pulsa **Enter** para saltar al elegido (o haz clic).
4. Al seleccionar uno, la app lo centra en el mapa, hace zoom hacia el y abre su ficha de detalle.
5. Pulsa **Esc** para cerrar sin elegir.

---

## Filtrar por tipo, grupo o lenguaje (tecla F)

### Que hace
Abre una barra bajo la barra superior con pastillas para mostrar u ocultar nodos segun tres criterios:
- **TYPE** (tipo): archivo, funcion, clase, documento, dato, configuracion, imagen.
- **COMMUNITY** (grupo de color).
- **LANG** (lenguaje detectado, p. ej. TypeScript, Python, Rust).

Al activar una o varias pastillas, el mapa se queda solo con lo que encaja. Importante: los nodos **no se mueven de sitio** al filtrar, asi no te pierdes.

### Para que sirve
Para centrarte en lo que te interesa y reducir el ruido. Por ejemplo: ver solo los documentos, solo los archivos Python, o solo un modulo concreto. Muy util en proyectos grandes para no ahogarte en informacion.

### Como se usa
1. Pulsa la tecla **F** o el boton de filtros (icono de tres lineas) en la barra superior.
2. Pulsa las pastillas que quieras activar (puedes combinar varias).
3. Cuando hay filtros activos aparece a la derecha un boton rojo **"Clear"** para quitarlos todos de golpe.
4. Vuelve a pulsar **F** o el boton de filtros para esconder la barra.

---

## La ficha de detalle de un nodo (hacer clic)

### Que hace
Al pulsar un circulo del mapa se abre a la derecha un panel con toda la informacion de ese archivo o carpeta: su nombre, su tipo (con color), el lenguaje, si esta "exported", la RUTA completa, y metadatos como numero de lineas (o de archivos si es carpeta), tamano en disco y cuantas conexiones tiene. Ademas lista:
- **"Connections Out"**: a que otros archivos apunta.
- **"Connections In"**: que otros archivos apuntan a el.

Cada conexion es pulsable para saltar a ese nodo.

### Para que sirve
Es la ficha completa de cada pieza del proyecto. Sirve para entender un archivo sin abrirlo: que es, de que tamano y, sobre todo, con quien se relaciona. Saltando por las conexiones puedes seguir el hilo del proyecto de un archivo a otro.

### Como se usa
1. Haz clic en cualquier nodo (el seleccionado se resalta en ambar y crece un poco).
2. Se abre el panel a la derecha.
3. Pulsa cualquier conexion de las listas para ir a ese otro nodo (la app lo centra y actualiza la ficha).
4. Cierra el panel con la **X** arriba a la derecha o con la tecla **Esc**.
5. Puedes retroceder/avanzar por los nodos que has visitado con las teclas **[** y **]**.

---

## Abrir archivos desde el mapa: "Open" y "Reveal" (con proteccion de seguridad)

### Que hace
En la ficha de un nodo, bajo la ruta ("Path"), hay dos botones:

- **"Open"** (azul) abre el archivo de forma **segura segun el tipo**:
  - Documentos, imagenes y codigo normal (.md, .pdf, .png, .json, .rs, .tsx, etc.) se abren con su programa habitual.
  - **Scripts** (.py, .bat, .cmd, .ps1, .sh, .vbs, .js, etc.) se abren SIEMPRE en un editor de texto (Bloc de notas) para LEERLOS, y **NUNCA se ejecutan**.
  - **Ejecutables/binarios** (.exe, .msi, .jar, .lnk, .com, .scr...) no se abren en absoluto: en su lugar se muestran en el explorador de archivos.
- **"Reveal"** (gris) siempre hace lo mismo: abre la carpeta del archivo en el explorador y lo deja seleccionado, sin abrir el archivo.

### Para que sirve
"Open" te lleva directo al contenido del archivo sin buscarlo a mano. "Reveal" te lo situa en el explorador por si quieres copiarlo, moverlo o trabajarlo fuera de la app.

La logica de seguridad existe para **protegerte**: en Windows, hacer doble clic sobre un script o un .exe normalmente lo EJECUTA (corre codigo en tu ordenador). Como esta app abre carpetas de cualquier origen, nunca debe ejecutar codigo solo porque pulses "Open": por eso los scripts se abren como texto y los ejecutables solo se muestran. Asi puedes inspeccionar cualquier archivo con total tranquilidad.

### Como se usa
1. Selecciona un nodo que sea un archivo para abrir su ficha.
2. Bajo "Path" veras los botones **"Open"** y **"Reveal"**.
3. Pulsa **"Open"** para ver el contenido (documento en su app, script en el Bloc de notas, ejecutable mostrado en el explorador).
4. Pulsa **"Reveal"** para localizar el archivo en el explorador de Windows, ya resaltado.

No necesitas saber el tipo: la app decide sola la accion segura.

---

## Volver al inicio: el boton "Back"

### Que hace
El boton con la flecha hacia la izquierda ("<"), arriba a la izquierda junto al nombre del proyecto, cierra el proyecto actual y te devuelve a la pantalla de bienvenida. Al volver, la app tambien deja de vigilar la carpeta en tiempo real y limpia el historial temporal.

### Para que sirve
Para cerrar el proyecto que estas viendo y abrir otro distinto, o simplemente volver al inicio. Es la forma limpia de cambiar de carpeta.

### Como se usa
Pulsa el boton de la flecha en la esquina superior izquierda. Vuelves a la pantalla de bienvenida, donde puedes pulsar **"Open Folder"** para elegir otra carpeta o un proyecto reciente de la lista.

---

## Modo Live: el mapa que se actualiza solo

Esta es una de las funciones estrella de Registry: el mapa esta **vivo** y refleja los cambios de tu carpeta en tiempo real.

### El indicador "● Live" (abajo, en el centro)

**Que hace.** Es una pequena etiqueta con un puntito que aparece abajo del todo, en el centro. Te dice si la app esta vigilando la carpeta abierta:
- Punto **rojo que late** junto a "Live" = esta vigilando.
- Punto **gris** con "Live off" = no vigila nada.

Es solo un semaforo informativo, **no es un boton**.

**Para que sirve.** Para saber de un vistazo si el mapa se va a actualizar solo cuando cambie algo. Si ves "● Live" en rojo, tienes la garantia de que cualquier archivo que se cree, se borre o se modifique dentro de esa carpeta se reflejara en el mapa en pocos segundos, sin que hagas nada.

**Como se usa.** No se pulsa. Nada mas abrir una carpeta, el punto se pone rojo. Si cierras la vista, cambias de carpeta o miras una foto del pasado con la barra de tiempo, pasa a gris "Live off". La app comprueba su estado cada 2 segundos, asi que siempre refleja la realidad.

### La vigilancia en vivo (el "watcher")

**Que hace.** Es el motor invisible detras del indicador Live. Cuando abres una carpeta, la app le pide al sistema operativo que le avise cada vez que algo cambie dentro (o en cualquier subcarpeta). En cuanto detecta un cambio, vuelve a leer la carpeta entera y redibuja el mapa: los archivos nuevos aparecen como nodos nuevos, los borrados desaparecen, y las conexiones se reajustan. Todo pasa solo.

**Para que sirve.** Para ver tu proyecto cambiar en tiempo real. **El caso de uso estrella:** abre tu proyecto en la app, deja que un agente de IA (como Claude Code) trabaje en esa carpeta, y mira el mapa transformarse solo mientras la IA crea, edita y borra archivos. Tambien es util cuando trabajas tu: guardas un archivo en tu editor y lo ves aparecer al momento. No hay que cerrar y volver a abrir para ver los ultimos cambios.

**Como se usa.** Se enciende solo al abrir una carpeta. No hay boton de encender/apagar: mientras tengas la carpeta abierta, esta vigilando. Al cambiar de carpeta, la vigilancia de la anterior se apaga. Los cambios tardan entre ~1,5 y ~3 segundos en verse: la app espera 1,5 segundos tras el ultimo cambio (asi, si guardas 3 archivos de golpe o la IA toca varios a la vez, todo se junta en UNA sola actualizacion en vez de parpadear) y luego re-lee y redibuja.

> **[VIDEO: watcher]** — Aqui va la demo del modo Live actualizandose solo mientras se editan archivos o mientras una IA trabaja en la carpeta.

### Cero consumo en reposo

**Que hace.** El modo Live **no** comprueba la carpeta una y otra vez gastando bateria y procesador. Se queda dormido, y es el propio sistema operativo quien le da un toque SOLO cuando ocurre un cambio de verdad. Ademas tiene un filtro inteligente: los archivos internos que la propia app genera (la carpeta `graphify-out`, bases de datos `.db`, y carpetas tipo `.git`, `node_modules`, `dist` o `target`) se ignoran, para que la app no entre en un bucle re-dibujandose a si misma.

**Para que sirve.** Para dejar la app abierta todo el dia vigilando tu proyecto sin que te caliente el ordenador ni te gaste bateria. Solo trabaja cuando hay algo real que mostrar.

**Como se usa.** No requiere configuracion: funciona asi de fabrica. Deja la carpeta abierta con el indicador "● Live" en rojo y olvidate.

---

## Viaje en el tiempo: la barra de tiempo (time-slider)

Registry guarda automaticamente "fotos" de tu carpeta para que puedas ver como estaba en el pasado.

### La barra de tiempo

**Que hace.** Es una franja horizontal delgada abajo, justo encima de la barra de estado, con un control deslizante que arrastras de izquierda a derecha. Cada punto es una "foto" de tu carpeta en un momento distinto. Al arrastrar a la **izquierda** ves como estaba antes; a la **derecha** del todo vuelves al presente. Izquierda = lo mas antiguo, derecha = lo mas reciente.

**Para que sirve.** Para responder preguntas como "¿que cambio esta semana?" o "¿como estaba esta carpeta el lunes?". La app guardo el estado automaticamente y tu solo retrocedes en el tiempo para verlo con tus propios ojos. Es una maquina del tiempo visual para tu carpeta.

**Como se usa.**
1. La barra solo aparece cuando la app ha guardado al menos **DOS fotos** (si abres una carpeta por primera vez, aun no hay pasado, asi que la barra esta oculta).
2. Arrastra el deslizante a la izquierda para retroceder o a la derecha para avanzar.
3. A medida que lo mueves (o pasas el raton por encima), en el centro ves la **fecha y hora exactas** de esa foto (por ejemplo "jul 2, 16:30:05").
4. Al soltar en un punto del pasado, el mapa se reconstruye para mostrar ese momento.
5. Para volver al presente: arrastra del todo a la derecha o pulsa el boton **"HOY"**.

> **[VIDEO: registry-timeslider]** — Aqui va la demo de arrastrar la barra y ver el mapa cambiar entre fotos del pasado.

### Guardado automatico de fotos (history.db)

**Que hace.** Cada vez que la app examina tu carpeta —al abrirla o al detectar sola que algo cambio— guarda automaticamente una foto completa del mapa con su fecha y hora. Todas se acumulan en un pequeno archivo llamado `history.db` dentro de la carpeta `graphify-out` (que la propia app crea dentro de tu carpeta). No tienes que pulsar "guardar": ocurre solo, en segundo plano.

**Para que sirve.** Es lo que hace posible el viaje en el tiempo. Cada foto queda etiquetada con su fecha y hora, asi que la app reconstruye con exactitud como estaba tu carpeta en cualquier momento anterior, sin volver a escanear el disco (es instantaneo y siempre fiel al original).

**Como se usa.** No requiere accion: es automatico. Cada escaneo = una foto nueva = un punto nuevo en la barra de tiempo. Si dejas la app abierta y editas archivos, la barra va ganando puntos a lo largo del dia o la semana. Las fotos son independientes: una foto vieja se sigue viendo igual aunque despues se guarden muchas encima.

### Estado PRESENTE vs HISTORICO y el boton "HOY"

**Que hace.** En el lado **IZQUIERDO** de la barra hay una etiqueta que te dice en que modo estas mirando:
- **"PRESENTE"** (punto azul) = ves tu carpeta tal como esta ahora.
- **"HISTORICO"** (punto ambar/naranja) = ves una foto del pasado.

En modo historico, toda la barra se tine ligeramente de **naranja** para recordarte que estas viajando en el tiempo. En el lado **DERECHO** hay un boton **"HOY"** que te devuelve al presente de un clic.

**Para que sirve.** Evita confusiones: como el mapa se ve igual de real en presente y pasado, el color y la etiqueta te recuerdan cual miras. Ademas, en modo HISTORICO la app **congela** esa vista: aunque cambies archivos y la app los detecte, NO te salta al presente sin avisar, para que estudies tranquilo. El boton "HOY" es el atajo para salir del pasado y reactivar la vista en vivo.

**Como se usa.** Mira la etiqueta de la esquina inferior izquierda. Para volver al presente: arrastra el deslizante del todo a la derecha, o pulsa **"HOY"**. El boton "HOY" solo esta encendido (naranja) cuando estas en el pasado; en el presente aparece atenuado porque no hay a donde volver.

### Contadores verde / ambar / rojo (que se anadio, cambio o borro)

**Que hace.** Al lado del deslizante, a la derecha, la barra muestra tres numeros con colores que resumen que paso en la foto que miras comparada con la anterior:
- Numero **VERDE con "+"** = cuantas cosas se ANADIERON (archivos o conexiones nuevos).
- Numero **AMBAR con "~"** = cuantas cosas CAMBIARON (p. ej. un archivo que crecio o se edito).
- Numero **ROJO con "-"** = cuantas cosas se BORRARON.

Tambien aparecen al pasar el raton por encima del deslizante, en el globo de ayuda.

**Para que sirve.** Es el resumen de un vistazo de "que cambio en este momento". Sin abrir nada, ves si hubo mucho movimiento (muchos verdes = anadiste; muchos rojos = borraste; ambar = reescribiste). Es justo lo que necesitas para "que cambio esta semana": deslizas por las fotos de los ultimos dias y los colores te cuentan la historia.

**Como se usa.** Mueve el deslizante a la foto que te interese y lee los tres numeros. Truco: pasa el raton por distintos puntos del deslizante y el globo de ayuda te adelanta la fecha y esos contadores de cada foto, para localizar rapido "el dia que pasaron muchas cosas".

> **Nota:** la PRIMERA foto de todas siempre muestra 0/0/0, porque no hay ninguna foto anterior con la que compararla.

---

## Conectar tu IA

Registry esta pensado para trabajar codo con codo con asistentes de inteligencia artificial. Hay tres formas de hacerlo.

### 1. El chat integrado — "Ask Claude"

**Que hace.** Es un panel de chat que se abre por el lado derecho. Le escribes preguntas en lenguaje normal sobre la carpeta abierta, como se las harias a una persona: "¿Que hace este proyecto?", "¿Cuales son los archivos principales?", "¿Que se rompe si borro este archivo?". Un asistente de IA (Claude) lee el mapa de tu carpeta y responde con un resumen escrito.

Lo importante: **NO** responde con conocimiento general de internet, responde SOLO mirando TU carpeta concreta. Si algo no esta en tu carpeta, te lo dice claramente en vez de inventarselo. Ademas, cuando menciona un archivo concreto, ese nombre aparece resaltado y es un boton: al pulsarlo, el mapa se mueve solo y centra ese archivo iluminado.

**Para que sirve.** Para entender una carpeta sin abrir archivo por archivo. Abres una carpeta que nunca has visto, preguntas "¿de que va esto?" y en segundos tienes un resumen. Es especialmente util para saber que partes estan conectadas ("¿que usa esta funcion?") sin rastrearlo a mano. Las respuestas con archivos clicables te llevan directo al sitio exacto del mapa.

**Como se usa.**
1. En la barra de herramientas de arriba pulsa el icono de **chat** (bocadillo de conversacion; su etiqueta al pasar el raton dice "Ask Claude about this folder"). Se abre el panel a la derecha.
2. La **PRIMERA vez** necesitas poner una clave (API key) de Anthropic — es como una contrasena personal que conecta la app con Claude. Si no la has puesto, la app te abre sola los ajustes (icono de engranaje) y te pide pegar la clave (empieza por `sk-ant-...`). La escribes, pulsas **"Save key"** y listo; solo se hace una vez.
   - **Tranquilidad:** esa clave se guarda SOLO en tu ordenador, en un archivo local tuyo (`~/.registry-app/settings.json`), nunca se sube a internet ni queda en el proyecto. La app nunca te la vuelve a mostrar entera, solo los ultimos 4 caracteres para que la reconozcas.
3. Con la clave puesta, escribe tu pregunta abajo, en el recuadro **"Ask about this folder…"**, y pulsa **Enter** o el boton **"Send"**.
4. Claude responde arriba. Donde veas un nombre de archivo resaltado, pulsalo: el mapa centra y selecciona ese nodo automaticamente.

Si algun dia falta la clave, la app te avisa con un mensaje claro y te reabre los ajustes; nunca da un error confuso.

### 2. El AI Bridge (para IAs y programas de tu ordenador)

El AI Bridge es un mini-servidor local que ofrece el mapa de tu carpeta a cualquier IA o programa que tengas en tu propio ordenador.

**El indicador "AI Bridge :44444" (abajo a la izquierda).**
Es una etiqueta que aparece siempre en la esquina inferior izquierda. Cuando dice "AI Bridge :44444" (en gris) significa que la app tiene encendido un mini-servidor dentro de tu ordenador, en la direccion `http://127.0.0.1:44444`, que ofrece el mapa de la carpeta abierta. No hay que instalar ni configurar nada: se enciende solo al abrir la app. El "44444" es el numero de "puerta" local por la que atiende.

**Para que sirve.** Para que cualquier IA o programa de tu propio ordenador (Claude Code, un script tuyo) pueda "ver" el mapa de tu proyecto sin abrir los archivos a ciegas. En vez de que la IA lea archivo por archivo, le pasas el mapa entero, la lista de conexiones y hasta la historia de cambios de golpe. No necesita clave ni cuenta.

**Como se usa (el panel desplegable).**
1. Abre una carpeta (asi el mapa queda cargado).
2. Haz clic en la etiqueta "AI Bridge :44444" para desplegar un panelito con la direccion y la lista de funciones.
3. Pulsa **"Copy"** para copiar `localhost:44444` (aparece "Copied!" 2 segundos) y pegarsela a tu IA.
4. Vuelve a pulsar la etiqueta para plegar el panel.

Mientras la app este abierta, el Bridge esta activo; si cierras la app, se apaga.

**El indicador "AI Connected" (punto verde).**
El mismo boton cambia de aspecto cuando una IA acaba de hablar con el Bridge: pasa de gris a **verde con un puntito** y el texto "AI Connected". Es tu senal de que algo (una IA) esta consultando el mapa ahora mismo. Se pone verde automaticamente cuando una IA ha hecho una consulta en los ultimos 30 segundos, y vuelve a gris pasado ese tiempo. La app lo comprueba sola cada 3 segundos. Util cuando le pides a tu IA que "mire el proyecto" y quieres confirmar que lo esta haciendo.

**Que puede consultar una IA (para curiosos o tecnicos).** Estas son las funciones que ofrece el Bridge; se usan con `curl` o desde tu IA:
- **Resumen del proyecto** (`/architecture`): con una sola llamada, la IA recibe un resumen compacto de toda la carpeta (cuantos archivos y conexiones hay, lineas de codigo, lenguajes, tipos de archivo y los archivos mas centrales). Es la mejor primera pregunta para orientarse. Ejemplo: `curl http://127.0.0.1:44444/architecture`.
- **Historia de cambios** (`/timeline`, `/changes/N`, `/snapshot/N`): la lista de todos los escaneos con su fecha y cuantas cosas se anadieron/cambiaron/borraron; el detalle de un escaneo; o el mapa completo tal como estaba en ese momento. Ejemplo: `curl http://127.0.0.1:44444/timeline`.
- **Buscar y ver detalle** (`/search?q=` y `/node/ID`): encuentra nodos por nombre (hasta 50 resultados) o devuelve un archivo con sus conexiones entrantes y salientes. Ejemplo: `curl "http://127.0.0.1:44444/search?q=payment"`.
- **Resaltar un nodo en tu pantalla** (`/highlight`): la unica funcion que "escribe" algo. Permite que tu IA marque un nodo del mapa para llamarte la atencion ("este es el archivo del que te hablo"). El panel del Bridge te muestra un aviso naranja: "N nodes highlighted by AI". Para quitar los marcados: `/clear-highlights`.

**Receta para Claude Code.** Puedes escribir una vez en el archivo `CLAUDE.md` de tu carpeta una instruccion para que tu asistente consulte el Bridge por su cuenta, por ejemplo:
> "Antes de explorar archivos en esta carpeta, consulta el AI Bridge del Registry: usa `curl http://127.0.0.1:44444/architecture` para el mapa, `curl http://127.0.0.1:44444/timeline` para ver los cambios recientes, y `POST /highlight` para senalarme en pantalla el nodo en el que trabajas."

Con eso, cada vez que abras esa carpeta con Claude Code el asistente se orientara solo con el mapa vivo antes de tocar nada.

**Seguridad del Bridge (tu tranquilidad).** El Bridge es seguro por diseno: solo escucha en `127.0.0.1` (tu propia maquina), asi que nada de fuera de tu ordenador puede acceder. Y salvo la funcion de resaltar nodos, **todo es de solo lectura**: la IA puede mirar el mapa y la historia, pero **no puede modificar, borrar ni crear archivos tuyos**. No hay claves ni cuentas que gestionar. Si cierras la app, el Bridge se apaga y ninguna IA puede consultar nada.

---

## Conectar con NotebookLM (el boton del cerebro 🧠)

### Que hace
Es un boton con un icono de cerebro en la barra de herramientas que conecta la carpeta abierta con **NotebookLM de Google**.

¿Que es NotebookLM? Es un cuaderno inteligente gratuito de Google (`notebooklm.google.com`): le das unos documentos como fuente y luego puedes chatear con ellos, pedir resumenes, hacer preguntas e incluso **escuchar un resumen en audio tipo podcast** de tu material.

Lo que hace este boton es preparar automaticamente un resumen escrito y **siempre actualizado** de tu carpeta (que archivos hay, en que lenguajes, que ha cambiado ultimamente con fechas, y cuales son los archivos mas importantes), lo guarda dentro de tu carpeta de Google Drive, y te guia para anadirlo UNA sola vez como fuente en NotebookLM. A partir de ahi, cada vez que tu proyecto cambia y pulsas "actualizar", se reescribe el mismo archivo y NotebookLM lo vuelve a leer solo — sin volver a configurar nada.

### Para que sirve
Para poder "conversar" con tu proyecto o escuchar un resumen hablado de el fuera de esta app, dentro de la herramienta de Google que quizas ya usas para estudiar o trabajar. En vez de explicarle a NotebookLM que hay en tu carpeta, la app le entrega un mapa-resumen limpio y lo mantiene al dia por ti. Ideal para repasar tu proyecto en el movil, oir un resumen mientras haces otra cosa, o compartir el contexto del proyecto sin trabajo manual.

### Como se usa (como mucho 2 clics)
1. En la barra de herramientas pulsa el **boton del cerebro** (su etiqueta dice "Connect this folder to NotebookLM (2 clics)"). Nota: el boton solo esta activo si tienes una carpeta cargada; si no, aparece atenuado y dice "Load a folder first".
2. Se abre una ventana que ya ha detectado sola tu carpeta de Google Drive y la muestra con un tic verde ("Google Drive found"). Si no la encontro, hay un enlace **"Choose a different folder…"** para elegirla tu. Pulsa el boton azul **"Connect"** — **CLIC 1**. En ese momento la app escribe el resumen en tu Drive y abre `notebooklm.google.com` en el navegador.
3. Aparece una pantalla-guia **"One last step — just this once"** (un ultimo paso, solo esta vez) que te dice que hacer en NotebookLM: abrir o crear un cuaderno, pulsar **"➕ Add source → Google Drive"** y elegir el archivo llamado **"registry-digest-….md"**. Cuando lo hayas hecho, vuelve a la app y pulsa **"Done ✓"** — **CLIC 2**. Ya esta conectado para siempre.
4. A partir de ahi, cada vez que abras el boton del cerebro veras la pantalla **"NotebookLM connected"** con un boton **"Update now"** (actualizar ahora): al pulsarlo se reescribe el mismo archivo en Drive con los ultimos cambios, y NotebookLM lo vuelve a indexar por su cuenta. **No hay que volver a anadir la fuente nunca mas.**

---

## Preguntas frecuentes (FAQ)

**¿Tengo que pulsar "guardar" en algun momento?**
No. Registry guarda las fotos de tu carpeta (para el viaje en el tiempo) de forma automatica, en segundo plano.

**¿El modo Live me va a gastar bateria si dejo la app abierta todo el dia?**
No. En reposo no hace nada: solo trabaja cuando el sistema le avisa de un cambio real. Ademas ignora sus propios archivos internos para no re-dibujarse en bucle.

**¿La barra de tiempo no aparece?**
Es normal si acabas de abrir la carpeta por primera vez: hacen falta al menos DOS fotos guardadas para que haya pasado que visitar. Deja la app abierta y ve editando; los puntos iran apareciendo.

**¿Es seguro pulsar "Open" sobre un script o un .exe de una carpeta desconocida?**
Si. La app nunca ejecuta codigo al pulsar "Open": los scripts se abren como texto para leer y los ejecutables solo se muestran en el explorador.

**¿Adonde va mi clave (API key) de Anthropic?**
Se guarda SOLO en tu ordenador, en `~/.registry-app/settings.json`. Nunca se sube a internet ni queda en el proyecto, y la app solo te muestra los ultimos 4 caracteres.

**¿Puede una IA conectada por el AI Bridge borrar o cambiar mis archivos?**
No. Salvo resaltar nodos en tu pantalla, todo el Bridge es de solo lectura, y solo escucha en tu propia maquina (127.0.0.1).

**¿NotebookLM es de pago?**
No. NotebookLM es un cuaderno inteligente gratuito de Google. Solo tienes que anadir el archivo de resumen como fuente una vez.

**¿Como cambio de proyecto?**
Pulsa el boton de la flecha ("Back") arriba a la izquierda para volver a la pantalla de bienvenida, y elige otra carpeta o un proyecto reciente.
