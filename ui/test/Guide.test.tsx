// The voice guide: the help button, stepping through, closing, which steps each person gets, and opening by
// itself on the first visit, once rmapi's data is in
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import MumbleApp, { type Meta } from "../src/App";
import {
  detectPlatform,
  finishedSteps,
  guideSteps,
  opensItself,
  saveFinished,
  type GuideStep,
} from "../src/guide/guide";
import { OnboardingHandler } from "../src/guide/OnboardingHandler";
import { blockStorage } from "./storage";

// The page around the guide, without the talk panel's client or the admin view's requests
vi.mock("../src/voice/Talk", () => ({ Talk: () => null }));
vi.mock("../src/admin/Admin", () => ({ Admin: () => null }));

function setup({ voice = true, admin = false, meta = {} as Meta } = {}) {
  const view = render(
    <OnboardingHandler meta={meta} voice={voice} admin={admin} />,
  );
  const user = userEvent.setup();
  const help = () => screen.getByRole("button", { name: "Voice guide" });
  const button = (name: string) => screen.getByRole("button", { name });
  return { user, help, button, view };
}

const dialog = () => screen.queryByRole("dialog", { name: "Voice guide" });

// Radix Select calls these, which jsdom lacks
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

describe("the voice guide", () => {
  it("opens from the help button on the first step, with focus on Next", async () => {
    const { user, help, button } = setup();
    expect(dialog()).toBeNull();

    await user.click(help());
    expect(screen.getByText("Step 1 / 4")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Talk in voice nets" }),
    ).toBeTruthy();
    expect(dialog()?.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.activeElement).toBe(button("Next"));
    expect(button("Back").getAttribute("aria-disabled")).toBe("true");
  });

  it("steps forward and back, keeping focus on the button pressed", async () => {
    const { user, help, button } = setup();
    await user.click(help());

    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Join a net" })).toBeTruthy();
    expect(document.activeElement).toBe(button("Next"));

    await user.click(button("Back"));
    expect(screen.getByText("Step 1 / 4")).toBeTruthy();
    expect(document.activeElement).toBe(button("Back"));
    // Back does nothing on the first step
    await user.keyboard("{Enter}");
    expect(screen.getByText("Step 1 / 4")).toBeTruthy();
  });

  it("closes on Finish, focusing the help button, and starts over when opened again", async () => {
    const { user, help, button } = setup();
    await user.click(help());
    for (let i = 0; i < 3; i++) await user.click(button("Next"));
    expect(screen.getByText("Step 4 / 4")).toBeTruthy();

    await user.click(button("Finish"));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(help());

    await user.click(help());
    expect(screen.getByText("Step 1 / 4")).toBeTruthy();
  });

  it("closes with Esc or the close button", async () => {
    const { user, help, button } = setup();
    await user.click(help());
    await user.keyboard("{Escape}");
    expect(dialog()).toBeNull();

    await user.click(help());
    await user.click(button("Close the guide"));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(help());
  });

  it("adds managing the nets for admins", async () => {
    const { user, help } = setup({ admin: true });
    await user.click(help());
    expect(screen.getByText("Step 1 / 6")).toBeTruthy();
  });

  it("has only the admin steps for an admin with voice off, and nothing for others", async () => {
    const { user, help } = setup({ voice: false, admin: true });
    await user.click(help());
    expect(screen.getByText("Step 1 / 2")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Build the unit nets" }),
    ).toBeTruthy();
  });

  it("is not offered where it has no steps", () => {
    setup({ voice: false });
    expect(screen.queryByRole("button", { name: "Voice guide" })).toBeNull();
  });
});

