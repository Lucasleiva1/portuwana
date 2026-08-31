# Método reproducible de assets faciales

Documento vivo de producción para PORTUWANA. Registra el método aprobado para
derivar parpadeos, bocas y otras variaciones faciales sin cambiar la identidad,
el encuadre ni la iluminación del personaje.

**Estado actual:** ojos, conjunto de habla y expresiones localizadas v2
validados.

**Última actualización:** 31 de agosto de 2026.

## Regla principal

El personaje se construye a partir de un único master canónico e inmutable:

```text
public/assets/airport/character/agent-master-v2.png
```

Nunca se vuelve a generar el cuerpo completo para crear un parpadeo o un
visema. Sólo se edita un recorte pequeño de la zona que debe cambiar. Después,
el cambio se aísla con una máscara suavizada y se coloca en un PNG transparente
con exactamente el mismo canvas y origen que el master.

Esto garantiza que cada capa aprobada se renderice con:

```text
x = 0
y = 0
scale = 1
rotation = 0
canvas = 1086 × 1448 px
```

Si una capa necesita desplazarse o escalarse manualmente para coincidir, no se
considera terminada: debe corregirse el archivo fuente.

## Por qué se descartó el método anterior

Los primeros ojos y bocas procedían de otra cara. Aunque era posible acercarlos
moviendo y escalando capas, cambiaban la geometría, la piel, la iluminación y el
estilo. También se probó regenerar el personaje completo con los ojos cerrados;
esa edición alteró cabello, rasgos y ropa.

Ambos enfoques quedan prohibidos para los assets definitivos. Los archivos
anteriores permanecen temporalmente en el repositorio sólo para comparación y
no están aprobados.

## Caso aprobado: parpadeo v2

### Entradas y salida

| Rol | Archivo | Tamaño | SHA-256 |
| --- | --- | --- | --- |
| Master canónico | `agent-master-v2.png` | 1086 × 1448 | `CCCC832B48455D19819DF41AFD9FEF611D117E035C98B7B9D388EBAD60D9581D` |
| Capa aprobada | `eyes-closed-v2.png` | 1086 × 1448 | `5CD02018534EB19A94680B88ACACA0C3AA6934AB426EE711B1379730BFA22A78` |

La capa final contiene 11.476 píxeles no transparentes: 5.986 opacos y
5.490 de transición. Su contenido alfa real ocupa `x=407..657` y
`y=265..342`; todo lo demás es transparente.

### Procedimiento exacto usado

1. Se fijó `agent-master-v2.png` como única referencia de identidad.
2. En coordenadas del master se extrajo este recorte de trabajo:

   ```text
   x = 390
   y = 235
   ancho = 320
   alto = 120
   rectángulo = (390, 235) → (710, 355)
   ```

3. La edición generativa recibió únicamente ese recorte, no el cuerpo completo.
   La instrucción normalizada para repetir el encargo es:

   > Cerrar naturalmente ambos ojos de esta misma mujer, como un parpadeo breve.
   > Mantener sin cambios identidad, cejas, nariz, piel, iluminación, encuadre,
   > resolución y posición. Editar sólo párpados y pestañas. No embellecer, no
   > cambiar expresión, no agregar maquillaje y no modificar el resto del rostro.

4. El resultado de la edición se normalizó nuevamente a `320 × 120`; nunca se
   aceptó un cambio de tamaño del recorte.
5. Del recorte editado se conservaron solamente dos regiones elípticas. Las
   coordenadas siguientes son relativas al recorte:

   | Zona | Centro | Radio X | Radio Y |
   | --- | --- | ---: | ---: |
   | Ojo izquierdo en imagen | `(70, 76)` | 54 | 32 |
   | Ojo derecho en imagen | `(211, 63)` | 57 | 34 |

6. La máscara permanece completamente opaca hasta el 72 % del radio elíptico y
   se desvanece progresivamente entre el 72 % y el 100 %. Fuera de las elipses,
   el alfa es cero. El feather evita un borde visible sin extender la edición a
   mejillas, cabello o ropa.
7. El parche se colocó otra vez en `(390, 235)` sobre un canvas transparente de
   `1086 × 1448` y se exportó como `eyes-closed-v2.png`.
8. No se creó una capa nueva para ojos abiertos. El estado abierto es siempre el
   master original. Durante el parpadeo se muestra la capa cerrada 115 ms y luego
   se oculta para volver a revelar el master.

## Controles de calidad obligatorios

Una capa facial no se marca como aprobada hasta pasar todos estos controles:

1. **Identidad:** alternar base/variante y comprobar que sólo cambia la zona
   solicitada.
