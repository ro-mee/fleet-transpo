import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const screenPath = fileURLToPath(new URL("../components/cargo/CargoDemoScreen.jsx", import.meta.url));
const cache = new Map();
const runtimeIds = new WeakMap();
let nextRuntimeId = 0;
const primitive = tag => function NativePrimitive({ children, accessibilityLabel, accessibilityRole, accessibilityState, onPress }) {
  return React.createElement(tag, {
    "aria-label": accessibilityLabel,
    "aria-pressed": accessibilityState?.selected,
    disabled: accessibilityState?.disabled,
    onClick: onPress,
    role: accessibilityRole,
  }, children);
};
const nativePressable = primitive("button");

async function load(path, reactRuntime = React) {
  if (!existsSync(path)) return null;
  if (!runtimeIds.has(reactRuntime)) runtimeIds.set(reactRuntime, nextRuntimeId++);
  const cacheKey = `${path}:${runtimeIds.get(reactRuntime)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const code = (await transform(readFileSync(path, "utf8"), { loader: "jsx", format: "cjs" })).code;
  const dependencies = {
    react: reactRuntime,
    "react-native": {
      View: primitive("div"),
      Text: primitive("span"),
      Pressable: nativePressable,
      ScrollView: primitive("main"),
      StyleSheet: { create: styles => styles },
    },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "../../lib/theme-context": { useTheme: () => ({ colors: {
      background: "#F5F2EC", onBackground: "#1F2925", onSurface: "#1F2925", onSurfaceVariant: "#53615A",
      surfaceContainerLow: "#FBF8F3", surfaceContainer: "#F4F0E9", surfaceContainerHigh: "#ECE7DE",
      primary: "#285448", primaryContainer: "#DCE9E3", onPrimaryContainer: "#17382F",
      secondaryContainer: "#F1E7D6", onSecondaryContainer: "#5A3D18", outline: "#68736D", outlineVariant: "#D8D5CC",
      success: "#286B54", warning: "#9A4E3C", danger: "#A84340", info: "#3F6A7C",
    }, scheme: "light" }) },
    "../../lib/theme": { fonts: { displayBold: "Display", displaySemiBold: "Display", body: "Body", bodyMedium: "Body", bodySemiBold: "Body Semi", data: "Mono", dataSemiBold: "Mono Semi" } },
  };

  const moduleRecord = { exports: {} };
  for (const match of code.matchAll(/require\("([^" ]+)"\)/g)) {
    const name = match[1];
    if (dependencies[name]) continue;
    const target = resolve(dirname(path), name);
    const candidates = [target, `${target}.jsx`, `${target}.js`];
    const dependencyPath = candidates.find(candidate => existsSync(candidate));
    if (!dependencyPath) throw new Error(`Unexpected screen dependency: ${name}`);
    dependencies[name] = await load(dependencyPath, reactRuntime);
  }

  runInNewContext(code, {
    module: moduleRecord,
    exports: moduleRecord.exports,
    React: reactRuntime,
    require: name => dependencies[name],
  });
  cache.set(cacheKey, moduleRecord.exports);
  return moduleRecord.exports;
}

function findPressable(tree, predicate) {
  if (!tree || typeof tree !== "object") return null;
  if (tree.type === nativePressable && predicate(tree.props || {})) return tree;
  const children = Array.isArray(tree.children) ? tree.children : [tree.children];
  for (const child of children) {
    const found = findPressable(child, predicate);
    if (found) return found;
  }
  return null;
}

function renderedText(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(renderedText).join(" ");
  return renderedText(tree.children);
}

describe("rendered read-only cargo demo", () => {
  it("opens on the shortage wait case and labels every value as simulated", async () => {
    const component = await load(screenPath);
    expect(component?.default).toBeDefined();
    if (!component?.default) return;

    const html = renderToStaticMarkup(React.createElement(component.default, { onBack: () => {} }));

    expect(html).toContain("DEMO ONLY");
    expect(html).toContain("No real trip or order will change");
    expect(html).toContain("Waiting for source decision");
    expect(html).toContain("10");
    expect(html).toContain("9");
    expect(html).toContain(">boxes</span>");
    expect(html).toContain("After recount");
    expect(html).not.toMatch(/Confirm pickup|Report pickup issue|Confirm delivery|Record delivery observation/i);
  });

  it("switches the WAIT sample to its recount without sending a real operation", async () => {
    const state = [];
    let cursor = 0;
    const reactRuntime = {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.length === 1 ? children[0] : children }),
      useState: initial => {
        const index = cursor++;
        if (index === state.length) state.push(initial);
        return [state[index], next => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
      },
    };
    const component = await load(screenPath, reactRuntime);
    expect(component?.default).toBeDefined();
    if (!component?.default) return;
    const render = () => { cursor = 0; return component.default({ onBack: () => {} }); };

    const waiting = render();
    expect(renderedText(waiting)).toContain("Waiting for source decision");
    const recountButton = findPressable(waiting, props => props.accessibilityLabel === "After recount");
    expect(recountButton).not.toBeNull();
    recountButton.props.onPress();

    const recounted = render();
    expect(renderedText(recounted)).toContain("Clean recount recorded");
    expect(renderedText(recounted)).toContain("new receipt for the same trip, manifest and execution");
    expect(renderedText(recounted)).not.toMatch(/Confirm pickup|Report pickup issue|Confirm delivery|Record delivery observation/i);
  });

  it("keeps Guest/VIP examples out of the shared cargo count screen", async () => {
    const state = [];
    let cursor = 0;
    const reactRuntime = {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.length === 1 ? children[0] : children }),
      useState: initial => {
        const index = cursor++;
        if (index === state.length) state.push(initial);
        return [state[index], next => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
      },
    };
    const component = await load(screenPath, reactRuntime);
    expect(component?.default).toBeDefined();
    if (!component?.default) return;
    const render = () => { cursor = 0; return component.default({ onBack: () => {} }); };
    const screen = render();
    const guestButton = findPressable(screen, props => props.accessibilityLabel?.startsWith("Guest / VIP"));
    expect(guestButton).not.toBeNull();
    guestButton.props.onPress();

    const passenger = renderedText(render());
    expect(passenger).toContain("Guest and VIP stay in the passenger flow");
    expect(passenger).not.toContain("BOX COUNT · SIMULATED");
  });
});
