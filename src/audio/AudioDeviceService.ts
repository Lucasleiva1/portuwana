import type { AudioInputDevice } from "./audio.types";

export interface MediaDevicesAdapter {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<readonly MediaDeviceInfo[]>;
  addEventListener?(type: "devicechange", listener: EventListener): void;
  removeEventListener?(type: "devicechange", listener: EventListener): void;
}

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const preferenceKey = "portuwana.audio.inputDeviceId";

export function browserMediaDevices(): MediaDevicesAdapter | null {
  return typeof navigator !== "undefined" && navigator.mediaDevices
    ? navigator.mediaDevices
    : null;
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export class AudioDeviceService {
  readonly #mediaDevices: MediaDevicesAdapter | null;
  readonly #storage: PreferenceStorage | null;
  #devices: readonly AudioInputDevice[] = [];
  #selectedDeviceId: string | null = null;
  #onChange: ((devices: readonly AudioInputDevice[]) => void) | null = null;
  #listening = false;

  constructor(
    mediaDevices: MediaDevicesAdapter | null = browserMediaDevices(),
    storage: PreferenceStorage | null = browserStorage(),
  ) {
    this.#mediaDevices = mediaDevices;
    this.#storage = storage;
    this.#selectedDeviceId = storage?.getItem(preferenceKey) ?? null;
  }

  get selectedDeviceId(): string | null {
    return this.#selectedDeviceId;
  }

  get devices(): readonly AudioInputDevice[] {
    return this.#devices;
  }

  async refresh(): Promise<readonly AudioInputDevice[]> {
    if (!this.#mediaDevices) {
      this.#devices = [];
      this.#onChange?.(this.#devices);
      return this.#devices;
    }
    const available = await this.#mediaDevices.enumerateDevices();
    this.#devices = available
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label.trim() || `Microfone ${index + 1}`,
        isDefault: device.deviceId === "default",
      }));

    const selectedStillExists = this.#devices.some(
      (device) => device.deviceId === this.#selectedDeviceId,
    );
    if (!selectedStillExists) {
      this.#selectedDeviceId =
        this.#devices.find((device) => device.isDefault)?.deviceId ??
        this.#devices[0]?.deviceId ??
        null;
    }
    this.#onChange?.(this.#devices);
    return this.#devices;
  }

  select(deviceId: string): void {
    if (!this.#devices.some((device) => device.deviceId === deviceId)) {
      throw new Error("The selected microphone is not available");
    }
    this.#selectedDeviceId = deviceId;
    this.#storage?.setItem(preferenceKey, deviceId);
  }

  watch(onChange: (devices: readonly AudioInputDevice[]) => void): void {
    this.#onChange = onChange;
    if (this.#listening || !this.#mediaDevices?.addEventListener) {
      return;
    }
    this.#mediaDevices.addEventListener("devicechange", this.#handleDeviceChange);
    this.#listening = true;
  }

  stopWatching(): void {
    if (this.#listening) {
      this.#mediaDevices?.removeEventListener?.(
        "devicechange",
        this.#handleDeviceChange,
      );
    }
    this.#listening = false;
    this.#onChange = null;
  }

  readonly #handleDeviceChange: EventListener = () => {
    void this.refresh();
  };
}
