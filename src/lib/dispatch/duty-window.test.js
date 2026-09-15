import { it,expect } from 'vitest';
import { isDriverUnavailableFor } from '@/lib/ai/pair-scoring';

it('permits a future duty window only with loaded schedule and leave evidence; preserves current status protection',()=>{
  const now=new Date(2026,8,13,10), pickup=new Date(2026,8,14,10), returnAt=new Date(2026,8,14,11);
  const shift={day_of_week:1,shift_start:'08:00:00',shift_end:'17:00:00',is_rest_day:false};
  const scheduleContext={schedules:new Map([[7,new Map([[1,shift]])]]),leave:new Map()};
  for (const driver_status of ['On Leave','Off Duty']) {
    const driver={driver_id:7,driver_status,license_expiry:'2028-01-01'};
    expect(isDriverUnavailableFor(driver,now,{pickup,returnAt}).unavailable).toBe(true);
    expect(isDriverUnavailableFor(driver,now,{pickup:now,returnAt:now,scheduleContext}).unavailable).toBe(true);
    expect(isDriverUnavailableFor(driver,now,{pickup,returnAt,scheduleContext}).unavailable).toBe(false);
    expect(isDriverUnavailableFor(driver,now,{pickup,returnAt,scheduleContext:{schedules:new Map(),leave:new Map()}}).unavailable).toBe(true);
    const leave=new Map([[7,[{status:'Approved',start_date:'2026-09-14',end_date:'2026-09-14'}]]]);
    expect(isDriverUnavailableFor(driver,now,{pickup,returnAt,scheduleContext:{...scheduleContext,leave}}).unavailable).toBe(true);
    expect(isDriverUnavailableFor(driver,now,{pickup:new Date(2026,8,14,18),returnAt:new Date(2026,8,14,19),scheduleContext}).unavailable).toBe(true);
  }
  expect(isDriverUnavailableFor({driver_id:7,driver_status:'Suspended'},now,{pickup,returnAt,scheduleContext}).unavailable).toBe(true);
});
