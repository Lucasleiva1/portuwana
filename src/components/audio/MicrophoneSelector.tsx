import type { AudioInputDevice } from "../../audio/audio.types";

interface MicrophoneSelectorProps {
  devices: readonly AudioInputDevice[];
  selectedDeviceId: string | null;
  onChange: (deviceId: string) => void;
}

export function MicrophoneSelector({
  devices,
  selectedDeviceId,
  onChange,
}: MicrophoneSelectorProps) {
  if (devices.length < 2) {
    return null;
  }
  return (
    <label className="microphone-selector">
      <span>Microfone</span>
      <select
        value={selectedDeviceId ?? devices[0]?.deviceId ?? ""}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </select>
    </label>
  );
}
