import '@fontsource/oswald/400.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';
import './ui/style.css';
import * as THREE from 'three/webgpu';
import { Engine } from './core/engine';
import { Kitchen, OVERVIEW } from './world/kitchen';
import { FX } from './world/fx';
import { UI } from './ui/ui';
import { Director } from './game/director';
import { audio } from './core/audio';
import { DAY_NAMES, LAST_DAY } from './game/tasks';
import { mats } from './world/materials';
import * as P from './world/props';

/** Compila de antemano los shaders de todos los materiales para que no haya tirones al abrir una estación. */
async function warmup(eng: Engine) {
  const g = new THREE.Group();
  const box = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  for (const m of [...Object.values(P.PM), ...Object.values(mats())]) g.add(new THREE.Mesh(box, typeof m === 'function' ? m() : m));
  g.add(P.knife(), P.oyster().group, P.lobster().group, P.fryBasket(), P.smallJar().group, P.caviarTinBig(), P.stockPot(), P.vacuumBag().group, P.can('#c33', 'X'), P.deli('#fff', 'X'), P.contactShadow(0.1, 0.1));
  g.position.copy(eng.camera.position).add(new THREE.Vector3(0, 0, -1).applyQuaternion(eng.camera.quaternion));
  eng.scene.add(g);
  try {
    await eng.renderer.compileAsync(eng.scene, eng.camera);
  } catch {
    /* si falla la precompilación, se compila al vuelo */
  }
  eng.scene.remove(g);
}

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const ui = new UI(document.getElementById('ui')!);
const eng = new Engine(canvas);

async function boot() {
  await eng.init();
  let kitchen: Kitchen;
  try {
    kitchen = new Kitchen(eng.scene, eng.renderer);
  } catch (e) {
    eng.fallback(e);
    throw e;
  }
  const fx = new FX(eng.scene);
  const dir = new Director(eng, kitchen, fx, ui);
  eng.setView(OVERVIEW);
  eng.camera.position.copy(OVERVIEW.pos);
  eng.camera.lookAt(OVERVIEW.look);
  await warmup(eng);

  // Bucle principal
  let titleT = 0;
  let onTitle = true;
  eng.start((dt) => {
    kitchen.update(dt, performance.now() / 1000);
    fx.update(dt, eng.camera);
    dir.update(dt);
    if (onTitle) {
      // cámara lenta recorriendo la cocina detrás del menú
      titleT += dt * 0.06;
      const r = 3.4;
      eng.setView({ pos: new THREE.Vector3(Math.sin(titleT) * r * 0.9, 1.75, Math.cos(titleT) * r * 0.7 + 0.6), look: new THREE.Vector3(0, 1.0, -1.2), fov: 66 });
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && dir.running) showPause();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dir.running) dir.paused ? resume() : showPause();
  });
  ui.onPause = () => showPause();

  function stars(n: number) {
    return `<span class="mini-stars">${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i></span>`;
  }

  function title() {
    onTitle = true;
    ui.showHud(false);
    const s = dir.save;
    const days = Array.from({ length: LAST_DAY }, (_, i) => i + 1)
      .map((d) => `<button class="day ${d > s.unlocked ? 'lock' : ''}" data-d="${d}" ${d > s.unlocked ? 'disabled' : ''}><b>Día ${d}</b><span>${d === LAST_DAY ? 'Último día' : DAY_NAMES[d - 1]}</span>${stars(s.stars[d] ?? 0)}</button>`)
      .join('');
    const el = ui.showScreen(`
      <div class="title">
        <div class="eyebrow">nueva york · cocina con estrella michelin</div>
        <h1>MISE<br/>EN PLACE</h1>
        <p class="tag">Un día en la vida de un cocinero. 6:40 am a 8:00 pm. Tickets, entregas, ostras, caviar y un chef que no perdona.</p>
        <button class="go" data-d="${s.unlocked}">Empezar turno · Día ${s.unlocked}</button>
        <div class="days">${days}</div>
        <div class="row">
          <button class="opt" data-o="sound">${s.muted ? '🔇 Sonido: no' : '🔊 Sonido: sí'}</button>
          <button class="opt" data-o="motion">${s.reduceMotion ? '📷 Cámara estable' : '📱 Cámara en mano'}</button>
        </div>
        <details class="how"><summary>Cómo se juega</summary>
          <p>Toca un ticket de la <b>lista de prep</b> para ir a la estación. Cada tarea es un gesto: tocar para cortar, mantener para servir, arrastrar para cubrir, deslizar para separar. Termina antes de la hora límite, sin errores y sin cortarte. La nota del chef decide tus estrellas.</p>
          <p class="tech">Render: ${eng.backendName}</p>
        </details>
      </div>`, 'title-screen');
    el.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => (b.onclick = () => start(+b.dataset.d!)));
    el.querySelectorAll<HTMLButtonElement>('[data-o]').forEach((b) => (b.onclick = () => {
      if (b.dataset.o === 'sound') {
        s.muted = !s.muted;
        audio.setMuted(s.muted);
      } else {
        s.reduceMotion = !s.reduceMotion;
        eng.handheld = s.reduceMotion ? 0 : 1;
      }
      dir.persist();
      title();
    }));
  }

  function start(day: number) {
    audio.unlock();
    audio.play('click');
    onTitle = false;
    ui.hideScreen();
    ui.flash();
    dir.startDay(day);
  }

  function showPause() {
    if (!dir.running || dir.paused) return;
    dir.pause(true);
    const el = ui.showScreen(`<div class="pause"><h2>Pausa</h2><p>${DAY_NAMES[dir.day - 1]} · el chef espera.</p><button class="go" data-a="r">Seguir</button><button class="opt" data-a="q">Salir al menú</button></div>`, 'dim');
    (el.querySelector('[data-a=r]') as HTMLButtonElement).onclick = resume;
    (el.querySelector('[data-a=q]') as HTMLButtonElement).onclick = () => location.reload();
  }

  function resume() {
    ui.hideScreen();
    dir.pause(false);
  }

  dir.onEnd = async (html, st) => {
    if (dir.day === LAST_DAY) await dir.teamPhoto();
    else await dir.toOverview();
    const last = dir.day === LAST_DAY;
    const next = Math.min(LAST_DAY, dir.day + 1);
    const canNext = !last && dir.save.unlocked >= next;
    const el = ui.showScreen(`${html}<div class="row end">
      ${canNext ? `<button class="go" data-a="n">Día ${next} →</button>` : ''}
      <button class="${canNext ? 'opt' : 'go'}" data-a="r">${st === 0 && !last ? 'Repetir el día' : last ? 'Volver a empezar' : 'Repetir'}</button>
      <button class="opt" data-a="m">Menú</button></div>`, 'dim summary');
    audio.play(st >= 2 ? 'ding' : 'bell');
    el.querySelector<HTMLButtonElement>('[data-a=n]')?.addEventListener('click', () => start(next));
    el.querySelector<HTMLButtonElement>('[data-a=r]')!.onclick = () => start(last ? 1 : dir.day);
    el.querySelector<HTMLButtonElement>('[data-a=m]')!.onclick = () => title();
  };

  title();
  document.getElementById('boot')?.remove();
  (window as unknown as { __game: unknown }).__game = { eng, dir, kitchen, ui, start };
}

boot().catch((e) => {
  console.error(e);
  const b = document.getElementById('boot');
  if (b) b.textContent = 'Tu navegador no pudo iniciar el renderizado 3D (WebGPU/WebGL2).';
});
