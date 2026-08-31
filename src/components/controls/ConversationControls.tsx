import { useEffect, useRef, useState } from "react";
import { ListeningIndicator } from "../audio/ListeningIndicator";
import { CloseIcon, SendIcon } from "../icons";
import { HelpButton } from "./HelpButton";
import {
  SpeakButton,
  deriveSpeakButtonPresentation,
} from "./SpeakButton";
import { WriteButton } from "./WriteButton";

interface ConversationControlsProps {
  machineState: string;
  writeOpen: boolean;
  helpOpen: boolean;
  audioLevel: number;
  onSpeak: () => void;
  onCancelRecording: () => void;
  onOpenWrite: () => void;
  onCloseWrite: () => void;
  onSubmitWrite: (text: string) => void;
  onToggleHelp: () => void;
}

export function ConversationControls({
  machineState,
  writeOpen,
  helpOpen,
  audioLevel,
  onSpeak,
  onCancelRecording,
  onOpenWrite,
  onCloseWrite,
  onSubmitWrite,
  onToggleHelp,
}: ConversationControlsProps) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const speakPresentation = deriveSpeakButtonPresentation(machineState);
  const responseDisabled =
    machineState !== "waitingForUser" &&
    machineState !== "writing" &&
    machineState !== "transcribing";
  const captureIndicatorState =
    machineState === "requestingMicrophone"
      ? "requesting"
      : machineState === "listening"
        ? "listening"
        : machineState === "recording"
          ? "recording"
          : machineState === "processingAudio"
            ? "processing"
            : machineState === "transcribing"
              ? "transcribing"
            : null;

  useEffect(() => {
    if (writeOpen) {
      textareaRef.current?.focus();
    } else {
      setDraft("");
    }
  }, [writeOpen]);

  const submit = () => {
    const value = draft.trim();
    if (!value) {
      return;
    }
    onSubmitWrite(value);
    setDraft("");
  };

  return (
    <div className="conversation-controls">
      {captureIndicatorState && (
        <ListeningIndicator
          state={captureIndicatorState}
          level={audioLevel}
          onCancel={onCancelRecording}
        />
      )}
      {writeOpen && (
        <div className="write-composer" id="write-response">
          <div className="write-composer__header">
            <label htmlFor="written-response">Escreva sua resposta</label>
            <button
              type="button"
              className="icon-button"
              onClick={onCloseWrite}
              aria-label="Cancelar resposta escrita"
            >
              <CloseIcon />
            </button>
          </div>
          <textarea
            id="written-response"
            ref={textareaRef}
            rows={2}
            value={draft}
            maxLength={280}
            placeholder="Ex.: Sim, onde fica a retirada de bagagem?"
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onCloseWrite();
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="write-composer__footer">
            <span>Enter para enviar · Shift+Enter para nova linha</span>
            <button
              type="button"
              className="write-composer__send"
              disabled={!draft.trim()}
              onClick={submit}
            >
              <span>Enviar</span>
              <SendIcon />
            </button>
          </div>
        </div>
      )}

      <div className="conversation-controls__buttons">
        <SpeakButton presentation={speakPresentation} onClick={onSpeak} />
        <WriteButton
          disabled={responseDisabled}
          expanded={writeOpen}
          onClick={onOpenWrite}
        />
        <HelpButton expanded={helpOpen} onClick={onToggleHelp} />
      </div>
    </div>
  );
}