2. **Canvas:** master y capa deben medir exactamente `1086 × 1448`.
3. **Origen:** probar primero `x=0`, `y=0`, `scale=1`, `rotation=0`.
4. **Alfa:** fuera de la máscara aprobada todos los píxeles deben ser
   transparentes.
5. **Opacidad:** inspeccionar la capa al 0 %, 50 % y 100 % para detectar dobles
   bordes o saltos.
6. **Grilla:** activar la grilla de desarrollo de 50 px, con líneas mayores cada
   100 px y etiquetas cada 200 px. Con la grilla activa se congela el movimiento
   idle para poder comparar coordenadas reales.
7. **Vista fija:** mantener la variante visible, no depender únicamente de un
   parpadeo rápido.
8. **Movimiento real:** probar el parpadeo a 115 ms.
9. **Resoluciones:** revisar 1920×1080, 1600×900, 1366×768 y 2560×1440.
10. **Código:** ejecutar `npm run check` antes de cerrar la iteración.

El panel `DEV · SCENE` implementa la grilla, controles de opacidad separados
para ojos y boca, vistas fijas de cada estado, el parpadeo real, la secuencia de
habla y la previsualización de cada expresión.

## Integración actual en la aplicación

Rutas activas:

```text
public/assets/airport/character/agent-master-v2.png
public/assets/airport/character/eyes-closed-v2.png
public/assets/airport/character/mouth-mid-v2.png
public/assets/airport/character/mouth-open-v2.png
public/assets/airport/character/expression-smile-v2.png
public/assets/airport/character/expression-serious-v2.png
public/assets/airport/character/expression-confused-v2.png
public/assets/airport/character/expression-surprised-v2.png
```

Configuración aprobada en
`src/scene/character/airportAgent.config.ts`:

```ts
eyesTransform: {
  open: { x: 0, y: 0, scale: 1, rotation: 0 },
  closed: { x: 0, y: 0, scale: 1, rotation: 0 },
},
overlayCalibration: {
  eyes: true,
  mouth: true,
},
```

El manifiesto activo se encuentra en
`src/scene/airport/assetManifest.ts`. El comportamiento del parpadeo, la boca,
las expresiones y la grilla está en `src/scene/character/CharacterRig.ts`.

## Método para la boca y futuras variantes

La boca sigue el mismo proceso, de una variante por vez. Se aprobó una mejora
adicional: el estado cerrado no necesita overlay; es el propio master. Así, una
secuencia de habla alterna `master → mid → open → mid → master` y nunca cubre el
rostro con una segunda imagen cuando la boca está cerrada.

### Caso aprobado: habla v2

Entradas y salidas:

| Rol | Archivo | Tamaño | SHA-256 |
| --- | --- | --- | --- |
| Estado cerrado | `agent-master-v2.png` | 1086 × 1448 | `CCCC832B48455D19819DF41AFD9FEF611D117E035C98B7B9D388EBAD60D9581D` |
| Apertura intermedia | `mouth-mid-v2.png` | 1086 × 1448 | `5F76119C8AAFC2769E7FE671278D3259482C9D78D7AF2BE3DAD6847C9B261470` |
| Apertura mayor | `mouth-open-v2.png` | 1086 × 1448 | `141F2255B69F10134B3D26E3230DA03DCA5C083ECF1332123651558F42027C2B` |

Procedimiento registrado:

1. Del master se extrajo el recorte `x=420`, `y=330`, `ancho=280`,
   `alto=180`.
2. Cada variante se generó por separado desde ese mismo recorte. `mid` recibió
   una apertura suave tipo “eh”; `open`, una apertura conversacional moderada
   tipo “ah”. En ambos casos se bloquearon identidad, nariz, mejillas, mentón,
   piel, luz, escala y encuadre.
3. Cada resultado generativo se recortó al aspecto original y se normalizó otra
   vez a `280 × 180` antes de crear la capa.
4. Ambas máscaras tienen centro relativo `(137, 88)`, equivalente a centro
   absoluto `(557, 418)`:

   | Variante | Radio X | Radio Y | Núcleo opaco |
   | --- | ---: | ---: | ---: |
   | `mid` | 92 | 50 | 72 % |
   | `open` | 94 | 55 | 72 % |

5. El feather usa una interpolación smoothstep reproducible. Para el radio
   elíptico normalizado `r`, con núcleo `c=0,72`:

   ```text
   alfa = 1                                         si r <= c
   t = (r - c) / (1 - c)                            si c < r < 1
   alfa = 1 - (t² × (3 - 2t))                       si c < r < 1
   alfa = 0                                         si r >= 1
   ```

