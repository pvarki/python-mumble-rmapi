// A browser voice session: a ticket from mumblermapi, a WebSocket to the voice gateway, and Mumble through it.
// React reads it with useSyncExternalStore; every change replaces the snapshot.
import { Microphone, Speakers, audioContext, voiceSupported } from "./audio";
import * as m from "./mumble";

const TOKEN_URL = "/ui/mumble/api/v1/voice/token";
const WS_PATH = "/ui/mumble/ws";
const PING_MS = 10000;
// A speaker counts as talking until this long after their last packet
const TALK_HOLD_MS = 300;
// Sequence numbers count 10 ms frames; each packet carries 20 ms
const FRAMES_PER_PACKET = 2;

export interface Net {
  id: number;
  parent: number;
  name: string;
  canEnter: boolean;
}

export interface Person {
  session: number;
  name: string;
  channel: number;
  mute: boolean;
  suppress: boolean;
}

export type Failure =
  | "unsupported" // no WebCodecs Opus in this browser
  | "mic" // no microphone, or permission refused
  | "unknown" // mumblermapi has not heard of this callsign yet
  | "refused" // revoked, or voice turned off
  | "rejected" // Murmur refused the login
  | "kicked" // disconnected by the server
  | "lost" // the connection dropped
  | "failed"; // anything else

export interface Snapshot {
  phase: "idle" | "connecting" | "connected";
  failure: Failure | null;
  detail: string; // the server's words, where it gave any
  self: number | null;
  nets: ReadonlyMap<number, Net>;
  people: ReadonlyMap<number, Person>;
  talking: ReadonlySet<number>;
  transmitting: boolean;
  denied: string | null; // why the last move was refused; "" when Murmur gave no reason
}

const IDLE: Snapshot = {
  phase: "idle",
  failure: null,
  detail: "",
  self: null,
  nets: new Map(),
  people: new Map(),
  talking: new Set(),
  transmitting: false,
  denied: null,
};

class Stop extends Error {
  constructor(
    readonly failure: Failure,
    readonly detail = "",
  ) {
    super(failure);
  }
}

async function fetchTicket(slot: number): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slot }),
  });
  if (response.status === 404) throw new Stop("unknown");
  if (response.status === 403) throw new Stop("refused");
  if (!response.ok) throw new Stop("failed", `HTTP ${response.status}`);
  const body = (await response.json()) as { ticket: string };
  return body.ticket;
}

export class VoiceClient {
  private snapshot: Snapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private mic: Microphone | null = null;
  private speakers: Speakers | null = null;
  private pinger = 0;
  private readonly talkTimers = new Map<number, number>();
  private sequence = 0;
  // Each packet is held until the next, so the last of a transmission can carry the terminator
  private held: Uint8Array | null = null;
  private stopping: Promise<void> = Promise.resolve();
  private generation = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  private set(change: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((l) => l());
  }

  // Must be called from a click: browsers unlock audio only inside a user gesture.
  async connect(slot: number): Promise<void> {
    if (this.snapshot.phase !== "idle") return;
    const generation = ++this.generation;
    this.set({ ...IDLE, phase: "connecting" });
    const ctx = audioContext();
    this.ctx = ctx;
    try {
      void ctx.resume();
      if (!(await voiceSupported())) throw new Stop("unsupported");
      let mic: Microphone;
      try {
        mic = await Microphone.open(ctx, (opus) => this.sendVoice(opus));
      } catch (e) {
        throw new Stop("mic", e instanceof Error ? e.message : "");
      }
      // Closed while the browser asked for the microphone: the teardown missed it, so let go of it here
      if (generation !== this.generation) {
        mic.close();
        return;
      }
      this.mic = mic;
      this.speakers = new Speakers(ctx);
      const ticket = await fetchTicket(slot);
      if (generation !== this.generation) return;
      this.open(ticket, generation);
    } catch (e) {
      if (generation !== this.generation) return;
      this.end(
        e instanceof Stop ? e.failure : "failed",
        e instanceof Stop ? e.detail : String(e),
      );
    }
  }

