import { describe, expect, it } from "vitest";
import type { MediaDevicesAdapter } from "../src/audio/AudioDeviceService";
import { MicrophoneService } from "../src/audio/MicrophoneService";

describe("MicrophoneService", () => {
  it("classifies a denied permission without creating a retry loop", async () => {
    let requests = 0;
    const mediaDevices: MediaDevicesAdapter = {
      enumerateDevices: async () => [],
      getUserMedia: async () => {
        requests += 1;
        throw new DOMException("denied", "NotAllowedError");
      },
    };
    const service = new MicrophoneService(mediaDevices);

    await expect(service.request()).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(service.permission).toBe("denied");
    expect(requests).toBe(1);
  });
});
