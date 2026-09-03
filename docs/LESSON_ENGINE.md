# LessonEngine

## Responsabilidad

`LessonEngine` es el núcleo pedagógico independiente de React, PixiJS, Tauri y
los futuros proveedores de audio. Recibe contenido desconocido, lo valida con
Zod y conserva únicamente el estado de la lección actual: nodo, ayuda usada y
finalización.

```text
Lesson content validado
        ↓
LessonEngine
        ↓
conversationMachine (XState)
        ↓
React UI / PixiJS
```

React envía acciones del usuario. XState controla el flujo y solicita análisis
al `IntentProvider`. `LessonEngine` decide si el intent avanza, reintenta o usa
fallback, y calcula la recompensa mediante `scoring.ts`.

## Modelo de datos

Una lección contiene:

- identidad, título, locale, nivel y escena;
- `startNodeId`;
- logros y vocabulario;
- una lista de nodos de diálogo.

La lección contiene un registro único de líneas NPC. Cada línea relaciona ID,
texto, texto lento, traducción, assets opcionales, expresión, emoción y duración
opcional. Los nodos sólo referencian líneas compatibles y definen pista,
ejemplos, intents aceptados, transiciones, fallback, recompensa máxima, modo y
si son terminales. `lesson.schemas.ts` valida también todas esas referencias.

Una lección inválida provoca el estado XState `error`; la interfaz muestra un
mensaje controlado y permite reintentar. No se desmonta la escena ni se produce
un crash de React.

## Lección `airport-arrival-01`

| Turno | Nodo | Intent principal | Siguiente nodo |
| --- | --- | --- | --- |
| 1 | `welcome` | `need_help` | `baggage-status` |
| 2 | `baggage-status` | `baggage_not_collected` | `baggage-area` |
| 3 | `baggage-area` | `confirm_baggage_area` | `ask-location` |
| 4 | `ask-location` | `ask_location` | `direction` |
| 5 | `direction` | `understood` | `direction-confirmation` |
| 6 | `direction-confirmation` | `thanks` / `understood` | `closing` |
| 7 | `closing` | terminal | lección completada |

`repeat_request` y `slow_request` repiten la última línea sin cambiar el nodo.
Las respuestas parciales, ambiguas, fuera de tema, poco claras o silenciosas
usan líneas de recuperación alternadas y no suman poder. Las rutas alternativas
`no_help`, `baggage_problem`, `already_have_baggage`, `deny` y `know_location`
tienen transiciones explícitas y coherentes con la escena.

## IntentProvider local

`LocalIntentProvider` normaliza mayúsculas, acentos, puntuación y espacios.
Después evalúa aliases y expresiones regulares únicamente entre los intents
permitidos por el nodo actual. Esto permite reconocer frases equivalentes sin
exigir coincidencia textual y reduce falsos positivos entre turnos.

Su `confidence` es una señal heurística interna de 0 a 1. No se presenta al
usuario como precisión científica y no participa del scoring.

El contrato superior `ConversationProvider` deja preparada una implementación
externa o de IA futura. El provider interpreta; no genera transiciones. El
sistema local guiado sigue siendo el único activo y funciona offline.

## Ayuda progresiva

La ayuda se registra por turno:

1. repetir / texto más lento;
2. pista;
3. traducción;
4. ejemplo.

Al usar una opción se habilita el nivel siguiente. `LessonEngine` devuelve el
contenido correspondiente al nodo y conserva el nivel máximo usado. Al avanzar
de nodo, el contador se reinicia.

## Scoring

El cálculo vive exclusivamente en `src/lesson/scoring.ts`:

| Condición | Recompensa |
| --- | ---: |
| Entendido sin ayuda | +8 |
| Con repetir / texto lento | +7 |
| Con pista | +6 |
| Con traducción | +4 |
| Con ejemplo | +3 |
| Retry o intent desconocido | +0 |

Nunca se restan puntos y `Poder do Português` se limita a 0–100. Un nodo puede
reducir su recompensa máxima mediante `powerReward`.

## XState

La máquina contiene `booting`, `loadingLesson`, `npcSpeaking`,
`waitingForUser`, `writing`, `recordingMock`, `processingResponse`,
`analyzingIntent`, `showingFeedback`, `transitioningNode`, `lessonCompleted`,
`paused` y `error`. `transcribing` conecta Whisper y los eventos globales de
pronunciación solicitada, completada, no disponible o fallida actualizan el
feedback sin cambiar el estado conversacional activo.

El texto escrito y la transcripción mock entran por eventos distintos, pero
ambos convergen en `analyzingIntent`. Por eso un STT real podrá reemplazar el
mock sin modificar `LessonEngine`.

## Agregar una futura escena

1. Crear una carpeta bajo `src/lesson/lessons/<scene-id>/`.
2. Separar `dialogue.ts`, `vocabulary.ts` y `lesson.ts`.
3. Declarar todos los intents y destinos de cada nodo.
4. Registrar la lección en `src/lesson/lessons/index.ts`.
5. Agregar variantes lingüísticas al provider local o a otro
   `IntentProvider` inyectable.
6. Cubrir schema, camino principal, errores, ayuda y finalización con tests.

No se debe importar React ni PixiJS desde `src/lesson`.

## Integración de audio

Las Partes 4–6 conectan captura de micrófono, VAD y `whisper.cpp` local. El
transcript se envía como texto a XState. `LocalIntentProvider` y `LessonEngine`
no conocen ni necesitan conocer el origen escrito o hablado del texto. La
evaluación de pronunciación se solicita en paralelo y un fallo nunca bloquea ni
resta progreso.
