const CHIME_DURATION_SECONDS = 0.32;
const CHIME_FREQUENCY_HERTZ = 880;
const CHIME_VOLUME = 0.24;
const DEFAULT_VOLUME_PERCENT = 100;

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

  play(volumePercent = DEFAULT_VOLUME_PERCENT): void {
    const context = this.getAudioContext();
    if (!context) return;
    const volume = CHIME_VOLUME * normalizeVolumePercent(volumePercent);

    try {
      if (context.state === "running") {
        if (volume > 0) this.scheduleChime(context, volume);
      } else if (context.state === "suspended") {
        void context.resume().then(() => {
          if (volume > 0) this.scheduleChime(context, volume);
        }, () => {});
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

  private scheduleChime(context: AudioContext, volume: number): void {
    if (context.state !== "running") return;

    let oscillator: OscillatorNode | undefined;
    let gain: GainNode | undefined;
    try {
      const now = context.currentTime;
      oscillator = context.createOscillator();
      gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(CHIME_FREQUENCY_HERTZ, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + CHIME_DURATION_SECONDS,
      );
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator?.disconnect();
        gain?.disconnect();
      };
      oscillator.start(now);
      oscillator.stop(now + CHIME_DURATION_SECONDS);
    } catch {
      oscillator?.disconnect();
      gain?.disconnect();
    }
  }
}

let defaultTerminalNotificationSound: TerminalNotificationSound | null = null;

export function playTerminalNotificationSound(volumePercent?: number): void {
  (defaultTerminalNotificationSound ??= new TerminalNotificationSound()).play(
    volumePercent,
  );
}

export function __resetTerminalNotificationSoundForTests(): void {
  defaultTerminalNotificationSound = null;
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
