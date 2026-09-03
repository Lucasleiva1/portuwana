"""Persistent local Faster-Whisper worker for PORTUWANA.

The worker receives newline-delimited JSON commands through stdin and writes
each result to a caller-owned response file. Audio and response paths are
restricted to the temporary request root supplied by the Tauri host.
"""

from __future__ import annotations

import argparse
import ctypes
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback
from typing import Any


_DLL_DIRECTORY_HANDLES: list[Any] = []


def _add_runtime_dll_directories() -> None:
    if os.name != "nt" or not hasattr(os, "add_dll_directory"):
        return

    candidates = [Path(sys.executable).resolve().parent]
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        candidates.append(Path(bundled).resolve())

    try:
        import site

        package_roots: list[str] = []
        for package_root in [*site.getsitepackages(), *sys.path]:
            if (
                package_root
                and package_root.endswith("site-packages")
                and package_root not in package_roots
            ):
                package_roots.append(package_root)
        for package_root in package_roots:
            root = Path(package_root)
            candidates.extend(
                [
                    root / "nvidia" / "cuda_runtime" / "bin",
                    root / "nvidia" / "cuda_nvrtc" / "bin",
                    root / "nvidia" / "cublas" / "bin",
                    root / "nvidia" / "cudnn" / "bin",
                    root / "ctranslate2",
                ]
            )
    except Exception:
        pass

    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen or not candidate.is_dir():
            continue
        seen.add(candidate)
        try:
            _DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(str(candidate)))
        except OSError:
            continue


_add_runtime_dll_directories()

import ctranslate2  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402


class NoSpeechDetectedError(ValueError):
    """The model completed normally but did not produce usable speech."""


def _package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def _gpu_info() -> dict[str, Any]:
    info: dict[str, Any] = {
        "gpuName": None,
        "driverVersion": None,
        "vramTotalMiB": None,
        "vramUsedMiB": None,
    }
    try:
        output = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=name,driver_version,memory.total,memory.used",
                "--format=csv,noheader,nounits",
            ],
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).splitlines()[0]
        name, driver, total, used = [part.strip() for part in output.split(",", 3)]
        info.update(
            {
                "gpuName": name,
                "driverVersion": driver,
                "vramTotalMiB": int(total),
                "vramUsedMiB": int(used),
            }
        )
    except Exception:
        pass
    return info


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    os.replace(temporary, path)


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root)
        return True
    except (OSError, ValueError):
        return False


