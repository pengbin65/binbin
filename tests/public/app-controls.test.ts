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

describe("control panel connection fallback", () => {
  it("keeps polling state when WebSocket is unavailable", () => {
    const script = readFileSync("public/app.js", "utf8");

    expect(script).toContain("startStatePolling()");
    expect(script).toContain("stopStatePolling()");
    expect(script).toContain("window.setInterval(fetchState");
  });
});

describe("control panel low-price rule controls", () => {
  it("defaults to low-price rule and sends the editable low-price threshold", () => {
    const html = readFileSync("public/index.html", "utf8");
    const script = readFileSync("public/app.js", "utf8");

    expect(html).toContain('name="pricingRule" value="low_price" checked');
    expect(html).toContain('id="lowPriceThresholdInput"');
    expect(html).toContain('value="0.70"');
    expect(script).toContain("selectedPricingOptions()");
    expect(script).toContain("lowPriceThreshold");
  });
});

describe("control panel editable shop settings", () => {
  it("renders controls for adding and saving shops", () => {
    const html = readFileSync("public/index.html", "utf8");
    const script = readFileSync("public/app.js", "utf8");

    expect(html).toContain('id="newShopNameInput"');
    expect(html).toContain('id="addShopButton"');
    expect(html).toContain('id="saveSettingsButton"');
    expect(script).toContain('fetch("/api/settings"');
    expect(script).toContain("saveSettings()");
    expect(script).toContain("addShopFromInput()");
    expect(script).toContain("removeShop(");
  });
});

describe("control panel API capture controls", () => {
  it("renders and wires API capture buttons", () => {
    const html = readFileSync("public/index.html", "utf8");
    const script = readFileSync("public/app.js", "utf8");

    expect(html).toContain('id="startCaptureButton"');
    expect(html).toContain('id="stopCaptureButton"');
    expect(script).toContain('postCaptureAction("start")');
    expect(script).toContain('postCaptureAction("stop")');
    expect(script).toContain("/api/capture/");
  });
});
