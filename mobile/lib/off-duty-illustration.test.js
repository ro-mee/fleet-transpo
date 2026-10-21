import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";
import { describe, expect, it } from "vitest";

const componentFile = resolve("mobile/components/OffDutyIllustration.jsx");

async function renderIllustration(size) {
  if (!existsSync(componentFile)) return null;

  const nodes = [];
  const { code } = await transform(readFileSync(componentFile, "utf8"), {
    loader: "jsx",
    format: "cjs",
  });
  const scope = { exports: {} };
  const react = {
    ...React,
    memo: component => component,
    createElement: (component, props) => {
      const node = { component, props: props || {} };
      nodes.push(node);
      return node;
    },
  };

  runInNewContext(code, {
    module: scope,
    exports: scope.exports,
    React: react,
    require: name => {
      if (name === "react") return react;
      if (name === "react-native") {
        return { Image: "Image", StyleSheet: { create: value => value } };
      }
      if (name.endsWith("off-duty.webp")) return "off-duty.webp";
      throw new Error(`Unexpected dependency from ${dirname(componentFile)}: ${name}`);
    },
  });

  const Component = scope.exports.default;
  Component({ size });
  return nodes.find(node => node.component === "Image");
}

describe("shared Off Duty illustration", () => {
  it("renders the supplied local artwork as a decorative contained image", async () => {
    expect(existsSync(componentFile)).toBe(true);
    const image = await renderIllustration("card");
    expect(image.props.source).toBe("off-duty.webp");
    expect(image.props.resizeMode).toBe("contain");
    expect(image.props.accessible).toBe(false);
  });

  it("provides compact, card, and hero sizes for the three screen contexts", async () => {
    const compact = await renderIllustration("compact");
    const card = await renderIllustration("card");
    const hero = await renderIllustration("hero");
    const dimensions = node => node.props.style.find(value => value?.width);

    expect(dimensions(compact).width).toBeLessThan(dimensions(card).width);
    expect(dimensions(card).width).toBeLessThan(dimensions(hero).width);
  });

  it.each(["compact", "card", "hero", "unknown"])("overrides bundled image dimensions for %s so artwork cannot fill the screen", async size => {
    const image = await renderIllustration(size);
    // Native Image prepends the asset dimensions before the supplied styles.
    const layout = Object.assign({ width: 800, height: 714 }, ...image.props.style.filter(Boolean));
    expect(layout.width).toBeLessThanOrEqual(160);
    expect(layout.height).toBeLessThanOrEqual(144);
    expect(layout.width / layout.height).toBeCloseTo(800 / 714, 2);
  });
});

describe("Off Duty screen coverage", () => {
  const homeCards = readFileSync("mobile/components/home/DriverHomeCards.jsx", "utf8");
  const home = readFileSync("mobile/app/(app)/(tabs)/index.js", "utf8");
  const trips = readFileSync("mobile/app/(app)/(tabs)/trips.js", "utf8");
  const map = readFileSync("mobile/app/(app)/(tabs)/map.js", "utf8");

  it("uses the shared illustration in Home assignment and Pre-Shift Off Duty states", () => {
    expect(homeCards).toContain("import OffDutyIllustration");
    expect(homeCards).toContain('<OffDutyIllustration size="compact" />');
    expect(home).toContain("import OffDutyIllustration");
    expect(home).toContain('<OffDutyIllustration size="card" />');
  });

  it("uses the shared illustration in the Map Off Duty state", () => {
    expect(map).toContain("import OffDutyIllustration");
    expect(map).toContain('<OffDutyIllustration size="hero" />');
  });

  it("keeps Trips date browsing independent of duty status", () => {
    expect(trips).not.toContain("OffDutyIllustration");
    expect(trips).not.toContain("useDuty");
    expect(trips).not.toContain("DUTY_EMPTY_STATES");
    expect(trips).toContain('accessibilityRole="tablist"');
    expect(trips).toContain('accessibilityLabel="View my work schedule"');
  });

  it("keeps Rest Day and On Leave on their existing distinct icon branches", () => {
    for (const source of [homeCards, map]) {
      expect(source).toContain("calendar-minus");
      expect(source).toContain("calendar-blank-outline");
    }
  });
});
