import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/components/ui/popover",()=>({Popover:({children})=>children,PopoverTrigger:({children})=>children,PopoverContent:({children,collisionPadding: _collisionPadding,...props})=>React.createElement("section",props,children)}));
vi.stubGlobal("React",React);
import { DatePicker } from "./date-picker";
import { DateTimePicker } from "./date-time-picker";
function day(html,n) {return html.match(new RegExp(`<button[^>]*>${n}</button>`))?.[0];}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,24,12));});
afterEach(()=>vi.useRealTimers());
describe("date/time calendar boundaries",()=>{
 it("preserves the existing future-scheduling default",()=>{
  const html=renderToStaticMarkup(React.createElement(DateTimePicker));
  expect(day(html,23)).toContain('disabled=""');expect(day(html,25)).not.toContain('disabled=""');
 });
 it("permits historical observations and disables future dates when requested",()=>{
  const html=renderToStaticMarkup(React.createElement(DateTimePicker,{disablePast:false,disableFuture:true}));
  expect(day(html,23)).not.toContain('disabled=""');expect(day(html,24)).not.toContain('disabled=""');expect(day(html,25)).toContain('disabled=""');
 });
});

it("bounds the popup to available viewport height so a phone can scroll the full calendar",()=>{
 const html=renderToStaticMarkup(React.createElement(DateTimePicker));
 expect(html).toContain("overflow-y-auto");expect(html).toContain("max-height:var(--radix-popover-content-available-height)");
});

it("names shared date-picker month navigation used in service configuration",()=>{
 const html=renderToStaticMarkup(React.createElement(DatePicker));
 expect(html).toContain('aria-label="Previous month"');expect(html).toContain('aria-label="Next month"');
});
