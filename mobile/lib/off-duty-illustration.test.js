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

  it("uses the shared illustration in Trips and Map Off Duty states", () => {
    expect(trips).toContain("import OffDutyIllustration");
    expect(trips).toContain('<OffDutyIllustration size="card" />');
    expect(map).toContain("import OffDutyIllustration");
    expect(map).toContain('<OffDutyIllustration size="hero" />');
  });

  it("keeps Rest Day and On Leave on their existing distinct icon branches", () => {
    for (const source of [homeCards, trips, map]) {
      expect(source).toContain("calendar-minus");
      expect(source).toContain("calendar-blank-outline");
    }
  });
});