  private open(ticket: string, generation: number): void {
    const ws = new WebSocket(`wss://${location.host}${WS_PATH}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      ws.send(ticket);
      this.pinger = window.setInterval(
        () => this.send(m.ping(Date.now())),
        PING_MS,
      );
    };
    ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (generation === this.generation) this.receive(new Uint8Array(e.data));
    };
    ws.onclose = (e) => {
      if (generation !== this.generation) return;
      this.end(
        this.snapshot.phase === "connected" ? "lost" : "failed",
        e.reason,
      );
    };
  }

  private send(data: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  private receive(data: Uint8Array): void {
    const message = m.unframe(data);
    if (!message) return;
    const { type, body } = message;
    if (type === m.MSG.UDPTunnel) {
      this.hear(body);
      return;
    }
    let f: m.Fields;
    try {
      f = m.pbDecode(body);
    } catch {
      return;
    }
    switch (type) {
      case m.MSG.ServerSync:
        this.set({ phase: "connected", self: m.serverSync(f).session });
        break;
      case m.MSG.ChannelState: {
        const u = m.channelState(f);
        const nets = new Map(this.snapshot.nets);
        const was = nets.get(u.id);
        nets.set(u.id, {
          id: u.id,
          parent: u.parent ?? was?.parent ?? 0,
          name: u.name ?? was?.name ?? "",
          canEnter: u.canEnter ?? was?.canEnter ?? true,
        });
        this.set({ nets });
        break;
      }
      case m.MSG.ChannelRemove: {
        const nets = new Map(this.snapshot.nets);
        nets.delete(m.channelRemove(f).id);
        this.set({ nets });
        break;
      }
      case m.MSG.UserState: {
        const u = m.userState(f);
        const people = new Map(this.snapshot.people);
        const was = people.get(u.session);
        people.set(u.session, {
          session: u.session,
          name: u.name ?? was?.name ?? "",
          channel: u.channel ?? was?.channel ?? 0,
          mute: u.mute ?? was?.mute ?? false,
          suppress: u.suppress ?? was?.suppress ?? false,
        });
        // A move clears a refusal shown for the previous attempt
        const denied =
          u.session === this.snapshot.self && u.channel !== undefined
            ? null
            : this.snapshot.denied;
        this.set({ people, denied });
        break;
      }
      case m.MSG.UserRemove: {
        const { session, reason } = m.userRemove(f);
        if (session === this.snapshot.self) {
          this.end("kicked", reason);
          return;
        }
        const people = new Map(this.snapshot.people);
        people.delete(session);
        this.speakers?.forget(session);
        this.set({ people });
        break;
      }
      case m.MSG.Reject:
        this.end("rejected", m.reject(f).reason);
        break;
      case m.MSG.PermissionDenied:
        this.set({ denied: m.permissionDenied(f).reason });
        break;
    }
  }

  private hear(packet: Uint8Array): void {
    const voice = m.parseVoice(packet);
    if (!voice) return;
    this.speakers?.play(voice.session, voice.opus);
    window.clearTimeout(this.talkTimers.get(voice.session));
    if (voice.last) {
      this.talkTimers.delete(voice.session);
      this.setTalking(voice.session, false);
      return;
    }
    this.talkTimers.set(
      voice.session,
      window.setTimeout(
        () => this.setTalking(voice.session, false),
        TALK_HOLD_MS,
      ),
    );
    this.setTalking(voice.session, true);
  }

  private setTalking(session: number, on: boolean): void {
    if (this.snapshot.talking.has(session) === on) return;
    const talking = new Set(this.snapshot.talking);
    if (on) talking.add(session);
    else talking.delete(session);
    this.set({ talking });
  }

  private sendVoice(opus: Uint8Array): void {
    if (this.held) {
      this.send(m.voicePacket(this.sequence, this.held, false));
      this.sequence += FRAMES_PER_PACKET;
    }
    this.held = opus;
  }

  join(net: number): void {
    const { self } = this.snapshot;
    if (self !== null) this.send(m.moveTo(self, net));
  }

  // Push-to-talk. Releasing sends what is still being encoded, the last packet marked as the end.
  talk(on: boolean): void {
    if (on === this.snapshot.transmitting) return;
    if (on && this.snapshot.phase !== "connected") return;
    const mic = this.mic;
    if (!mic) return;
    this.set({ transmitting: on });
    if (on) {
      void this.stopping.then(() => {
        if (this.snapshot.transmitting && this.mic === mic) mic.start();
      });
      return;
    }
    this.stopping = mic.stop().then(() => {
      if (this.held) {
        this.send(m.voicePacket(this.sequence, this.held, true));
        this.sequence += FRAMES_PER_PACKET;
        this.held = null;
      }
    });
  }

  disconnect(): void {
    this.generation++;
    this.teardown();
    this.set(IDLE);
  }

  private end(failure: Failure, detail: string): void {
    this.generation++;
    this.teardown();
    this.set({ ...IDLE, failure, detail });
  }

  private teardown(): void {
    window.clearInterval(this.pinger);
    this.talkTimers.forEach((t) => window.clearTimeout(t));
    this.talkTimers.clear();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.mic?.close();
    this.mic = null;
    this.speakers?.close();
    this.speakers = null;
    void this.ctx?.close();
    this.ctx = null;
    this.held = null;
  }
}