describe("where you talk", () => {
  const platform = () =>
    screen.getByRole("combobox", { name: "Where you talk" });

  it("starts in the browser, with its picture", async () => {
    const { user, help, button } = setup();
    await user.click(help());
    expect(platform().textContent).toBe("In this browser");
    await user.click(button("Next"));
    await user.click(button("Next"));
    expect(screen.getByRole("heading", { name: "Push to talk" })).toBeTruthy();
    const picture = screen.getByRole("img", {
      name: /^The talk panel in the browser/,
    });
    expect(picture.getAttribute("src")).toBe(
      "/ui/mumble/guide/browser-talk.en.webp",
    );
    expect(picture.closest("a")?.getAttribute("href")).toBe(
      "/ui/mumble/guide/browser-talk.en.webp",
    );
  });

  it("switches to ATAK's steps, back on the first step", async () => {
    const { user, help, button } = setup();
    await user.click(help());
    await user.click(button("Next"));
    await user.click(platform());
    await user.click(
      screen.getByRole("option", { name: "Android phone: ATAK" }),
    );
    expect(screen.getByText("Step 1 / 4")).toBeTruthy();
    await user.click(button("Next"));
    expect(
      screen.getByRole("heading", { name: "Load OpenDefence Voice in ATAK" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /^ATAK's plugin list/ }),
    ).toBeTruthy();
  });

  it("is not offered to an admin with voice off", async () => {
    const { user, help } = setup({ voice: false, admin: true });
    await user.click(help());
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("detectPlatform", () => {
  it("starts Android phones on ATAK and everyone else in the browser", () => {
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; SM-G556B)")).toBe(
      "android",
    );
    expect(
      detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"),
    ).toBe("browser");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      "browser",
    );
  });
});

describe("on the first visit", () => {
  const meta = (more: Partial<Meta> = {}): Meta => ({
    callsign: "ALPHA",
    autoOpenGuides: true,
    onDisableGuides: vi.fn(),
    ...more,
  });
  const offer = "Do not show me guides automatically";

  it("opens by itself, with focus on Next, until it is finished", async () => {
    const first = setup({ meta: meta() });
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(first.button("Next"));
    for (let i = 0; i < 3; i++) await first.user.click(first.button("Next"));
    await first.user.click(first.button("Finish"));
    first.view.unmount();

    setup({ meta: meta() });
    expect(dialog()).toBeNull();
  });

  it("opens again on the next visit when it was closed before the end", async () => {
    const first = setup({ meta: meta() });
    await first.user.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    first.view.unmount();

    setup({ meta: meta() });
    expect(dialog()).not.toBeNull();
  });

  it("opens again with the admin steps once the person is an admin", async () => {
    const first = setup({ meta: meta() });
    for (let i = 0; i < 3; i++) await first.user.click(first.button("Next"));
    await first.user.click(first.button("Finish"));
    first.view.unmount();

    setup({ meta: meta(), admin: true });
    expect(screen.getByText("Step 1 / 6")).toBeTruthy();
  });

  it("offers on the first step to stop guides opening by themselves, then closes", async () => {
    const m = meta();
    const { user, button } = setup({ meta: m });
    await user.click(button("Next"));
    expect(screen.queryByRole("button", { name: offer })).toBeNull();
    await user.click(button("Back"));

    await user.click(button(offer));
    expect(m.onDisableGuides).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("waits for the help button where rmui says guides do not open by themselves, without the offer", async () => {
    const { user, help } = setup({ meta: meta({ autoOpenGuides: false }) });
    expect(dialog()).toBeNull();

    await user.click(help());
    expect(dialog()).not.toBeNull();
    expect(screen.queryByRole("button", { name: offer })).toBeNull();
  });

  it("waits for the help button without a callsign to remember it by", () => {
    setup({ meta: meta({ callsign: undefined }) });
    expect(dialog()).toBeNull();
  });
});

describe("while rmui waits for rmapi's data", () => {
  const meta: Meta = { callsign: "ALPHA", autoOpenGuides: true };

  async function visit() {
    const view = render(<MumbleApp data={{}} meta={meta} />);
    await screen.findByRole("heading", { name: "Voice" });
    expect(dialog()).toBeNull();
    return view;
  }

  it("does not open for someone whose voice turns out to be off", async () => {
    const view = await visit();
    view.rerender(<MumbleApp data={{ voice: false, nets: [] }} meta={meta} />);
    expect(screen.queryByRole("button", { name: "Voice guide" })).toBeNull();
  });

  it("opens for an admin who saw only the talk steps before", async () => {
    localStorage.setItem(
      "mumble.guide.ALPHA",
      JSON.stringify(["intro", "join", "talk", "nets"]),
    );
    const view = await visit();
    view.rerender(
      <MumbleApp data={{ voice: true, admin: true, nets: [] }} meta={meta} />,
    );
    expect(screen.getByText("Step 1 / 6")).toBeTruthy();
  });
});

describe("guideSteps", () => {
  const ids = (steps: GuideStep[]) => steps.map((s) => s.id);

  it("shows talking to everyone with voice, and managing nets to admins after it", () => {
    expect(ids(guideSteps({ voice: true, admin: false }))).toEqual([
      "intro",
      "join",
      "talk",
      "nets",
    ]);
    expect(ids(guideSteps({ voice: true, admin: true }))).toEqual([
      "intro",
      "join",
      "talk",
      "nets",
      "units",
      "fixed",
    ]);
  });
  it("puts ATAK's own steps between the intro and the nets", () => {
    expect(
      ids(guideSteps({ voice: true, admin: false, platform: "android" })),
    ).toEqual(["intro", "plugin", "ptt", "nets"]);
  });
  it("leaves talking out where voice is off", () => {
    expect(ids(guideSteps({ voice: false, admin: true }))).toEqual([
      "units",
      "fixed",
    ]);
    expect(guideSteps({ voice: false, admin: false })).toEqual([]);
  });
});

const USER = guideSteps({ voice: true, admin: false });

describe("finishedSteps", () => {
  it("remembers the steps per callsign, adding to what was seen before", () => {
    saveFinished("ALPHA", USER);
    saveFinished("ALPHA", guideSteps({ voice: false, admin: true }));
    expect(finishedSteps("ALPHA")).toEqual([
      "intro",
      "join",
      "talk",
      "nets",
      "units",
      "fixed",
    ]);
    expect(finishedSteps("BRAVO")).toEqual([]);
  });
  it("ignores what is not JSON", () => {
    localStorage.setItem("mumble.guide.ALPHA", "{");
    expect(finishedSteps("ALPHA")).toEqual([]);
  });
  it("is empty where storage is blocked", () => {
    blockStorage();
    expect(finishedSteps("ALPHA")).toEqual([]);
    expect(() => saveFinished("ALPHA", USER)).not.toThrow();
  });
});

describe("opensItself", () => {
  it("opens on every visit where storage is blocked", () => {
    blockStorage();
    saveFinished("ALPHA", USER);
    expect(opensItself("ALPHA", USER, true)).toBe(true);
  });
});
