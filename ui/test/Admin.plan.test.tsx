// The channel plan: adding a top-level net, importing, exporting and removing it whole
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Admin } from "../src/admin/Admin";
import { api } from "../src/api";
import { CHANNELS, fakeAdmin, net, pointer, settle } from "./admin";

fakeAdmin();

describe("the plan", () => {
  it("gets a new top-level net from the form above the cards, which then opens", async () => {
    vi.spyOn(api, "addChannel").mockResolvedValue({ id: 6 });
    render(<Admin />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Add net" }));
    vi.mocked(api.channels).mockResolvedValue([...CHANNELS, net(6, "30")]);
    const name = screen.getByRole("textbox", { name: "Net name" });
    fireEvent.change(name, { target: { value: "30" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await settle();
    expect(api.addChannel).toHaveBeenCalledWith("30", 0);
    expect(screen.queryByRole("textbox", { name: "Net name" })).toBeNull();
    const panel = screen.getByTestId("net-panel");
    expect(document.activeElement).toBe(within(panel).getByRole("heading"));
    expect(document.activeElement?.textContent).toBe("30");
  });

  it("imports a channel plan file", async () => {
    vi.spyOn(api, "importPlan").mockResolvedValue({ created: 1 });
    const pick = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => undefined);
    const user = pointer();
    const { container } = render(<Admin />);
    await settle();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Import channel plan…" }),
    );
    const file = container.querySelector<HTMLInputElement>("input[type=file]");
    expect(pick.mock.contexts).toEqual([file]);
    fireEvent.change(file!, {
      target: { files: [new File(["nets: []"], "plan.yaml")] },
    });
    await settle();
    expect(api.importPlan).toHaveBeenCalledWith("nets: []");
    expect(screen.getByRole("status").textContent).toBe("1 new net imported.");
  });

  it("exports, and is removed whole once confirmed with an export offered first", async () => {
    vi.spyOn(api, "exportPlan").mockResolvedValue("nets: []");
    vi.spyOn(api, "clearChannels").mockResolvedValue({ removed: 5 });
    URL.createObjectURL = vi.fn(() => "blob:plan");
    URL.revokeObjectURL = vi.fn();
    const saved = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const user = pointer();
    render(<Admin />);
    await settle();

    const more = screen.getByRole("button", { name: "More actions" });
    await user.click(more);
    await user.click(
      screen.getByRole("menuitem", { name: "Export channel plan" }),
    );
    await settle();
    expect(saved).toHaveBeenCalledTimes(1);

    const removeAll = async () => {
      await user.click(more);
      await user.click(
        screen.getByRole("menuitem", { name: "Remove all unit nets…" }),
      );
    };
    await removeAll();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(more);

    await removeAll();
    const dialog = screen.getByRole("alertdialog", {
      name: "Remove all unit nets (5)?",
    });
    expect(dialog.textContent).toContain("Anyone connected is moved out.");

    fireEvent.click(screen.getByRole("button", { name: "Export first" }));
    await settle();
    expect(saved).toHaveBeenCalledTimes(2);

    vi.mocked(api.channels).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
    await settle();
    expect(api.clearChannels).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("5 nets removed.");
    expect(document.activeElement).toBe(more);
  });
});
