// An open net: beside the list or its own screen, focus after it goes away, and its confirmations
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Admin } from "../src/admin/Admin";
import { api } from "../src/api";
import {
  CHANNELS,
  deferred,
  fakeAdmin,
  net,
  queryRow,
  row,
  settle,
  workspace,
} from "./admin";

fakeAdmin();

describe("an open net", () => {
  it("shows beside the list on a wide workspace", async () => {
    render(<Admin />);
    await settle();

    fireEvent.click(row("20"));
    const panel = screen.getByTestId("net-panel");
    expect(document.activeElement).toBe(within(panel).getByRole("heading"));
    expect(queryRow("10")).toBeTruthy();

    // The title takes focus once, not again on the next poll
    const edit = screen.getByTestId("edit-net");
    edit.focus();
    await settle(10_000);
    expect(document.activeElement).toBe(edit);

    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByTestId("net-panel")).toBeNull();
    expect(document.activeElement).toBe(row("20"));
  });

  it("is its own screen on a narrow one, and Back returns to its row", async () => {
    workspace.width = 500;
    render(<Admin />);
    await settle();

    fireEvent.click(row("20"));
    expect(screen.getByTestId("net-panel")).toBeTruthy();
    expect(queryRow("10")).toBeNull();

    fireEvent.click(screen.getByTestId("back"));
    expect(screen.queryByTestId("net-panel")).toBeNull();
    expect(document.activeElement).toBe(row("20"));
  });

  it("saves an edited description of up to 1000 characters", async () => {
    const editChannel = vi.spyOn(api, "editChannel").mockResolvedValue(null);
    render(<Admin />);
    await settle();
    fireEvent.click(row("20"));
    fireEvent.click(screen.getByTestId("edit-net"));

    const description = screen.getByRole("textbox", { name: "Description" });
    expect(description.getAttribute("maxlength")).toBe("1000");
    fireEvent.change(description, { target: { value: "Second company" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(editChannel).toHaveBeenCalledWith(4, {
      description: "Second company",
    });
  });

  it("gives focus back to the control a form or the picker was opened from", async () => {
    vi.mocked(api.channels).mockResolvedValue([
      net(1, "10", [
        { ...net(2, "101"), access: "invite", members: ["ALPHA"] },
        { ...net(3, "102"), access: "inherit" },
      ]),
    ]);
    render(<Admin />);
    await settle();
    const button = (name: string) => screen.getByRole("button", { name });
    const escape = () =>
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    fireEvent.click(row("101"));
    fireEvent.click(screen.getByTestId("edit-net"));
    escape();
    expect(document.activeElement).toBe(screen.getByTestId("edit-net"));

    fireEvent.click(button("Sub-net"));
    escape();
    expect(document.activeElement).toBe(button("Sub-net"));

    fireEvent.click(button("Member"));
    fireEvent.click(button("Close"));
    expect(document.activeElement).toBe(button("Member"));

    fireEvent.click(row("102"));
    fireEvent.click(screen.getByRole("radio", { name: "Members only" }));
    fireEvent.click(button("Close"));
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "As net above" }),
    );
  });

  it("closes when it is removed elsewhere, and focus goes to the net above", async () => {
    render(<Admin />);
    await settle();
    fireEvent.click(row("201"));
    expect(screen.getByTestId("net-panel")).toBeTruthy();

    vi.mocked(api.channels).mockResolvedValue([CHANNELS[0], net(4, "20")]);
    await settle(10_000);
    expect(screen.queryByTestId("net-panel")).toBeNull();
    expect(document.activeElement).toBe(row("20"));
  });
});

describe("a confirmation", () => {
  const cancel = () => screen.getByRole("button", { name: "Cancel" });
  const escape = () =>
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

  it("comes before a net is removed; Esc or Cancel keep the net and go back to Remove net", async () => {
    render(<Admin />);
    await settle();
    fireEvent.click(row("20"));
    const removeNet = () => screen.getByRole("button", { name: "Remove net" });

    fireEvent.click(removeNet());
    screen.getByRole("alertdialog", { name: "Remove 20 and its sub-net?" });
    expect(document.activeElement).toBe(cancel());
    escape();
    await settle();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByTestId("net-panel")).toBeTruthy();
    expect(document.activeElement).toBe(removeNet());

    fireEvent.click(removeNet());
    fireEvent.click(cancel());
    await settle();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(removeNet());
  });

  it("refuses Esc and Cancel while the removal runs, then closes the net", async () => {
    const answer = deferred<null>();
    vi.spyOn(api, "removeChannel").mockReturnValue(answer.promise);
    render(<Admin />);
    await settle();
    fireEvent.click(row("20"));
    fireEvent.click(screen.getByRole("button", { name: "Remove net" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(api.removeChannel).toHaveBeenCalledWith(4);
    escape();
    fireEvent.click(cancel());
    await settle();
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    vi.mocked(api.channels).mockResolvedValue([CHANNELS[0]]);
    answer.resolve(null);
    await settle();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByTestId("net-panel")).toBeNull();
    expect(document.activeElement).toBe(row("10"));
  });

  it("comes before the last member goes, and Esc goes back to that member", async () => {
    vi.mocked(api.channels).mockResolvedValue([
      { ...net(1, "10"), access: "invite", members: ["ALPHA"] },
    ]);
    const removeMember = vi.spyOn(api, "removeMember");
    render(<Admin />);
    await settle();
    fireEvent.click(row("10"));
    const x = () => screen.getByRole("button", { name: "Remove ALPHA" });

    fireEvent.click(x());
    screen.getByRole("alertdialog", { name: /^ALPHA is the last member\./ });
    escape();
    await settle();
    expect(screen.getByTestId("net-panel")).toBeTruthy();
    expect(document.activeElement).toBe(x());
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("comes before access narrows on people connected, and Cancel goes back to the choice", async () => {
    vi.mocked(api.channels).mockResolvedValue([
      net(1, "10", [{ ...net(2, "101"), members: ["ALPHA"] }]),
    ]);
    const editChannel = vi.spyOn(api, "editChannel");
    render(<Admin />);
    await settle();
    fireEvent.click(row("101"));

    fireEvent.click(screen.getByRole("radio", { name: "Members only" }));
    screen.getByRole("alertdialog", {
      name: "Those connected who are not let in any more are moved out.",
    });
    fireEvent.click(cancel());
    await settle();
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Open" }),
    );
    expect(editChannel).not.toHaveBeenCalled();
  });
});
