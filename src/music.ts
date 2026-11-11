import musicUrl from '../assets/music/a-light-beyond.mp3?url';

export type MusicStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/** Keep fades portable when the newer hold API is absent (e.g. older engines). */
export function holdGain(param: AudioParam, time: number) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(time);
  } else {
    const current = param.value;
    param.cancelScheduledValues(time);
    param.setValueAtTime(current, time);
  }
}

/** One decoded score and one looping source per audio engine, loaded after a gesture. */
export class Music {
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private controller: AbortController | null = null;
  private loading: Promise<void> | null = null;
  private disposed = false;
  private enabled = true;
  private status: MusicStatus = 'idle';
  readonly gain: GainNode;
  constructor(
    private context: AudioContext,
    destination: AudioNode,
    private onStatus: (status: MusicStatus) => void,
  ) {
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(destination);
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    const t = this.context.currentTime;
    holdGain(this.gain.gain, t);
    this.gain.gain.setTargetAtTime(enabled && this.source ? 0.45 : 0, t, 0.25);
  }
  load() {
    if (
      this.disposed ||
      !this.enabled ||
      this.buffer ||
      this.loading ||
      this.status === 'unavailable'
    )
      return;
    this.status = 'loading';
    this.onStatus(this.status);
    const controller = (this.controller = new AbortController());
    const timeout = setTimeout(() => controller.abort(), 20000);
    this.loading = (async () => {
      try {
        const response = await fetch(musicUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(`Music HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 4 * 1024 * 1024) throw new Error('Music exceeds encoded budget');
        if (this.disposed) return;
        const buffer = await this.context.decodeAudioData(bytes);
        if (this.disposed) return;
        if (buffer.duration < 143.9 || buffer.duration > 144.2 || buffer.numberOfChannels !== 2)
          throw new Error('Unexpected music duration/channels');
        this.buffer = buffer;
        const source = (this.source = this.context.createBufferSource());
        source.buffer = buffer;
        source.loop = true;
        source.loopStart = 0;
        source.loopEnd = 144;
        source.connect(this.gain);
        source.start();
        this.setEnabled(this.enabled);
        this.status = 'ready';
        this.onStatus(this.status);
      } catch {
        if (!this.disposed) {
          this.status = 'unavailable';
          this.onStatus(this.status);
        }
      } finally {
        clearTimeout(timeout);
        this.controller = null;
        this.loading = null;
      }
    })();
  }
  duck() {
    if (!this.enabled || !this.source) return;
    const t = this.context.currentTime;
    holdGain(this.gain.gain, t);
    this.gain.gain.linearRampToValueAtTime(0.18, t + 0.04);
    this.gain.gain.setTargetAtTime(0.45, t + 0.65, 0.35);
  }
  observe() {
    return {
      status: this.status,
      sources: this.source ? 1 : 0,
      decodedBytes: this.buffer
        ? this.buffer.length * this.buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT
        : 0,
      duration: this.buffer?.duration ?? 0,
      gain: this.gain.gain.value,
    };
  }
  dispose() {
    this.disposed = true;
    this.controller?.abort();
    this.source?.stop();
    this.source?.disconnect();
    this.source = null;
    this.buffer = null;
    this.gain.disconnect();
  }
}
