import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("green package script", () => {
  it("copies runtime assets and creates operator batch files", () => {
    const script = readFileSync("scripts/package-green.ps1", "utf8");

    expect(script).toContain("npm.cmd run build");
    expect(script).toContain("Copy-Item -LiteralPath \"dist\"");
    expect(script).toContain("Copy-Item -LiteralPath \"public\"");
    expect(script).toContain("Copy-Item -LiteralPath \"node_modules\"");
    expect(script).toContain("start-pricing-console.bat");
    expect(script).toContain("open-console.bat");
    expect(script).toContain("Compress-Archive");
  });
});
