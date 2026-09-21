import { describe, expect, it } from "vitest";
import {
  MAP_INTRO_STAGE_COUNT,
  MAP_INTRO_STAGES,
  advanceMapIntroStage,
  isMapTabIntent,
} from "./map-intro";

describe("Map intro local practice", () => {
  it("defines the five local trip stages in order", () => {
    expect(MAP_INTRO_STAGE_COUNT).toBe(5);
    expect(MAP_INTRO_STAGES.map((stage) => stage.key)).toEqual([
      "start",
      "pickup",
      "guest",
      "destination",
      "dropoff",
    ]);
  });

  it("does not advance after a failed swipe", () => {
    expect(advanceMapIntroStage(2, false)).toBe(2);
  });

  it("advances exactly one stage after a successful swipe", () => {
    expect(advanceMapIntroStage(2, true)).toBe(3);
  });

  it("does not advance beyond the completed local state", () => {
    expect(advanceMapIntroStage(MAP_INTRO_STAGE_COUNT, true)).toBe(
      MAP_INTRO_STAGE_COUNT
    );
  });

  it("recognizes only the Map tab as intentional Map navigation", () => {
    expect(isMapTabIntent("map")).toBe(true);
    expect(isMapTabIntent("index")).toBe(false);
    expect(isMapTabIntent("trips")).toBe(false);
  });
});
