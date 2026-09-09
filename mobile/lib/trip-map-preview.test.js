import { expect, it } from 'vitest';
import { previewEndpoints, previewDocument } from './trip-map-preview';
it('validates real endpoints and safely embeds preview configuration', () => {
  expect(previewEndpoints({})).toBeNull();
  expect(previewEndpoints({ origin_longitude: 181, origin_latitude: 10, destination_longitude: 121, destination_latitude: 14 })).toBeNull();
  const points = previewEndpoints({ origin_longitude: 0, origin_latitude: 0, destination_longitude: 121, destination_latitude: 14 });
  expect(points).toEqual([[0, 0], [121, 14]]);
  const html = previewDocument(points, '</script><script>evil', true);
  expect(html).not.toContain('</script><script>evil');
  expect(html).toContain('calculateRoute');
  expect(html).toContain('map.resize()');
  expect(html).toContain("id:'route-highlight'");
  expect(html).toContain('<radialGradient');
  expect(html).toContain('if(fill)map.setPaintProperty');
  expect(html).not.toContain(":'#EFF0EB'");
  expect(html).toContain("i===0?'Pickup':'Drop-off'");
  expect(html).toContain("'line-color':'#285448'");
});
