import { Music, MusicStatus } from './music';

export class AudioEngine {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private master: GainNode | null = null;
  private oscillator: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private music: Music | null = null;
  private soundEnabled = true;
  private musicEnabled = true;
  private active = false;
  private background = false;
  private disposed = false;
  private wanted = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private resuming: Promise<void> | null = null;
  private blocked = false;
  private chimes = new Set<OscillatorNode>();
  onStatus: (status: MusicStatus | 'blocked') => void = () => {};
  private visibility = () => this.setBackground(document.hidden);
  private blur = () => this.setBackground(true);
  private focus = () => this.setBackground(document.hidden);
  private hide = (event: PageTransitionEvent) => {
    if (event.persisted) this.setBackground(true);
    else this.dispose();
  };
  constructor() {
    document.addEventListener('visibilitychange', this.visibility);
    addEventListener('blur', this.blur);
    addEventListener('focus', this.focus);
    addEventListener('pagehide', this.hide);
    addEventListener('pageshow', this.focus);
  }
  get enabled() {
    return this.soundEnabled;
  }
  set enabled(value: boolean) {
    this.soundEnabled = value;
    this.reconcile();
  }
  setMusicEnabled(value: boolean) {
    this.musicEnabled = value;
    this.music?.setEnabled(value);
    if (value && this.enabled && this.active) this.music?.load();
  }
  /** Only called from an existing explicit user action; never on initial page load. */
  start() {
    if (this.disposed || !this.enabled) return;
    try {
      if (!this.context) {
        const ctx = (this.context = new AudioContext());
        this.master = ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(ctx.destination);
        this.gain = ctx.createGain();
        this.gain.gain.value = 0;
        this.gain.connect(this.master);
        this.oscillator = ctx.createOscillator();
        this.oscillator.type = 'triangle';
        this.oscillator.frequency.value = 42;
        const filter = (this.filter = ctx.createBiquadFilter());
        filter.type = 'lowpass';
        filter.frequency.value = 180;
        this.oscillator.connect(filter);
        filter.connect(this.gain);
        this.oscillator.start();
        this.music = new Music(ctx, this.master, (status) =>
          this.onStatus(this.blocked ? 'blocked' : status),
        );
        this.music.setEnabled(this.musicEnabled);
      }
      this.blocked = false;
      this.reconcile(true);
      this.music?.load();
    } catch {
      this.blocked = true;
      this.onStatus('blocked');
    }
  }
  setActivity(active: boolean) {
    this.active = active;
    this.reconcile();
  }
  private setBackground(value: boolean) {
    this.background = value;
    this.reconcile();
  }
  private reconcile(gesture = false) {
    const ctx = this.context;
    if (!ctx || !this.master || this.disposed) return;
    const wanted = this.enabled && this.active && !this.background && !document.hidden;
    if (this.wanted === wanted && !gesture) return;
    this.wanted = wanted;
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    const t = ctx.currentTime;
    this.master.gain.cancelAndHoldAtTime(t);
    this.master.gain.setTargetAtTime(wanted ? 1 : 0, t, 0.045);
    if (wanted && !this.blocked) {
      if (!this.resuming) {
        this.resuming = ctx
          .resume()
          .then(() => {
            if (!this.disposed && ctx.state === 'running')
              this.onStatus(this.music?.observe().status ?? 'idle');
          })
          .catch(() => {
            this.blocked = true;
            this.onStatus('blocked');
          })
          .finally(() => {
            this.resuming = null;
            // A pending resume must not undo a later mute/background transition.
            if (!this.wanted && !this.disposed) void ctx.suspend().catch(() => {});
          });
      }
    } else {
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        if (!this.wanted && !this.disposed) void ctx.suspend().catch(() => {});
      }, 280);
    }
  }
  update(speed: number, active: boolean, walking: boolean, opening = false) {
    this.setActivity(active || opening);
    if (!this.context || !this.gain || !this.oscillator) return;
    const t = this.context.currentTime;
    this.gain.gain.setTargetAtTime(
      this.enabled && active
        ? walking
          ? 0.003
          : 0.015 + Math.min(Math.abs(speed) / 1100, 1) * 0.035
        : 0,
      t,
      0.2,
    );
    this.oscillator.frequency.setTargetAtTime(
      walking ? 33 : 38 + Math.min(Math.abs(speed), 1000) * 0.08,
      t,
      0.2,
    );
  }
  chime() {
    if (!this.context || !this.master || !this.enabled || this.disposed) return;
    this.music?.duck();
    const ctx = this.context,
      g = ctx.createGain(),
      o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(330, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.3);
    g.gain.setValueAtTime(0.04, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
    o.connect(g);
    g.connect(this.master);
    this.chimes.add(o);
    o.start();
    o.stop(ctx.currentTime + 0.7);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
      this.chimes.delete(o);
    };
  }
  observe() {
    return {
      context: this.context?.state ?? 'not-created',
      time: this.context?.currentTime ?? 0,
      enabled: this.enabled,
      musicEnabled: this.musicEnabled,
      wanted: this.wanted,
      blocked: this.blocked,
      chimes: this.chimes.size,
      music: this.music?.observe() ?? null,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.music?.dispose();
    this.oscillator?.stop();
    this.oscillator?.disconnect();
    this.filter?.disconnect();
    this.gain?.disconnect();
    this.master?.disconnect();
    for (const chime of this.chimes) chime.stop();
    if (this.context) void this.context.close().catch(() => {});
    document.removeEventListener('visibilitychange', this.visibility);
    removeEventListener('blur', this.blur);
    removeEventListener('focus', this.focus);
    removeEventListener('pagehide', this.hide);
    removeEventListener('pageshow', this.focus);
  }
}
