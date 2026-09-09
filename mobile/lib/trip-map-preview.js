export function previewEndpoints(trip) {
  const values = [trip?.origin_longitude, trip?.origin_latitude, trip?.destination_longitude, trip?.destination_latitude];
  if (values.some(v => v == null || v === '' || !Number.isFinite(Number(v)))) return null;
  const [lng, lat, endLng, endLat] = values.map(Number);
  if (Math.abs(lng) > 180 || Math.abs(endLng) > 180 || Math.abs(lat) > 85 || Math.abs(endLat) > 85) return null;
  return [[lng, lat], [endLng, endLat]];
}

// Only serialized coordinates/config enter the document, never raw trip text.
export function previewDocument(points, key, airport = false) {
  const config = JSON.stringify({ points, key, airport }).replaceAll('<', '\\u003c');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="stylesheet" href="https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps.css">
  <style>html,body,#map{margin:0;width:100%;height:100%;background:#F2F3EF;overflow:hidden}
  .pin{width:28px;height:36px;filter:drop-shadow(0 3px 3px #183B3445)}
  .pin-label{position:absolute;left:50%;top:-18px;transform:translateX(-50%);white-space:nowrap;border-radius:8px;background:#F8FAF5;color:#285448;padding:2px 5px;font:600 10px/13px system-ui,sans-serif;box-shadow:0 2px 4px #183B3420}
  </style></head><body><div id="map"></div>
  <script src="https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps-web.min.js"></script>
  <script src="https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/services/services-web.min.js"></script>
  <script>
  const config=${config};
  const send=state=>window.ReactNativeWebView?.postMessage(state);
  try {
    const map=tt.map({key:config.key,container:'map',center:config.points[0],zoom:12,interactive:false,stylesVisibility:{trafficIncidents:false,trafficFlow:false}});
    let fittedCoords=config.points;
    const fit=coords=>{fittedCoords=coords;const bounds=new tt.LngLatBounds();coords.forEach(p=>bounds.extend(p));const h=map.getContainer().clientHeight;map.fitBounds(bounds,{padding:{top:Math.min(58,h*0.4),bottom:Math.min(20,h*0.15),left:36,right:36},maxZoom:16,duration:0});};
    new ResizeObserver(()=>{map.resize();if(map.loaded())fit(fittedCoords);}).observe(document.getElementById('map'));
    map.on('load',async()=>{
      try {
        // Same provider style API as TomTomMap, scoped to this light preview.
        for(const layer of map.getStyle().layers||[]){
          const id=layer.id.toLowerCase();
          if(layer.type==='background') map.setPaintProperty(layer.id,'background-color','#F2F3EF');
          // Preserve provider land-use/airport detail instead of flattening every fill.
          if(layer.type==='fill') {
            const fill=id.includes('water')?'#CBE4EA':/park|forest|vegetation/.test(id)?'#D9E8D9':id.includes('building')?'#DDE1DD':null;
            if(fill)map.setPaintProperty(layer.id,'fill-color',fill);
          }
          if(layer.type==='line'&&/road|street|highway/.test(id))map.setPaintProperty(layer.id,'line-color',/casing|outline/.test(id)?'#E0E3DE':'#FAFBF7');
          if(layer.type==='symbol'){
            if(/poi|transit|rail|shield/.test(id))map.setLayoutProperty(layer.id,'visibility','none');
            else {map.setPaintProperty(layer.id,'text-color','#7C8D91');map.setPaintProperty(layer.id,'text-halo-color','#F8FAF7');}
          }
        }
        config.points.forEach((p,i)=>{
          const el=document.createElement('div');el.className='pin';
          const center=i===1&&config.airport?'<path d="M7 13l6 1 4-6 2 1-3 7 4 3-1 2-5-2-3 4-2-1 1-5-4-2z" fill="white"/>':'<circle cx="14" cy="13" r="4.5" fill="white"/>';
          el.innerHTML='<svg width="28" height="36" viewBox="0 0 28 36"><defs><radialGradient id="g" cx="32%" cy="22%" r="82%"><stop stop-color="#369E7E"/><stop offset="0.55" stop-color="#17684F"/><stop offset="1" stop-color="#173E33"/></radialGradient></defs><path d="M14 1C6 1 1 7 1 14c0 9 13 21 13 21s13-12 13-21C27 7 22 1 14 1z" fill="url(#g)"/><path d="M4 13C4 7 8 4 14 4c4 0 7 2 9 5" fill="none" stroke="white" stroke-opacity="0.3" stroke-width="1.5" stroke-linecap="round"/><circle cx="14" cy="13.7" r="5.8" fill="#103A2D" opacity="0.18"/>'+center+'</svg>';
          const label=document.createElement('span');label.className='pin-label';label.textContent=i===0?'Pickup':'Drop-off';el.appendChild(label);
          el.setAttribute('aria-label',label.textContent);
          new tt.Marker({element:el,anchor:'bottom'}).setLngLat(p).addTo(map);
        });
        fit(config.points);
        const response=await tt.services.calculateRoute({key:config.key,locations:config.points.map(p=>p.join(',')).join(':'),traffic:false,maxAlternatives:0});
        const feature=response.toGeoJson()?.features?.[0];
        if(feature?.geometry?.type!=='LineString'||feature.geometry.coordinates.length<2)throw new Error('No route');
        map.addSource('preview-route',{type:'geojson',data:feature});
        map.addLayer({id:'route-shadow',type:'line',source:'preview-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#183B34','line-width':12,'line-opacity':0.22,'line-blur':3,'line-translate':[0,3]}});
        map.addLayer({id:'route',type:'line',source:'preview-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#285448','line-width':8}});
        map.addLayer({id:'route-body',type:'line',source:'preview-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#247A5D','line-width':5.5}});
        map.addLayer({id:'route-highlight',type:'line',source:'preview-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#89BFA7','line-width':1.5,'line-opacity':0.55,'line-translate':[0,-1]}});
        fit([...config.points,...feature.geometry.coordinates]);
        map.once('idle',()=>send('ready'));
      }catch{send('unavailable');}
    });
  }catch{send('unavailable');}
  </script></body></html>`;
}
