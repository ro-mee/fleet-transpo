import { finiteNumberInRange } from './map-webview-data';
import { navigationPhaseForStatus } from './trip-navigation-phase';

export function navigationTarget(trip) {
  const phase = navigationPhaseForStatus(trip?.trip_status);
  if (!phase) return null;
  const pickup = phase === 'to_pickup';
  const provenance = pickup ? trip.pickup_location_provenance : trip.dropoff_location_provenance;
  if (provenance && provenance !== 'canonical_registry') return null;
  const lat = finiteNumberInRange(pickup ? trip.origin_latitude : trip.destination_latitude, -90, 90);
  const lng = finiteNumberInRange(pickup ? trip.origin_longitude : trip.destination_longitude, -180, 180);
  return lat == null || lng == null ? null : { lat, lng };
}

export function externalNavigationUrl(target) {
  const lat = finiteNumberInRange(target?.lat, -90, 90);
  const lng = finiteNumberInRange(target?.lng, -180, 180);
  return lat == null || lng == null ? null : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}&travelmode=driving&dir_action=navigate`;
}

// Executed inside the native WebView and in the runtime tests. Keeping this as
// source avoids bundler helpers leaking through a serialized function closure.
export const ROUTE_CONTROLLER_SCRIPT = String.raw`
(function () {
  var config = window.fleetRouteConfig;
  var preferences = { avoidTolls: config.avoidTolls === true, selectedIndex: config.selectedIndex || 0 };
  var candidates = [];
  var requestId = 0;
  function send(type, data) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: type, sessionKey: config.sessionKey, tripId: config.tripId }, data)));
  }
  function coordinate(value, min, max) {
    return value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
  }
  function summaries() {
    return candidates.map(function (candidate, index) {
      return Object.assign({ index: index }, candidate.route.summary);
    });
  }
  function draw(index) {
    var candidate = candidates[index];
    if (!candidate) return;
    var map = window.ttMap;
    (window.badgeMarkers || []).forEach(function (marker) { marker.remove(); });
    window.badgeMarkers = [];
    var geojson = window.buildTrafficSegments
      ? window.buildTrafficSegments(candidate.feature, candidate.route, false)
      : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { color: config.primary }, geometry: candidate.feature.geometry }] };
    if (map.getLayer('alt-route')) {
      map.removeLayer('alt-route');
      if (map.getSource('alt-route')) map.removeSource('alt-route');
    }
    // Route geometry refreshes only on fetch/recalculate — never on GPS
    // ticks. Prefer the fleet layer updater when the document provides it.
    if (window.__updateRoutePolyline) {
      window.__updateRoutePolyline(geojson);
    } else if (map.getLayer('route')) map.getSource('route').setData(geojson);
    else map.addLayer({ id: 'route', type: 'line', source: { type: 'geojson', data: geojson }, paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': 1 } });
    preferences.selectedIndex = index;
    window.routeCoords = candidate.feature.geometry.coordinates;
    window.routeInstructions = candidate.route.guidance ? candidate.route.guidance.instructions : [];
    window.cumDist = null;
    window.lastClosestIdx = 0;
    window.offRouteCount = 0;
    window.lastRouteAt = candidate.calculatedAt;
    send('ROUTE_CALCULATED', Object.assign({}, candidate.route.summary, {
      calculatedAt: window.lastRouteAt, trafficAware: config.traffic,
      routes: summaries(), preferences: preferences
    }));
    if (window.updateNavigationBanner) window.updateNavigationBanner(window.currentCarLng, window.currentCarLat);
  }
  window.recalculateRoute = function (carLng, carLat, requested) {
    if (!coordinate(carLng, -180, 180) || !coordinate(carLat, -90, 90) ||
        !coordinate(window.currentDestLng, -180, 180) || !coordinate(window.currentDestLat, -90, 90)) {
      send('ROUTE_UNAVAILABLE', { reason: 'MISSING_LOCATION', retained: candidates.length > 0 });
      return Promise.resolve(false);
    }
    if (window.isRecalculating && !requested) return Promise.resolve(false);
    var id = ++requestId;
    var next = requested || preferences;
    var avoidTolls = next.avoidTolls === true;
    var selectedIndex = Number.isInteger(next.selectedIndex) && next.selectedIndex >= 0 ? next.selectedIndex : 0;
    window.isRecalculating = true;
    window.lastCalcCarLng = carLng;
    window.lastCalcCarLat = carLat;
    send('ROUTE_REFRESHING', { retained: candidates.length > 0 });
    var options = {
      key: config.key, traffic: config.traffic, computeTravelTimeFor: 'all',
      maxAlternatives: config.alternatives ? 2 : 0, instructionsType: 'text',
      locations: carLng + ',' + carLat + ':' + window.currentDestLng + ',' + window.currentDestLat
    };
    if (config.traffic) options.sectionType = 'traffic';
    if (avoidTolls) options.avoid = 'tollRoads';
    var timeout;
    var provider = Promise.resolve().then(function () { return tt.services.calculateRoute(options); });
    var deadline = new Promise(function (_, reject) { timeout = setTimeout(function () { reject(new Error('Route timed out')); }, 20000); });
    return Promise.race([provider, deadline]).then(function (response) {
      clearTimeout(timeout);
      if (id !== requestId) return false;
      var features = response.toGeoJson().features || [];
      var valid = (response.routes || []).map(function (route, index) {
        return { route: route, feature: features[index], calculatedAt: Date.now() };
      }).filter(function (candidate) {
        var summary = candidate.route.summary;
        var geometry = candidate.feature && candidate.feature.geometry;
        return summary && Number.isFinite(summary.travelTimeInSeconds) && summary.travelTimeInSeconds >= 0 &&
          Number.isFinite(summary.lengthInMeters) && summary.lengthInMeters >= 0 &&
          geometry && geometry.type === 'LineString' && geometry.coordinates.length >= 2 &&
          geometry.coordinates.every(function (point) { return coordinate(point[0], -180, 180) && coordinate(point[1], -90, 90); });
      });
      if (!valid.length) throw new Error('No valid route');
      var previousCandidates = candidates;
      var previousPreferences = preferences;
      candidates = valid;
      preferences = { avoidTolls: avoidTolls, selectedIndex: selectedIndex < valid.length ? selectedIndex : 0 };
      window.isRecalculating = false;
      try { draw(preferences.selectedIndex); }
      catch (error) {
        candidates = previousCandidates;
        preferences = previousPreferences;
        throw error;
      }
      return true;
    }).catch(function () {
      clearTimeout(timeout);
      if (id !== requestId) return false;
      window.isRecalculating = false;
      send('ROUTE_UNAVAILABLE', { retained: candidates.length > 0, preferences: preferences });
      return false;
    });
  };
  window.applyRoutePreferences = function (requested) {
    if (requested.avoidTolls === preferences.avoidTolls && candidates[requested.selectedIndex] && !window.isRecalculating) {
      // Invalidate any earlier request before selecting a provider-backed route.
      ++requestId;
      try { draw(requested.selectedIndex); }
      catch (_) { send('ROUTE_UNAVAILABLE', { retained: candidates.length > 0, preferences: preferences }); }
      return;
    }
    window.recalculateRoute(window.currentCarLng, window.currentCarLat, requested);
  };
})();
`;
