/**
 * Finds speech in the microphone's loudness, on the phone, so only the moments someone speaks are recorded
 * and sent for speech-to-text (silence never leaves the phone). Pure logic, fed one level reading at a time
 * (tested in speechDetector.test.ts).
 *
 * The background noise level (gym music, machines) is learned as it goes; speech is a level clearly above it
 * for a moment, and it ends after a short quiet stretch.
 */

export interface DetectorOptions {
  /** dB above the background that counts as speech */
  startAboveDb: number;
  /** dB above the background below which it's quiet again */
  stopAboveDb: number;
  /** anything quieter than this is never speech (dBFS) */
  minLevelDb: number;
  /** speech must last this long to count (ignores clanks and coughs) */
  minSpeechMs: number;
  /** this long quiet ends the utterance */
  endSilenceMs: number;
  /** longer than this isn't a command (music, someone talking on and on): dropped, and learned as background */
  maxSpeechMs: number;
  /** after starting, only learn the background for this long */
  warmupMs: number;
}

export const DEFAULT_DETECTOR: DetectorOptions = {
  startAboveDb: 12,
  stopAboveDb: 6,
  minLevelDb: -55,
  minSpeechMs: 250,
  endSilenceMs: 900,
  maxSpeechMs: 12_000,
  warmupMs: 1000,
};

export type DetectorEvent =
  | { type: "speech_start"; at: number }
  /** an utterance worth sending: from `startedAt` to `at` */
  | { type: "speech_end"; startedAt: number; at: number }
  /** too short or too long to be a command: drop the recording */
  | { type: "discard"; at: number };

export class SpeechDetector {
  noiseFloor: number;
  private loudSince: number | null = null;
  private quietSince: number | null = null;
  private speechStart: number | null = null;
  private firstAt: number | null = null;
  private warmup: number[] = [];
  private speechLevels: number[] = [];
  private readonly o: DetectorOptions;

  constructor(options: Partial<DetectorOptions> = {}, initialFloor = -60) {
    this.o = { ...DEFAULT_DETECTOR, ...options };
    this.noiseFloor = initialFloor;
  }

  get inSpeech(): boolean {
    return this.speechStart != null;
  }

  /** Forget everything (e.g. after the app spoke, or a new recording started). */
  reset(at: number) {
    this.loudSince = null;
    this.quietSince = null;
    this.speechStart = null;
    this.speechLevels = [];
    void at;
  }

  feed(levelDb: number, now: number): DetectorEvent | null {
    const level = Number.isFinite(levelDb) ? Math.max(-160, levelDb) : -160;
    this.firstAt ??= now;
    if (now - this.firstAt < this.o.warmupMs) {
      this.warmup.push(level);
      this.noiseFloor = this.warmup.reduce((a, b) => a + b, 0) / this.warmup.length;
      return null;
    }
    const loud = level >= Math.max(this.noiseFloor + this.o.startAboveDb, this.o.minLevelDb);
    const quiet = level < Math.max(this.noiseFloor + this.o.stopAboveDb, this.o.minLevelDb);

    if (this.speechStart == null) {
      // learn the background: follow it down quickly, up slowly (so speech doesn't raise it much)
      this.noiseFloor = level < this.noiseFloor ? 0.7 * this.noiseFloor + 0.3 * level : this.noiseFloor + 0.02 * (level - this.noiseFloor);
      if (!loud) {
        this.loudSince = null;
        return null;
      }
      this.loudSince ??= now;
      if (now - this.loudSince >= this.o.minSpeechMs) {
        this.speechStart = this.loudSince;
        this.quietSince = null;
        return { type: "speech_start", at: this.speechStart };
      }
      return null;
    }

    const startedAt = this.speechStart;
    this.speechLevels.push(level);
    if (now - startedAt >= this.o.maxSpeechMs) {
      // not a command: most likely the background got louder (music turned up)
      const sorted = [...this.speechLevels].sort((a, b) => a - b);
      this.noiseFloor = sorted[Math.floor(sorted.length / 2)];
      this.reset(now);
      return { type: "discard", at: now };
    }
    if (quiet) {
      this.quietSince ??= now;
      if (now - this.quietSince >= this.o.endSilenceMs) {
        const end = this.quietSince;
        this.reset(now);
        return end - startedAt >= this.o.minSpeechMs ? { type: "speech_end", startedAt, at: end } : { type: "discard", at: now };
      }
    } else {
      this.quietSince = null;
    }
    return null;
  }
}