class FasterWhisperRuntime:
    def __init__(
        self,
        model_path: Path,
        model_name: str,
        request_root: Path,
        status_path: Path,
        preferred_device: str,
        gpu_compute_type: str,
        cpu_compute_type: str,
    ) -> None:
        self.model_path = model_path
        self.model_name = model_name
        self.request_root = request_root.resolve()
        self.status_path = status_path.resolve()
        self.preferred_device = preferred_device
        self.gpu_compute_type = gpu_compute_type
        self.cpu_compute_type = cpu_compute_type
        self.device = "cpu"
        self.compute_type = cpu_compute_type
        self.model: WhisperModel | None = None
        self.load_ms = 0
        self.fallback_reason: str | None = None
        self.contexts: dict[str, str] = {}
        self.cuda_device_count = 0
        self.gpu_info = _gpu_info()

    def _status(self, ready: bool, error: str | None = None) -> dict[str, Any]:
        return {
            "ready": ready,
            "provider": "faster-whisper",
            "fasterWhisperVersion": _package_version("faster-whisper"),
            "ctranslate2Version": getattr(ctranslate2, "__version__", "unknown"),
            "model": self.model_name,
            "backend": self.device,
            "computeType": self.compute_type,
            "cudaDeviceCount": self.cuda_device_count,
            "loadMs": self.load_ms,
            "fallbackReason": self.fallback_reason,
            "error": error,
            **self.gpu_info,
        }

    def _persist_status(self, ready: bool, error: str | None = None) -> None:
        _write_json(self.status_path, self._status(ready, error))

    def load(self) -> None:
        if not self.model_path.is_dir():
            raise FileNotFoundError(f"Faster-Whisper model not found: {self.model_path}")
        self.cuda_device_count = ctranslate2.get_cuda_device_count()
        if self.preferred_device == "cuda" and self.cuda_device_count > 0:
            try:
                ctypes.WinDLL("cublas64_12.dll")
                self.device = "cuda"
                self.compute_type = self.gpu_compute_type
            except Exception as error:
                self.device = "cpu"
                self.compute_type = self.cpu_compute_type
                self.fallback_reason = f"CUDA detectado, pero cuBLAS no cargó: {error}"
        else:
            self.device = "cpu"
            self.compute_type = self.cpu_compute_type
            if self.preferred_device == "cuda":
                self.fallback_reason = "CUDA no está disponible para CTranslate2."

        started = time.perf_counter()
        try:
            self.model = WhisperModel(
                str(self.model_path),
                device=self.device,
                compute_type=self.compute_type,
                local_files_only=True,
            )
        except Exception as error:
            if self.device != "cuda":
                raise
            self.fallback_reason = f"CUDA falló al cargar el modelo: {error}"
            self.device = "cpu"
            self.compute_type = self.cpu_compute_type
            self.model = WhisperModel(
                str(self.model_path),
                device="cpu",
                compute_type=self.cpu_compute_type,
                local_files_only=True,
            )
        self.load_ms = round((time.perf_counter() - started) * 1000)
        self.gpu_info = _gpu_info()
        self._persist_status(True)

    def _switch_to_cpu(self, reason: Exception) -> None:
        self.fallback_reason = f"CUDA falló durante la inferencia: {reason}"
        self.device = "cpu"
        self.compute_type = self.cpu_compute_type
        started = time.perf_counter()
        self.model = WhisperModel(
            str(self.model_path),
            device="cpu",
            compute_type=self.cpu_compute_type,
            local_files_only=True,
        )
        self.load_ms = round((time.perf_counter() - started) * 1000)
        self.gpu_info = _gpu_info()
        self._persist_status(True)

    def _validated_path(self, value: Any, *, must_exist: bool) -> Path:
        if not isinstance(value, str) or not value:
            raise ValueError("Invalid request path")
        path = Path(value).resolve()
        if not _is_within(path, self.request_root):
            raise ValueError("Request path is outside the temporary request root")
        if must_exist and not path.is_file():
            raise FileNotFoundError(f"Request file not found: {path}")
        return path

    def _prompt(self, scope: str, scene_prompt: str) -> str | None:
        previous = self.contexts.get(scope, "")[-200:]
        parts = [part.strip() for part in (scene_prompt[:600], previous) if part.strip()]
        return " ".join(parts) or None

    def _transcribe_once(
        self,
        audio_path: Path,
        language: str | None,
        prompt: str | None,
    ) -> tuple[str, str, int]:
        if self.model is None:
            raise RuntimeError("Faster-Whisper is not loaded")
        started = time.perf_counter()
        segments, info = self.model.transcribe(
            str(audio_path),
            beam_size=1,
            language=language,
            task="transcribe",
            vad_filter=False,
            initial_prompt=prompt,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
        inference_ms = round((time.perf_counter() - started) * 1000)
        if not text:
            raise NoSpeechDetectedError("No se identificó una frase.")
        return text, info.language, inference_ms

    def transcribe(self, command: dict[str, Any]) -> dict[str, Any]:
        audio_path = self._validated_path(command.get("audioPath"), must_exist=True)
        language_value = command.get("language")
        if language_value not in {"pt", "es", "auto"}:
            raise ValueError("Unsupported transcription language")
        language = None if language_value == "auto" else language_value
        scope = str(command.get("contextScope") or "lesson")[:80]
        scene_prompt = str(command.get("initialPrompt") or "")
        prompt = self._prompt(scope, scene_prompt)

        try:
            text, detected_language, inference_ms = self._transcribe_once(
                audio_path, language, prompt
            )
        except NoSpeechDetectedError:
            raise
        except Exception as error:
            if self.device != "cuda":
                raise
            self._switch_to_cpu(error)
            text, detected_language, inference_ms = self._transcribe_once(
                audio_path, language, prompt
            )

        self.contexts[scope] = f"{self.contexts.get(scope, '')} {text}".strip()[-1000:]
        self._persist_status(True)
        status = self._status(True)
        return {
            "status": "success",
            "requestId": command.get("requestId"),
            "text": text,
            "language": detected_language,
            "inferenceMs": inference_ms,
            **status,
        }

    def handle(self, command: dict[str, Any]) -> bool:
        operation = command.get("op")
        if operation == "shutdown":
            return False
        if operation == "resetContext":
            scope = command.get("contextScope")
            if isinstance(scope, str) and scope:
                self.contexts.pop(scope[:80], None)
            else:
                self.contexts.clear()
            return True
        if operation != "transcribe":
            return True

        response_path: Path | None = None
        try:
            response_path = self._validated_path(command.get("responsePath"), must_exist=False)
            response = self.transcribe(command)
        except Exception as error:
            response = {
                "status": "error",
                "requestId": command.get("requestId"),
                "code": "transcription-failed",
                "message": str(error),
                "trace": traceback.format_exc(limit=3),
                **self._status(self.model is not None),
            }
        if response_path is not None:
            _write_json(response_path, response)
        return True


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--model-name", choices=("base", "small"), default="small")
    parser.add_argument("--request-root", required=True)
    parser.add_argument("--status-path", required=True)
    parser.add_argument("--preferred-device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--gpu-compute-type", default="int8_float32")
    parser.add_argument("--cpu-compute-type", default="int8")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    runtime = FasterWhisperRuntime(
        model_path=Path(args.model_path).resolve(),
        model_name=args.model_name,
        request_root=Path(args.request_root),
        status_path=Path(args.status_path),
        preferred_device=args.preferred_device,
        gpu_compute_type=args.gpu_compute_type,
        cpu_compute_type=args.cpu_compute_type,
    )
    try:
        runtime.load()
    except Exception as error:
        runtime._persist_status(False, str(error))
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        return 2

    for raw_line in sys.stdin:
        if len(raw_line) > 64_000:
            continue
        try:
            command = json.loads(raw_line)
            if isinstance(command, dict) and not runtime.handle(command):
                break
        except Exception:
            print(traceback.format_exc(), file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
