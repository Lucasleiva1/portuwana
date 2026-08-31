# Configuración en Windows

## Plataforma objetivo

- Windows 10 u 11 x64.
- PowerShell.
- No se configura macOS, Linux ni mobile en esta fase.

## 1. Node.js y npm

Verificar:

```powershell
node --version
npm --version
```

Usar una versión estable de Node compatible con Vite 7. Las dependencias exactas
del proyecto quedan registradas en `package-lock.json`; instalar con:

```powershell
npm install
```

## 2. Rust y target MSVC

Instalar Rust mediante `rustup` y seleccionar el toolchain MSVC de 64 bits.
Verificar:

```powershell
rustc --version
cargo --version
rustup show active-toolchain
rustup target list --installed
```

El toolchain activo debe indicar `x86_64-pc-windows-msvc`.

## 3. Visual Studio Build Tools

Desde Visual Studio Installer instalar **Build Tools 2022** con:

- Desktop development with C++ / Desarrollo para el escritorio con C++.
- MSVC x64/x86 build tools.
- Windows 10 u 11 SDK.

`cl.exe` puede no aparecer en el PATH de una PowerShell común. Cargo localiza las
Build Tools instaladas; la comprobación definitiva es que `cargo check` termine
correctamente.

## 4. WebView2

Tauri usa Microsoft Edge WebView2. Windows 11 suele incluir el runtime. En
Windows 10, si `npm run tauri dev` informa que falta, instalar el **WebView2
Evergreen Runtime** oficial de Microsoft y volver a ejecutar el comando.

La validación útil no es solo el registro de Windows: la ventana nativa debe
abrir, renderizar PixiJS y permitir interacción.

## 5. Tauri

Verificar el diagnóstico:

```powershell
npm run tauri info
```

Ejecutar validaciones:

```powershell
npm run typecheck
npm run test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Abrir la aplicación de desarrollo:

```powershell
npm run tauri dev
```

El primer arranque puede tardar varios minutos porque Cargo compila Tauri,
WebView2 y SQLite. Los arranques siguientes reutilizan esa compilación.

## 6. Señales de funcionamiento

En la pantalla técnica deben aparecer:

```text
Tauri: ready
PixiJS: ready
XState: ready
Audio: ready
Whisper: ready
SQLite: ready
```

La base `portuwana.db` se guarda en el directorio de datos de la aplicación que
gestiona Tauri, no dentro del repositorio.

Whisper aparece `pending` si faltan el runtime o el modelo activo; eso no impide
usar `Escrever`. La instalación y los hashes están en `WHISPER_WINDOWS.md`.

## Requisitos deliberadamente pendientes

- Assets gráficos finales del aeropuerto, personaje y logo.
- Credenciales Azure Speech (`key` y `region`), suministradas por un canal
  seguro en una fase posterior.
- Evaluación real de pronunciación.

No agregar claves, modelos grandes ni ejecutables a Git. El runtime local y el
modelo se distribuyen como recursos Tauri por un canal de artefactos, no por el
repositorio.
