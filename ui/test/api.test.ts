// Reading the admin API's error bodies
import { describe, expect, it } from "vitest";

import { detail } from "../src/api";

describe("detail", () => {
  it("reads FastAPI's sentence, and a validation error's messages", () => {
    expect(detail('{"detail": "no channel 9"}')).toBe("no channel 9");
    expect(
      detail('{"detail": [{"msg": "too long"}, {"msg": "bad pattern"}, 3]}'),
    ).toBe("too long; bad pattern");
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
      expect(detail(body), body).toBeNull();
    }
  });
});
