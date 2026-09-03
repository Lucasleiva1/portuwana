# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path
import site

from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_dynamic_libs,
    collect_submodules,
    copy_metadata,
)


spec_dir = Path(SPECPATH)
worker = spec_dir / "portuwana_faster_whisper_worker.py"

datas = []
binaries = []
hiddenimports = []

for package in ("faster_whisper", "ctranslate2", "av", "tokenizers"):
    datas += collect_data_files(package)
    binaries += collect_dynamic_libs(package)
    hiddenimports += collect_submodules(package)

for distribution in (
    "faster-whisper",
    "ctranslate2",
    "av",
    "tokenizers",
    "huggingface-hub",
):
    try:
        datas += copy_metadata(distribution)
    except Exception:
        pass

nvidia_root = next(
    (
        Path(package_dir) / "nvidia"
        for package_dir in site.getsitepackages()
        if (Path(package_dir) / "nvidia").is_dir()
    ),
    None,
)
if nvidia_root is None:
    raise RuntimeError("No se encontró el runtime NVIDIA en el entorno de build")

for relative_dir in ("cublas/bin", "cuda_runtime/bin", "cudnn/bin"):
    dlls = list((nvidia_root / relative_dir).glob("*.dll"))
    if not dlls:
        raise RuntimeError(f"No se encontraron DLLs NVIDIA en {nvidia_root / relative_dir}")
    binaries += [(str(dll), ".") for dll in dlls]

a = Analysis(
    [str(worker)],
    pathex=[str(spec_dir)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "PySide6",
        "pygame",
        "sounddevice",
        "torch",
        "tensorflow",
        "matplotlib",
        "IPython",
        "jupyter",
    ],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="portuwana-faster-whisper",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    contents_directory="_internal",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="portuwana-faster-whisper",
)
