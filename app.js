// =========================
// Kakao Map 기본 설정
// =========================
const MAP_CENTER = new kakao.maps.LatLng(37.5665, 126.9780);
const mapContainer = document.getElementById('map');
const mapOption = { center: MAP_CENTER, level: 8 };
const map = new kakao.maps.Map(mapContainer, mapOption);

const clusterer = new kakao.maps.MarkerClusterer({ map: map, averageCenter: true, minLevel: 7 });

// =========================
// 전역 상태
// =========================
const binMarkers = [];
let meMarker = null, meCircle = null, routePolyline = null, highlightPolygon = null;
let guPolys = [];
let nearestMarkerInfo = null;

let selectionOverlay = new kakao.maps.CustomOverlay({ yAnchor: 1.2, zIndex: 100, clickable: true });
let currentlyClickedMarker = null;

// SVG 마커(403 방지)
const svgPin = (color) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 24 34">
  <defs>
    <filter id="s" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-opacity=".25"/>
    </filter>
  </defs>
  <path filter="url(#s)" fill="${color}" d="M12 1.5a9 9 0 0 0-9 9c0 6.8 9 20 9 20s9-13.2 9-20a9 9 0 0 0-9-9z"/>
  <circle cx="12" cy="10.5" r="3.2" fill="#fff"/>
