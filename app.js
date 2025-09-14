// Kakao SDK가 로드된 뒤 index.html의 kakao.maps.load(...)가 이 함수를 호출합니다.
window.initMap = function () {

  // ============ 기본 셋업 ============
  const map = new kakao.maps.Map(
    document.getElementById('map'),
    { center: new kakao.maps.LatLng(37.5665, 126.9780), level: 7 }
  );

  const clusterer = new kakao.maps.MarkerClusterer({
    map, averageCenter: true, minLevel: 7
  });

  const binMarkers = []; // { kakaoMarker, meta:{name, lat, lon} }
  let meMarker = null, meCircle = null, routePolyline = null;

  // ============ 403 방지 SVG 마커 ============
  const svgPin = (color) =>
    'data:image/svg+xml;utf8,' + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 24 34">
        <defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-opacity=".25"/></filter></defs>
        <path filter="url(#s)" fill="${color}"
          d="M12 1.5a9 9 0 0 0-9 9c0 6.8 9 20 9 20s9-13.2 9-20a9 9 0 0 0-9-9z"/>
        <circle cx="12" cy="10.5" r="3.2" fill="#fff"/>
      </svg>`);

  const iconDefault = new kakao.maps.MarkerImage(svgPin('#10b981'),
    new kakao.maps.Size(30,42), { offset: new kakao.maps.Point(15,42) });
  const iconRed = new kakao.maps.MarkerImage(svgPin('#ef4444'),
    new kakao.maps.Size(30,42), { offset: new kakao.maps.Point(15,42) });
  const iconBlue = new kakao.maps.MarkerImage(svgPin('#2563eb'),
    new kakao.maps.Size(30,42), { offset: new kakao.maps.Point(15,42) });

  // ============ 유틸 ============
  const $info = document.getElementById('info');
  const metersToText = (m)=> (m>=1000? (m/1000).toFixed(2)+' km' : Math.round(m)+' m');

  // geometry가 있으면 그걸 쓰고, 없으면 Polyline.getLength 로 폴백
  function distanceMeters(a, b) {
    const s = kakao?.maps?.geometry?.spherical;
    if (s && typeof s.computeDistanceBetween === 'function') {
      return s.computeDistanceBetween(a, b);
    }
    const line = new kakao.maps.Polyline({ path: [a, b] });
    const len = line.getLength();
    line.setMap && line.setMap(null);
    return len;
  }

  async function routeFoot(src, dst){
    const url =
      `https://router.project-osrm.org/route/v1/foot/${src.getLng()},${src.getLat()};${dst.getLng()},${dst.getLat()}?overview=full&geometries=geojson`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes?.[0]) return null;
      return data.routes[0];
    } catch { return null; }
  }

  function clearVisual() {
    if (routePolyline) { routePolyline.setMap(null); routePolyline = null; }
  }

  // ============ 샘플 휴지통 마커 5개 ============
  const samples = [
    { name: '시청 앞 휴지통', lat: 37.5665, lon: 126.9780 },
    { name: '덕수궁 돌담길 휴지통', lat: 37.5658, lon: 126.9752 },
    { name: '광화문 광장 휴지통', lat: 37.5715, lon: 126.9770 },
    { name: '을지로 입구 휴지통', lat: 37.5669, lon: 126.9827 },
    { name: '종각역 휴지통',     lat: 37.5700, lon: 126.9820 },
  ];

  const newMarkers = [];
  samples.forEach(({name, lat, lon}) => {
    const pos = new kakao.maps.LatLng(lat, lon);
    const marker = new kakao.maps.Marker({ position: pos, image: iconDefault });

    kakao.maps.event.addListener(marker, 'click', async () => {
      if (!meMarker) {
        $info.innerHTML = `<small><b>${name}</b> · (내 위치 버튼을 먼저 눌러주세요)</small>`;
        return;
      }

      // 거리/경로 표시(내 위치 → 선택 휴지통)
      const A = meMarker.getPosition(), B = marker.getPosition();
      clearVisual();

      // 대표 마커 강조
      newMarkers.forEach(m => m.setImage(iconDefault));
      marker.setImage(iconRed);

      const crow = distanceMeters(A, B);
      const route = await routeFoot(A, B);

      if (!route) {
        routePolyline = new kakao.maps.Polyline({
          map, path: [A, B], strokeWeight: 6, strokeColor: '#FF0000', strokeOpacity: .9
        });
        $info.innerHTML = `<small><b>${name}</b> · 직선: ${metersToText(crow)} (경로 API 실패)</small>`;
      } else {
        const path = route.geometry.coordinates.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng));
        routePolyline = new kakao.maps.Polyline({
          map, path, strokeWeight: 7, strokeColor: '#FF0000', strokeOpacity: .95
        });
        const mins = Math.round(route.duration / 60);
        $info.innerHTML = `<small><b>${name}</b> · 경로 거리: ${metersToText(route.distance)} · ${mins}분</small>`;
        // 화면 맞춤
        const bounds = new kakao.maps.LatLngBounds();
        path.forEach(p => bounds.extend(p));
        map.setBounds(bounds);
      }
    });

    binMarkers.push({ kakaoMarker: marker, meta: { name, lat, lon } });
    newMarkers.push(marker);
  });
  clusterer.addMarkers(newMarkers);

  // ============ 버튼 동작 ============
  document.getElementById('btnLocate').addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('브라우저가 위치 서비스를 지원하지 않습니다.');
      return;
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const ll = new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude);

      // 기존 제거
      if (meMarker) meMarker.setMap(null);
      if (meCircle) meCircle.setMap(null);

      meMarker = new kakao.maps.Marker({ map, position: ll, image: iconBlue });
      meCircle = new kakao.maps.Circle({
        map, center: ll, radius: pos.coords.accuracy || 50,
        strokeWeight: 1, strokeColor: '#2563eb', strokeOpacity: .7,
        fillColor: '#2563eb', fillOpacity: .15
      });
      map.setLevel(4, { anchor: ll });

      // 가장 가까운 휴지통 하나만 자동 안내
      const ranked = newMarkers
        .map(m => ({ m, d: distanceMeters(ll, m.getPosition()) }))
        .sort((a,b) => a.d - b.d);

      if (!ranked.length) {
        $info.textContent = '휴지통 데이터가 없습니다.';
        return;
      }

      // 1등만 표시/경로
      const best = ranked[0].m;
      best.setImage(iconRed);

      const route = await routeFoot(ll, best.getPosition());
      if (!route) {
        clearVisual();
        routePolyline = new kakao.maps.Polyline({
          map, path: [ll, best.getPosition()], strokeWeight: 6, strokeColor: '#FF0000', strokeOpacity: .9
        });
        $info.innerHTML = `<small>가장 가까운 휴지통까지 직선 ${metersToText(ranked[0].d)} (경로 API 실패)</small>`;
      } else {
        const path = route.geometry.coordinates.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng));
        clearVisual();
        routePolyline = new kakao.maps.Polyline({
          map, path, strokeWeight: 7, strokeColor: '#FF0000', strokeOpacity: .95
        });
        const mins = Math.round(route.duration / 60);
        $info.innerHTML = `<small>가장 가까운 휴지통 · 경로 거리 ${metersToText(route.distance)} · ${mins}분</small>`;

        const bounds = new kakao.maps.LatLngBounds();
        path.forEach(p => bounds.extend(p));
        map.setBounds(bounds);
      }
    }, (err) => {
      alert('위치 접근 실패: ' + err.message + '\n(HTTPS 또는 http://localhost 로 열어주세요)');
    }, { enableHighAccuracy: true, timeout: 10000 });
  });

  document.getElementById('btnClear').addEventListener('click', () => {
    clearVisual();
    if (meMarker) { meMarker.setMap(null); meMarker = null; }
    if (meCircle) { meCircle.setMap(null); meCircle = null; }
    newMarkers.forEach(m => m.setImage(iconDefault));
    $info.textContent = '초기화됨. “내 위치”를 눌러보세요.';
  });
};
