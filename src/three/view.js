// Camera distance and visual detail are independent of the basemap tile zoom.
export const VIEW = Object.freeze({
  desktop: 13.65,
  mobile: 13.35,
  nearest: 16.5,
  atlas: 11.8,
  fullHeight: 12.3,
  traffic: 12.8,
  pitch: 40,
});
// A smaller composition stage changes viewport pixels, not the city's detail.
export const sceneZoom = (map) => map.getZoom() + (map.lumenZoomOffset || 0);
