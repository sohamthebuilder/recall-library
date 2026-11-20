import { describe, expect, it } from "vitest";
import { canSignIn } from "./access";

describe("who may sign in", () => {
  const learnerEmail = "learner@example.com";

  it("lets in the configured learner's verified Google account, whatever the letter case", () => {
    expect(canSignIn({ email: "Learner@Example.com", emailVerified: true }, learnerEmail)).toBe(true);
  });

  it("refuses every other account", () => {
    expect(canSignIn({ email: "someone.else@example.com", emailVerified: true }, learnerEmail)).toBe(false);
  });

  it("refuses the learner's address if Google has not verified it", () => {
    expect(canSignIn({ email: "learner@example.com", emailVerified: false }, learnerEmail)).toBe(false);
  });

  it("refuses everyone when no learner email is configured", () => {
    expect(canSignIn({ email: "learner@example.com", emailVerified: true }, undefined)).toBe(false);
    expect(canSignIn({ email: "", emailVerified: true }, "")).toBe(false);
  });
});
