import assert from "node:assert/strict";
import test from "node:test";
import { uploadedBrandGuide } from "../src/lib/lifecycle-brand-guides";

test("uploaded brand guides match the four accounts", () => {
  const volt = uploadedBrandGuide("12 Volt Power");
  assert.equal(volt?.senderName, "12 Volt Power");
  assert.match(volt?.dosAndDonts || "", /we partner with/i);
  assert.match(volt?.voiceTone || "", /dependable partner/i);

  const hrig = uploadedBrandGuide("HR Innovator Group");
  assert.equal(hrig?.senderName, "The HR Innovator Group");
  assert.match(hrig?.colors || "", /#3A9E3E/);
  assert.match(hrig?.fonts || "", /Montserrat/);
  assert.equal(hrig?.logoAssetsUrl, "https://hrinnovatorsgroup.com/");

  const looda = uploadedBrandGuide("Looda House Pawn");
  assert.equal(looda?.senderName, "Looda House Pawn");
  assert.match(looda?.colors || "", /#B8963A/);
  assert.match(looda?.fonts || "", /Anton/);
  assert.match(looda?.dosAndDonts || "", /Where Treasures Change Hands/);

  const hendo = uploadedBrandGuide("Hendos Barrel House");
  assert.equal(hendo?.senderName, "Hendo's Barrel House");
  assert.match(hendo?.colors || "", /#F5EEE4/);
  assert.match(hendo?.colors || "", /#D85338/);
  assert.match(hendo?.fonts || "", /Proxima Nova/);
  assert.equal(uploadedBrandGuide("Hendo's Barrel House")?.senderName, hendo?.senderName);
});

test("other accounts do not receive one of these kits", () => {
  assert.equal(uploadedBrandGuide("Swing Inn Cafe"), null);
  assert.equal(uploadedBrandGuide("Pipe It Right Plumbing"), null);
});
