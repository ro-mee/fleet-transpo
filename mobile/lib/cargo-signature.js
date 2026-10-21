// Only numeric strokes cross the WebView bridge. Signer text never enters HTML.
export function parseCargoSignatureMessage(data) {
  if (typeof data !== "string" || data.length > 100000) throw new Error("The drawing is too large. Clear it and sign again.");
  const message = JSON.parse(data);
  if (!message || Object.keys(message).sort().join(",") !== "strokes,type" || message.type !== "signature" || !Array.isArray(message.strokes) || message.strokes.length > 64) throw new Error("The drawing could not be read. Clear it and sign again.");
  let points = 0;
  for (const stroke of message.strokes) {
    if (!Array.isArray(stroke) || stroke.length < 1 || (points += stroke.length) > 2048) throw new Error("The drawing is too large. Clear it and sign again.");
    for (const point of stroke) if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || point[0] < 0 || point[0] > 600 || point[1] < 0 || point[1] > 240) throw new Error("The drawing could not be read. Clear it and sign again.");
  }
  return { width: 600, height: 240, strokes: message.strokes };
}

export function cargoSignatureHtml({ ink, background } = {}) {
  const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${color(background, "#FBF8F3")}}canvas{width:100%;height:100%;touch-action:none;display:block}</style></head><body><canvas id="drawing" width="600" height="240" aria-label="Draw signature"></canvas><script>
var canvas=document.getElementById('drawing'),ctx=canvas.getContext('2d'),strokes=[],active=null,total=0;
ctx.strokeStyle='${color(ink, "#1F2925")}';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';
function point(e){var r=canvas.getBoundingClientRect();return [Math.round(Math.max(0,Math.min(600,(e.clientX-r.left)*600/r.width))*10)/10,Math.round(Math.max(0,Math.min(240,(e.clientY-r.top)*240/r.height))*10)/10];}
function send(){window.ReactNativeWebView.postMessage(JSON.stringify({type:'signature',strokes:strokes}));}
function stop(e){e.preventDefault();if(active){if(active.length<2){strokes.pop();total--;}active=null;send();}}
canvas.addEventListener('pointerdown',function(e){e.preventDefault();if(active||strokes.length>=64||total>=2048)return;active=[point(e)];strokes.push(active);total++;canvas.setPointerCapture(e.pointerId);ctx.beginPath();ctx.moveTo(active[0][0],active[0][1]);send();});
canvas.addEventListener('pointermove',function(e){e.preventDefault();if(!active||total>=2048)return;var p=point(e),last=active[active.length-1];if(p[0]===last[0]&&p[1]===last[1])return;active.push(p);total++;ctx.lineTo(p[0],p[1]);ctx.stroke();});
canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);
</script></body></html>`;
}

export async function captureCargoSignatureLocation(location, { timeoutMs = 8000, now = Date.now, isCurrent = () => true } = {}) {
  let timer, expired = false;
  try {
    return await Promise.race([
      (async () => {
        if (!(await location.requestForegroundPermissionsAsync()).granted || expired || !isCurrent()) return null;
        const fix = await location.getCurrentPositionAsync({ accuracy: location.Accuracy?.Balanced });
        if (expired || !isCurrent()) return null;
        const { latitude, longitude, accuracy } = fix?.coords || {};
        if (![latitude, longitude, accuracy, fix?.timestamp].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0 || accuracy > 10000 || now() - fix.timestamp > 60000 || fix.timestamp > now() + 60000) return null;
        return { latitude, longitude, accuracy_m: accuracy, captured_at: new Date(fix.timestamp).toISOString() };
      })(),
      new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(null); }, timeoutMs); }),
    ]);
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// Compare the exact visible count, issues and authority before accepting a drawing.
export function cargoSignatureContextKey({ identity, manifestHash, assignment, form }) {
  return JSON.stringify([identity, manifestHash, assignment, form?.counts || {}, form?.issues || {}]);
}
