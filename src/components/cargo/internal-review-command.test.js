import { it, expect } from 'vitest';
import { createCargoDecisionCommandManager } from './cargo-decision-command';

it('freezes the exact reviewed images and securement attestations across uncertain retries',async()=>{
  const ids=['image-1'],checks={load_secured:true,vehicle_safe:true,counts_reviewed:true};let calls=0;const sent=[];
  const commands=createCargoDecisionCommandManager({createId:()=> 'stable',send:async(id,payload)=>{sent.push(payload);if(++calls===1)throw new Error('Response lost');return {saved:true};}});
  expect((await commands.submit({tripId:7,createPayload:event_id=>({event_id,reviewed_evidence_ids:ids,securement_checks:checks})})).status).toBe('uncertain');
  ids.push('different-image');checks.load_secured=false;
  expect((await commands.submit({tripId:7,createPayload:()=>{throw Error('Must retry the original command');}})).status).toBe('accepted');
  expect(sent[1].reviewed_evidence_ids).toEqual(['image-1']);expect(sent[1].securement_checks.load_secured).toBe(true);
});
