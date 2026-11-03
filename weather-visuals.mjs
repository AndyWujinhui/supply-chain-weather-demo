const levels = { High: 0.8, Critical: 1, Medium: 0.46, None: 0.15 };

export function strengthFor(level) {
  if (!Object.hasOwn(levels, level)) throw new Error(`Unknown weather risk level: ${level}`);
  return levels[level];
}

function hash(x, y) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

export function cloudDensity(x, y, frame, strength) {
  const angle = frame * 0.025;
  const cx = 0.67 - frame * 0.0014, cy = 0.72 - frame * 0.003;
  const dx = (x - cx) * 1.65, dy = y - cy;
  const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
  const texture = noise(x * 13 + angle, y * 13 - angle) * 0.51
    + noise(x * 32 - angle, y * 32 + angle) * 0.29
    + noise(x * 81, y * 81) * 0.2;
  const arms = Math.sin(a * 3 + Math.log(r + 0.03) * 7 - angle * 2) * 0.5 + 0.5;
  const envelope = Math.exp(-r * r * 5.2);
  const eye = 1 - Math.exp(-r * r * 1600);
  return Math.max(0, Math.min(1, ((texture - 0.34) * 1.5 + arms * 0.62)
    * envelope * eye * strength + Math.max(0, texture - 0.55) * 0.2));
}

export function windVector(x, y, frame, strength) {
  const cx = 0.67 - frame * 0.0014, cy = 0.72 - frame * 0.003;
  const dx = (x - cx) * 1.65, dy = y - cy;
  const radius = Math.hypot(dx, dy);
  const speed = strength * Math.exp(-radius * 2.4) * 0.045;
  const divisor = Math.max(radius, 0.025);
  return { u: (-dy - dx * 0.18) / divisor * speed, v: (dx - dy * 0.18) / divisor * speed };
}

const coast = [[107,33],[114,33],[119.3,32.2],[121.7,30.9],[121.1,29],[120.7,27.7],
  [119.6,26.8],[119.2,25.9],[118.5,24.7],[117.4,23.6],[115.7,22.7],[114.2,22.3],
  [112.5,21.7],[110.5,21.2],[110.3,20.2],[109.6,20.4],[108.4,21.5],[107,21.6]];
const taiwan = [[121.5,25.3],[122,24.9],[121.6,23.5],[120.8,21.9],[120.1,22.8],[120.1,24],[120.8,25.1]];

