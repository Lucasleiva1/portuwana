# Método reproducible de ambientación del aeropuerto

## Resultado aprobado

La ambientación combina dos técnicas independientes:

1. seis estados completos del mismo aeropuerto (`A → B → C → D → E → F`)
   muestran el avance de los pasajeros, una pausa con menos gente y la entrada
   posterior de una composición distinta;
2. dos pasajeros recortados con alfa real aparecen, permanecen quietos,
   desaparecen y cambian de zona solamente mientras son invisibles.

No se simula una caminata deslizando una figura rígida. El fondo canónico A
permanece intacto y funciona como respaldo si faltan variantes o pasajeros.

La capa se monta en este orden:

```text
AirportBackground (A/B/C/D/E/F) → AirportAmbience → AirportAgent → interfaz DOM
```

La implementación está separada en:

```text
src/scene/airport/AirportBackground.ts
src/scene/airport/backgroundMotion.ts
src/scene/airport/AirportAmbience.ts
src/scene/airport/ambientMotion.ts
src/scene/airport/airportAmbience.config.ts
```

## Assets aprobados

| Archivo | Tamaño | SHA-256 |
| --- | ---: | --- |
| `ambient/background-state-b-v1.png` | 1672 × 941 | `343E26E5559100ECFED1F555E61DDFD82546F915E16F067BDCB8692ECF04D5C8` |
| `ambient/background-state-c-v1.png` | 1672 × 941 | `6A59E492EE89B477890E981119F1D7E1AE585099E444D5620ED1C195D729A203` |
| `ambient/background-state-d-v1.png` | 1672 × 941 | `AF308D1793F7504FA37CEEFF257E04FB1BD87A6EAEC31E52A206C99C518E7F96` |
| `ambient/background-state-e-v1.png` | 1672 × 941 | `5344714D7973D4A69D127E34F283B8B5BCBDA7F0E687C28CFB161F57D3B8EB81` |
| `ambient/background-state-f-v1.png` | 1672 × 941 | `AB593AF6C254719F619F6877F072444BD6883E7B5E8EBBBADCDC4A65E5424282` |
| `ambient/ambient-traveler-man-v2.png` | 512 × 768 | `7BD0335897469BEE495A21E2B987102FE0205AC0381FC6DB278120DBA30BABF0` |
| `ambient/ambient-traveler-woman-v2.png` | 512 × 768 | `452D1B31A77B600E351F716BF475E88458F350BB4FBD079A321658DC8728B048` |

Los estados B a F se generaron con ImageGen integrado, siempre de a uno. Cada
estado parte exclusivamente del anterior y cambia sólo los pasajeros. PixiJS
aplica `cover` a cada toma, por lo que la pequeña diferencia de resolución no
deforma la escena.

## Prompts de los estados del fondo

### Estado B

```text
Use case: precise-object-edit
Input: el fondo original exacto.
Crear el siguiente momento sutil del mismo aeropuerto. Cambiar solamente los
viajeros: hacer avanzar varios pasos a la pareja con equipaje del sector
inferior izquierdo, desplazar levemente algunos viajeros lejanos y retirar una
pequeña cantidad del grupo.
Conservar cámara 16:9, encuadre, perspectiva, arquitectura, columnas, ventanas,
techo, carteles y texto existente, plantas, baldosas, reflejos, iluminación,
sombras, cielo, torre y color. Mantener libre el piso derecho. Sin UI, logos,
marcas de agua, desenfoque ni estelas.
```

### Estado C

```text
Use case: precise-object-edit
Input: el estado B exacto.
Crear el momento siguiente. Hacer avanzar otra vez a la misma pareja, desplazar
algunos viajeros lejanos y cambiar suavemente dos o tres integrantes del grupo.
Repetir todas las invariantes del estado B; no rediseñar el aeropuerto.
```

### Estado D

```text
Use case: precise-object-edit
Input: el estado C exacto.
Crear el siguiente momento sutil. Mover a la misma pareja con equipaje varios
pasos naturales hacia el interior de la terminal, reduciendo su escala según la
perspectiva hasta dejarla cerca de salir del primer plano activo. Retirar
modestamente algunos pasajeros lejanos.
Conservar exactamente arquitectura, cartelería y texto, cámara, encuadre 16:9,
columnas, ventanas, techo, plantas, torre, baldosas, reflejos, luz, sombras,
cielo y color. Mantener libre la mitad derecha. Sin sujetos grandes nuevos, UI,
logos, marcas de agua, desenfoque, estelas ni cambios de cámara.
```

### Estado E

```text
Use case: precise-object-edit
Input: el estado D exacto.
Crear el momento siguiente. La pareja con equipaje ya salió completamente de la
escena: eliminarla y reconstruir naturalmente piso y reflejos. Crear el momento
más despejado del ciclo retirando varios pasajeros lejanos, pero conservar una
cantidad pequeña y creíble dentro de la terminal.
Repetir todas las invariantes del estado D; no agregar otra pareja ni sujetos
de primer plano y no rediseñar el aeropuerto.
```

