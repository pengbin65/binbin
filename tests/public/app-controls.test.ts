import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("control panel shop bulk controls", () => {
  it("renders bulk shop selection buttons and wires their handlers", () => {
    const html = readFileSync("public/index.html", "utf8");
    const script = readFileSync("public/app.js", "utf8");

    expect(html).toContain('id="selectAllShopsButton"');
    expect(html).toContain('id="clearAllShopsButton"');
    expect(script).toContain("setAllShopsSelected(true)");
    expect(script).toContain("setAllShopsSelected(false)");
  });
});