</svg>`);

let defaultMarkerImage = new kakao.maps.MarkerImage(
  svgPin('#10b981'),
  new kakao.maps.Size(30, 42), { offset: new kakao.maps.Point(15, 42) }
);
let redMarkerImage = new kakao.maps.MarkerImage(
  svgPin('#ef4444'),
  new kakao.maps.Size(30, 42), { offset: new kakao.maps.Point(15, 42) }
);
let imageA = new kakao.maps.MarkerImage(
  svgPin('#ef4444'),
  new kakao.maps.Size(30, 42), { offset: new kakao.maps.Point(15, 42) }
);
let imageB = new kakao.maps.MarkerImage(
  svgPin('#3b82f6'),
  new kakao.maps.Size(30, 42), { offset: new kakao.maps.Point(15, 42) }
);

// =========================
// 공용 유틸
// =========================
function setInfo(html){ document.getElementById('info').innerHTML = html; }
function clearVisual(){
  if (routePolyline) { routePolyline.setMap(null); routePolyline = null; }
  if (highlightPolygon) { highlightPolygon.setMap(null); highlightPolygon = null; }
  if (nearestMarkerInfo && nearestMarkerInfo.marker) { nearestMarkerInfo.marker.setImage(defaultMarkerImage); nearestMarkerInfo = null; }
}
function toNumber(v){
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/[,\s]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}
function isWgs84(lat, lon){ return lat >= 33 && lat <= 39 && lon >= 124 && lon <= 132; }
const metersToText = (m)=> (m>=1000? (m/1000).toFixed(2)+' km' : Math.round(m)+' m');

// =========================
// 데이터 로드 (CSV/GeoJSON)
// =========================
async function loadCsvFromUrl(url){
  const res = await fetch(encodeURI(url));
  if (!res.ok) throw new Error('CSV HTTP ' + res.status);
  const text = await res.text();
  return Papa.parse(text, { header: true, skipEmptyLines: true });
}

function setMarkersFromRows(rows){
  clusterer.clear();
  binMarkers.length = 0;
  const headers = rows.meta?.fields || Object.keys(rows.data?.[0] || {});
  const hLow = headers.map(h => h.toLowerCase());
  const latKey = headers[hLow.indexOf('lat')];
  const lonKey = headers[hLow.indexOf('lon')];
  let labelKey = null;
  const labelCandidates = ['name','이름','명칭','설치위치','주소','address','place','location','위치','지점명','title'];
  for (const c of labelCandidates) { const i = hLow.indexOf(c); if (i !== -1) { labelKey = headers[i]; break; } }
  if (!latKey || !lonKey){ setInfo('<small>CSV에 lat/lon 컬럼이 없습니다.</small>'); return; }

  const newMarkers = [];
  rows.data.forEach(row => {
    const lat = toNumber(row[latKey]); const lon = toNumber(row[lonKey]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isWgs84(lat, lon)) return;

    const name = labelKey ? (row[labelKey] ?? '') : '';
    const position = new kakao.maps.LatLng(lat, lon);
    const marker = new kakao.maps.Marker({ position: position, image: defaultMarkerImage });

    kakao.maps.event.addListener(marker, 'click', function() {
      selectionOverlay.setMap(null);
      currentlyClickedMarker = marker;

      // 내 위치와의 직선거리 안내(가능할 때)
      let distLine = '';
      if (meMarker) {
        const d = distanceMeters(latlng, bm.kakaoMarker.getPosition());
        distLine = `<div style="font-size:12px;color:#374151;margin-top:4px;">내 위치까지 약 <b>${metersToText(d)}</b></div>`;
      } else {
        distLine = `<div style="font-size:12px;color:#6b7280;margin-top:4px;">(내 위치 버튼을 먼저 눌러주세요)</div>`;
      }

      const content = `
        <div style="padding:8px; background:white; border-radius:8px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); display:flex; flex-direction:column; gap:6px; font-size:12px;">
          <div style="display:flex; gap:6px;">
            <button class="marker-btn" data-action="setAsA" style="border:1px solid #ddd; background:#fff; padding:4px 8px; border-radius:6px; cursor:pointer;">출발</button>
            <button class="marker-btn" data-action="setAsB" style="border:1px solid #ddd; background:#fff; padding:4px 8px; border-radius:6px; cursor:pointer;">도착</button>
            <button class="marker-btn" data-action="routeFromMe" style="border:1px solid #2563eb; color:#2563eb; background:#fff; padding:4px 8px; border-radius:6px; cursor:pointer;">내 위치→경로</button>
          </div>
          ${distLine}
        </div>`;
      selectionOverlay.setContent(content);
      selectionOverlay.setPosition(marker.getPosition());
      selectionOverlay.setMap(map);
    });

    binMarkers.push({ kakaoMarker: marker, meta: { name: String(name || '휴지통'), lat, lon } });
    newMarkers.push(marker);
  });

  clusterer.addMarkers(newMarkers);

  if (binMarkers.length){
    const bounds = new kakao.maps.LatLngBounds();
    binMarkers.forEach(bm => bounds.extend(bm.kakaoMarker.getPosition()));
    map.setBounds(bounds);
    setInfo(`<small>불러온 휴지통: <b>${binMarkers.length}</b>개</small>`);
    document.getElementById('chips').innerHTML = '<span class="pill">CSV 로드 완료</span>';
  } else {
    setInfo('<small>마커가 없습니다. CSV의 lat/lon 값을 확인하세요.</small>');
  }
}

async function loadGeoFromUrl(url){
  const res = await fetch(encodeURI(url));
  if (!res.ok) throw new Error('GEO HTTP ' + res.status);
  return res.json();
}
function isSeoulProps(props){
  if (!props) return false;
  const candid = [props.CTP_KOR_NM, props.SIDO, props.sido, props.sido_nm, props.SIDO_NM, props.광역시도명, props.시도명].filter(Boolean).map(String);
  if (candid.some(v => v.includes('서울특별시') || v === '서울특별시')) return true;
  for (const k of ['SIG_CD','SIGCD','ADM_CD','adm_cd','sig_cd','sgg_cd']) { if (props[k] && String(props[k]).startsWith('11')) return true; }
  try { for (const k in props){ if (String(props[k]).includes('서울특별시')) return true; } } catch(_){}
  return false;
}
function findGuName(props){
  const keys = ['SIG_KOR_NM','SIG_ENG_NM','SIG_KOR','SIG_NM','gu','GU_NAME','name','AdmNm','adm_nm'];
  for (const k of keys){ if (props && props[k]) return String(props[k]); }
  for (const k in props){ const v = String(props[k]); if (v.endsWith('구')) return v; }
  return null;
}

function createKakaoPolygonFromGeoJSON(feature) {
  let paths = [];
  const coordinates = feature.geometry.coordinates;
  const type = feature.geometry.type;

  if (type === 'Polygon') {
    paths.push(coordinates[0].map(c => new kakao.maps.LatLng(c[1], c[0])));
  } else if (type === 'MultiPolygon') {
    coordinates.forEach(poly => paths.push(poly[0].map(c => new kakao.maps.LatLng(c[1], c[0]))));
  }
  return new kakao.maps.Polygon({ path: paths, strokeWeight: 1, strokeColor: '#374151', strokeOpacity: 0.8, fillColor: '#374151', fillOpacity: 0.05 });
}

function buildGuLayers(geojson){
  guPolys.forEach(g => { if(g.kakaoPolygon) g.kakaoPolygon.setMap(null); });
  guPolys = [];
  const features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
  const seoulFeats = features.filter(f => isSeoulProps(f.properties));
  seoulFeats.forEach(f => {
    const name = findGuName(f.properties || {}) || '(이름없음)';
    const kakaoPolygon = createKakaoPolygonFromGeoJSON(f);
    kakaoPolygon.setMap(map);
    guPolys.push({ name, feature: f, kakaoPolygon: kakaoPolygon });
  });

  const sel = document.getElementById('selGu'), datalist = document.getElementById('guList');
  sel.innerHTML = '<option value="">– (서울) 구 선택 –</option>';
  datalist.innerHTML = '';
  [...new Set(guPolys.map(g => g.name))].sort().forEach(n => {
    const opt = document.createElement('option'); opt.value = n; datalist.appendChild(opt);
    const o2 = document.createElement('option'); o2.value = n; o2.textContent = n; sel.appendChild(o2);
  });
  document.getElementById('chips').innerHTML += ' <span class="pill seoul">GeoJSON (서울만) 로드 완료</span>';
}

function highlightGu(name){
  if (highlightPolygon) { highlightPolygon.setMap(null); highlightPolygon = null; }

  const foundFeats = guPolys.filter(g => g.name === name).map(g => g.feature);
  if (!foundFeats.length){ return; }

  let combinedGeom = foundFeats[0];
  for (let i = 1; i < foundFeats.length; i++) { try { combinedGeom = turf.union(combinedGeom, foundFeats[i]); } catch (e) { console.error("Turf union failed:", e); } }

  let paths = [];
  if (combinedGeom.geometry.type === 'Polygon') {
    paths.push(combinedGeom.geometry.coordinates[0].map(c => new kakao.maps.LatLng(c[1], c[0])));
  } else if (combinedGeom.geometry.type === 'MultiPolygon') {
    combinedGeom.geometry.coordinates.forEach(poly => paths.push(poly[0].map(c => new kakao.maps.LatLng(c[1], c[0]))));
  }

  highlightPolygon = new kakao.maps.Polygon({ path: paths, strokeWeight: 3, strokeColor: '#2563eb', strokeOpacity: 0.8, fillColor: '#2563eb', fillOpacity: 0.08 });
  highlightPolygon.setMap(map);

  const bounds = new kakao.maps.LatLngBounds();
  paths.flat().forEach(latlng => bounds.extend(latlng));
  map.setBounds(bounds);
}

// =========================
// 이벤트: 구 선택/검색
// =========================
document.getElementById('selGu').addEventListener('change', (e) => {
  const name = e.target.value;
  clearVisual();
  if (name) highlightGu(name);
});
document.getElementById('inpGuSearch').addEventListener('change', (e) => {
  const name = e.target.value;
  const sel = document.getElementById('selGu');
  if (Array.from(sel.options).some(o => o.value === name)){
    sel.value = name;
    sel.dispatchEvent(new Event('change'));
  } else {
    alert('서울 구 목록에서 찾을 수 없습니다.');
  }
});

// =========================
// 유틸: 구 내부/대표 휴지통
// =========================
function binsInGu(name){
  const feats = guPolys.filter(g => g.name === name).map(g => g.feature);
  if (!feats.length) return [];
  let geom = feats[0];
  for (let i=1;i<feats.length;i++){ try{ geom = turf.union(geom, feats[i]); }catch(e){} }
  return binMarkers.filter(bm => turf.booleanPointInPolygon(
    turf.point([bm.kakaoMarker.getPosition().getLng(), bm.kakaoMarker.getPosition().getLat()]),
    geom
  ));
}

function bestBinOfGu(name){
  const feats = guPolys.filter(g => g.name === name).map(g => g.feature);
  if (!feats.length) return null;
  let geom = feats[0];
  for (let i=1;i<feats.length;i++){ try{ geom = turf.union(geom, feats[i]); }catch(e){} }
  const centroid = turf.centroid(geom).geometry.coordinates; // [lon,lat]
  const centerLatLng = new kakao.maps.LatLng(centroid[1], centroid[0]);

  let bestBin = null, bestD = Infinity;
  binsInGu(name).forEach(bm => {
    const d = kakao.maps.LatLng.prototype.getDistance(centerLatLng, bm.kakaoMarker.getPosition());
    if (d < bestD){ bestD = d; bestBin = bm; }
  });
  return bestBin;
}

// =========================
// 라우팅 (도보)
// =========================
function nearestBinFrom(latlng){
  let bestBin = null, bestD = Infinity;
  binMarkers.forEach(bm => {
    const d = kakao.maps.LatLng.prototype.getDistance(latlng, bm.kakaoMarker.getPosition());
    if (d < bestD){ bestD = d; bestBin = bm; }
  });
  return { marker: bestBin ? bestBin.kakaoMarker : null, meters: bestD };
}

async function routeFoot(src, dst){
  const url = `https://router.project-osrm.org/route/v1/foot/${src.getLng()},${src.getLat()};${dst.getLng()},${dst.getLat()}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes || !data.routes[0]) return null;
  return data.routes[0];
}

