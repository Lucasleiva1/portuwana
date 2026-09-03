# Fase 1 / Parte 8 — Faster-Whisper

## Resultado

Faster-Whisper reemplaza a whisper.cpp en el flujo normal de reconocimiento.
La interfaz `STTProvider` mantiene aislados a `LessonEngine` y la UI. El runtime
Python/CTranslate2 es un worker local persistente gestionado por Tauri; el
modelo `small` se carga una sola vez y se mantiene caliente.

No se modificaron el diccionario, SQLite, PixiJS, CharacterRig, XState,
LessonEngine ni PronunciationProvider. Pronunciación sigue ejecutándose en
paralelo y nunca bloquea la respuesta del personaje.

## Decisiones trasladadas de WhisperSolution Premium

- Faster-Whisper 1.2.1 con CTranslate2 4.7.2 y Python 3.11.9.
- `small` multilingüe como modelo de calidad principal.
- CUDA `int8_float32` y CPU `int8`.
- carga persistente y contexto anterior limitado a 200 caracteres.
- mono 16 kHz, 600 ms de silencio, 250 ms de pre-roll y 180 ms mínimos.
- DLL de cuBLAS cargada explícitamente antes del modelo en Windows.

PORTUWANA mantiene su propia captura WebView, Silero VAD, máquina de estados y
contratos tipados. No copia otros subsistemas de WhisperSolution.

## Benchmark del 1 de septiembre de 2026

Hardware: GTX 1050 Ti 4 GiB, driver 581.80. Audio humano en español de 6,24 s.
Los promedios calientes excluyen la primera pasada.

| Motor | Modelo | Backend / compute | Carga | Inferencia caliente | Resultado |
|---|---|---|---:|---:|---|
| Faster-Whisper | small | CUDA / int8_float32 | 1959 ms | 664 ms | frase correcta |
| Faster-Whisper | base | CUDA / int8_float32 | 841 ms | 312 ms | más errores de palabras/concordancia |
| Faster-Whisper | small | CPU / int8 | 1748 ms | 7164 ms | frase correcta |
| whisper.cpp | base | CPU | carga por invocación | 27808 ms total | un error verbal |

La elección final es `small`: es suficientemente rápida en CUDA y fue
claramente más fiel. El runtime Tauri real también informó CUDA activo, carga
persistente y entre 1168 y 1209 MiB de VRAM usados en las verificaciones.

## QA de voz pt-BR

La lista de aceptación manual en la ventana nativa es:

- Oi.
- Preciso de ajuda.
- Ainda não.
- Onde fica a retirada de bagagem?
- À direita?
- Entendi.
- Obrigado.
- voz baja, voz rápida, pausa interna, ruido moderado, frase larga y respuesta
  fuera de tema.

El panel DEV permite comprobar el texto, duración, inferencia, fin de voz a
texto, nivel RMS y backend. La automatización no activa el micrófono ni registra
la voz de la persona sin una acción explícita.

Como control automatizado adicional se sintetizó la secuencia completa con voz
`pt-BR` y se procesó tres veces: `small` reconoció las siete respuestas en orden
por CUDA, con 824 ms de inferencia caliente promedio. La variante humana (voz
baja, velocidad, ruido y pausas reales) queda deliberadamente como prueba
interactiva desde `Falar`.

## Verificación automatizada

- 130 pruebas Vitest.
- 19 pruebas Rust.
- TypeScript estricto y build Vite.
- worker empaquetado probado en CUDA y CPU.
- CUDA real, VRAM y backend confirmados desde el proceso iniciado por Tauri.
- caída secuencial a whisper.cpp cubierta por tests.
- compilación Tauri Windows sin bundle.

Parte 8 no implementa traducción. El dictado ES/PT sólo reconoce el idioma
seleccionado y entrega texto al diccionario existente.
