// A net's path as people read it
import { describe, expect, it } from "vitest";

import { pathLabel } from "../src/paths";

describe("pathLabel", () => {
  it("drops the Units and Missions roots", () => {
    expect(pathLabel("/Units/10/101")).toBe("10 › 101");
    expect(pathLabel("/Missions/PATROL-NORTH")).toBe("PATROL-NORTH");
  });
  it("joins any other path", () => {
    expect(pathLabel("/Teams/Red")).toBe("Teams › Red");
    expect(pathLabel("/Units")).toBe("Units");
  });
});
