import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db',()=>({query:vi.fn()}));
vi.mock('@/lib/integration/booking-gateway',()=>({getBookingGateway:vi.fn()}));
import { query } from '@/lib/db';
import { getBookingGateway } from '@/lib/integration/booking-gateway';
import { emitTransportStatus, reconcileFailedDeliveries } from './outbound.service';
beforeEach(()=>vi.clearAllMocks());
it('keeps an INTERNAL reservation transition entirely local',async()=>{
  const response=await emitTransportStatus({request_id:7,source_system:'INTERNAL',external_booking_id:'internal:7',fleet_status:'Assigned'});
  expect(response).toEqual({delivered:false,gateway:'none',reason:'internal-request'});
  expect(query).not.toHaveBeenCalled();expect(getBookingGateway).not.toHaveBeenCalled();
});
it('never retries an old INTERNAL outbound row or one with INTERNAL payload origin',async()=>{
  query.mockResolvedValueOnce({rows:[{log_id:1,source_system:'INTERNAL',payload:{source_system:'INTERNAL'}},{log_id:2,source_system:'PMS',payload:{source_system:'INTERNAL'}}]});
  const result=await reconcileFailedDeliveries();
  expect(result.retried).toBe(0);expect(getBookingGateway).not.toHaveBeenCalled();expect(query).toHaveBeenCalledTimes(1);
});