6. Los parches se reintegraron en `(420, 330)` sobre canvas transparente de
   `1086 × 1448`.
7. `mouth-mid-v2.png` ocupa realmente `x=466..648`, `y=369..467`; contiene
   14.241 píxeles no transparentes, 7.641 opacos y 6.600 de feather.
8. `mouth-open-v2.png` ocupa realmente `x=464..650`, `y=364..472`; contiene
   16.023 píxeles no transparentes, 8.591 opacos y 7.432 de feather.
9. Ambas capas se registran en la aplicación con `x=0`, `y=0`, `scale=1` y
   `rotation=0`. Los assets heredados de boca no participan del movimiento.

Prompts normalizados conservados para repetición:

```text
MID: cambiar únicamente los labios a una posición natural de habla intermedia,
como una “eh” suave; labios apenas separados, pocos dientes superiores e
interior natural. Preservar exactamente el resto del recorte.

OPEN: cambiar únicamente los labios a una apertura conversacional moderada,
como una “ah” tranquila; dientes, lengua e interior anatómicamente coherentes,
sin exagerar la mandíbula. Preservar exactamente el resto del recorte.
```

### Regla para futuras bocas

1. Partir siempre de `agent-master-v2.png`.
2. Extraer un recorte ajustado alrededor de la boca con margen suficiente para
   el feather.
3. Generar cada visema directamente desde el master, nunca desde otro visema.
4. Rechazar cualquier resultado que cambie nariz, mentón, piel, cabeza, ropa o
   luz.
5. Aislar la boca con una máscara pequeña y suavizada.
6. Reintegrarla en un canvas transparente de `1086 × 1448` en su coordenada de
   origen.
7. Validarla fija, a distintas opacidades y en alternancia con el master.
8. Mantener cada resultado versionado y registrar su hash.

## Caso aprobado: expresiones localizadas v2

Las expresiones ya no son imágenes alternativas de cuerpo completo. El master
queda visible y cada expresión agrega únicamente las regiones faciales que
cambian. El modo del rig es `localized-overlay`.

### Recorte y normalización

Todas parten directamente del master con este recorte:

```text
x = 360
y = 150
ancho = 380
alto = 360
rectángulo = (360, 150) → (740, 510)
```

Cada resultado generativo se recortó al aspecto del original y se normalizó de
nuevo a `380 × 360`. Luego se aplicó el mismo smoothstep documentado para las
bocas y se reintegró en `(360, 150)` sobre canvas transparente de
`1086 × 1448`.

### Máscaras

Las coordenadas siguientes son relativas al recorte facial. Todas usan núcleo
opaco de 72 % y feather smoothstep hasta 100 % del radio:

| Expresión | Región | Centro | Radio X | Radio Y |
| --- | --- | --- | ---: | ---: |
| Smile | Boca | `(190, 260)` | 115 | 58 |
| Serious | Boca | `(190, 260)` | 115 | 58 |
| Confused | Cejas | `(190, 100)` | 160 | 62 |
| Confused | Boca | `(190, 260)` | 115 | 60 |
| Surprised | Ojo/ceja izquierda en imagen | `(105, 125)` | 90 | 100 |
| Surprised | Ojo/ceja derecha en imagen | `(265, 105)` | 90 | 100 |
| Surprised | Boca | `(190, 260)` | 108 | 72 |

La expresión seria modifica sólo la boca porque el cambio de sonrisa a reposo
ya comunica atención sin alterar la mirada. La sorpresa es la única variante
que necesita párpados además de cejas y boca.

### Archivos aprobados

| Archivo | SHA-256 | Límites alfa | Píxeles no transparentes |
| --- | --- | --- | ---: |
| `expression-smile-v2.png` | `020F6B390A0873DDEC1316A943F7567EBA9C2B9FE8F1E21F9B6EA5DE3FC84E73` | `x=436..664`, `y=353..467` | 20.659 |
| `expression-serious-v2.png` | `7576A079BE2588734A58CEB2730B64199E308C81A22025550FEEA17064CFABCD` | `x=436..664`, `y=353..467` | 20.659 |
| `expression-confused-v2.png` | `51B61476B8DAE853B46FE83376B054CF3F29747ED02CABF431F3318F3DC597C9` | `x=392..708`, `y=189..469` | 52.078 |
| `expression-surprised-v2.png` | `ACFE4F004E429DCC74F90CD92EB6E7A7F4DB0B59300558A5FD9AA7F1EDBEFDBE` | `x=376..714`, `y=156..481` | 77.687 |

Todos se renderizan en `x=0`, `y=0`, `scale=1`, `rotation=0`. El estado
`neutral` no tiene archivo v2: es el master.

