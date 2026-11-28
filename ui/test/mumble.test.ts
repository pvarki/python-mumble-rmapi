// The browser's Mumble protocol
import { describe, expect, it } from "vitest";

import {
  MSG,
  channelState,
  frame,
  moveTo,
  mvDecode,
  mvEncode,
  parseVoice,
  pbDecode,
  pbEncode,
  permissionDenied,
  ping,
  reject,
  serverSync,
  unframe,
  userRemove,
  userState,
  voicePacket,
} from "../src/voice/mumble";

const enc = new TextEncoder();
// A protobuf length-delimited field
const ld = (field: number, bytes: Uint8Array) => [
  field * 8 + 2,
  bytes.length,
  ...bytes,
];

describe("frames", () => {
  it("round-trips a message with its 6-byte header", () => {
    const f = frame(9, Uint8Array.of(1, 2, 3));
    expect([...f]).toEqual([0, 9, 0, 0, 0, 3, 1, 2, 3]);
    expect(unframe(f)).toEqual({ type: 9, body: Uint8Array.of(1, 2, 3) });
  });
  it("refuses short or mislabelled frames", () => {
    expect(unframe(Uint8Array.of(0, 1, 0))).toBeNull();
    expect(unframe(Uint8Array.of(0, 1, 0, 0, 0, 5, 1))).toBeNull();
  });
});

describe("protobuf", () => {
  it("encodes varints as protobuf does", () => {
    expect([...pbEncode([[1, 300]])]).toEqual([0x08, 0xac, 0x02]);
    expect([...pbEncode([[5, 0]])]).toEqual([0x28, 0]);
  });
  it("decodes the fields the panel reads and skips the rest", () => {
    const body = Uint8Array.from([
      0x08,
      7, // channel_id 7
      0x10,
      2, // parent 2
      ...ld(3, enc.encode("00A TIKE")),
      0x09,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8, // a fixed64 to skip
      0x0d,
      1,
      2,
      3,
      4, // a fixed32 to skip
      0x68,
      0, // can_enter false
    ]);
    expect(channelState(pbDecode(body))).toEqual({
      id: 7,
      parent: 2,
      name: "00A TIKE",
      canEnter: false,
    });
  });
  it("keeps large varints exact", () => {
    const big = 2 ** 40 + 5;
    expect(pbDecode(pbEncode([[1, big]])).get(1)).toEqual([big]);
  });
  it("throws on truncated or unknown input", () => {
    expect(() => pbDecode(Uint8Array.of(0x08, 0x80))).toThrow();
    expect(() => pbDecode(Uint8Array.of(0x1a, 5, 1))).toThrow();
    expect(() => pbDecode(Uint8Array.of(0x0b))).toThrow();
  });
  it("reads users, removals, rejections and refusals", () => {
    const user = Uint8Array.from([
      0x08,
      42,
      ...ld(3, enc.encode("VOICE1---web-1")),
      0x28,
      3,
      0x30,
      1,
      0x40,
      1,
    ]);
    expect(userState(pbDecode(user))).toEqual({
      session: 42,
      name: "VOICE1---web-1",
      channel: 3,
      mute: true,
      suppress: true,
    });
    expect(userState(pbDecode(Uint8Array.of(0x08, 4)))).toEqual({
      session: 4,
      name: undefined,
      channel: undefined,
      mute: undefined,
      suppress: undefined,
    });
    expect(serverSync(pbDecode(Uint8Array.of(0x08, 9)))).toEqual({
      session: 9,
    });
    expect(
      userRemove(
        pbDecode(Uint8Array.from([0x08, 9, ...ld(3, enc.encode("bye"))])),
      ),
    ).toEqual({ session: 9, reason: "bye" });
    expect(
      reject(
        pbDecode(
          Uint8Array.from([
            0x08,
            2,
            ...ld(2, enc.encode("Wrong certificate or password")),
          ]),
        ),
      ),
    ).toEqual({ reason: "Wrong certificate or password" });
    expect(
      permissionDenied(
        pbDecode(Uint8Array.from([...ld(4, enc.encode("no")), 0x28, 1])),
      ),
    ).toEqual({ reason: "no", type: 1 });
    expect(serverSync(pbDecode(new Uint8Array()))).toEqual({ session: 0 });
  });
  it("builds what the browser sends", () => {
    expect([...moveTo(42, 7)]).toEqual([
      0,
      MSG.UserState,
      0,
      0,
      0,
      4,
      0x08,
      42,
      0x28,
      7,
    ]);
    expect([...ping(1)]).toEqual([0, MSG.Ping, 0, 0, 0, 2, 0x08, 1]);
  });
});