### Estado F

```text
Use case: precise-object-edit
Input: el estado E exacto.
Crear el momento siguiente. Introducir una composición distinta de tres a cinco
pasajeros pequeños y lejanos en los tercios izquierdo y central; como máximo uno
puede llevar equipaje. Mantener abierto todo el primer plano. No recrear la
pareja anterior ni colocar personas cerca de cámara.
Repetir todas las invariantes del estado D; mantener libre la mitad derecha y
no rediseñar el aeropuerto.
```

Siempre se genera una sola variante y se valida antes de continuar. Si cambia
la cámara, la relación de aspecto o un elemento dominante, la salida se rechaza.

## Línea temporal A → B → C → D → E → F

Cada estado se mantiene 4,8 segundos y se disuelve al siguiente durante 1,2
segundos con `smoothstep`. El ciclo completo dura 36 segundos:

```text
A (original) → B (avance 1) → C (avance 2) → D (avance 3)
             → E (menos gente) → F (grupo distinto) → A
```

Los seis sprites ocupan el mismo contenedor. Si sólo carga A, el modo se degrada
a `static`. El cálculo es dinámico: si falta una variante, recorre solamente
las que hayan cargado. La función pura está cubierta por
`tests/backgroundMotion.test.ts`.

## Transparencia real de los pasajeros

Las primeras exportaciones v1 eran RGB: la cuadrícula estaba pintada en la
imagen y producía rectángulos visibles. Esas versiones se rechazaron. No se usa
chroma key ni shader en tiempo de ejecución.

El script reproducible es:

```text
scripts/Convert-WhiteMatteToAlpha.ps1
```

Método:

1. carga el PNG RGB y lo normaliza a ARGB de 32 bits;
2. detecta desde los cuatro bordes la región clara y casi neutra conectada;
3. ejecuta un flood fill para no borrar blancos internos desconectados;
4. convierte esa región conectada a alfa 0;
5. suaviza sólo el anillo inmediato del contorno y retira el mate claro;
6. guarda un PNG con canal alfa real.

La prueba de control debe componer v1 y v2 sobre un fondo oscuro con grilla. En
v2 la grilla debe verse alrededor de toda la silueta. Además, los píxeles de las
esquinas deben medir alfa 0. Recién entonces se cambia el manifiesto a v2.

## Zonas seguras y coordenadas

El lienzo lógico es 1600 × 900. Se excluyen explícitamente:

- `x=390..550`: jardinera pequeña;
- `x=700..1000`: jardinera grande y columna;
- `x>=850`: posible intersección con la funcionaria principal;
- escalas mayores a `0.11`: compiten visualmente con la escena.

Zonas aprobadas: izquierda (`x=50..360`) y corredor centro-izquierdo
(`x=580..660`), con base `y=525..570`.

| Pasajero | Posiciones `(x, y, escala)` |
| --- | --- |
| hombre | `(110,570,0.105)`, `(335,560,0.09)`, `(610,530,0.075)` |
| mujer | `(225,560,0.09)`, `(590,540,0.075)`, `(70,550,0.085)` |

Todas las coordenadas viven únicamente en `airportAmbience.config.ts`. La
funcionaria está anclada en `x=1170`, escala `0.6`, por lo que estos pasajeros no
pueden quedar detrás de su cuerpo.

## Línea temporal de figuras independientes

Cada ciclo dura 12 segundos:

| Tramo normalizado | Estado |
| --- | --- |
| `0,00 → 0,12` | aparición con `smoothstep` |
| `0,12 → 0,60` | visible y quieto |
| `0,60 → 0,72` | desaparición con `smoothstep` |
| `0,72 → 1,00` | invisible y cambio de zona |

Las figuras usan fases distintas. La ubicación cambia únicamente con alfa cero.

## Evolución prevista

- `fade-relocate`: versión actual, sin desplazamiento visible;
- `cross`: caminata real con cuatro a ocho poses coherentes;
- `wait`: microgestos de espera;
- `luggage`: animación separada de la valija;
- `crowd-depth`: velocidades y escalas por profundidad.

Antes de incorporar caminatas deben existir poses o un esqueleto coherente. No
se debe mover una figura rígida por el piso como sustituto.

## Validación realizada y pendiente

- 21 archivos de pruebas y 81 tests aprobados;
- build de producción aprobado;
- aplicación nativa verificada con HTTP 200, ventana `PORTUWANA` de 1044 × 699;
- seis fondos cargados en modo `state-dissolve`;
- dos figuras cargadas en modo `fade-relocate`;
- captura real sin rectángulos opacos;
- pendiente: conectar la opción global `prefers-reduced-motion`.
