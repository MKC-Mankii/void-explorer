export class AudioEngine {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private oscillator: OscillatorNode | null = null;
  enabled = true;
  start() {
    try {
      if (!this.context) {
        const ctx = (this.context = new AudioContext());
        this.gain = ctx.createGain();
        this.gain.gain.value = 0;
        this.gain.connect(ctx.destination);
        this.oscillator = ctx.createOscillator();
        this.oscillator.type = 'triangle';
        this.oscillator.frequency.value = 42;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 180;
        this.oscillator.connect(filter);
        filter.connect(this.gain);
        this.oscillator.start();
      }
      void this.context.resume();
    } catch {
      /* Sound is optional if the browser denies audio. */
    }
  }
  update(speed: number, active: boolean, walking: boolean) {
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
    if (!this.context || !this.enabled) return;
    const ctx = this.context,
      g = ctx.createGain(),
      o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(330, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.3);
    g.gain.setValueAtTime(0.04, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.7);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
}
