// The admin view's data: loading and polling, and requests with their notices
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Admin } from "../src/admin/Admin";
import { api, type Channel } from "../src/api";
import {
  CHANNELS,
  deferred,
  fakeAdmin,
  net,
  pointer,
  queryRow,
  row,
  settle,
} from "./admin";

fakeAdmin();

describe("loading", () => {
  it("fetches on mount and every 10 s while the page is visible, the templates once", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const { unmount } = render(<Admin />);
    await settle();
    expect(row("10")).toBeTruthy();
    expect(api.channels).toHaveBeenCalledTimes(1);

    await settle(10_000);
    expect(api.channels).toHaveBeenCalledTimes(2);

    hidden.mockReturnValue(true);
    await settle(10_000);
    expect(api.channels).toHaveBeenCalledTimes(2);

    hidden.mockReturnValue(false);
    fireEvent(document, new Event("visibilitychange"));
    await settle();
    expect(api.channels).toHaveBeenCalledTimes(3);

    unmount();
    await settle(30_000);
    expect(api.channels).toHaveBeenCalledTimes(3);
    expect(api.templates).toHaveBeenCalledTimes(1);
  });

  it("keeps the newer answer when an older fetch answers last", async () => {
    const older = deferred<Channel[]>();
    vi.mocked(api.channels)
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce([net(5, "NEW")]);
    render(<Admin />);
    await settle(10_000);
    expect(row("NEW")).toBeTruthy();

    older.resolve(CHANNELS);
    await settle();
    expect(row("NEW")).toBeTruthy();
    expect(queryRow("10")).toBeNull();
  });

  it("shows a failed fetch as an error until it is dismissed", async () => {
    vi.mocked(api.channels).mockRejectedValue(new Error("down"));
    render(<Admin />);
    await settle();
    expect(screen.getByRole("alert").textContent).toBe(
      "Voice service error: down",
    );

    await settle(60_000);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("requests", () => {
  const voiceSwitch = (callsign: string) =>
    screen.getByRole("switch", { name: `Voice for ${callsign}` });

  it("refuses a second press while one is in flight and marks only its control busy", async () => {
    const answer = deferred<null>();
    const setVoice = vi.spyOn(api, "setVoice").mockReturnValue(answer.promise);
    localStorage.setItem("mumble.adminTab", "users");
    render(<Admin />);
    await settle();

    fireEvent.click(voiceSwitch("ALPHA"));
    fireEvent.click(voiceSwitch("ALPHA"));
    expect(setVoice).toHaveBeenCalledTimes(1);
    expect(setVoice).toHaveBeenCalledWith("ALPHA", false);
    expect(voiceSwitch("ALPHA").getAttribute("aria-disabled")).toBe("true");
    expect(voiceSwitch("BRAVO").getAttribute("aria-disabled")).toBeNull();

    answer.resolve(null);
    await settle();
    expect(voiceSwitch("ALPHA").getAttribute("aria-disabled")).toBeNull();
    // Done means fetched again, so the switch shows the server's state
    expect(api.channels).toHaveBeenCalledTimes(2);
  });

  it("clears the error once a later request succeeds", async () => {
    vi.spyOn(api, "setVoice")
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValueOnce(null);
    localStorage.setItem("mumble.adminTab", "users");
    render(<Admin />);
    await settle();

    fireEvent.click(voiceSwitch("BRAVO"));
    await settle();
    expect(screen.getByRole("alert").textContent).toBe(
      "Voice service error: refused",
    );

    fireEvent.click(voiceSwitch("BRAVO"));
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a success for 6 s", async () => {
    vi.spyOn(api, "applyTemplate").mockResolvedValue({ created: 2 });
    const user = pointer();
    render(<Admin />);
    await settle();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Use a template…" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply Plan A" }));
    await settle();
    expect(api.applyTemplate).toHaveBeenCalledWith("a");
    expect(screen.getByRole("status").textContent).toBe(
      "2 new nets added from the template.",
    );
    expect(screen.queryByTestId("templates")).toBeNull();

    await settle(5_900);
    expect(screen.queryByRole("status")).toBeTruthy();
    await settle(100);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
