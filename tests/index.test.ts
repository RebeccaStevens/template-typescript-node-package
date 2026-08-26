import { describe, expect, expectTypeOf, it } from "vitest";

import { helloWorld } from "../src/index.ts";

describe("helloWorld", () => {
  it("should return greeting", () => {
    expect(helloWorld()).toBe("Hello World");
  });

  it("should return a string", () => {
    expectTypeOf(helloWorld).returns.toBeString();
  });
});
