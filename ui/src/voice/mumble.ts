// The Mumble protocol as the browser speaks it through the voice gateway: one whole TCP message (6-byte header
// plus protobuf body) per WebSocket frame, with voice in UDPTunnel messages in the legacy (1.4) packet format.
// Only the fields the talk panel reads are decoded. No imports, so `node --test` can load this file directly.

export const MSG = {
  UDPTunnel: 1,
  Ping: 3,
  Reject: 4,
  ServerSync: 5,
  ChannelRemove: 6,
  ChannelState: 7,
  UserRemove: 8,
  UserState: 9,
  PermissionDenied: 12,
} as const;

const OPUS = 4;
const TERMINATOR = 0x2000;

export function frame(type: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(6 + body.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, type);
  view.setUint32(2, body.length);
  out.set(body, 6);
  return out;
}

export function unframe(
  data: Uint8Array,
): { type: number; body: Uint8Array } | null {
  if (data.length < 6) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = view.getUint32(2);
  if (length !== data.length - 6) return null;
  return { type: view.getUint16(0), body: data.subarray(6) };
}

// ---- protobuf
type Field = number | Uint8Array;
export type Fields = Map<number, Field[]>;

function pbVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

// Varint fields only, which is all the browser sends
export function pbEncode(fields: [number, number][]): Uint8Array {
  const out: number[] = [];
  for (const [field, value] of fields) {
    pbVarint(out, field * 8);
    pbVarint(out, value);
  }
  return Uint8Array.from(out);
}

export function pbDecode(bytes: Uint8Array): Fields {
  const fields: Fields = new Map();
  let pos = 0;
  const varint = (): number => {
    let value = 0;
    let scale = 1;
    for (;;) {
      if (pos >= bytes.length) throw new Error("truncated varint");
      const b = bytes[pos++];
      value += (b & 0x7f) * scale;
      if (b < 0x80) return value;
      scale *= 0x80;
    }
  };
  while (pos < bytes.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    let value: Field;
    switch (tag & 7) {
      case 0:
        value = varint();
        break;
      case 1:
        pos += 8;
        continue;
      case 2: {
        const length = varint();
        if (pos + length > bytes.length) throw new Error("truncated field");
        value = bytes.subarray(pos, pos + length);
        pos += length;
        break;
      }
      case 5:
        pos += 4;
        continue;
      default:
        throw new Error(`wire type ${tag & 7}`);
    }
    const list = fields.get(field);
    if (list) list.push(value);
    else fields.set(field, [value]);
  }
  return fields;
}

const text = new TextDecoder();
// The last occurrence wins, as protobuf has it for singular fields
const last = (f: Fields, n: number): Field | undefined => {
  const list = f.get(n);
  return list?.[list.length - 1];
};
const num = (f: Fields, n: number): number | undefined => {
  const v = last(f, n);
  return typeof v === "number" ? v : undefined;
};
const str = (f: Fields, n: number): string | undefined => {
  const v = last(f, n);
  return v instanceof Uint8Array ? text.decode(v) : undefined;
};
const bool = (f: Fields, n: number): boolean | undefined => {
  const v = num(f, n);
  return v === undefined ? undefined : v !== 0;
};

// Each message as the fields that are present: an update carries only what changed
export interface ChannelUpdate {
  id: number;
  parent?: number;
  name?: string;
  canEnter?: boolean;
}

export interface UserUpdate {
  session: number;
  name?: string;
  channel?: number;
  mute?: boolean;
  suppress?: boolean;
}

export const channelState = (f: Fields): ChannelUpdate => ({
  id: num(f, 1) ?? 0,
  parent: num(f, 2),
  name: str(f, 3),
  canEnter: bool(f, 13),
});

export const userState = (f: Fields): UserUpdate => ({
  session: num(f, 1) ?? 0,
  name: str(f, 3),
  channel: num(f, 5),
  mute: bool(f, 6),
  suppress: bool(f, 8),
});

