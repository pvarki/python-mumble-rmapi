// The voice switch in the users list: the server's state, a press, and the keyboard
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Admin } from "../src/admin/Admin";
import { api, type User } from "../src/api";
import { deferred, fakeAdmin, pointer, settle } from "./admin";

fakeAdmin();

const user = (callsign: string, voice_disabled: boolean): User => ({
  callsign,
  admin: false,
  revoked: false,
  voice_disabled,
  online: [],
});

const voiceSwitch = (callsign: string) =>
  screen.getByRole("switch", { name: `Voice for ${callsign}` });

async function showUsers() {
  localStorage.setItem("mumble.adminTab", "users");
  render(<Admin />);
  await settle();
}

describe("the voice switch", () => {
  it("shows the server's state, titled with the callsign", async () => {
    vi.mocked(api.users).mockResolvedValue([
      user("ALPHA", false),
      user("BRAVO", true),
    ]);
    await showUsers();
    expect(voiceSwitch("ALPHA").getAttribute("aria-checked")).toBe("true");
    expect(voiceSwitch("BRAVO").getAttribute("aria-checked")).toBe("false");
    expect(voiceSwitch("ALPHA").title).toBe("Voice for ALPHA");
  });

  it("flips only once the server has answered", async () => {
    const answer = deferred<null>();
    vi.spyOn(api, "setVoice").mockReturnValue(answer.promise);
    const press = pointer();
    await showUsers();

    await press.click(voiceSwitch("ALPHA"));
    expect(api.setVoice).toHaveBeenCalledWith("ALPHA", false);
    expect(voiceSwitch("ALPHA").getAttribute("aria-checked")).toBe("true");

    vi.mocked(api.users).mockResolvedValue([user("ALPHA", true)]);
    answer.resolve(null);
    await settle();
    expect(voiceSwitch("ALPHA").getAttribute("aria-checked")).toBe("false");
  });

  it("keeps focus while busy and answers Space and Enter", async () => {
    const answer = deferred<null>();
    const setVoice = vi.spyOn(api, "setVoice").mockReturnValue(answer.promise);
    const keys = pointer();
    await showUsers();

    voiceSwitch("BRAVO").focus();
    await keys.keyboard(" ");
    expect(setVoice).toHaveBeenCalledWith("BRAVO", false);
    expect(voiceSwitch("BRAVO").getAttribute("aria-disabled")).toBe("true");
    expect(voiceSwitch("BRAVO").hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(voiceSwitch("BRAVO"));

    answer.resolve(null);
    await settle();
    await keys.keyboard("{Enter}");
    expect(setVoice).toHaveBeenCalledTimes(2);
  });
});
