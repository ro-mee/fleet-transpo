import {it,expect,vi} from 'vitest';
vi.mock('@/lib/db',()=>({query:vi.fn()}));
import {recordReservationEvent} from './reservation-events.service';
it('writes assignment evidence using the transaction and propagates audit failure to roll it back',async()=>{
 const db={query:vi.fn(async()=>({rows:[{event_id:4}]}))};
 const event={requestId:1,eventType:'vehicle_assigned',metadata:{forced:true,override_reason:'Verified departure by phone'},db,strict:true};
 expect((await recordReservationEvent(event)).recorded).toBe(true);
 expect(db.query.mock.calls[0][1][7]).toContain('Verified departure by phone');
 db.query.mockRejectedValueOnce(new Error('audit unavailable'));
 await expect(recordReservationEvent(event)).rejects.toThrow('audit unavailable');
 await expect(recordReservationEvent({...event,eventType:null})).rejects.toThrow('requires a request and event type');
});