// =========================
// 가까운 3개 휴지통 기능
// =========================
let nearestMarks = [];
let nearestInfoWindows = [];

function clearNearest() {
  nearestMarks.forEach(m => m.setImage(defaultMarkerImage));
  nearestMarks = [];
  nearestInfoWindows.forEach(iw => iw.close && iw.close());
  nearestInfoWindows = [];
}

function nearestKBinsFrom(latlng, k = 3) {
  const arr = binMarkers.map(bm => ({
    bm,
    d: distanceMeters(latlng, bm.kakaoMarker.getPosition())
  }));
  arr.sort((a, b) => a.d - b.d);
  return arr.slice(0, Math.min(k, arr.length));
}


async function showNearest(latlng, k = 3) {
  clearVisual();
  clearNearest();

  const list = nearestKBinsFrom(latlng, k);
  if (!list.length) { alert('휴지통 데이터가 없습니다.'); return; }

  // #1은 빨강
  list[0].marker.setImage(redMarkerImage);
  nearestMarks.push(list[0].marker);

  // 라벨 표시
  list.forEach((it, idx) => {
    const iw = new kakao.maps.InfoWindow({
      content: `<div style="font-size:12px;padding:4px 6px;">#${idx+1} ${it.name}<br>${Math.round(it.meters)} m</div>`
    });
    iw.open(map, it.marker);
    nearestInfoWindows.push(iw);
  });

  // #1 경로
  const dst = list[0].marker.getPosition();
  const route = await routeFoot(latlng, dst);
  if (!route) {
    routePolyline = new kakao.maps.Polyline({
      map: map, path: [latlng, dst], strokeWeight: 6, strokeColor: '#FF0000', strokeOpacity: 0.9
    });
    setInfo(`<small>가까운 3곳 중 #1까지 직선 ${Math.round(list[0].meters)} m (경로 API 실패)</small>`);
  } else {
    const path = route.geometry.coordinates.map(c => new kakao.maps.LatLng(c[1], c[0]));
    routePolyline = new kakao.maps.Polyline({
      map: map, path, strokeWeight: 7, strokeColor: '#FF0000', strokeOpacity: 0.95
    });
    const mins = Math.round(route.duration / 60);
    setInfo(`<small>가까운 3곳:
      #1 ${Math.round(list[0].meters)} m · ${mins}분,
      #2 ${list[1] ? Math.round(list[1].meters) + ' m' : '-'},
      #3 ${list[2] ? Math.round(list[2].meters) + ' m' : '-'}</small>`);
  }

  // 화면 범위
  const bounds = new kakao.maps.LatLngBounds();
  bounds.extend(latlng);
  list.forEach(it => bounds.extend(it.marker.getPosition()));
  map.setBounds(bounds);
}

