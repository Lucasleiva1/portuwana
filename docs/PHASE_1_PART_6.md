# Fase 1 / Parte 6

## Resultado

La escena del aeropuerto continúa guiada por objetivos, pero ya no depende de
frases exactas. El provider local reconoce formulaciones equivalentes y devuelve
una interpretación estructurada: entendido, parcial, ambiguo, fuera de tema o
poco claro. `LessonEngine` sigue siendo la única capa que puede avanzar un nodo.

Las recuperaciones para ambigüedad, fuera de tema, respuesta parcial, falta de
comprensión y silencio pertenecen al contenido de la escena. Cada tipo tiene dos
líneas y rota de forma determinista para evitar una repetición mecánica.

## Líneas y variantes

`airport-arrival/lines.ts` es el registro único de las líneas NPC. Reúne:

- ID y texto;
- texto lento y traducción opcionales;
- asset normal y lento opcionales;
- expresión, emoción y duración opcional.

Los nodos sólo guardan IDs de líneas compatibles. Esto permite agregar o cambiar
audio sin duplicar rutas en React, XState o PixiJS.

## Proveedor conversacional futuro

`ConversationProvider` admite implementaciones `local-guided`, `external` o
`ai`. Sólo `local-guided` está activo. Una implementación futura podrá mejorar
la interpretación, pero deberá devolver el contrato tipado y dejar las
transiciones al `LessonEngine`. Parte 6 no incluye IA generativa, RAG ni APIs.

## Voz actual

`NpcSpeechService` usa este orden:

1. audio local preparado;
2. `TTSProvider` configurado;
3. texto visible sin bloquear la lección.

El modo lento prioriza asset lento, luego TTS lento y finalmente 0.82× sobre el
asset normal. Los resultados TTS se cachean para replay. Toda fuente llega al
mismo `SpeechPlaybackEngine`, que sigue enviando amplitud al `CharacterRig`.

Actualmente el repositorio no contiene WAV de la funcionaria y Azure TTS no
tiene credenciales. Por eso la aplicación usa el fallback de texto. Los tests
cubren assets locales, fallback, replay con caché y modo lento.

## Pronunciación

`PronunciationProvider` recibe audio, transcript, locale, modo y frase objetivo
opcional. Conversación guiada y práctica guiada usan el mismo contrato, pero la
frase objetivo sólo es obligatoria en práctica.

Whisper termina primero y la conversación avanza inmediatamente. La evaluación
se ejecuta aparte y responde mediante eventos no bloqueantes. Un resultado real
produce una frase breve y, como máximo, una recomendación. Una puntuación baja
nunca resta progreso y un error no modifica `Poder do Português`.

El adapter Azure continúa `notConfigured`; no se muestra feedback inventado en
runtime. El mock tipado se usa únicamente en tests.

## Poder do Português

Se conservan por separado comunicación, comprensión, pronunciación y autonomía.
La cifra visible sigue siendo el acumulado general. La ayuda reduce solamente la
contribución de autonomía; la pronunciación aporta de cero a tres puntos y jamás
resta.

## Límite de Parte 7

Parte 7 queda documentada, no implementada. Incorporará persistencia de progreso
y sesiones, configuración y diagnóstico locales, importadores de diccionarios,
Wiktionary portugués y español estructurado, Apertium, FreeDict, índices offline
portugués ↔ español y búsqueda local integrada a la conversación. Parte 6 no
procesa ninguna fuente de diccionario ni agrega un backend cloud.
