# Faster-Whisper local en Windows

## Runtime principal

Desde Fase 1 / Parte 8, PORTUWANA usa Faster-Whisper como STT principal. La
combinación se tomó de WhisperSolution Premium y fue validada en el mismo
equipo:

- Faster-Whisper 1.2.1;
- CTranslate2 4.7.2;
- Python 3.11.9 empaquetado, sin instalación manual para el usuario;
- modelo multilingüe `small` de Systran;
- CUDA con `int8_float32` cuando está disponible;
- CPU con `int8` como degradación automática;
- tarea `transcribe`: nunca se usa Faster-Whisper para traducir.

El proceso persistente está en `src-tauri/binaries/faster-whisper/` y el modelo
en `src-tauri/resources/models/faster-whisper-small/`. Tauri resuelve ambas
rutas; React no puede elegir ejecutables ni modelos arbitrarios. El build se
reproduce con `tools/faster-whisper-worker/build-worker.ps1` usando el entorno
estable documentado en `requirements.txt`.

El runtime incluido ocupa 1988,4 MiB y el modelo 463,7 MiB. La mayor parte del
runtime son las DLL oficiales de cuBLAS y cuDNN necesarias para que CUDA no
dependa de una instalación global. No se empaqueta el entorno de desarrollo.

## Flujo y ciclo de vida

```text
Falar
  → AudioEngine / un único Silero VAD
  → WAV PCM 16-bit, mono, 16 kHz
  → comando Tauri validado
  → worker Faster-Whisper ya caliente
  → CUDA; CPU si CUDA falla
  → transcript validado
  → LocalIntentProvider
  → LessonEngine
```

El worker se inicia una vez, carga el modelo una vez y atiende múltiples frases
por NDJSON sobre stdin. No abre puertos ni ventanas y no requiere permisos de
administrador. Rust limita audio y respuestas a una raíz temporal propia,
serializa las solicitudes, reinicia el worker si cae y lo termina al cerrar la
aplicación. Cancelar mata la inferencia activa; la siguiente solicitud crea un
worker limpio.

La jerarquía de recuperación, siempre secuencial, es:

1. Faster-Whisper CUDA;
2. Faster-Whisper CPU;
3. whisper.cpp 1.9.3 temporal;
4. `Escrever`.

Whisper.cpp no se carga ni se ejecuta junto con Faster-Whisper. Se conserva sólo
para la transición y puede retirarse en una fase posterior cuando la matriz de
equipos finales esté validada.

## CUDA y modelo

En el equipo de validación se detectó NVIDIA GeForce GTX 1050 Ti, driver 581.80,
4096 MiB de VRAM y un dispositivo visible para CTranslate2. El paquete incorpora
CUDA Runtime 12.9.79, cuBLAS 12.9.2.10 y cuDNN 9.22.0.52. El backend reportó
realmente `cuda`, `int8_float32` y aproximadamente 1,1 GiB de VRAM en uso.

Se compararon `base` y `small` sobre el mismo WAV de 6,24 s y cinco pasadas
CUDA. `base` fue más veloz (312 ms de inferencia caliente) pero degradó palabras
y concordancia. `small` conservó la frase correctamente con 664 ms de promedio
caliente, por lo que queda como modelo final.

El benchmark reproducible es:

```powershell
.\tools\faster-whisper-worker\benchmark-worker.ps1 `
  -Audio C:\ruta\frase.wav -Device cuda -Runs 5 -Language pt
```

La misma prueba forzada a CPU produjo 7164 ms de inferencia caliente. El
Whisper.cpp `base` anterior tardó 27808 ms de proceso completo para el mismo
audio. Las cifras son del equipo indicado y no son garantías para otro hardware.

## Audio, VAD y contexto

La captura pide un canal con `echoCancellation`, `noiseSuppression` y
`autoGainControl`. Silero VAD v5 es el único responsable de cerrar el turno:
600 ms de silencio, 250 ms de pre-roll y 180 ms mínimos de voz. El VAD interno
de Faster-Whisper queda desactivado para no sumar una segunda espera.

La escena aporta un prompt corto de vocabulario. Se conservan como máximo 200
caracteres de contexto anterior y se limpia al reiniciar/cambiar el alcance de
la lección. El contexto ayuda, pero `condition_on_previous_text` permanece
desactivado para evitar propagación indefinida de errores.

El panel DEV muestra dispositivo, nivel RMS, captura/VAD, backend, compute type,
GPU, VRAM, carga, duración, inferencia, fin de voz a texto y fallback.

## Privacidad y verificación

El audio no sale del equipo. Cada WAV temporal se elimina en éxito, error o
cancelación y el transcript no se escribe en logs. Los errores de silencio no
se confunden con fallos de CUDA.

```powershell
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --no-bundle
npm run tauri -- dev
```

Para la prueba humana final, pulsar `Falar` y recorrer las frases pt-BR de
`PHASE_1_PART_8.md`, verificando que el transcript avance la escena. La prueba
humana de micrófono debe hacerse desde la ventana visible; no se graba al usuario
automáticamente durante un benchmark.
