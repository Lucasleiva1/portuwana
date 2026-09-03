# Contrato visual del aeropuerto

## Ubicación

Todos los gráficos de la primera escena viven bajo:

```text
public/assets/airport/
```

No se usan base64, capturas completas de interfaz ni rutas externas. Vite copia
el contenido de `public` sin transformar los nombres, por lo que reemplazar un
asset no requiere cambiar código.

## Masters de primera validación

### Fondo

```text
public/assets/airport/background.webp
```

- Formato WebP.
- Relación aproximada 16:9.
- Resolución recomendada: 2560×1440 o superior.
- Ilustración semi-realista cálida de un aeropuerto brasileño contemporáneo.
- Sin personaje principal, botones, paneles ni textos propios de PORTUWANA.
- Debe reservar profundidad y espacio para el personaje en el centro/derecha.

El motor aplica `cover` y recorte centrado; nunca deforma la imagen.

### Personaje master

```text
public/assets/airport/character/agent-master-v2.png
```

- PNG con transparencia real.
- Funcionaria de aeropuerto, plano de torso o cintura.
- Misma dirección artística e iluminación que el fondo.
- Resolución suficiente para 1080p y 1440p.
- Sin fondo, UI ni texto incrustado.

## Rig facial aprobado (v2)

La prueba de parpadeo usa un único master canónico y una capa mínima derivada
de ese mismo rostro:

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

Ambos archivos tienen un canvas de `1086×1448`. La capa cerrada conserva ese
canvas y está registrada en `x=0`, `y=0`, `scale=1`, `rotation=0`. Su alfa está
limitado a dos zonas elípticas con borde suavizado; el resto es transparente.
El estado abierto es el propio master, no una segunda capa. El ciclo real
muestra `eyes-closed-v2.png` durante 115 ms y vuelve al master.

El estado neutral y el cuerpo también son siempre el master. Las expresiones v2
son overlays faciales localizados; no sustituyen la imagen completa. Por eso se
registran en modo `localized-overlay` y conservan origen, escala y canvas.

El panel `DEV · SCENE` incluye una grilla de 50 px, líneas mayores cada 100 px,
coordenadas del lienzo, control de opacidad y vista cerrada fija. La grilla sólo
existe en desarrollo.

El procedimiento de producción completo, las coordenadas del recorte, la
máscara, los hashes y el registro para continuar con la boca están documentados
en [CHARACTER_ASSET_METHOD.md](CHARACTER_ASSET_METHOD.md).

## Ambientación combinada del fondo

```text
public/assets/airport/ambient/background-state-b-v1.png
public/assets/airport/ambient/background-state-c-v1.png
public/assets/airport/ambient/background-state-d-v1.png
public/assets/airport/ambient/background-state-e-v1.png
public/assets/airport/ambient/background-state-f-v1.png
public/assets/airport/ambient/ambient-traveler-man-v2.png
public/assets/airport/ambient/ambient-traveler-woman-v2.png
```

El fondo original es el estado A inmutable. B a F cambian únicamente el avance y
la distribución de pasajeros, y se conectan mediante una disolución lenta. D
continúa el avance, E reduce la ocupación y F incorpora un grupo diferente. Las
dos figuras v2 forman una segunda capa situada entre el fondo y el personaje.
No caminan todavía: aparecen, permanecen quietas, desaparecen y cambian de zona
sólo mientras su alfa es cero. Sus PNG tienen alfa real; las v1 con cuadrícula
horneada fueron rechazadas y no deben volver a conectarse.

El método, las posiciones, los tiempos, los hashes, los prompts y el camino para
incorporar futuros pasajeros en movimiento están registrados en
[AMBIENT_SCENE_METHOD.md](AMBIENT_SCENE_METHOD.md).

## Rig opcional por capas (legado pendiente de reemplazo)

```text
public/assets/airport/character/
  body.png
  eyes-open.png
  eyes-closed.png
  mouth-closed.png
  mouth-mid.png
  mouth-open.png
  expression-neutral.png
  expression-smile.png
  expression-confused.png
  expression-surprised.png
  expression-serious.png
```

Los archivos anteriores se conservan temporalmente para comparación, pero las
bocas sin sufijo `-v2` están deshabilitadas. El habla usa el master como estado
cerrado y únicamente las capas `mouth-mid-v2.png` y `mouth-open-v2.png`. Las
nuevas capas aprobadas deben compartir exactamente:

- tamaño de canvas;
- origen y transparencia;
- pose base y escala;
- ubicación del rostro, ojos y boca;
- espacio transparente alrededor del cuerpo.

No recortar cada capa a su contenido. No mover ojos o boca para “acomodar” una
exportación: corregir el archivo fuente. Los únicos offsets admitidos están
declarados explícitamente en
`src/scene/character/airportAgent.config.ts`.

## Prioridad de carga

1. Si existe `body.png`, se construye el rig por capas y se agregan las capas
   opcionales disponibles.
2. Sin `body.png`, se usa `agent-master.png`.
3. Sin ambos, PixiJS muestra una silueta técnica abstracta marcada
   `AGENT ASSET MISSING`.

El parpadeo se habilita únicamente si carga `eyes-closed-v2.png`. La demostración
de speaking exige que carguen las dos bocas v2 y estén marcadas como calibradas;
tener los archivos antiguos en disco no las habilita. Los estados abiertos de
ojos y cerrado de boca son siempre el propio master. El master conserva la
respiración sutil.

## Sustitución del master por rig completo

1. Mantener temporalmente los assets anteriores como respaldo.
2. Exportar `body.png` con el mismo encuadre lógico del master.
3. Exportar las capas opcionales sin alterar canvas u origen.
4. Abrir PORTUWANA en desarrollo: el panel `DEV · SCENE` indicará las capas
   detectadas y habilitará los previews compatibles.
5. Validar 1920×1080, 1600×900, 1366×768 y 2560×1440.
6. Cuando el rig esté aprobado, el master puede conservarse como fallback.

## Checklist gráfico

- [ ] Fondo sin personaje ni UI incrustada.
- [ ] Fondo mínimo 2560×1440 y 16:9 aproximado.
- [ ] Personaje con transparencia, sin halo opaco.
- [ ] Iluminación y temperatura coherentes con el aeropuerto.
- [ ] Rostro nítido en 1080p/1440p.
- [x] Prueba de ojos v2 con canvas y origen idénticos.
- [x] Estado abierto obtenido directamente del master, sin parche adicional.
- [x] Bocas mid/open v2 derivadas del master y registradas en origen exacto.
- [x] Expresiones v2 localizadas mantienen pose, cuerpo y proporciones.
- [x] Ciclo de fondo A/B/C/D/E/F separado del rig principal.
- [x] Pasajeros ambientales v2 con alfa real y zonas seguras verificadas.
- [ ] Ningún panel DOM tapa el rostro en las resoluciones objetivo.
- [x] Build y tests pasan con assets presentes y ausentes.
