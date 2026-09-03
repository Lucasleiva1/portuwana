# Arquitectura técnica

## Alcance

La Fase 1 / Parte 1 establece una aplicación Tauri 2 para Windows con React,
Vite y TypeScript estricto.

La Parte 2 añade la composición visual real del aeropuerto: viewport lógico
1600×900, fondo con cover/crop, personaje independiente, rig opcional por capas
y UI conversacional React superpuesta. Los assets finales siguen siendo externos
al código y se documentan en `ASSETS_AIRPORT.md`.

La Parte 3 convierte esa escena en una lección conversacional completa basada
en contenido estructurado. Zod valida la lección, `LessonEngine` toma las
decisiones pedagógicas, un `IntentProvider` local interpreta equivalencias y
XState gobierna el flujo.

La Parte 4 incorpora captura real de micrófono y VAD local. `AudioEngine`
centraliza el contexto de audio, permisos, dispositivos, nivel, timeouts,
captura y cleanup. El audio se normaliza a WAV PCM mono de 16 bits y 16 kHz en
memoria.

La Parte 5 reemplaza el STT simulado por `whisper.cpp` 1.9.3 local. Un servicio
Rust ejecuta el CLI desde una ruta fija con modelo multilingüe `base` o `small`,
idioma `pt` y traducción desactivada. La interfaz conserva `Escrever` como vía
equivalente y recuperación segura.

La Parte 6 amplía la conversación sin convertirla en chat libre generativo.
`ConversationProvider` interpreta el turno y `LessonEngine` conserva el control
de objetivos y transiciones. El contenido registra variantes y recuperaciones
por línea. Voz y pronunciación permanecen como providers intercambiables; la
evaluación de pronunciación se ejecuta en paralelo y nunca bloquea el diálogo.

La Parte 7 agrega persistencia local de progreso, sesiones y preferencias. Un
servicio de diccionario aislado importa fuentes léxicas comprimidas, construye
un índice SQLite bidireccional y permite consultas contextuales sin enviar
eventos a `LessonEngine`. El asistente reutiliza el audio y Whisper locales para
dictado ES/PT.

La Parte 8 convierte Faster-Whisper 1.2.1 + CTranslate2 4.7.2 en STT principal.
Un worker Python empaquetado se mantiene caliente, prefiere CUDA y cae a CPU;
whisper.cpp queda como fallback técnico secuencial y no se carga en paralelo.

## Capas

```text
src/
  app/                  Composición y estilos de la aplicación
  components/           Componentes React de interfaz técnica
  scene/                 Escena PixiJS, fondo, resolver de assets y CharacterRig
  lesson/                Schemas, contenido, ayuda, scoring y LessonEngine
  conversation/          Provider conversacional, intents y análisis local
  state/                 Máquina XState y contexto de conversación
  audio/                 Permisos, dispositivos, VAD, captura, WAV y sesión
  speech/
    providers/           Interfaces STT, TTS y pronunciación
    playback/            Resolución, caché y reproducción de voz NPC
    pronunciation/       Feedback pedagógico y contribución no negativa
    voice/               Configuración de la voz de cada personaje
    faster-whisper/      Provider principal y estado del worker persistente
    whisper/             Fallback temporal whisper.cpp
    azure/               Providers Azure controlados
  schemas/               Validación Zod de entradas futuras
  storage/               Inicialización SQLite
  dictionary/            Servicio, normalización, léxico esencial e importador DEV
  logging/               Logger único y eventos técnicos
  mocks/                 STT y pronunciación controlados para desarrollo/tests

src-tauri/
  binaries/faster-whisper/ Worker empaquetado con CUDA/CPU (ignorado por Git)
  binaries/whisper/      Runtime whisper.cpp Windows x64 (ignorado por Git)
  resources/models/      Modelos multilingües base/small (ignorados por Git)
  src/faster_whisper.rs  Worker persistente, fallback CUDA/CPU y cleanup
  src/whisper.rs         Fallback temporal tipado
  migrations/            Migraciones SQLite versionadas
  capabilities/          Permisos mínimos Tauri

public/
  assets/airport/        Assets visuales futuros
  assets/audio/airport/  WAV locales futuros de la funcionaria
  vad/                   Modelo Silero, worklet y runtime WASM locales
```

## Arranque

