/** Visibility never overrides a manual pause; hidden time is not replayed on return. */
export class Playback {
  desired = false;
  visible = true;
  intersecting = false;
  last: number | null = null;
  get running() { return this.desired && this.visible && this.intersecting; }
  reset() { this.last = null; }
  tick(now: number) {
    if (!this.running) { this.reset(); return 0; }
    const delta = this.last === null ? 0 : Math.max(0, Math.min(.08, (now - this.last) / 1000));
    this.last = now; return delta * 1.7;
  }
}
