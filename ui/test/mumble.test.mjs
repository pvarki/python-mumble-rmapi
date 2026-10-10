// Unit tests for the browser's Mumble protocol: `pnpm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextEncoder } from "node:util";

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
} from "../src/voice/mumble.ts";

const enc = new TextEncoder();
// A protobuf length-delimited field
const ld = (field, bytes) => [field * 8 + 2, bytes.length, ...bytes];

describe("frames", () => {
  it("round-trips a message with its 6-byte header", () => {
    const f = frame(9, Uint8Array.of(1, 2, 3));
    assert.deepEqual([...f], [0, 9, 0, 0, 0, 3, 1, 2, 3]);
    const back = unframe(f);
    assert.equal(back.type, 9);
    assert.deepEqual([...back.body], [1, 2, 3]);
  });
  it("refuses short or mislabelled frames", () => {
    assert.equal(unframe(Uint8Array.of(0, 1, 0)), null);
    assert.equal(unframe(Uint8Array.of(0, 1, 0, 0, 0, 5, 1)), null);
  });
});

describe("protobuf", () => {
  it("encodes varints as protobuf does", () => {
    assert.deepEqual([...pbEncode([[1, 300]])], [0x08, 0xac, 0x02]);
    assert.deepEqual([...pbEncode([[5, 0]])], [0x28, 0]);
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
    assert.deepEqual(channelState(pbDecode(body)), {
      id: 7,
      parent: 2,
      name: "00A TIKE",
      canEnter: false,
    });
  });
  it("keeps large varints exact", () => {
    const big = 2 ** 40 + 5;
    assert.equal(pbDecode(pbEncode([[1, big]])).get(1)[0], big);
  });
  it("throws on truncated or unknown input", () => {
    assert.throws(() => pbDecode(Uint8Array.of(0x08, 0x80)));
    assert.throws(() => pbDecode(Uint8Array.of(0x1a, 5, 1)));
    assert.throws(() => pbDecode(Uint8Array.of(0x0b)));
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
    assert.deepEqual(userState(pbDecode(user)), {
      session: 42,
      name: "VOICE1---web-1",
      channel: 3,
      mute: true,
      suppress: true,
    });
    assert.deepEqual(userState(pbDecode(Uint8Array.of(0x08, 4))), {
      session: 4,
      name: undefined,
      channel: undefined,
      mute: undefined,
      suppress: undefined,
    });
    assert.deepEqual(serverSync(pbDecode(Uint8Array.of(0x08, 9))), {
      session: 9,
    });
    assert.deepEqual(
      userRemove(
        pbDecode(Uint8Array.from([0x08, 9, ...ld(3, enc.encode("bye"))])),
      ),
      { session: 9, reason: "bye" },
    );
    assert.deepEqual(
      reject(
        pbDecode(
          Uint8Array.from([
            0x08,
            2,
            ...ld(2, enc.encode("Wrong certificate or password")),
          ]),
        ),
      ),
      { reason: "Wrong certificate or password" },
    );
    assert.deepEqual(
      permissionDenied(
        pbDecode(Uint8Array.from([...ld(4, enc.encode("no")), 0x28, 1])),
      ),
      { reason: "no", type: 1 },
    );
    assert.deepEqual(serverSync(pbDecode(new Uint8Array())), { session: 0 });
  });
  it("builds what the browser sends", () => {
    assert.deepEqual(
      [...moveTo(42, 7)],
      [0, MSG.UserState, 0, 0, 0, 4, 0x08, 42, 0x28, 7],
    );
    assert.deepEqual([...ping(1)], [0, MSG.Ping, 0, 0, 0, 2, 0x08, 1]);
  });
});

describe("Mumble varints", () => {
  const cases = [
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
      assert.deepEqual(mvEncode(value), bytes, String(value));
      assert.deepEqual(mvDecode(Uint8Array.from(bytes), 0), [
        value,
        bytes.length,
      ]);
    }
  });
  it("refuse truncated and negative forms", () => {
    assert.throws(() => mvDecode(Uint8Array.of(0x80), 0));
    assert.throws(() => mvDecode(Uint8Array.of(0xc0, 1), 0));
    assert.throws(() => mvDecode(Uint8Array.of(0xe0, 1, 2), 0));
    assert.throws(() => mvDecode(Uint8Array.of(0xf0, 1, 2, 3), 0));
    assert.throws(() => mvDecode(Uint8Array.of(0xf8), 0));
    assert.throws(() => mvDecode(new Uint8Array(), 0));
  });
});

describe("voice packets", () => {
  it("send Opus to the current net, marking the last of a transmission", () => {
    const f = voicePacket(130, Uint8Array.of(9, 9, 9), true);
    const { type, body } = unframe(f);
    assert.equal(type, MSG.UDPTunnel);
    assert.deepEqual([...body], [0x80, 0x80, 130, 0xa0, 3, 9, 9, 9]);
    assert.deepEqual(
      [...unframe(voicePacket(2, Uint8Array.of(1), false)).body],
      [0x80, 2, 1, 1],
    );
  });
  it("read who is talking from the server's packets", () => {
    const packet = Uint8Array.of(0x80, 42, 4, 0xa0, 2, 7, 8, 0, 0); // trailing position bytes
    const voice = parseVoice(packet);
    assert.equal(voice.session, 42);
    assert.deepEqual([...voice.opus], [7, 8]);
    assert.equal(voice.last, true);
    assert.equal(parseVoice(Uint8Array.of(0x80, 42, 4, 3, 7)), null); // shorter than it says
    assert.equal(parseVoice(Uint8Array.of(0x20, 1, 2)), null); // a ping
    assert.equal(parseVoice(new Uint8Array()), null);
  });
  it("carry no voice in a key-up, nor in a terminator's lone TOC byte", () => {
    // No terminator and a payload of none (a key-up) or one TOC byte
    assert.equal(parseVoice(Uint8Array.of(0x80, 42, 4, 0)), null);
    assert.equal(parseVoice(Uint8Array.of(0x80, 42, 4, 1, 0xf8)), null);
    // A terminator still ends the transmission, with nothing to decode
    for (const opus of [[], [0xf8]]) {
      const voice = parseVoice(
        Uint8Array.of(0x80, 42, 4, 0xa0, opus.length, ...opus),
      );
      assert.equal(voice.last, true);
      assert.equal(voice.opus.length, 0);
    }
    const two = parseVoice(Uint8Array.of(0x80, 42, 4, 2, 0xf8, 1));
    assert.deepEqual([...two.opus], [0xf8, 1]);
    assert.equal(two.last, false);
  });
});
