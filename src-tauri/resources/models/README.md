# Modelos Whisper para PORTUWANA

Los modelos son recursos locales ignorados por Git. El modelo activo por defecto
es el multilingüe **base**; `small` queda soportado como opción, pero no se
descarga automáticamente.

Archivos admitidos:

| Modelo | Archivo | SHA-1 oficial |
| --- | --- | --- |
| base | `ggml-base.bin` | `465707469ff3a37a2b9b8d8f89f2f99de7299dac` |
| small | `ggml-small.bin` | `55356645c2b361a969dfd0ef2c5a50d530afd8d5` |

Fuente oficial:
`https://huggingface.co/ggerganov/whisper.cpp`.

No usar modelos terminados en `.en`: PORTUWANA transcribe portugués con los
modelos multilingües. Rust resuelve sólo estos nombres fijos y no recibe rutas
arbitrarias desde la interfaz.
