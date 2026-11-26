// Who may use an open net: a click, Space or Enter chooses; the arrow keys only move focus
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Admin } from "../src/admin/Admin";
import { api } from "../src/api";
import { deferred, fakeAdmin, net, pointer, row, settle } from "./admin";

fakeAdmin();

const choice = (name: string) => screen.getByRole("radio", { name });

async function open(name: string) {
  render(<Admin />);
  await settle();
  fireEvent.click(row(name));
}

describe("the access choice", () => {
  it("marks the net's access and offers As net above only below the top level", async () => {
    await open("10");
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Open",
      "Members only",
    ]);
    expect(choice("Open").getAttribute("aria-checked")).toBe("true");
    expect(choice("Members only").getAttribute("aria-checked")).toBe("false");

    fireEvent.click(row("101"));
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("chooses with a click, and a click on the current choice does nothing", async () => {
    const editChannel = vi.spyOn(api, "editChannel").mockResolvedValue(null);
    await open("101");

    fireEvent.click(choice("Open"));
    expect(editChannel).not.toHaveBeenCalled();
    fireEvent.click(choice("As net above"));
    expect(editChannel).toHaveBeenCalledWith(2, { access: "inherit" });
  });

  it("marks every option busy while a choice is saved", async () => {
    const answer = deferred<null>();
    vi.spyOn(api, "editChannel").mockReturnValue(answer.promise);
    await open("101");

    fireEvent.click(choice("As net above"));
    for (const option of screen.getAllByRole("radio")) {
      expect(option.getAttribute("aria-disabled")).toBe("true");
    }
    answer.resolve(null);
    await settle();
    expect(choice("Open").getAttribute("aria-disabled")).toBeNull();
  });

  it("moves focus with the arrow keys without choosing; Space or Enter chooses", async () => {
    const editChannel = vi.spyOn(api, "editChannel").mockResolvedValue(null);
    const keys = pointer();
    await open("101");
    choice("Open").focus();

    await keys.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(choice("Members only"));
    await keys.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(choice("As net above"));
    await keys.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(choice("Open"));
    await keys.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(choice("As net above"));
    expect(editChannel).not.toHaveBeenCalled();
    expect(choice("Open").getAttribute("aria-checked")).toBe("true");

    await keys.keyboard(" ");
    expect(editChannel).toHaveBeenCalledWith(2, { access: "inherit" });
    await settle();
    await keys.keyboard("{Enter}");
    expect(editChannel).toHaveBeenCalledTimes(2);
  });

  it("is one Tab stop, entered at the current choice", async () => {
    vi.mocked(api.channels).mockResolvedValue([
      { ...net(1, "10"), access: "invite", members: ["ALPHA"] },
    ]);
    const keys = pointer();
    await open("10");
    screen.getByTestId("close-net").focus();

    await keys.tab();
    expect(document.activeElement).toBe(choice("Members only"));
    await keys.tab();
    expect(document.activeElement?.getAttribute("role")).not.toBe("radio");
  });
});
