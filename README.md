# PORTUWANA

Prototipo de escritorio para aprender portugués mediante conversaciones y
situaciones reales. Esta base corresponde a **Fase 1 / Parte 8** y está dirigida
exclusivamente a Windows 10/11 x64.

## Comandos

```powershell
npm install
npm run typecheck
npm run test
npm run build
npm run tauri dev
```

La aplicación no requiere credenciales externas para reconocer la voz del
usuario: micrófono, VAD y Faster-Whisper funcionan localmente en portugués,
español o detección automática. Faster-Whisper 1.2.1, CTranslate2 4.7.2 y el
modelo multilingüe `small` están empaquetados; CUDA es preferido y CPU funciona
como fallback automático. No se descargan modelos durante la ejecución. Azure
Speech continúa reservado para voz NPC y pronunciación futuras.

Consultar [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y
[docs/WHISPER_WINDOWS.md](docs/WHISPER_WINDOWS.md) para más detalles. El método
visual reproducible del personaje se mantiene en
[docs/CHARACTER_ASSET_METHOD.md](docs/CHARACTER_ASSET_METHOD.md).

La conversación guiada flexible, las variantes, la voz modular y la frontera
de pronunciación de Parte 6 se describen en
[docs/PHASE_1_PART_6.md](docs/PHASE_1_PART_6.md).

La persistencia SQLite, el diccionario ES ↔ PT-BR, la importación de fuentes y
el dictado del traductor se documentan en
[docs/PHASE_1_PART_7.md](docs/PHASE_1_PART_7.md). Licencias y procedencia:
[docs/dictionary-sources.md](docs/dictionary-sources.md).

La migración de voz, el worker persistente, CUDA/CPU y los benchmarks de Parte 8
se documentan en [docs/PHASE_1_PART_8.md](docs/PHASE_1_PART_8.md).
