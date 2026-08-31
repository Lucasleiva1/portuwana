# PORTUWANA

Prototipo de escritorio para aprender portugués mediante conversaciones y
situaciones reales. Esta base corresponde a **Fase 1 / Parte 5** y está dirigida
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
usuario: micrófono, VAD y `whisper.cpp` funcionan localmente. El runtime oficial
1.9.3 y el modelo multilingüe `base` deben existir en las rutas documentadas; no
se descargan durante la ejecución. Azure Speech continúa reservado para voz NPC
y pronunciación futuras.

Consultar [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y
[docs/WHISPER_WINDOWS.md](docs/WHISPER_WINDOWS.md) para más detalles. El método
visual reproducible del personaje se mantiene en
[docs/CHARACTER_ASSET_METHOD.md](docs/CHARACTER_ASSET_METHOD.md).
