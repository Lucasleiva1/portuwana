# Fase 1 / Parte 7

La Parte 7 incorpora persistencia local completa y un diccionario/traductor
offline español ↔ portugués brasileño sin alterar el control pedagógico de
`LessonEngine`.

## Persistencia

La migración 2 añade perfil local, progreso por lección, sesiones, configuración,
historial, favoritos, fuentes, builds, entradas, sentidos, traducciones,
relaciones e índices. Las sesiones interrumpidas se cierran como abandonadas al
volver a abrir la app. No se guarda audio crudo.

`LocalPersistence` mantiene volumen, velocidad, subtítulos, ayuda, dispositivo
de entrada, proveedor/voz, asistente elegido y ruta DEV. Guarda intentos,
dimensiones de progreso, Poder do Português, turnos, ayudas, intents y resultado
final.

## Diccionario

`DictionaryService` es la frontera única para búsquedas, traducción orientativa
de frases, historial y favoritos. Normaliza Unicode, conserva la grafía original,
tolera acentos y errores leves, prioriza coincidencias exactas y consolida
resultados repetidos conservando sus fuentes. Usa FTS5 cuando está disponible y
el índice SQL regular como fallback.

En frases, la tolerancia aproximada no se aplica palabra por palabra: sólo se
componen coincidencias léxicas exactas y reglas contextuales verificadas. Esto
evita errores como `como → como você está?` o `tomo → touro`; la construcción
`como tomo un taxi, gracias` produce `como pego um táxi, obrigado`.

Durante un build marcado `building`, las búsquedas usan el léxico esencial
estable. Esto evita resultados incorrectos causados por consultar tablas todavía
parciales. El caso de regresión `hombre → homem` queda cubierto, separado de
`hombro → ombro`.

## Importación

El constructor Rust detecta por extensión y estructura interna, no por nombre
exacto. Procesa XML/BZ2, JSONL/GZ, ZIP Apertium y TAR.XZ FreeDict en streaming,
normaliza, genera el sentido inverso, deduplica, enlaza procedencia y reconstruye
los índices por fuera del hilo de UI.

Build real del 1 de septiembre de 2026:

- 60.268 términos externos; 60.320 después del léxico esencial.
- 75.746 traducciones externas; 75.827 después del léxico esencial.
- 39.424 relaciones.
- FTS5 activo con 60.320 documentos.
- SQLite reportado al finalizar: 55.455.744 bytes.
- Tiempo de importación: 130.935 ms.

El detalle de archivos, errores y licencias está en
[`dictionary-sources.md`](dictionary-sources.md).

## Interfaz y voz

El asistente aparece abajo a la derecha con Lía o Téo y expresiones neutral,
parpadeo, pregunta y risa. Los ocho PNG usan alfa real. La burbuja incluye
traducción, Auto/ES→PT/PT→ES, recientes, favoritos y el constructor DEV.

El botón **Hablar** reutiliza `AudioEngine`, VAD y Whisper locales. Transcribe en
español, portugués o detección automática según la dirección seleccionada,
coloca el texto en el editor y lanza la traducción. Escribir sigue disponible si
el micrófono o el modelo no están listos.

Una palabra del diálogo abre el asistente de forma contextual. Esa acción no
envía eventos de respuesta ni cambia la máquina conversacional.

## Verificación

Las fixtures cubren XML/BZ2, JSONL/GZ, ZIP, TAR.XZ, normalización, sentidos e
importación. Las pruebas TypeScript cubren búsqueda bidireccional, acentos,
errores leves, frases, deduplicación visible, `hombre/hombro`, configuración de
Whisper y dictado en español. La migración y los servicios de persistencia tienen
checks específicos, además de la suite general.

No se agregó IA generativa, nube, login, embeddings, pagos, flashcards ni Parte 8.