### Intenciones normalizadas

```text
SMILE: sonrisa profesional algo más cálida, con una cantidad contenida de
dientes superiores; modificar sólo labios e interior de boca.

SERIOUS: expresión atenta y profesional, no enojada; quitar la sonrisa y dejar
la boca cerrada en reposo.

CONFUSED: duda amable y moderada; una ceja algo más alta que la otra y boca
cerrada ligeramente asimétrica, sin gesto cómico.

SURPRISED: sorpresa leve y segura; cejas moderadamente elevadas, ojos apenas más
abiertos y una pequeña boca “oh”, sin miedo ni exageración.
```

## Registro de iteraciones

| ID | Estado | Resultado | Decisión |
| --- | --- | --- | --- |
| EYES-LEGACY | Rechazado | Ojos de otra cara recortados y movidos manualmente | No usar ni recalibrar |
| EYES-FULL-EDIT | Rechazado | Regeneración de cuerpo completo con deriva visual | No usar; editar sólo recortes locales |
| EYES-001 | Aprobado | `eyes-closed-v2.png`, misma identidad y origen exacto | Método base para próximas capas |
| MOUTH-001 | Aprobado | `mouth-mid-v2.png`, apertura “eh” localizada | Activar como visema intermedio |
| MOUTH-002 | Aprobado | `mouth-open-v2.png`, apertura “ah” localizada | Activar como visema abierto |
| EXP-SMILE-001 | Aprobado | `expression-smile-v2.png` | Overlay sólo de boca |
| EXP-SERIOUS-001 | Aprobado | `expression-serious-v2.png` | Overlay sólo de boca |
| EXP-CONFUSED-001 | Aprobado | `expression-confused-v2.png` | Overlays de cejas y boca |
| EXP-SURPRISED-001 | Aprobado | `expression-surprised-v2.png` | Overlays de ojos/cejas y boca |

## Plantilla para registrar cada nuevo asset

Copiar y completar este bloque dentro del registro técnico:

```text
ID:
Fecha:
Estado: pendiente / rechazado / aprobado
Master de entrada:
SHA-256 del master:
Rectángulo de recorte: x, y, ancho, alto
Instrucción de edición:
Tamaño normalizado del recorte:
Forma y coordenadas de máscara:
Feather:
Posición en canvas final:
Nombre versionado de salida:
SHA-256 de salida:
Transform en la aplicación: x, y, scale, rotation
Pruebas visuales realizadas:
Pruebas automáticas realizadas:
Motivo de aprobación o rechazo:
```

## Política de conservación y limpieza

- Todo asset nuevo usa un nombre versionado (`-v2`, `-v3`, etc.).
- No se sobrescribe silenciosamente un asset previamente revisado.
- Un resultado rechazado no se conecta al manifiesto activo.
- Los assets heredados se eliminan sólo después de que el reemplazo esté
  aprobado y se haya verificado que ninguna ruta o prueba los utiliza.
- Las imágenes temporales del generador no son fuente de verdad. La fuente de
  verdad es el master, la capa versionada aprobada y este registro.

## Extensibilidad para futuros movimientos faciales

El rig queda abierto a nuevas capas sin reemplazar el master ni recalibrar lo ya
aprobado. Cada familia de movimiento debe mantenerse como un canal independiente:

- **ojos:** parpadeo, mirada izquierda/derecha y futuras aperturas parciales;
- **boca:** visemas actuales `closed`, `mid`, `open` y futuros visemas para
  vocales o fonemas concretos;
- **expresión:** cejas, párpados y boca localizados por estado emocional;
- **cabeza:** inclinación o desplazamiento aplicados al contenedor del rig, no
  horneados dentro de los PNG;
- **cuerpo:** respiración, balanceo y gestos de manos separados del rostro.

Para agregar una capa facial se repite este contrato:

1. partir siempre de `agent-master-v2.png` o de su sucesor aprobado;
2. generar sólo el recorte mínimo que cambia;
3. reintegrarlo en canvas completo de `1086 × 1448`;
4. mantener `x=0`, `y=0`, `scale=1`, `rotation=0`;
5. agregar una clave versionada al manifiesto y un estado tipado al rig;
6. definir el orden de composición con parpadeo y habla;
7. registrar prompt, máscara, hash y prueba visual en este documento.

La prioridad visual actual es `master → expresión → ojos → boca`. Esto permite
que una expresión siga parpadeando y hablando. Si más adelante una emoción
necesita un visema propio, se agregará como combinación explícita; no se moverán
capas a ojo ni se modificará el master para resolverla.
