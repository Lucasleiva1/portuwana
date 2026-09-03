# AudioEngine

## Alcance

La Parte 4 activa micrófono y VAD reales en Windows; la Parte 8 conecta su salida
a Faster-Whisper persistente. No evalúa pronunciación y no transmite ni conserva audio.
`Escrever` continúa pasando directamente al mismo `IntentProvider` y
`LessonEngine`.

```text
Falar → micrófono → Silero VAD → PCM → WAV 16 kHz → Faster-Whisper → texto
Escrever ────────────────────────────────────────────────→ texto
texto → IntentProvider → LessonEngine
```

## Componentes

- `AudioEngine`: fachada y ciclo de vida único.
- `MicrophoneService`: `getUserMedia`, constraints y clasificación de permisos.
- `AudioDeviceService`: enumeración, selección, `devicechange` y preferencia local.
- `VadService`: adaptador de `@ricky0123/vad-web` con Silero v5 local.
- `LevelMeter`: RMS suavizado y limitado a 15 actualizaciones por segundo.
- `Recorder`: normalización mono y resampling.
- `WavEncoder`: RIFF/WAVE PCM de 16 bits.
- `AudioSessionCoordinator`: exclusión mutua entre reproducción y micrófono.

Ningún componente React crea un `AudioContext`. `AudioEngine` lo crea de forma
diferida tras una interacción y lo comparte con VAD y reproducción.

## Permisos y dispositivos

Al pulsar `Falar`, el servicio solicita:

```ts
{
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
}
```

Los navegadores pueden ignorar constraints no soportados. Los estados son
`unknown`, `requesting`, `granted`, `denied`, `unavailable` y `error`. Una
denegación vuelve a `waitingForUser`, muestra un aviso y conserva `Escrever`.
El permiso sólo se vuelve a solicitar mediante una acción explícita.

Después del permiso, las etiquetas de `audioinput` quedan disponibles. Si hay
más de una entrada aparece un selector compacto. La elección se guarda en
`localStorage` bajo `portuwana.audio.inputDeviceId`. Un `devicechange` vuelve a
enumerar y elige `default` si la preferencia desapareció.

## VAD y timeouts

`VadService` carga exclusivamente assets locales desde `/vad/`:

- `silero_vad_v5.onnx`;
- `vad.worklet.bundle.min.js`;
- `ort-wasm-simd-threaded.mjs`;
- `ort-wasm-simd-threaded.wasm`.

Los eventos son inicio, fin, misfire y frame procesado. Parte 8 configura 600 ms
de silencio final, 250 ms de pre-roll y 180 ms mínimos de voz. Los timeouts
centralizados son 8 segundos para esperar voz y 20 segundos como duración
máxima. Un misfire corto no cierra la escucha; un timeout sí cancela de forma
segura y no genera audio vacío. El VAD de Faster-Whisper está desactivado para
no encadenar dos detectores.

## Captura y WAV

Silero entrega el segmento detectado como `Float32Array` mono a 16 kHz. `Recorder`
también admite hardware a 44.1/48 kHz. Para reducción de frecuencia usa promedio
ponderado por solapamiento, que actúa como filtro de caja y evita elegir muestras
aisladas; para aumento usa interpolación lineal determinista.

La salida es:

```ts
{
  pcm: Float32Array; // mono
  sampleRate: 16000;
  durationMs: number;
  wavBlob: Blob;     // RIFF, PCM 16-bit
}
```

El encoder escribe `RIFF`, `WAVE`, `fmt ` y `data`, un canal, 16 kHz y 16 bits.
Los tests inspeccionan el header y rechazan PCM vacío.

## XState

```text
waitingForUser
  → requestingMicrophone
  → listening
  → recording
  → processingAudio
  → audioReady
  → transcribing
  → analyzingIntent
```

`NO_SPEECH`, `MICROPHONE_DENIED`, `CANCEL_RECORDING` y `AUDIO_ERROR` regresan a
un estado seguro sin convertir el error de audio en un error fatal de lección.
`TRANSCRIPTION_SUCCEEDED` entrega texto y métricas; fallo, timeout y cancelación
regresan a `waitingForUser` con `Escrever` disponible. En DEV se pueden ver el
transcript, tiempo de audio, tiempo de proceso y RTF.

## Coordinación, pausa y cleanup

`AudioSessionCoordinator` impide reproducción NPC durante escucha/grabación e
impide micrófono durante voz NPC. Al pausar, reiniciar, desmontar, pasar a
escritura o cerrar:

- se limpian los dos timeouts;
- se pausa y destruye el VAD;
- se detienen todos los `MediaStreamTrack`;
- se desconectan analyser y source nodes;
- se aborta playback;
- se remueve `devicechange`;
- se cierra el `AudioContext`.
- se cancela el worker Faster-Whisper activo y se elimina su WAV temporal.

## Errores y privacidad

Se manejan permiso denegado, entrada ausente, dispositivo desconectado, fallo de
VAD/modelo/WASM, contexto suspendido, captura vacía, timeout y conflicto de
sesión. El audio no sale del equipo, no se descarga nada automáticamente y no se
incluyen audio ni transcript en logs. Sólo se registran estado, duración,
frecuencia, modelo, RTF y código de error. El detalle del archivo temporal y el
runtime está en `WHISPER_WINDOWS.md`.