// =========================
/* 초기 로드 */
// =========================
(async function init(){
  const q = new URLSearchParams(location.search);
  const csvName = q.get('csv') || '주소 수정.csv';
  const geoName = q.get('geo') || 'HangJeongDong_Seoul.geojson';

  try {
    const csvParsed = await loadCsvFromUrl(csvName);
    setMarkersFromRows(csvParsed);
  } catch (e) { console.warn('CSV 자동 로드 실패', e); }
  try {
    const geojson = await loadGeoFromUrl(geoName);
    buildGuLayers(geojson);
  } catch (e) {
    console.warn('GeoJSON 자동 로드 실패', e);
    document.getElementById('fileBox').style.display = 'block';
    setInfo('<small>자동 로드 실패: 파일로 열었다면 아래에서 직접 선택하세요.</small>');
  }
})();

// =========================
// 버튼/지도 이벤트
// =========================
document.getElementById('btnBestInGu').addEventListener('click', async () => {
  const name = document.getElementById('selGu').value;
  if (!name) { alert('먼저 구를 선택하세요.'); return; }
  clearVisual();
  highlightGu(name);
  const best = bestBinOfGu(name);
  if (!best){ alert('선택한 구 안에 휴지통이 없습니다.'); return; }

  if (nearestMarkerInfo && nearestMarkerInfo.marker) nearestMarkerInfo.marker.setImage(defaultMarkerImage);
  best.kakaoMarker.setImage(redMarkerImage);
  nearestMarkerInfo = { marker: best.kakaoMarker, meters: 0 };
  map.panTo(best.kakaoMarker.getPosition());
});

