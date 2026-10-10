// Unit tests for reading the admin API's error bodies: `pnpm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detail } from "../src/api.ts";

describe("detail", () => {
  it("reads FastAPI's sentence, and a validation error's messages", () => {
    assert.equal(detail('{"detail": "no channel 9"}'), "no channel 9");
    assert.equal(
      detail('{"detail": [{"msg": "too long"}, {"msg": "bad pattern"}, 3]}'),
      "too long; bad pattern",
    );
  });
  it("gives null for anything else", () => {
    for (const body of [
      "",
      "<html>",
      "null",
      "{}",
      '{"detail": []}',
      '{"detail": 5}',
    ]) {
      assert.equal(detail(body), null, body);
    }
  });
});
