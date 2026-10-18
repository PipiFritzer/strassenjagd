// Parsing and building Google Maps Street View links. No API key is involved:
// the game only opens public Google Maps URLs in a new tab.

const num = s => (s == null || s === '' ? null : Number(s));

// Extracts position and viewing direction from a full Google Maps link.
// Short links (maps.app.goo.gl) carry no coordinates and return null.
export function parseStreetViewLink(raw) {
  const url = (raw || '').trim();
  if (!/^https:\/\//.test(url)) return null;
  let m = url.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)((?:,[\d.]+[a-z])*)/);
  if (m) {
    const parts = {};
    for (const seg of m[3].split(',').filter(Boolean)) parts[seg.slice(-1)] = num(seg.slice(0, -1));
    const tilt = parts.t;
    const out = { lat: num(m[1]), lng: num(m[2]), heading: parts.h ?? 0, pitch: tilt == null ? 0 : tilt - 90, fov: parts.y ?? 75 };
    const pano = url.match(/!1s([A-Za-z0-9_-]{10,})!2e/);
    if (pano) out.pano = pano[1];
    out.streetView = /,3a,/.test(url) || /!1s/.test(url);
    return out;
  }
  m = url.match(/[?&](?:viewpoint|cbll)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) {
    const h = url.match(/[?&]heading=(-?[\d.]+)/), p = url.match(/[?&]pitch=(-?[\d.]+)/);
    return { lat: num(m[1]), lng: num(m[2]), heading: h ? num(h[1]) : 0, pitch: p ? num(p[1]) : 0, fov: 75, streetView: true };
  }
  return null;
}

export const isMapsLink = url => /^https:\/\/(?:[a-z0-9-]+\.)*(?:google\.[a-z.]+|goo\.gl)\//i.test((url || '').trim());

// Official Maps URL that opens Street View at a point (works in the browser and the Maps app).
export function openUrl(f) {
  if (f.streetView === false && f.link) return f.link;
  if (f.lat != null && f.lng != null) {
    const q = new URLSearchParams({ api: '1', map_action: 'pano', viewpoint: `${f.lat},${f.lng}`, heading: String(Math.round(f.heading || 0)), pitch: String(Math.round(f.pitch || 0)), fov: String(Math.round(f.fov || 75)) });
    if (f.pano) q.set('pano', f.pano);
    return 'https://www.google.com/maps/@?' + q.toString();
  }
  return f.link;
}

// Keyless Street View embed. Unofficial: if Google stops serving it, the review
// still shows the "Open in Google Maps" button below the frame.
export function embedUrl(f) {
  if (f.lat == null || f.lng == null || f.streetView === false) return null;
  const cbp = `11,${Math.round(f.heading || 0)},0,0,${Math.round(-(f.pitch || 0))}`;
  return `https://maps.google.com/maps?layer=c&cbll=${f.lat},${f.lng}&cbp=${cbp}&output=svembed`;
}

export function randomStreetViewUrl(spots) {
  const [name, lat, lng] = spots[Math.floor(Math.random() * spots.length)];
  const j = () => (Math.random() - 0.5) * 0.04;
  return { name, url: openUrl({ lat: +(lat + j()).toFixed(5), lng: +(lng + j()).toFixed(5), heading: Math.floor(Math.random() * 360), pitch: 0 }) };
}
