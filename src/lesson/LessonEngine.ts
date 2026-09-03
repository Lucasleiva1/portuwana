import { createEmptyHelpUsage, helpLevelByKind, registerHelpUsage } from "./help";
import { parseLesson } from "./lesson.schemas";
import type {
  DialogueNode,
  HelpKind,
  Lesson,
  LessonHelp,
  ConversationMode,
  NpcLine,
  RecoveryKind,
  LessonResolution,
  TurnHelpUsage,
} from "./lesson.types";
import { calculatePowerReward } from "./scoring";

function copyHelpUsage(usage: TurnHelpUsage): TurnHelpUsage {
  return { ...usage };
}

export class LessonEngine {
  #lesson: Lesson | null = null;
  #currentNodeId: string | null = null;
  #currentLineId: string | null = null;
  #helpUsage: TurnHelpUsage = createEmptyHelpUsage();
  #nodeLineCounts = new Map<string, number>();
  #recoveryLineCounts = new Map<RecoveryKind, number>();
  #completed = false;

  constructor(input?: unknown) {
    if (input !== undefined) {
      this.load(input);
    }
  }

  load(input: unknown): Lesson {
    this.#lesson = parseLesson(input);
    this.restart();
    return this.#lesson;
  }

  start(): DialogueNode {
    return this.#requireCurrentNode();
  }

  getLesson(): Lesson {
    if (!this.#lesson) {
      throw new Error("No lesson is loaded");
    }
    return this.#lesson;
  }

  getCurrentNode(): DialogueNode {
    return this.#requireCurrentNode();
  }

  getCurrentLine(): NpcLine {
    if (!this.#currentLineId) {
      throw new Error("No NPC line is selected");
    }
    return this.getLine(this.#currentLineId);
  }

  getLine(lineId: string): NpcLine {
    const line = this.getLesson().lines.find((candidate) => candidate.id === lineId);
    if (!line) {
      throw new Error(`Unknown NPC line: ${lineId}`);
    }
    return line;
  }

  getConversationMode(): ConversationMode {
    const lesson = this.getLesson();
    return this.#requireCurrentNode().mode ?? lesson.defaultMode;
  }

  getTargetPhrase(): string | null {
    return this.#requireCurrentNode().targetPhrase ?? null;
  }

  selectRecoveryLine(kind: RecoveryKind): NpcLine {
    const lineIds = this.getLesson().recoveryLineIds[kind];
    const count = this.#recoveryLineCounts.get(kind) ?? 0;
    const lineId = lineIds[count % lineIds.length];
    if (!lineId) {
      throw new Error(`No recovery line is configured for ${kind}`);
    }
    this.#recoveryLineCounts.set(kind, count + 1);
    this.#currentLineId = lineId;
    return this.getCurrentLine();
  }

  current(): DialogueNode | null {
    if (!this.#lesson || !this.#currentNodeId) {
      return null;
    }

    return this.#lesson.nodes.find((node) => node.id === this.#currentNodeId) ?? null;
  }

  getCurrentTurn(): number {
    const lesson = this.getLesson();
    const index = lesson.nodes.findIndex((node) => node.id === this.#currentNodeId);
    return index >= 0 ? index + 1 : 0;
  }

  getTotalTurns(): number {
    return this.getLesson().nodes.length;
  }

  getHelpUsage(): TurnHelpUsage {
    return copyHelpUsage(this.#helpUsage);
  }

  recordHelp(kind: HelpKind): TurnHelpUsage {
    this.#helpUsage = registerHelpUsage(this.#helpUsage, kind);
    return this.getHelpUsage();
  }

  getHelp(kind: HelpKind): LessonHelp {
    const node = this.#requireCurrentNode();
    const line = this.getCurrentLine();
    const fallback = "Tente responder com suas próprias palavras.";
    const textByKind: Readonly<Record<HelpKind, string>> = {
      replay: line.text,
      slower: line.slowText ?? line.text,
      hint: node.hint ?? fallback,
      translation: line.translation ?? "Tradução ainda não disponível.",
      example: node.exampleAnswers?.[0] ?? fallback,
    };

    return { kind, level: helpLevelByKind[kind], text: textByKind[kind] };
  }

  resolveIntent(intent: string): LessonResolution {
    const node = this.#requireCurrentNode();
    const accepted = node.acceptedIntents.includes(intent);
    const targetNodeId = accepted
      ? (node.transitions[intent] ?? node.id)
      : (node.fallbackNodeId ?? node.id);
    const moved = targetNodeId !== node.id;
    const status = !accepted ? "unknown" : moved ? "advanced" : "retry";
    const helpUsage = this.getHelpUsage();
    const reward = calculatePowerReward({
      status,
      highestHelpLevel: helpUsage.highestLevel,
      maxReward: node.powerReward,
    });

    this.#currentNodeId = targetNodeId;
    if (accepted) {
      this.#selectNodeLine(this.#requireCurrentNode());
    }
    if (moved) {
      this.#helpUsage = createEmptyHelpUsage();
    }

    return {
      status,
      intent,
      fromNodeId: node.id,
      toNodeId: targetNodeId,
      reward,
      helpUsage,
    };
  }

  isAtTerminalNode(): boolean {
    return this.#requireCurrentNode().terminal === true;
  }

  complete(): void {
    if (!this.isAtTerminalNode()) {
      throw new Error("The lesson cannot complete before its terminal node");
    }
    this.#completed = true;
  }

  isCompleted(): boolean {
    return this.#completed;
  }

  restart(): DialogueNode {
    const lesson = this.getLesson();
    this.#currentNodeId = lesson.startNodeId;
    this.#currentLineId = null;
    this.#helpUsage = createEmptyHelpUsage();
    this.#nodeLineCounts.clear();
    this.#recoveryLineCounts.clear();
    this.#completed = false;
    const node = this.#requireCurrentNode();
    this.#selectNodeLine(node);
    return node;
  }

  jumpToNode(nodeId: string): DialogueNode {
    const lesson = this.getLesson();
    const node = lesson.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      throw new Error(`Unknown lesson node: ${nodeId}`);
    }
    this.#currentNodeId = node.id;
    this.#selectNodeLine(node);
    this.#helpUsage = createEmptyHelpUsage();
    this.#completed = false;
    return node;
  }

  #requireCurrentNode(): DialogueNode {
    const node = this.current();
    if (!node) {
      throw new Error("No lesson is loaded");
    }
    return node;
  }

  #selectNodeLine(node: DialogueNode): NpcLine {
    const count = this.#nodeLineCounts.get(node.id) ?? 0;
    const lineId = node.lineIds[count % node.lineIds.length];
    if (!lineId) {
      throw new Error(`Dialogue node ${node.id} has no lines`);
    }
    this.#nodeLineCounts.set(node.id, count + 1);
    this.#currentLineId = lineId;
    return this.getCurrentLine();
  }
}
