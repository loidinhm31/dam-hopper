import type { TerminalCodexNotificationSoundPattern } from "@/api/client.js";

const CHIME_VOLUME = 0.24;
const DEFAULT_VOLUME_PERCENT = 100;
const ATTACK_DURATION_SECONDS = 0.01;
const SILENT_GAIN = 0.0001;

export const DEFAULT_TERMINAL_NOTIFICATION_SOUND_PATTERN =
  "default" satisfies TerminalCodexNotificationSoundPattern;

interface SoundNote {
  frequency: number;
  startOffset: number;
  duration: number;
  gainMultiplier: number;
  waveform: OscillatorType;
}

const SOUND_PATTERNS: Readonly<
  Record<TerminalCodexNotificationSoundPattern, readonly SoundNote[]>
> = {
  default: [
    {
      frequency: 880,
      startOffset: 0,
      duration: 0.32,
      gainMultiplier: 1,
      waveform: "sine",
    },
  ],
  soft: [
    {
      frequency: 660,
      startOffset: 0,
      duration: 0.24,
      gainMultiplier: 0.55,
      waveform: "sine",
    },
  ],
  "two-tone": [
    {
      frequency: 660,
      startOffset: 0,
      duration: 0.15,
      gainMultiplier: 0.8,
      waveform: "sine",
    },
    {
      frequency: 880,
      startOffset: 0.18,
      duration: 0.15,
      gainMultiplier: 0.8,
      waveform: "sine",
    },
  ],
  urgent: [
    {
      frequency: 1046,
      startOffset: 0,
      duration: 0.08,
      gainMultiplier: 1,
      waveform: "square",
    },
    {
      frequency: 1046,
      startOffset: 0.12,
      duration: 0.08,
      gainMultiplier: 1,
      waveform: "square",
    },
    {
      frequency: 1046,
      startOffset: 0.24,
      duration: 0.08,
      gainMultiplier: 1,
      waveform: "square",
    },
  ],
};

export interface TerminalNotificationSoundDependencies {
  createAudioContext?: () => AudioContext | null;
}

export class TerminalNotificationSound {
  private audioContext: AudioContext | null | undefined;
  private readonly createAudioContext: () => AudioContext | null;

  constructor(dependencies: TerminalNotificationSoundDependencies = {}) {
    this.createAudioContext =
      dependencies.createAudioContext ?? createBrowserAudioContext;
  }

  play(volumePercent?: number): void;
  play(
    pattern: TerminalCodexNotificationSoundPattern,
    volumePercent?: number,
  ): void;
  play(
    patternOrVolume:
      | TerminalCodexNotificationSoundPattern
      | number = DEFAULT_TERMINAL_NOTIFICATION_SOUND_PATTERN,
    volumePercent = DEFAULT_VOLUME_PERCENT,
  ): void {
    const pattern =
      typeof patternOrVolume === "number"
        ? DEFAULT_TERMINAL_NOTIFICATION_SOUND_PATTERN
        : patternOrVolume;
    const configuredVolume =
      typeof patternOrVolume === "number" ? patternOrVolume : volumePercent;
    const context = this.getAudioContext();
    if (!context) return;

    const volume = CHIME_VOLUME * normalizeVolumePercent(configuredVolume);
    try {
      if (context.state === "running") {
        if (volume > 0) this.schedulePattern(context, pattern, volume);
      } else if (context.state === "suspended") {
        void context.resume().then(
          () => {
            if (volume > 0) this.schedulePattern(context, pattern, volume);
          },
          () => {},
        );
      }
    } catch {
      // Audio is optional; unsupported and blocked playback must not affect delivery.
    }
  }

  private getAudioContext(): AudioContext | null {
    if (this.audioContext === undefined) {
      try {
        this.audioContext = this.createAudioContext();
      } catch {
        this.audioContext = null;
      }
    }
    return this.audioContext;
  }

  private schedulePattern(
    context: AudioContext,
    pattern: TerminalCodexNotificationSoundPattern,
    volume: number,
  ): void {
    if (context.state !== "running") return;
    for (const note of SOUND_PATTERNS[pattern]) {
      this.scheduleNote(context, note, volume);
    }
  }

  private scheduleNote(
    context: AudioContext,
    note: SoundNote,
    volume: number,
  ): void {
    let oscillator: OscillatorNode | undefined;
    let gain: GainNode | undefined;
    try {
      const startTime = context.currentTime + note.startOffset;
      const endTime = startTime + note.duration;
      oscillator = context.createOscillator();
      gain = context.createGain();
      oscillator.type = note.waveform;
      oscillator.frequency.setValueAtTime(note.frequency, startTime);
      gain.gain.setValueAtTime(SILENT_GAIN, startTime);
      gain.gain.exponentialRampToValueAtTime(
        volume * note.gainMultiplier,
        startTime + ATTACK_DURATION_SECONDS,
      );
      gain.gain.exponentialRampToValueAtTime(SILENT_GAIN, endTime);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => disconnectNodes(oscillator, gain);
      oscillator.start(startTime);
      oscillator.stop(endTime);
    } catch {
      disconnectNodes(oscillator, gain);
    }
  }
}

let defaultTerminalNotificationSound: TerminalNotificationSound | null = null;

export function playTerminalNotificationSound(volumePercent?: number): void;
export function playTerminalNotificationSound(
  pattern: TerminalCodexNotificationSoundPattern,
  volumePercent?: number,
): void;
export function playTerminalNotificationSound(
  patternOrVolume:
    | TerminalCodexNotificationSoundPattern
    | number = DEFAULT_TERMINAL_NOTIFICATION_SOUND_PATTERN,
  volumePercent?: number,
): void {
  const sound = (defaultTerminalNotificationSound ??=
    new TerminalNotificationSound());
  if (typeof patternOrVolume === "number") {
    sound.play(patternOrVolume);
  } else {
    sound.play(patternOrVolume, volumePercent);
  }
}

export function __resetTerminalNotificationSoundForTests(): void {
  defaultTerminalNotificationSound = null;
}

function disconnectNodes(
  oscillator: OscillatorNode | undefined,
  gain: GainNode | undefined,
): void {
  disconnectNode(oscillator);
  disconnectNode(gain);
}

function disconnectNode(node: AudioNode | undefined): void {
  try {
    node?.disconnect();
  } catch {
    // Node teardown is best-effort, like sound playback itself.
  }
}

function createBrowserAudioContext(): AudioContext | null {
  const browserGlobal = globalThis as typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextConstructor =
    browserGlobal.AudioContext ?? browserGlobal.webkitAudioContext;
  return AudioContextConstructor ? new AudioContextConstructor() : null;
}

function normalizeVolumePercent(volumePercent: number): number {
  if (!Number.isFinite(volumePercent)) return 1;
  return Math.min(100, Math.max(0, volumePercent)) / 100;
}
