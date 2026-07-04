import { describe, it, expect } from "vitest";
import { assertNever } from "./assert-never.js";

describe("assertNever", () => {
  it("throws and names the unexpected value when reached at runtime", () => {
    // Cast simulates an invalid value slipping past the types (bad I/O).
    expect(() => assertNever("surprise" as never)).toThrow(/surprise/);
  });

  it("uses a caller-supplied message when given", () => {
    expect(() => assertNever(42 as never, "unhandled projection kind")).toThrow(
      "unhandled projection kind",
    );
  });
});
