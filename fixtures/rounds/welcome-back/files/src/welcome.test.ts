import { describe, it, expect } from "vitest";
import { welcome, welcomeBack } from "./welcome";

describe("welcome", () => {
  it("greets with initials", () => {
    expect(welcome("Ada Lovelace")).toBe("Hello, Ada Lovelace! (AL)");
  });

  it("welcomes a returning user", () => {
    expect(welcomeBack("Ada Lovelace")).toMatch(/^Welcome back, /);
  });
});
