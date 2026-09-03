# Fuentes del diccionario offline

Registro de la construcción DEV ejecutada el 1 de septiembre de 2026 desde
`C:\Users\jaell\Desktop\PORTUWANA_DICTIONARY_SOURCES`. Los originales no se
modifican, no se copian a `public/` y no se incluyen en el instalador.

| Familia | Archivo detectado | Tamaño | Formato procesado | Licencia documentada | Resultado |
| --- | --- | ---: | --- | --- | --- |
| Apertium ES ↔ PT | `apertium-es-pt-master.zip` | 702.502 B | ZIP + diccionario bilingüe `.dix` | GPL-3.0-or-later, según `COPYING` incluido | 15.532 procesadas, 15.522 aceptadas, 0 errores |
| FreeDict PT → ES | `freedict-por-spa-2025.11.23.stardict.tar.xz` | 299.476 B | TAR.XZ + StarDict (`.ifo`, `.idx.gz`, `.dict`) | CC BY-SA 3.0, según metadatos del `.ifo` | 10.791 procesadas, 14.038 aceptadas, 0 errores |
| Wikcionario ES / Wiktextract | `raw-wiktextract-data.jsonl` | 1.185.448.227 B | JSONL sin comprimir, lectura línea por línea | `REVIEW_REQUIRED`: falta registrar URL, fecha y licencia exactas del dump | 1.011.043 procesadas, 12.887 aceptadas, 1.153 líneas descartadas |
| Wikcionário PT | No encontrado | — | `.xml.bz2` esperado | `REVIEW_REQUIRED` hasta incorporar un dump concreto | Pendiente |

Las 1.153 incidencias de Wiktextract corresponden a líneas que no pudieron
leerse o validarse como el JSON estructurado esperado. El build continuó, dejó
trazabilidad de la fuente y terminó como `completed_with_errors`; Apertium y
FreeDict no registraron errores.

## Redistribución

- La base derivada conserva referencias internas a cada fuente.
- Antes de distribuir un SQLite generado se deben revisar las obligaciones GPL
  de Apertium, la atribución/ShareAlike de FreeDict y la licencia exacta del dump
  Wiktextract.
- Mientras Wiktextract no tenga procedencia verificable, cualquier
  redistribución del derivado queda marcada `REVIEW_REQUIRED`.
- La fuente incorporada `PORTUWANA esencial` es vocabulario curado del proyecto
  y garantiza búsquedas básicas aunque la carpeta DEV no exista.

## Reproducción DEV

Desde `src-tauri`:

```powershell
cargo run --bin build_dictionary -- `
  "C:\Users\jaell\Desktop\PORTUWANA_DICTIONARY_SOURCES" `
  "$env:APPDATA\com.portuwana.app\portuwana.db"
```

La interfaz DEV también expone **Fuentes → Build Dictionary Database**. La ruta
inicial se guarda en SQLite y puede cambiarse sin hardcodearla para producción.