function mountWeather() {
  const main = document.getElementById('weather-cloud-map');
  const radar = document.getElementById('weather-radar-map');
  const wind = document.getElementById('weather-wind-map');
  if (!main || !radar || !wind) throw new Error('Weather imagery canvases are missing');
  const fixtures = JSON.parse(document.getElementById('demo-fixtures').textContent);
  let level = fixtures.states[fixtures.publishedScenario].riskLevel;
  let frame = 0, mode = 'infrared', english = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let playing = !reduced.matches;
  const texture = document.createElement('canvas');
  texture.width = 270; texture.height = 141;
  const textureContext = texture.getContext('2d');
  const mainContext = main.getContext('2d');
  const radarContext = radar.getContext('2d');
  const windContext = wind.getContext('2d');
  if (!textureContext || !mainContext || !radarContext || !windContext) throw new Error('Canvas 2D is unavailable');
  const pixels = textureContext.createImageData(texture.width, texture.height);
  const slider = document.getElementById('weather-frame');
  const play = document.getElementById('weather-play');
  const project = (lon, lat, w, h) => [(lon - 107) / 20 * w, (33 - lat) / 15 * h];

  function background(ctx, w, h) {
    ctx.fillStyle = '#091d30'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#254359'; ctx.lineWidth = 0.7;
    for (let lon = 108; lon <= 126; lon += 3) {
      const [x] = project(lon, 33, w, h);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let lat = 18; lat <= 33; lat += 3) {
      const [, y] = project(107, lat, w, h);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (const polygon of [coast, taiwan]) {
      ctx.beginPath();
      polygon.forEach(([lon, lat], index) => {
        const [x, y] = project(lon, lat, w, h);
        if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath(); ctx.fillStyle = '#203b41'; ctx.fill();
      ctx.strokeStyle = '#668b8d'; ctx.lineWidth = 1.1; ctx.stroke();
    }
  }

  function imagery(ctx, w, h, kind) {
    const strength = strengthFor(level);
    for (let y = 0; y < texture.height; y++) {
      for (let x = 0; x < texture.width; x++) {
        const density = cloudDensity(x / texture.width, y / texture.height, frame, strength);
        const offset = (y * texture.width + x) * 4;
        if (kind === 'infrared') {
          const value = Math.round(130 + density * 125);
          pixels.data[offset] = value - 12;
          pixels.data[offset + 1] = value;
          pixels.data[offset + 2] = Math.min(255, value + 8);
          pixels.data[offset + 3] = Math.round(Math.min(1, density * 1.6) * 235);
        } else {
          const colors = density > 0.7 ? [230,50,94] : density > 0.5 ? [255,170,41]
            : density > 0.31 ? [234,226,43] : density > 0.16 ? [40,193,145] : [26,107,156];
          pixels.data[offset] = colors[0];
          pixels.data[offset + 1] = colors[1];
          pixels.data[offset + 2] = colors[2];
          pixels.data[offset + 3] = density < 0.09 ? 0 : Math.round(Math.min(1, density * 2) * 220);
        }
      }
    }
    textureContext.putImageData(pixels, 0, 0);
    ctx.drawImage(texture, 0, 0, w, h);
  }

  function annotations(ctx, w, h, small = false) {
    const [x, y] = project(118.0894, 24.4798, w, h);
    ctx.setLineDash([5, 6]); ctx.strokeStyle = '#e5c777'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(w * 0.71, h * 0.82);
    ctx.bezierCurveTo(w * 0.68, h * 0.68, w * 0.61, h * 0.59, w * 0.58, h * 0.48);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffcb65'; ctx.beginPath(); ctx.arc(x, y, small ? 3 : 5, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${small ? 11 : 15}px "Segoe UI","Microsoft YaHei"`;
    ctx.fillStyle = '#fff'; ctx.fillText(english ? 'Xiamen' : '厦门', x - (small ? 37 : 45), y - 10);
    if (!small) {
      ctx.font = '12px "Segoe UI","Microsoft YaHei"'; ctx.fillStyle = '#a4bfce';
      ctx.fillText(english ? 'Fujian coast' : '福建沿海', w * 0.39, h * 0.26);
      ctx.fillText(english ? 'Taiwan Strait' : '台湾海峡', w * 0.69, h * 0.45);
      ctx.fillText(english ? 'Synthetic path - not a forecast' : '情景路径 · 非官方预报', 18, h - 17);
      const colors = mode === 'radar' ? ['#1a6b9c','#28c191','#eae22b','#ffaa29','#e6325e']
        : ['#304354','#647582','#a1b0bb','#d8e2e8','#ffffff'];
      colors.forEach((color, i) => {ctx.fillStyle = color; ctx.fillRect(w - 180 + i * 31, h - 29, 30, 8);});
      ctx.fillStyle = '#c9dce7'; ctx.font = '10px "Segoe UI","Microsoft YaHei"';
      ctx.fillText(english ? 'Relative synthetic intensity' : '合成影像相对强度', w - 180, h - 7);
    }
  }

  function render() {
    background(mainContext, main.width, main.height);
    imagery(mainContext, main.width, main.height, mode);
    annotations(mainContext, main.width, main.height);
    background(radarContext, radar.width, radar.height);
    imagery(radarContext, radar.width, radar.height, 'radar');
    annotations(radarContext, radar.width, radar.height, true);
    background(windContext, wind.width, wind.height);
    windContext.strokeStyle = '#62dfd3'; windContext.lineWidth = 1.2;
    const strength = strengthFor(level);
    for (let row = 0; row < 14; row++) {
      for (let col = 0; col < 20; col++) {
        const x = (col + 0.5) / 20, y = (row + 0.5) / 14;
        const { u, v } = windVector(x, y, frame, strength);
        const phase = (frame / 9 + hash(col, row)) % 1;
        const startX = (x + u * phase) * wind.width;
        const startY = (y + v * phase) * wind.height;
        const endX = startX + u * wind.width, endY = startY + v * wind.height;
        const angle = Math.atan2(endY - startY, endX - startX);
        windContext.globalAlpha = 0.35 + strength * 0.65;
        windContext.beginPath(); windContext.moveTo(startX, startY); windContext.lineTo(endX, endY);
        windContext.moveTo(endX - 3 * Math.cos(angle - 0.5), endY - 3 * Math.sin(angle - 0.5));
        windContext.lineTo(endX, endY);
        windContext.lineTo(endX - 3 * Math.cos(angle + 0.5), endY - 3 * Math.sin(angle + 0.5));
        windContext.stroke();
      }
    }
    windContext.globalAlpha = 1;
    annotations(windContext, wind.width, wind.height, true);
    wind.dataset.frame = String(frame); wind.dataset.riskLevel = level;
    slider.value = String(frame);
    const minutes = 8 * 60 + frame * 10;
    document.getElementById('weather-frame-time').textContent = `${english ? 'Scenario' : '情景'} ${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    document.getElementById('weather-layer-label').textContent = mode === 'radar'
      ? (english ? 'RADAR · Synthetic echoes' : 'RADAR · 合成回波')
      : (english ? 'IR · Synthetic cloud imagery' : 'IR · 红外云图');
    play.textContent = playing ? (english ? 'Pause' : '暂停回放') : (english ? 'Play' : '播放回放');
    play.setAttribute('aria-pressed', String(playing));
    document.getElementById('weather-map-explanation').textContent = english
      ? 'Clouds, rainfall echoes and wind motion share one fictional scenario clock. These are not satellite, radar or wind observations.'
      : '云系、降雨回波与风场使用同一情景时间轴。全部为合成演示，不是卫星、雷达或风速实测。';
    document.querySelectorAll('[data-map-mode]').forEach(button => {
      button.textContent = button.dataset.mapMode === 'radar'
        ? (english ? 'Rainfall echoes' : '降雨回波') : (english ? 'Infrared clouds' : '红外云图');
    });
    main.dataset.frame = String(frame); main.dataset.riskLevel = level;
  }

  document.querySelectorAll('[data-map-mode]').forEach(button => button.addEventListener('click', () => {
    mode = button.dataset.mapMode;
    document.querySelectorAll('[data-map-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    render();
  }));
  play.addEventListener('click', () => {playing = !playing; render();});
  slider.addEventListener('input', () => {frame = Number(slider.value); playing = false; render();});
  document.getElementById('weather-language').addEventListener('click', () => {english = !english; render();});
  document.addEventListener('weather-scenario-change', event => {level = event.detail.riskLevel; render();});
  reduced.addEventListener('change', event => {if (event.matches) {playing = false; render();}});
  render();
  setInterval(() => {
    if (playing && !document.hidden) {frame = (frame + 1) % 36; render();}
  }, 180);
}

if (typeof document !== 'undefined') {
  try {
    mountWeather();
  } catch (error) {
    const notice = document.getElementById('weather-visual-error');
    if (notice) {notice.hidden = false; notice.textContent = `天气影像加载失败：${error.message}`;}
    document.querySelectorAll('.studio-controls button, .studio-timeline button, .studio-timeline input')
      .forEach(control => {control.disabled = true;});
    console.error('Weather imagery initialization failed', error);
    throw error;
  }
}