export const serverSync = (f: Fields) => ({ session: num(f, 1) ?? 0 });
export const channelRemove = (f: Fields) => ({ id: num(f, 1) ?? 0 });
export const userRemove = (f: Fields) => ({
  session: num(f, 1) ?? 0,
  reason: str(f, 3) ?? "",
});
export const reject = (f: Fields) => ({ reason: str(f, 2) ?? "" });
export const permissionDenied = (f: Fields) => ({
  reason: str(f, 4) ?? "",
  type: num(f, 5) ?? 0,
});

export const ping = (now: number) => frame(MSG.Ping, pbEncode([[1, now]]));
export const moveTo = (session: number, channel: number) =>
  frame(
    MSG.UserState,
    pbEncode([
      [1, session],
      [5, channel],
    ]),
  );

// ---- Mumble's own varint, used inside voice packets (PacketDataStream)
export function mvEncode(value: number): number[] {
  if (value < 0x80) return [value];
  if (value < 0x4000) return [(value >> 8) | 0x80, value & 0xff];
  if (value < 0x200000)
    return [(value >> 16) | 0xc0, (value >> 8) & 0xff, value & 0xff];
  if (value < 0x10000000)
    return [
      (value >>> 24) | 0xe0,
      (value >> 16) & 0xff,
      (value >> 8) & 0xff,
      value & 0xff,
    ];
  return [
    0xf0,
    (value >>> 24) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ];
}

// [value, bytes read]; only the non-negative forms that carry sessions, sequences and lengths
export function mvDecode(b: Uint8Array, at: number): [number, number] {
  const first = b[at];
  if (first === undefined) throw new Error("truncated");
  const need = (n: number) => {
    if (at + n > b.length) throw new Error("truncated");
  };
  if (first < 0x80) return [first, 1];
  if (first < 0xc0) {
    need(2);
    return [((first & 0x3f) << 8) | b[at + 1], 2];
  }
  if (first < 0xe0) {
    need(3);
    return [((first & 0x1f) << 16) | (b[at + 1] << 8) | b[at + 2], 3];
  }
  if (first < 0xf0) {
    need(4);
    return [
      (first & 0x0f) * 0x1000000 +
        ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]),
      4,
    ];
  }
  if ((first & 0xfc) === 0xf0) {
    need(5);
    return [
      b[at + 1] * 0x1000000 +
        ((b[at + 2] << 16) | (b[at + 3] << 8) | b[at + 4]),
      5,
    ];
  }
  throw new Error("unsupported varint");
}

// One Opus packet to the current net (target 0), tunnelled over TCP
export function voicePacket(
  sequence: number,
  opus: Uint8Array,
  last: boolean,
): Uint8Array {
  const head = [
    OPUS << 5,
    ...mvEncode(sequence),
    ...mvEncode(opus.length | (last ? TERMINATOR : 0)),
  ];
  const packet = new Uint8Array(head.length + opus.length);
  packet.set(head);
  packet.set(opus, head.length);
  return frame(MSG.UDPTunnel, packet);
}

export interface Voice {
  session: number;
  opus: Uint8Array;
  last: boolean;
}

// A voice packet from the server; null for anything that is not Opus, and for a key-up, which a phone sends ahead
// of a press's audio: no terminator and a payload of one byte or none. Such a payload is no audio (a lone TOC byte
// decodes as concealment of the speaker's last transmission), so a terminator's comes back empty.
export function parseVoice(packet: Uint8Array): Voice | null {
  if (packet.length < 1 || packet[0] >> 5 !== OPUS) return null;
  let at = 1;
  const [session, n1] = mvDecode(packet, at);
  at += n1;
  const [, n2] = mvDecode(packet, at); // sequence
  at += n2;
  const [header, n3] = mvDecode(packet, at);
  at += n3;
  const size = header & 0x1fff;
  const last = (header & TERMINATOR) !== 0;
  if (at + size > packet.length || (size <= 1 && !last)) return null;
  return {
    session,
    opus: packet.subarray(at, size > 1 ? at + size : at),
    last,
  };
}
