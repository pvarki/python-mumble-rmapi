// The talk panel's failure line: read out at once, with what went wrong under it
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { FailureLine } from "../src/voice/FailureLine";

it("says what failed, and the detail when there is one", () => {
  const { rerender } = render(
    <FailureLine failure="failed" detail="HTTP 502" />,
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "Could not connect.HTTP 502",
  );
  rerender(<FailureLine failure="refused" detail="" />);
  expect(screen.getByRole("alert").textContent).toBe(
    "Voice off. Ask an admin.",
  );
});