document.getElementById('btnLocate').addEventListener('click', async () => {
  if (!navigator.geolocation){ alert('브라우저가 위치 서비스를 지원하지 않습니다.'); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const latlng = new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude);

    if (meMarker) meMarker.setMap(null);
    if (meCircle) meCircle.setMap(null);

    meMarker = new kakao.maps.Marker({
      map: map, position: latlng,
      image: new kakao.maps.MarkerImage(svgPin('#2563eb'),
        new kakao.maps.Size(30, 42), { offset: new kakao.maps.Point(15, 42) })
    });
    new kakao.maps.InfoWindow({ content: '현재 위치', removable: true }).open(map, meMarker);
    meCircle = new kakao.maps.Circle({ map: map, center: latlng, radius: pos.coords.accuracy, strokeWeight: 1, strokeColor: '#0070FF', strokeOpacity: 0.7, fillColor: '#0070FF', fillOpacity: 0.2 });
    map.setLevel(3, { anchor: latlng });

    // 가까운 3개 표시 + #1 경로
    await showNearest(latlng, 3);
  }, (err) => {
    alert('위치 접근 실패: ' + err.message + '\n(HTTPS 또는 http://localhost 로 열어주세요)');
  }, { enableHighAccuracy: true, timeout: 10000 });
});

document.getElementById('btnPick').addEventListener('click', () => {
  let pickMode = window.__pickMode = !window.__pickMode;
  alert(pickMode ? '지도를 클릭해 임의 위치를 지정하세요. (마커는 드래그로 이동 가능)' : '임의 위치 지정을 종료합니다.');
});

kakao.maps.event.addListener(map, 'click', async (mouseEvent) => {
  selectionOverlay.setMap(null);
  if (!window.__pickMode) return;
  const latlng = mouseEvent.latLng;
  ensureManualMarker(latlng);
  setInfo(`<small>임의 위치: ${latlng.getLat().toFixed(6)}, ${latlng.getLng().toFixed(6)}</small>`);

  // 가까운 3개 표시 + #1 경로
  await showNearest(latlng, 3);
});

document.getElementById('btnResetAB').addEventListener('click', resetAB);

