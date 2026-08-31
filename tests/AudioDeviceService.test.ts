import { describe, expect, it, vi } from "vitest";
import {
  AudioDeviceService,
  type MediaDevicesAdapter,
} from "../src/audio/AudioDeviceService";

function device(
  deviceId: string,
  label: string,
  kind: MediaDeviceKind = "audioinput",
): MediaDeviceInfo {
  return { deviceId, label, kind, groupId: "group", toJSON: () => ({}) };
}

describe("AudioDeviceService", () => {
  it("enumerates, selects, persists and reacts to device changes", async () => {
    let available: readonly MediaDeviceInfo[] = [
      device("default", "Microfone padrão"),
      device("usb", "USB Mic"),
      device("speaker", "Speaker", "audiooutput"),
    ];
    let deviceChange: EventListener | null = null;
    const mediaDevices: MediaDevicesAdapter = {
      getUserMedia: vi.fn(),
      enumerateDevices: async () => available,
      addEventListener: (_type, listener) => {
        deviceChange = listener;
      },
      removeEventListener: vi.fn(),
    };
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const service = new AudioDeviceService(mediaDevices, storage);
    const changed = vi.fn();
    service.watch(changed);

    expect(await service.refresh()).toHaveLength(2);
    expect(service.selectedDeviceId).toBe("default");
    service.select("usb");
    expect(service.selectedDeviceId).toBe("usb");
    expect([...values.values()]).toContain("usb");

    available = [device("default", "Microfone padrão")];
    expect(deviceChange).not.toBeNull();
    (deviceChange as unknown as EventListener)(new Event("devicechange"));
    await vi.waitFor(() => expect(service.selectedDeviceId).toBe("default"));
    expect(changed).toHaveBeenCalled();
    service.stopWatching();
  });
});
