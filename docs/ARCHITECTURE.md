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

## Capas

```text
src/
  app/                  Composición y estilos de la aplicación
  components/           Componentes React de interfaz técnica
  scene/                 Escena PixiJS, fondo, resolver de assets y CharacterRig
  lesson/                Schemas, contenido, ayuda, scoring y LessonEngine
  conversation/          Contrato de intents y provider local
  state/                 Máquina XState y contexto de conversación
  audio/                 Permisos, dispositivos, VAD, captura, WAV y sesión
  speech/
    providers/           Interfaces STT, TTS y pronunciación
    playback/            Resolución y reproducción de voz NPC
    voice/               Configuración de la voz de cada personaje
    whisper/             Provider, configuración y modelos de Whisper local
    azure/               Providers Azure controlados
  schemas/               Validación Zod de entradas futuras
  storage/               Inicialización SQLite
  logging/               Logger único y eventos técnicos
  mocks/                 STT y pronunciación controlados para desarrollo/tests

src-tauri/
  binaries/whisper/      Runtime whisper.cpp Windows x64 (ignorado por Git)
  resources/models/      Modelos multilingües base/small (ignorados por Git)
  src/whisper.rs         Servicio nativo tipado, timeout y cleanup
  migrations/            Migraciones SQLite versionadas
  capabilities/          Permisos mínimos Tauri

public/
  assets/airport/        Assets visuales futuros
  assets/audio/airport/  WAV locales futuros de la funcionaria
  vad/                   Modelo Silero, worklet y runtime WASM locales
```

## Arranque

1. React registra `app.start` y prepara infraestructura.
2. Tauri precarga `sqlite:portuwana.db` y aplica la migración 1.
3. `database.ts` abre la conexión, consulta `schema.version` y registra
   `database.ready`.
4. `AirportScene` inicializa PixiJS 8 de forma asíncrona, resuelve el contrato de
   assets y monta un mundo lógico 1600×900. El fondo usa cover/crop; el personaje
   elige rig por capas, master o placeholder técnico.
5. Cuando PixiJS y SQLite están listos, React envía `APP_READY`.
6. XState entra en `loadingLesson`; Zod valida `airport-arrival-01` y crea
   `LessonEngine`.
7. `AudioEngine` observa dispositivos sin pedir permiso todavía.
8. React consulta `whisper_status` sin descargar recursos y muestra su estado.
9. La escena registra `scene.ready`; cuando Tauri, PixiJS, audio y SQLite están
   listos, React registra `app.ready`.

## Conversación

`conversationMachine` controla carga, habla NPC, permiso, escucha, grabación,
procesamiento de audio, transcripción local, escritura, análisis de intención,
feedback, transición de nodo, pausa, finalización y error. `transcribing` ya
representa la frontera STT; `pronunciationAssessment` continúa reservado. La UI
no decide el siguiente nodo ni calcula puntos.

`LocalIntentProvider` recibe sólo los intents aceptados por el nodo actual. El
resultado entra a `LessonEngine`, que resuelve transición, fallback, ayuda y
recompensa. El detalle se documenta en `LESSON_ENGINE.md`.

## Providers

Las interfaces `STTProvider`, `TTSProvider` y `PronunciationProvider` reciben
tipos explícitos sin `any`. `WhisperProvider` está activo cuando el runtime y el
modelo elegido existen; `AzureTTSProvider` y `AzurePronunciationProvider`
continúan devolviendo `notConfigured` sin credenciales. No se leen variables de
entorno, no se guardan credenciales y no se descarga ningún modelo Whisper.

El paquete de Azure Speech queda instalado para la integración futura, sin
credenciales. `NpcSpeechService` prioriza asset local, luego un `TTSProvider`
configurado y finalmente texto. `LocalVoiceProvider` no se confunde con TTS.
Los detalles están en `AUDIO_ENGINE.md` y `NPC_VOICE.md`.

`@ricky0123/vad-web` ejecuta Silero VAD v5 completamente local con el modelo,
worklet y WASM incluidos en `public/vad`. El flujo de voz del usuario nunca
duplica `LessonEngine`: audio → Whisper → texto → intent → lección.

## Persistencia y seguridad

La única tabla de esta fase es `technical_status`, creada por una migración Rust.
El frontend recibe `sql:default`, suficiente para cargar y consultar la base; no
recibe permiso de escritura SQL. El plugin shell está registrado, pero ninguna
orden shell queda expuesta al frontend. Logging tiene únicamente `log:default`.

El PCM y el WAV del usuario viven en memoria hasta invocar Whisper. Rust escribe
el WAV en una carpeta temporal exclusiva y la elimina al terminar, cancelar o
fallar. No se envía audio a internet. Los logs registran metadatos técnicos, no
audio ni transcript. React no puede elegir ejecutables, modelos por ruta ni
argumentos libres; Rust resuelve un catálogo fijo. Ver `WHISPER_WINDOWS.md`.

## Decisiones visuales

La pantalla usa los tokens provisionales entregados para PORTUWANA: fondo
`#0D151B`, superficies `#142129`/`#1B2B34`, turquesa `#39B8B2` y acento claro
`#55CEC6`. El monograma, la escena y los iconos nativos son técnicos; no deben
considerarse arte final.
