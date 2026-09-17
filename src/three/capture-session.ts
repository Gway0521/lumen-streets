import type { TrafficRecipe } from "./contracts.ts";

interface CaptureLayer {
  traffic?: { snapshot(): TrafficRecipe<number>; restore(value: TrafficRecipe<number>): void };
  time: number;
  accumulator: number;
  playing: boolean;
  capturing: boolean;
}
interface CaptureStream { locked: boolean; generation: number }
type CaptureState = { phase: "idle" } | {
  phase: "capturing";
  time: number;
  accumulator: number;
  playing: boolean;
  traffic?: TrafficRecipe<number>;
};

/** A capture owns one checkpoint, even when encoding fails or is cancelled. */
export class CaptureSession {
  private state: CaptureState = { phase: "idle" };
  private layer: CaptureLayer;
  private stream: CaptureStream;
  constructor(layer: CaptureLayer, stream: CaptureStream) { this.layer = layer; this.stream = stream; }
  begin(): void {
    if (this.state.phase !== "idle" || this.stream.locked) throw Error("Capture already active");
    this.state = { phase: "capturing", time: this.layer.time, accumulator: this.layer.accumulator,
      playing: this.layer.playing, traffic: this.layer.traffic?.snapshot() };
    this.stream.locked = true;
    this.stream.generation++;
    this.layer.capturing = true;
    this.layer.playing = false;
  }
  restore(): void {
    if (this.state.phase !== "capturing") return;
    const state = this.state;
    try {
      if (state.traffic) this.layer.traffic?.restore(state.traffic);
    } finally {
      this.layer.time = state.time;
      this.layer.accumulator = state.accumulator;
      this.layer.playing = state.playing;
      this.layer.capturing = false;
      this.stream.locked = false;
      this.state = { phase: "idle" };
    }
  }
}
