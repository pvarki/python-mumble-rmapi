// Microphone to Opus and Opus to speakers, with WebCodecs and Web Audio. Mumble speaks 48 kHz mono Opus,
// which the browser encodes and decodes natively; nothing here is a codec of our own.

const RATE = 48000;
const FRAME = 960; // 20 ms, Mumble's usual packet
const OPUS = { codec: "opus", sampleRate: RATE, numberOfChannels: 1 } as const;
// How far ahead incoming audio is scheduled, to ride out network jitter, and how far behind it may fall
// before it is dropped rather than heard late
const JITTER = 0.08;
const MAX_LAG = 0.5;

// Taps the microphone only while push-to-talk is down; the main thread is told nothing otherwise.
const TAP = `registerProcessor("mumble-tap", class extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.port.onmessage = (e) => { this.on = e.data; }; }
  process(inputs) {
    const samples = inputs[0] && inputs[0][0];
    if (this.on && samples) this.port.postMessage(samples.slice(0));
    return true;
  }
});`;

export async function voiceSupported(): Promise<boolean> {
  if (
    typeof AudioEncoder === "undefined" ||
    typeof AudioDecoder === "undefined"
  )
    return false;
  try {
    const [enc, dec] = await Promise.all([
      AudioEncoder.isConfigSupported(OPUS),
      AudioDecoder.isConfigSupported(OPUS),
    ]);
    return Boolean(enc.supported && dec.supported);
  } catch {
    return false;
  }
}

// One audio context for both directions, at Mumble's rate so nothing is resampled twice
export function audioContext(): AudioContext {
  return new AudioContext({ sampleRate: RATE, latencyHint: "interactive" });
}

export class Microphone {
  private buffer = new Float32Array(FRAME);
  private filled = 0;
  private timestamp = 0;

  private constructor(
    private readonly stream: MediaStream,
    private readonly tap: AudioWorkletNode,
    private readonly encoder: AudioEncoder,
  ) {
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => this.take(e.data);
  }

  static async open(
    ctx: AudioContext,
    onPacket: (opus: Uint8Array) => void,
  ): Promise<Microphone> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    try {
      const url = URL.createObjectURL(
        new Blob([TAP], { type: "text/javascript" }),
      );
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const tap = new AudioWorkletNode(ctx, "mumble-tap", {
        numberOfOutputs: 0,
      });
      ctx.createMediaStreamSource(stream).connect(tap);
      const encoder = new AudioEncoder({
        output: (chunk) => {
          const opus = new Uint8Array(chunk.byteLength);
          chunk.copyTo(opus);
          onPacket(opus);
        },
        error: (e) => console.error("Opus encoder", e),
      });
      encoder.configure({ ...OPUS, bitrate: 32000 });
      return new Microphone(stream, tap, encoder);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      throw e;
    }
  }

  private take(samples: Float32Array): void {
    let at = 0;
    while (at < samples.length) {
      const n = Math.min(FRAME - this.filled, samples.length - at);
      this.buffer.set(samples.subarray(at, at + n), this.filled);
      this.filled += n;
      at += n;
      if (this.filled === FRAME) {
        const data = new AudioData({
          format: "f32-planar",
          sampleRate: RATE,
          numberOfFrames: FRAME,
          numberOfChannels: 1,
          timestamp: this.timestamp,
          data: this.buffer,
        });
        this.encoder.encode(data);
        data.close();
        this.timestamp += (FRAME * 1e6) / RATE;
        this.filled = 0;
      }
    }
  }

  start(): void {
    this.filled = 0;
    this.tap.port.postMessage(true);
  }

  // Resolves once every packet of this transmission has been handed over
  async stop(): Promise<void> {
    this.tap.port.postMessage(false);
    this.filled = 0; // a partial frame is under 20 ms; it is dropped
    if (this.encoder.state === "configured") await this.encoder.flush();
  }

  close(): void {
    this.tap.port.postMessage(false);
    this.tap.disconnect();
    if (this.encoder.state !== "closed") this.encoder.close();
    this.stream.getTracks().forEach((t) => t.stop());
  }
}

export class Speakers {
  private readonly decoders = new Map<number, AudioDecoder>();
  private readonly next = new Map<number, number>();
  private readonly timestamps = new Map<number, number>();

  constructor(private readonly ctx: AudioContext) {}

  play(session: number, opus: Uint8Array): void {
    if (opus.length === 0) return;
    let decoder = this.decoders.get(session);
    if (!decoder) {
      decoder = new AudioDecoder({
        output: (data) => this.schedule(session, data),
        error: () => this.decoders.delete(session),
      });
      decoder.configure(OPUS);
      this.decoders.set(session, decoder);
    }
    const timestamp = this.timestamps.get(session) ?? 0;
    this.timestamps.set(session, timestamp + 20000);
    decoder.decode(
      new EncodedAudioChunk({ type: "key", timestamp, data: opus }),
    );
  }

  private schedule(session: number, data: AudioData): void {
    const pcm = new Float32Array(data.numberOfFrames);
    data.copyTo(pcm, { planeIndex: 0, format: "f32-planar" });
    const buffer = this.ctx.createBuffer(
      1,
      data.numberOfFrames,
      data.sampleRate,
    );
    data.close();
    buffer.copyToChannel(pcm, 0);
    const now = this.ctx.currentTime;
    const at = Math.max(this.next.get(session) ?? 0, now + JITTER);
    if (at - now > MAX_LAG) {
      this.next.set(session, now + JITTER);
      return;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.start(at);
    this.next.set(session, at + buffer.duration);
  }

  forget(session: number): void {
    const decoder = this.decoders.get(session);
    if (decoder && decoder.state !== "closed") decoder.close();
    this.decoders.delete(session);
    this.next.delete(session);
    this.timestamps.delete(session);
  }

  close(): void {
    for (const session of [...this.decoders.keys()]) this.forget(session);
  }
}
