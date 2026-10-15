/* Local WebGL guide. Its movement previews the route; it is not a location fix. */
export function mountWalkingGuide(root) {
  let disposed = false;
  let destroy = () => {};
  const abort = new AbortController();
  const status = root.querySelector('.locator-guide-status');
  import(root.dataset.threeModule).then(THREE => {
    if (disposed) return;
    destroy = createGuide(THREE, root, abort.signal, () => disposed);
  }).catch(() => {
    if (!disposed && status) status.textContent = '3D guide unavailable on this device. Follow the blue route.';
  });
  return () => { disposed = true; abort.abort(); destroy(); };
}

function createGuide(T, root, signal, isDisposed) {
  const canvas = root.querySelector('.locator-3d-guide');
  const svg = root.querySelector('.store-map-floorplan');
  const stage = root.querySelector('.locator-map-stage');
  const status = root.querySelector('.locator-guide-status');
  const points = JSON.parse(root.querySelector('#locator-route-points').textContent);
  const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  const scene = new T.Scene();
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 5000);
  const tilt = .55;
  camera.position.set(0, Math.sin(tilt) * 1200, Math.cos(tilt) * 1200);
  camera.lookAt(0, 0, 0);
  scene.add(new T.HemisphereLight(0xffffff, 0x687482, 2.4));
  const light = new T.DirectionalLight(0xffffff, 2.5);
  light.position.set(-120, 200, 300);
  scene.add(light);
  const mat = color => new T.MeshStandardMaterial({ color, roughness: .8 });
  const skin = mat(0xd7a383), jacket = mat(0xb62f42), shirt = mat(0xe9edf1);
  const pants = mat(0x273443), shoes = mat(0xe0e5e9), hair = mat(0x352b27);
  const actor = new T.Group();
  scene.add(actor);
  const mesh = (geometry, material, parent = actor) => {
    const result = new T.Mesh(geometry, material); parent.add(result); return result;
  };
  function ellipsoid(x, y, z, sx, sy, sz, material, parent = actor) {
    const result = mesh(new T.SphereGeometry(1, 20, 14), material, parent);
    result.position.set(x, y, z); result.scale.set(sx, sy, sz); return result;
  }
  const torso = new T.Group(); actor.add(torso);
  ellipsoid(0, 1.29, 0, .215, .29, .135, jacket, torso);
  ellipsoid(0, 1.29, .115, .105, .245, .035, shirt, torso);
  ellipsoid(0, .99, 0, .18, .14, .13, pants, torso);
  ellipsoid(0, 1.59, 0, .065, .08, .065, skin, torso);
  ellipsoid(0, 1.79, 0, .15, .195, .145, skin, torso);
  ellipsoid(-.15, 1.79, 0, .025, .047, .028, skin, torso);
  ellipsoid(.15, 1.79, 0, .025, .047, .028, skin, torso);
  const scalp = mesh(new T.SphereGeometry(.154, 24, 12, 0, Math.PI * 2, 0, Math.PI * .48), hair, torso);
  scalp.position.y = 1.82; scalp.scale.y = 1.12;
  const facialDetails = new T.Group(); torso.add(facialDetails);
  ellipsoid(-.048, 1.82, .135, .012, .015, .01, mat(0x252729), facialDetails);
  ellipsoid(.048, 1.82, .135, .012, .015, .01, mat(0x252729), facialDetails);
  ellipsoid(0, 1.765, .144, .022, .032, .032, skin, facialDetails);
  ellipsoid(0, 1.715, .128, .033, .005, .006, mat(0x8e514d), facialDetails);

  // A curved front surface follows the head, rather than displaying a portrait disk.
  const faceGeometry = new T.PlaneGeometry(.267, .34, 20, 24);
  const positions = faceGeometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i);
    positions.setZ(i, .145 * Math.sqrt(Math.max(.03, 1 - (x / .151) ** 2 - (y / .196) ** 2)) + .004);
  }
  faceGeometry.computeVertexNormals();
  const faceMaterial = new T.MeshStandardMaterial({ transparent: true, roughness: .9, alphaTest: .08 });
  const faceMesh = mesh(faceGeometry, faceMaterial, torso);
  faceMesh.position.y = 1.79; faceMesh.visible = false;
  let faceTexture, faceBitmap;
  status.textContent = '3D walking preview · preparing face-only texture…';
  fetch(root.dataset.faceUrl, { credentials: 'same-origin', signal }).then(async response => {
    if (!response.ok) {
      const problem = await response.json(); throw new Error(problem.detail || 'Face unavailable.');
    }
    const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY' });
    if (isDisposed()) { bitmap.close(); return; }
    faceBitmap = bitmap;
    faceTexture = new T.Texture(bitmap); faceTexture.flipY = false;
    faceTexture.colorSpace = T.SRGBColorSpace; faceTexture.needsUpdate = true;
    faceMaterial.map = faceTexture; faceMaterial.needsUpdate = true;
    faceMesh.visible = true; facialDetails.visible = false;
    status.textContent = '3D walking preview · face-only profile crop';
    draw();
  }).catch(error => {
    if (!isDisposed() && error.name !== 'AbortError') {
      status.textContent = '3D walking preview · ' + error.message;
    }
  });

  const unitY = new T.Vector3(0, 1, 0);
  function limb(radius, material) {
    return mesh(new T.CapsuleGeometry(radius, 1 - radius * 2, 4, 10), material);
  }
  function connect(segment, start, end) {
    const delta = new T.Vector3().subVectors(end, start);
    segment.position.copy(start).add(end).multiplyScalar(.5);
    segment.quaternion.setFromUnitVectors(unitY, delta.clone().normalize());
    segment.scale.set(1, delta.length(), 1);
  }
  const legs = [-1, 1].map(side => ({
    side, upper: limb(.065, pants), lower: limb(.052, pants),
    knee: ellipsoid(0, 0, 0, .058, .058, .058, pants),
    foot: ellipsoid(0, 0, 0, .078, .055, .16, shoes),
  }));
  const arms = [-1, 1].map(side => ({
    side, upper: limb(.051, jacket), lower: limb(.043, jacket),
    hand: ellipsoid(0, 0, 0, .045, .062, .04, skin),
  }));
  function pose(phase) {
    const bounce = .012 * Math.cos(phase * Math.PI * 4);
    torso.position.y = bounce;
    torso.rotation.y = .035 * Math.sin(phase * Math.PI * 2);
    legs.forEach(leg => {
      const cycle = (phase + (leg.side === 1 ? .5 : 0)) % 1;
      const stance = .62;
      const swing = cycle < stance ? 0 : (cycle - stance) / (1 - stance);
      const z = cycle < stance ? .20 - .40 * cycle / stance : -.20 + .40 * swing;
      const ankleY = .095 + (cycle < stance ? 0 : .115 * Math.sin(swing * Math.PI));
      const hip = new T.Vector3(leg.side * .105, .93 + bounce, 0);
      const ankle = new T.Vector3(leg.side * .105, ankleY, z);
      const dy = ankle.y - hip.y, dz = ankle.z - hip.z;
      const distance = Math.min(.859, Math.hypot(dy, dz));
      const bend = Math.sqrt(Math.max(0, .43 ** 2 - (distance / 2) ** 2));
      const knee = new T.Vector3(hip.x, (hip.y + ankle.y) / 2 + dz / distance * bend,
        (hip.z + ankle.z) / 2 - dy / distance * bend);
      connect(leg.upper, hip, knee); connect(leg.lower, knee, ankle);
      leg.knee.position.copy(knee);
      leg.foot.position.set(ankle.x, ankle.y - .035, ankle.z + .065);
      leg.foot.rotation.x = swing ? -.28 * Math.sin(swing * Math.PI) : .03;
    });
    arms.forEach(arm => {
      const swing = Math.sin(phase * Math.PI * 2 + (arm.side === 1 ? Math.PI : 0));
      const shoulder = new T.Vector3(arm.side * .22, 1.46 + bounce, 0);
      const elbow = new T.Vector3(arm.side * .24, 1.20 + bounce, swing * .12);
      const wrist = new T.Vector3(arm.side * .25, .99 + bounce, swing * .17 + .10);
      connect(arm.upper, shoulder, elbow); connect(arm.lower, elbow, wrist); arm.hand.position.copy(wrist);
    });
  }
  const shadow = mesh(new T.CircleGeometry(1, 32), new T.MeshBasicMaterial({ color: 0x172837, transparent: true, opacity: .16 }), scene);
  let frame = 0, elapsed = 0, previous = 0, visible = true, dead = false;
  let width = 1, height = 1, scale = 26, matrix, yaw = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const lengths = points.slice(1).map((point, i) => Math.hypot(point[0] - points[i][0], point[1] - points[i][1]));
  const routeLength = lengths.reduce((a, b) => a + b, 0);
  function resize() {
    const bounds = stage.getBoundingClientRect();
    const ctm = svg.getScreenCTM();
    width = bounds.width; height = bounds.height;
    matrix = { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e - bounds.left, f: ctm.f - bounds.top };
    scale = Math.max(24, Math.min(35, svg.getBoundingClientRect().height * .055));
    actor.scale.setScalar(scale);
    shadow.scale.set(scale * .32, scale * .17, 1);
    shadow.rotation.x = -Math.PI / 2;
    renderer.setSize(width, height, false);
    camera.left = -width / 2; camera.right = width / 2;
    camera.top = height / 2; camera.bottom = -height / 2; camera.updateProjectionMatrix();
    draw();
  }
  function draw() {
    if (!matrix || dead) return;
    let distance = routeLength ? (elapsed * 35) % routeLength : 0;
    let index = 0;
    while (index < lengths.length - 1 && distance > lengths[index]) distance -= lengths[index++];
    const start = points[index], end = points[index + 1] || start;
    const ratio = lengths[index] ? distance / lengths[index] : 0;
    const x = start[0] + (end[0] - start[0]) * ratio;
    const y = start[1] + (end[1] - start[1]) * ratio;
    const px = matrix.a * x + matrix.c * y + matrix.e;
    const py = matrix.b * x + matrix.d * y + matrix.f;
    // Invert the tilted camera's ground projection so feet stay on the SVG route.
    actor.position.set(px - width / 2, 0, (py - height / 2) / Math.sin(tilt));
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const desired = Math.atan2(matrix.a * dx + matrix.c * dy,
      (matrix.b * dx + matrix.d * dy) / Math.sin(tilt));
    yaw += Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw)) * .15;
    actor.rotation.y = yaw;
    // Gait phase derives from travel distance, keeping stride and speed related.
    let groundTravel = 0;
    for (let i = 0; i <= index; i++) {
      const ax = points[i + 1][0] - points[i][0], ay = points[i + 1][1] - points[i][1];
      const groundLength = Math.hypot(matrix.a * ax + matrix.c * ay,
        (matrix.b * ax + matrix.d * ay) / Math.sin(tilt));
      groundTravel += groundLength * (i === index ? ratio : 1);
    }
    pose((groundTravel / (scale * (.40 / .62))) % 1);
    shadow.position.set(actor.position.x, -.025, actor.position.z);
    renderer.render(scene, camera);
  }
  function playing() {
    return !dead && visible && !document.hidden && !reduced.matches && !root.classList.contains('locator-motion-paused');
  }
  function tick(time) {
    frame = 0;
    if (!playing()) { previous = 0; draw(); return; }
    if (!previous) previous = time;
    const delta = time - previous;
    if (delta >= 32) { elapsed += Math.min(delta / 1000, .08); previous = time; draw(); }
    frame = requestAnimationFrame(tick);
  }
  function updatePlayback() {
    cancelAnimationFrame(frame); frame = 0; previous = 0;
    if (playing()) frame = requestAnimationFrame(tick); else draw();
  }
  const resizer = new ResizeObserver(resize); resizer.observe(stage);
  const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; updatePlayback(); });
  observer.observe(stage);
  const toggle = root.querySelector('.locator-motion-toggle');
  if (toggle) toggle.addEventListener('click', updatePlayback);
  reduced.addEventListener('change', updatePlayback);
  document.addEventListener('visibilitychange', updatePlayback);
  canvas.hidden = false; resize(); updatePlayback();
  return () => {
    dead = true; cancelAnimationFrame(frame); resizer.disconnect(); observer.disconnect();
    if (toggle) toggle.removeEventListener('click', updatePlayback);
    reduced.removeEventListener('change', updatePlayback);
    document.removeEventListener('visibilitychange', updatePlayback);
    scene.traverse(object => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) object.material.dispose();
    });
    if (faceTexture) faceTexture.dispose(); if (faceBitmap) faceBitmap.close();
    renderer.dispose(); canvas.hidden = true;
  };
}
