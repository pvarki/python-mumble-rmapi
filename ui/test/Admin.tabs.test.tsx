// The admin view's tabs and the remembered folds
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Admin } from "../src/admin/Admin";
import { api } from "../src/api";
import { fakeAdmin, net, pointer, queryRow, row, settle } from "./admin";
import { blockStorage } from "./storage";

fakeAdmin();

describe("the tab", () => {
  const tab = (name: RegExp) => screen.getByRole("tab", { name });

  it("starts on the one chosen last in this browser and remembers a new choice", async () => {
    localStorage.setItem("mumble.adminTab", "users");
    const user = pointer();
    render(<Admin />);
    await settle();
    expect(tab(/^Users/).getAttribute("aria-selected")).toBe("true");

    await user.click(tab(/^Nets/));
    expect(tab(/^Nets/).getAttribute("aria-selected")).toBe("true");
    expect(localStorage.getItem("mumble.adminTab")).toBe("nets");
  });

  it("starts on Nets and still switches where storage is blocked", async () => {
    blockStorage();
    const user = pointer();
    render(<Admin />);
    await settle();
    expect(tab(/^Nets/).getAttribute("aria-selected")).toBe("true");

    await user.click(tab(/^Users/));
    expect(tab(/^Users/).getAttribute("aria-selected")).toBe("true");
  });

  it("moves with the arrow keys, Home and End, showing each tab's panel", async () => {
    const user = pointer();
    render(<Admin />);
    await settle();
    await user.click(tab(/^Nets/));

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tab(/^Users/));
    expect(tab(/^Users/).getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getByRole("switch", { name: "Voice for ALPHA" }),
    ).toBeTruthy();

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tab(/^Nets/));
    expect(row("10")).toBeTruthy();
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(tab(/^Users/));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(tab(/^Nets/));
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(tab(/^Users/));
  });

  it("names its panel after the chosen tab, which controls it", async () => {
    const user = pointer();
    render(<Admin />);
    await settle();
    const nets = screen.getByRole("tabpanel", { name: /^Nets/ });
    expect(tab(/^Nets/).getAttribute("aria-controls")).toBe(nets.id);

    await user.click(tab(/^Users/));
    const users = screen.getByRole("tabpanel", { name: /^Users/ });
    expect(tab(/^Users/).getAttribute("aria-controls")).toBe(users.id);
    expect(tab(/^Nets/).getAttribute("aria-selected")).toBe("false");
  });
});

describe("folds", () => {
  const fold = () =>
    within(screen.getByTestId("net-10")).getAllByTestId("fold")[0];

  it("are remembered in this browser", async () => {
    const { unmount } = render(<Admin />);
    await settle();
    expect(queryRow("101")).toBeTruthy();

    fireEvent.click(fold());
    expect(queryRow("101")).toBeNull();
    expect(localStorage.getItem("mumble.folds")).toBe('{"1":false}');

    unmount();
    render(<Admin />);
    await settle();
    expect(queryRow("101")).toBeNull();
    expect(fold().getAttribute("aria-expanded")).toBe("false");
  });

  it("ignore what is saved when it is not JSON", async () => {
    localStorage.setItem("mumble.folds", "{");
    render(<Admin />);
    await settle();
    expect(queryRow("101")).toBeTruthy();
  });

  it("forget nets that are gone when they are saved", async () => {
    localStorage.setItem("mumble.folds", '{"99":false}');
    render(<Admin />);
    await settle();

    fireEvent.click(fold());
    expect(localStorage.getItem("mumble.folds")).toBe('{"1":false}');
  });

  it("start folded to the top level for more than 30 nets", async () => {
    const squads = Array.from({ length: 30 }, (_, i) => net(10 + i, `S${i}`));
    vi.mocked(api.channels).mockResolvedValue([net(1, "10", squads)]);
    render(<Admin />);
    await settle();
    expect(queryRow("S0")).toBeNull();
    expect(fold().getAttribute("aria-expanded")).toBe("false");
  });

  it("open for a search without changing what is saved", async () => {
    localStorage.setItem("mumble.folds", '{"1":false}');
    render(<Admin />);
    await settle();
    expect(queryRow("101")).toBeNull();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search nets or callsigns" }),
      { target: { value: "101" } },
    );
    expect(queryRow("101")).toBeTruthy();
    expect(localStorage.getItem("mumble.folds")).toBe('{"1":false}');
  });
});