1. React registra `app.start` y prepara infraestructura.
2. Tauri precarga `sqlite:portuwana.db` y aplica las migraciones 1 y 2.
3. `database.ts` abre la conexión, consulta `schema.version` y registra
   `database.ready`.
4. `AirportScene` inicializa PixiJS 8 de forma asíncrona, resuelve el contrato de
   assets y monta un mundo lógico 1600×900. El fondo usa cover/crop; el personaje
   elige rig por capas, master o placeholder técnico.
5. Cuando PixiJS y SQLite están listos, React envía `APP_READY`.
6. XState entra en `loadingLesson`; Zod valida `airport-arrival-01` y crea
   `LessonEngine`.
7. `AudioEngine` observa dispositivos sin pedir permiso todavía.
8. React consulta `faster_whisper_status`; Tauri inicia una vez el worker y
   muestra backend, modelo, GPU y estado sin descargar recursos.
9. La escena registra `scene.ready`; cuando Tauri, PixiJS, audio y SQLite están
   listos, React registra `app.ready`.

## Conversación

`conversationMachine` controla carga, habla NPC, permiso, escucha, grabación,
procesamiento de audio, transcripción local, escritura, análisis de intención,
feedback, transición de nodo, pausa, finalización y error. `transcribing`
representa la frontera STT y los eventos de pronunciación son asíncronos. La UI
no decide el siguiente nodo ni calcula puntos.

`LocalGuidedConversationProvider` añade controles globales de repetición y modo
lento y delega el análisis lingüístico a `LocalIntentProvider`. El resultado
distingue entendido, coincidencia parcial, ambiguo, fuera de tema y poco claro.
Sólo `LessonEngine` resuelve transición, fallback, ayuda y recompensa. Un
provider externo o de IA futuro deberá respetar el mismo resultado estructurado.

## Providers

Las interfaces `STTProvider`, `TTSProvider` y `PronunciationProvider` reciben
tipos explícitos sin `any`. `PortuwanaSTTProvider` usa Faster-Whisper y sólo
invoca `WhisperProvider` si el principal no está disponible;
`AzureTTSProvider` y `AzurePronunciationProvider`
continúan devolviendo `notConfigured` sin credenciales. No se leen variables de
entorno, no se guardan credenciales y no se descarga ningún modelo Whisper.

El paquete de Azure Speech queda instalado para la integración futura, sin
credenciales. `NpcSpeechService` prioriza asset local, luego un `TTSProvider`
configurado y finalmente texto. `LocalVoiceProvider` no se confunde con TTS.
`NpcSpeechService` cachea audio TTS por línea y velocidad para que la repetición
no vuelva a sintetizar.
Los detalles están en `AUDIO_ENGINE.md` y `NPC_VOICE.md`.

`@ricky0123/vad-web` ejecuta Silero VAD v5 completamente local con el modelo,
worklet y WASM incluidos en `public/vad`. El flujo de voz del usuario nunca
duplica `LessonEngine`: audio → Whisper → texto → intent → lección.

## Persistencia y seguridad

La migración 1 conserva `technical_status`; la migración 2 agrega perfil,
progreso, sesiones, settings, historial, favoritos y el modelo léxico con
trazabilidad. El frontend recibe `sql:default` y `sql:allow-execute` para esos
servicios locales tipados. El constructor pesado y el acceso a fuentes externas
permanecen en comandos Rust acotados: React no puede ejecutar SQL arbitrario
fuera de la base precargada ni elegir ejecutables. El plugin shell está
registrado, pero ninguna orden shell queda expuesta al frontend.

El PCM y el WAV del usuario viven en memoria hasta invocar Faster-Whisper. Rust escribe
el WAV en una carpeta temporal exclusiva y la elimina al terminar, cancelar o
fallar. No se envía audio a internet. Los logs registran metadatos técnicos, no
audio ni transcript. React no puede elegir ejecutables, modelos por ruta ni
argumentos libres; Rust resuelve un catálogo fijo. Ver `WHISPER_WINDOWS.md`.

## Decisiones visuales

La pantalla usa los tokens provisionales entregados para PORTUWANA: fondo
`#0D151B`, superficies `#142129`/`#1B2B34`, turquesa `#39B8B2` y acento claro
`#55CEC6`. El monograma, la escena y los iconos nativos son técnicos; no deben
considerarse arte final.
