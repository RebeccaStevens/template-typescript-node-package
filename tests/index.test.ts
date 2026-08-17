import { describe, expect, it } from "vitest";

import { helloWorld } from "../src/index.ts";

describe("helloWorld", () => {
  it("should return greeting", () => {
    expect(helloWorld()).toBe("Hello World");
  });
});
