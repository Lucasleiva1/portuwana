# whisper.cpp para PORTUWANA

Esta carpeta contiene el runtime local de reconocimiento de voz y no se publica
en Git. La versión fijada por la Parte 5 es **whisper.cpp 1.9.3**, release
`b4938`, Windows x64.

Archivos esperados:

- `whisper-cli.exe`;
- las DLL incluidas en el asset oficial `whisper-bin-x64.zip`.

El ZIP oficial utilizado tiene SHA-256:

```text
c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d
```

Descarga oficial:
`https://github.com/ggml-org/whisper.cpp/releases/tag/b4938`.

La aplicación no acepta una ruta de ejecutable desde React y no descarga el
runtime durante la ejecución. Rust resuelve exclusivamente esta ubicación fija.