document.getElementById('btnRouteAB').addEventListener('click', async () => {
  if (!(markerA && markerB)){ alert('A와 B가 모두 선택되어야 합니다.'); return; }

  clusterer.clear();
  markerA.setMap(map);
  markerB.setMap(map);

  if (routePolyline) routePolyline.setMap(null);

  const A = markerA.getPosition(), B = markerB.getPosition();
  try {
    const route = await routeFoot(A, B);
    if (!route){
      routePolyline = new kakao.maps.Polyline({ map: map, path: [A, B], strokeWeight: 6, strokeColor: '#FF0000', strokeOpacity: 0.9 });
      setInfo('<small>경로 API 실패 - 직선 연결</small>');
      return;
    }
    const path = route.geometry.coordinates.map(c => new kakao.maps.LatLng(c[1], c[0]));
    routePolyline = new kakao.maps.Polyline({ map: map, path: path, strokeWeight: 7, strokeColor: '#FF0000', strokeOpacity: 0.95 });

    if (path && path.length > 0) {
      const bounds = new kakao.maps.LatLngBounds();
      path.forEach(point => bounds.extend(point));
      map.setBounds(bounds);
    }

    const mins = Math.round(route.duration / 60);
    setInfo(`<small>도보 약 ${Math.round(route.distance)} m · ${mins}분</small>`);
  } catch (e){
    routePolyline = new kakao.maps.Polyline({ map: map, path: [A, B], strokeWeight: 6, strokeColor: '#FF0000', strokeOpacity: 0.9 });
    setInfo('<small>경로 API 오류 - 직선 연결</small>');
  }
});

document.getElementById('btnClear').addEventListener('click', () => {
  clearVisual();
  clearNearest(); // 가까운 3개 라벨/마커 원복
  if (meMarker) { meMarker.setMap(null); meMarker = null; }
  if (meCircle) { meCircle.setMap(null); meCircle = null; }
  if (manualMarker) { manualMarker.setMap(null); manualMarker = null; manualMarkerInfowindow.close(); }
  resetAB();
  setInfo('초기화됨. 필요한 기능을 선택하세요.');
});

const panel = document.querySelector('.panel');
const toggleBtn = document.getElementById('togglePanelBtn');
toggleBtn.addEventListener('click', () => {
  panel.classList.toggle('hidden');
  toggleBtn.textContent = panel.classList.contains('hidden') ? 'UI 보이기' : 'UI 숨기기';
});

