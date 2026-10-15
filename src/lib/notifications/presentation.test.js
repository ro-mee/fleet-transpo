import { expect, it } from "vitest";
import { notificationCategory } from "./presentation";
it("labels fuel diagnostic notifications as Maintenance", () => {
  expect(notificationCategory("fuel_diagnostic").label).toBe("Maintenance");
});
