import { describe,it,expect } from 'vitest';
import { requestLocationContext,resolveLocationRelevance,qualifiedGps,omitStandbyStorage } from './location-relevance';
const now = new Date('2026-09-13T04:00:00Z');
const request = minutes => ({ fleet_status:'Pending',pickup_datetime:new Date(+now+minutes*60_000).toISOString() });
const fix = { latitude:14.6,longitude:121,accuracy:10,observed_at:now.toISOString() };
describe('request-specific location policy', () => {
  it('withholds standby storage fields even in nested generic API responses',()=>{
    const value={driver:{driver_id:1,standby_latitude:14.6,standby_session_family:'private',location_observed_at:now},date:now};
    expect(JSON.parse(JSON.stringify(value,omitStandbyStorage))).toEqual({driver:{driver_id:1},date:now.toISOString()});
  });
  it('covers the horizon, trusted departure, overdue and non-actionable requests', () => {
    expect(requestLocationContext(request(90),now).urgency).toBe('SHORT_NOTICE');
    expect(requestLocationContext(request(90.01),now).urgency).toBe('SCHEDULED');
    expect(requestLocationContext(request(180),now).urgency).toBe('SCHEDULED');
    expect(requestLocationContext(request(-5),now).reasonCode).toBe('OVERDUE_REQUEST');
    expect(requestLocationContext({...request(-5),fleet_status:'Cancelled'},now).urgency).toBe('SCHEDULED');
    expect(requestLocationContext({fleet_status:'Pending'},now).urgency).toBe('SCHEDULED');
    expect(requestLocationContext({...request(150),planned_departure_at:request(15).pickup_datetime},now).urgency).toBe('SCHEDULED');
    expect(requestLocationContext(request(150),now,{at:request(15).pickup_datetime,source:'itinerary'}).urgency).toBe('SHORT_NOTICE');
  });
  it('requires observed-time freshness and accuracy, including boundary and future skew', () => {
    expect(qualifiedGps({...fix,observed_at:new Date(+now-90_000)},now).eligible).toBe(true);
    for(const change of [{observed_at:new Date(+now-90_001)},{observed_at:new Date(+now+30_001)},{accuracy:null},{accuracy:101},{latitude:null}])
      expect(qualifiedGps({...fix,...change},now).eligible).toBe(false);
  });
  it('resolves modes per candidate and suppresses scheduled GPS entirely', () => {
    expect(resolveLocationRelevance({request:request(30),now,fix,readyNow:true}).liveLocationUsed).toBe(true);
    expect(resolveLocationRelevance({request:request(30),now}).mode).toBe('IMMEDIATE');
    expect(resolveLocationRelevance({request:request(30),now,fix,preceding:{dispatch_id:1,origin:{lat:14,lng:121}}}).mode).toBe('REPOSITION');
    const scheduled=resolveLocationRelevance({request:request(1440),now,fix,readyNow:true});
    expect(scheduled).toEqual(resolveLocationRelevance({request:request(1440),now}));
    expect(scheduled).not.toHaveProperty('gpsHealth');
  });
});
