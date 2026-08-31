# Método reproducible de assets faciales

Documento vivo de producción para PORTUWANA. Registra el método aprobado para
derivar parpadeos, bocas y otras variaciones faciales sin cambiar la identidad,
el encuadre ni la iluminación del personaje.

**Estado actual:** método de ojos validado. Bocas todavía no aprobadas.

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

El panel `DEV · SCENE` implementa la grilla, el control de opacidad, la vista
abierta, la vista cerrada fija y el parpadeo real.

## Integración actual en la aplicación

Rutas activas:

```text
public/assets/airport/character/agent-master-v2.png
public/assets/airport/character/eyes-closed-v2.png
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
  mouth: false,
},
```

El manifiesto activo se encuentra en
`src/scene/airport/assetManifest.ts`. El comportamiento del parpadeo y la grilla
está en `src/scene/character/CharacterRig.ts`.

## Método para la boca y futuras variantes

La boca seguirá el mismo proceso, de una variante por vez:

1. Partir siempre de `agent-master-v2.png`.
2. Extraer un recorte ajustado alrededor de la boca con margen suficiente para
   el feather.
3. Generar primero sólo una boca intermedia conversacional.
4. Rechazar cualquier resultado que cambie nariz, mentón, piel, cabeza, ropa o
   luz.
5. Aislar la boca con una máscara pequeña y suavizada.
6. Reintegrarla en un canvas transparente de `1086 × 1448` en su coordenada de
   origen.
7. Validarla fija, a distintas opacidades y en alternancia con el master.
8. Sólo después de aprobar la boca intermedia, crear boca cerrada y abierta.
9. Mantener `overlayCalibration.mouth = false` hasta que el conjunto completo
   esté aprobado.

Los valores exactos de recorte y máscara se añadirán a este documento al crear
cada variante. No deben estimarse por adelantado.

## Registro de iteraciones

| ID | Estado | Resultado | Decisión |
| --- | --- | --- | --- |
| EYES-LEGACY | Rechazado | Ojos de otra cara recortados y movidos manualmente | No usar ni recalibrar |
| EYES-FULL-EDIT | Rechazado | Regeneración de cuerpo completo con deriva visual | No usar; editar sólo recortes locales |
| EYES-001 | Aprobado | `eyes-closed-v2.png`, misma identidad y origen exacto | Método base para próximas capas |
| MOUTH-001 | Pendiente | Primera prueba: boca intermedia | Documentar recorte, máscara, hash y validación |

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
