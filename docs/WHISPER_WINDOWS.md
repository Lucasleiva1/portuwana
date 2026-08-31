# Whisper local en Windows

## Versión y archivos

PORTUWANA fija `whisper.cpp` **1.9.3** (release `b4938`) para Windows x64. El
runtime oficial se coloca en `src-tauri/binaries/whisper/` y los modelos en
`src-tauri/resources/models/`. Ambos directorios se empaquetan como recursos de
Tauri, pero sus binarios grandes quedan fuera de Git.

El proyecto instalado y verificado usa:

- `whisper-bin-x64.zip`, SHA-256
  `c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d`;
- `ggml-base.bin`, SHA-1
  `465707469ff3a37a2b9b8d8f89f2f99de7299dac`.

El modelo `small` es opcional y debe llamarse `ggml-small.bin`. La aplicación no
descarga ejecutables ni modelos al arrancar.

## Flujo

```text
Falar
  → AudioEngine / Silero VAD
  → WAV PCM 16-bit, mono, 16 kHz
  → comando Tauri tipado
  → whisper-cli -l pt (sin traducción)
  → transcript validado
  → LocalIntentProvider
  → LessonEngine
```

React envía únicamente bytes WAV y configuración validada (`base|small`, `pt`,
`translate=false`, timeout y threads). No envía comandos, argumentos libres ni
rutas. Rust localiza el ejecutable y el modelo en ubicaciones fijas, crea una
carpeta temporal única, ejecuta el proceso sin ventana y valida el JSON final.

## Configuración

La configuración inicial está en
`src/speech/whisper/whisper.config.ts`:

- modelo: `base`;
- idioma: `pt`;
- traducción: desactivada;
- timeout: 45 segundos;
- threads: 4.

El timeout es deliberadamente 45 segundos: en el equipo de desarrollo, la carga
fría del modelo base tardó aproximadamente 28 segundos aun con un WAV de un
segundo. `small` necesita instalarse de forma explícita antes de elegirlo. En DEV
el panel muestra versión, modelos disponibles, transcript y tiempos.

## Cancelación, errores y privacidad

Cada solicitud tiene un identificador seguro. Cancelar, pausar, reiniciar, pasar
a `Escrever` o desmontar la aplicación solicita la terminación del proceso. El
servicio también mata y espera el proceso al vencer el timeout. La salida de
error se consume en paralelo para evitar bloqueos y la carpeta temporal se
elimina mediante cleanup RAII tanto en éxito como en error.

El WAV existe en disco sólo mientras `whisper-cli` lo procesa. No se conserva el
audio, no se envía a internet y el texto reconocido no se escribe en logs. Los
logs contienen sólo modelo, duraciones, RTF y códigos de error.

Si faltan runtime o modelo, la lección sigue operativa y `Escrever` permanece
disponible. Los errores esperables son `binary-missing`, `model-missing`,
`invalid-wav`, `timeout`, `cancelled`, `empty-transcript` y `process-failed`.

## Verificación

```powershell
npm run typecheck
npm run test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
npm run tauri dev
```

Para la prueba funcional final, pulsar `Falar`, decir una respuesta válida en
portugués y comprobar que aparece `Você disse:`, que el intent avanza la lección
y que no queda ninguna carpeta `portuwana-whisper-*` en `%TEMP%`.

Fuentes oficiales:

- `https://github.com/ggml-org/whisper.cpp/releases/tag/b4938`;
- `https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md`;
- `https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/README.md`.