describe("Mumble varints", () => {
  const cases: [number, number[]][] = [
    [0, [0]],
    [0x7f, [0x7f]],
    [0x80, [0x80, 0x80]],
    [0x3fff, [0xbf, 0xff]],
    [0x4000, [0xc0, 0x40, 0x00]],
    [0x1fffff, [0xdf, 0xff, 0xff]],
    [0x200000, [0xe0, 0x20, 0x00, 0x00]],
    [0xfffffff, [0xef, 0xff, 0xff, 0xff]],
    [0x10000000, [0xf0, 0x10, 0, 0, 0]],
    [0xffffffff, [0xf0, 0xff, 0xff, 0xff, 0xff]],
  ];
  it("encode and decode each length", () => {
    for (const [value, bytes] of cases) {
      expect(mvEncode(value), String(value)).toEqual(bytes);
      expect(mvDecode(Uint8Array.from(bytes), 0)).toEqual([
        value,
        bytes.length,
      ]);
    }
  });
  it("refuse truncated and negative forms", () => {
    expect(() => mvDecode(Uint8Array.of(0x80), 0)).toThrow();
    expect(() => mvDecode(Uint8Array.of(0xc0, 1), 0)).toThrow();
    expect(() => mvDecode(Uint8Array.of(0xe0, 1, 2), 0)).toThrow();
    expect(() => mvDecode(Uint8Array.of(0xf0, 1, 2, 3), 0)).toThrow();
    expect(() => mvDecode(Uint8Array.of(0xf8), 0)).toThrow();
    expect(() => mvDecode(new Uint8Array(), 0)).toThrow();
  });
});

describe("voice packets", () => {
  it("send Opus to the current net, marking the last of a transmission", () => {
    expect(unframe(voicePacket(130, Uint8Array.of(9, 9, 9), true))).toEqual({
      type: MSG.UDPTunnel,
      body: Uint8Array.of(0x80, 0x80, 130, 0xa0, 3, 9, 9, 9),
    });
    expect(unframe(voicePacket(2, Uint8Array.of(1), false))?.body).toEqual(
      Uint8Array.of(0x80, 2, 1, 1),
    );
  });
  it("read who is talking from the server's packets", () => {
    const packet = Uint8Array.of(0x80, 42, 4, 0xa0, 2, 7, 8, 0, 0); // trailing position bytes
    expect(parseVoice(packet)).toEqual({
      session: 42,
      opus: Uint8Array.of(7, 8),
      last: true,
    });
    expect(parseVoice(Uint8Array.of(0x80, 42, 4, 3, 7))).toBeNull(); // shorter than it says
    expect(parseVoice(Uint8Array.of(0x20, 1, 2))).toBeNull(); // a ping
    expect(parseVoice(new Uint8Array())).toBeNull();
  });
  it("carry no voice in a key-up, nor in a terminator's lone TOC byte", () => {
    // No terminator and a payload of none (a key-up) or one TOC byte
    expect(parseVoice(Uint8Array.of(0x80, 42, 4, 0))).toBeNull();
    expect(parseVoice(Uint8Array.of(0x80, 42, 4, 1, 0xf8))).toBeNull();
    // A terminator still ends the transmission, with nothing to decode
    for (const opus of [[], [0xf8]]) {
      expect(
        parseVoice(Uint8Array.of(0x80, 42, 4, 0xa0, opus.length, ...opus)),
      ).toEqual({ session: 42, opus: new Uint8Array(), last: true });
    }
    expect(parseVoice(Uint8Array.of(0x80, 42, 4, 2, 0xf8, 1))).toEqual({
      session: 42,
      opus: Uint8Array.of(0xf8, 1),
      last: false,
    });
  });
});
