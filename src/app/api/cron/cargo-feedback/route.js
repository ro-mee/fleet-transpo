import { verifyServiceToken } from '@/lib/api/service-auth';
import { ok, err, handleError } from '@/lib/api/utils';
import { deliverCargoFeedback } from '@/services/cargo-feedback.service';

export async function POST(req) {
  try {
    const auth = verifyServiceToken(req, process.env.CRON_SECRET);
    if (!auth.ok) return err(auth.message, auth.status);
    let input = {};
    const reader=req.body?.getReader();
    if(reader){
      const chunks=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();return err('Request is too large.',400);}chunks.push(value);}}
      finally{reader.releaseLock();}
      if(size){const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{return err('Invalid JSON body.',400);}}
    }
    if (!input || typeof input!=='object' || Array.isArray(input)) return err('Invalid feedback worker request.',400);
    const allowed = Object.keys(input || {});
    if (allowed.some(key => key !== 'batch_size')) return err('Invalid feedback worker request.', 400);
    const batchSize = input.batch_size ?? 50;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) return err('Batch size must be between 1 and 100.', 400);
    return ok(await deliverCargoFeedback({ batchSize }));
  } catch (error) { return handleError(error); }
}