// A/B & 경로(내 위치→선택 휴지통)
document.addEventListener('click', async function(e) {
  if (e.target && e.target.classList.contains('marker-btn')) {
    const action = e.target.dataset.action;

    if (action === 'setAsA') {
      if (!currentlyClickedMarker) return;
      if (markerA) markerA.setImage(defaultMarkerImage);
      currentlyClickedMarker.setImage(imageA);
      markerA = currentlyClickedMarker;
      setChips();
      selectionOverlay.setMap(null);
      const pos = currentlyClickedMarker.getPosition();
      setInfo(`<small><span class="labelA" style="margin-right:4px;">출발</span> 지점 선택됨: ${pos.getLat().toFixed(5)}, ${pos.getLng().toFixed(5)}</small>`);

    } else if (action === 'setAsB') {
      if (!currentlyClickedMarker) return;
      if (markerB) markerB.setImage(defaultMarkerImage);
      currentlyClickedMarker.setImage(imageB);
      markerB = currentlyClickedMarker;
      setChips();
      selectionOverlay.setMap(null);

      // 내 위치와의 거리도 즉시 안내(가능 시)
      if (meMarker) {
        const d = kakao.maps.LatLng.prototype.getDistance(meMarker.getPosition(), markerB.getPosition());
        setInfo(`<small><span class="labelB" style="margin-right:4px;">도착</span> 지점 선택됨 · 내 위치↔선택 휴지통: <b>${metersToText(d)}</b></small>`);
      } else {
        const pos = markerB.getPosition();
        setInfo(`<small><span class="labelB" style="margin-right:4px;">도착</span> 지점 선택됨: ${pos.getLat().toFixed(5)}, ${pos.getLng().toFixed(5)} · (내 위치 버튼을 먼저 눌러주세요)</small>`);
      }

    } else if (action === 'routeFromMe') {
      if (!currentlyClickedMarker) return;
      if (!meMarker) { alert('먼저 [내 위치]를 눌러 위치를 활성화하세요.'); return; }

      // 내 위치 → 선택 휴지통 경로/거리 안내
      const A = meMarker.getPosition(), B = currentlyClickedMarker.getPosition();
      if (routePolyline) routePolyline.setMap(null);

      try {
        const route = await routeFoot(A, B);
        if (!route){
          routePolyline = new kakao.maps.Polyline({ map: map, path: [A, B], strokeWeight: 6, strokeColor: '#FF0000', strokeOpacity: 0.9 });
          const crow = kakao.maps.LatLng.prototype.getDistance(A, B);
          setInfo(`<small>직선거리: ${metersToText(crow)} (경로 API 실패)</small>`);
        } else {
          const path = route.geometry.coordinates.map(c => new kakao.maps.LatLng(c[1], c[0]));
          routePolyline = new kakao.maps.Polyline({ map: map, path: path, strokeWeight: 7, strokeColor: '#FF0000', strokeOpacity: 0.95 });

          const bounds = new kakao.maps.LatLngBounds();
          path.forEach(p => bounds.extend(p));
          map.setBounds(bounds);

          const mins = Math.round(route.duration / 60);
          setInfo(`<small>내 위치 → 선택 휴지통 · 약 ${metersToText(route.distance)} · ${mins}분</small>`);
        }
      } catch (err) {
        const crow = kakao.maps.LatLng.prototype.getDistance(A, B);
        routePolyline = new kakao.maps.Polyline({ map: map, path: [A, B], strokeWeight: 6, strokeColor: '#FF0000', strokeOpacity: 0.9 });
        setInfo(`<small>직선거리: ${metersToText(crow)} (경로 API 오류)</small>`);
      }

      selectionOverlay.setMap(null);
    }
  }
});

// =========================
// 파일 업로드 (file:// 대비)
// =========================
function readTextFile(file){
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsText(file, 'utf-8');
  });
}
document.getElementById('fileCsv').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const text = await readTextFile(f);
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  setMarkersFromRows(parsed);
});
document.getElementById('fileGeo').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const text = await readTextFile(f);
  const geo = JSON.parse(text);
  buildGuLayers(geo);
});

// =========================
// A/B 선택 & 보조 유틸
// =========================
let pickMode = false;
let manualMarker = null;
let manualMarkerInfowindow = new kakao.maps.InfoWindow({ content: '임의 위치', removable: true });

function ensureManualMarker(latlng){
  if (manualMarker){
    manualMarker.setPosition(latlng);
  } else {
    manualMarker = new kakao.maps.Marker({ position: latlng, draggable: true, map: map });
    kakao.maps.event.addListener(manualMarker, 'dragend', () => {
      const ll = manualMarker.getPosition();
      setInfo(`<small>임의 위치: ${ll.getLat().toFixed(6)}, ${ll.getLng().toFixed(6)}</small>`);
    });
  }
  manualMarkerInfowindow.open(map, manualMarker);
  return manualMarker;
}

let markerA = null, markerB = null;

function resetAB(){
  if (markerA) { markerA.setImage(defaultMarkerImage); }
  if (markerB) { markerB.setImage(defaultMarkerImage); }
  markerA = markerB = null;
  setChips();
  if (routePolyline) routePolyline.setMap(null);

  clusterer.clear();
  const allKakaoMarkers = binMarkers.map(bm => bm.kakaoMarker);
  clusterer.addMarkers(allKakaoMarkers);
}
function setChips(){
  const chips = document.getElementById('chips');
  chips.innerHTML = '';
  if (markerA) chips.innerHTML += `<span class="chip"><span class="labelA">A</span> ${markerA.getPosition().getLat().toFixed(5)}, ${markerA.getPosition().getLng().toFixed(5)}</span>`;
  if (markerB) chips.innerHTML += `<span class="chip"><span class="labelB">B</span> ${markerB.getPosition().getLat().toFixed(5)}, ${markerB.getPosition().getLng().toFixed(5)}</span>`;
}

