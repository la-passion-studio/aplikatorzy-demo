/**
 * aplikatorzy.pl — the page around the film
 *
 * Loader, navigation, scroll reveals, the contact form. Deliberately small:
 * the 3D scene owns the spectacle, this owns the manners.
 */

import { gsap } from '../vendor/gsap/index.js';
import { ScrollTrigger } from '../vendor/gsap/ScrollTrigger.js';
import { renderPartners, renderPreview, initForms, initMagnetic, enableReveal, initReveal } from './pages.js';

/* --- loader ------------------------------------------------------------- */

let loaderShown = 0;

export function setLoaderProgress(p) {
  const v = Math.max(loaderShown, Math.min(1, p || 0));
  loaderShown = v;
  const fill = document.getElementById('loader-fill');
  const pct = document.getElementById('loader-pct');
  if (fill) fill.style.width = `${(v * 100).toFixed(1)}%`;
  if (pct) pct.textContent = `${Math.round(v * 100)}%`;
}

export function finishLoader() {
  setLoaderProgress(1);
  const label = document.getElementById('loader-label');
  if (label) label.textContent = 'GOTOWE';
  const loader = document.getElementById('loader');
  if (!loader) return;
  // let the bar read 100% for a beat before it dissolves
  setTimeout(() => {
    loader.classList.add('is-done');
    setTimeout(() => { loader.style.display = 'none'; }, 1300);
  }, 340);
}

export function showFatal(message) {
  const box = document.getElementById('fatal');
  const msg = document.getElementById('fatal-msg');
  const loader = document.getElementById('loader');
  if (loader) loader.classList.add('is-done');
  document.body.classList.remove('is-locked');
  if (msg) msg.textContent = '';   // technical detail stays in the console, not on the page
  console.error('[3D]', message);
  document.body.classList.add('no-3d');
  if (box) box.hidden = false;
  // the site below still has to work
  const canvas = document.getElementById('stage');
  if (canvas) canvas.style.opacity = '0';
  revealEverything();
}

function revealEverything() {
  document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'));
}

/* --- the page ----------------------------------------------------------- */

export function initSite() {
  enableReveal();
  const nav = document.getElementById('nav');
  const burger = document.getElementById('burger');
  const menu = document.getElementById('menu');

  /* navigation goes quiet and blurred once you leave the top */
  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle('is-scrolled', window.scrollY > 40);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* mobile menu */
  if (burger && menu) {
    const close = () => {
      burger.setAttribute('aria-expanded', 'false');
      menu.classList.remove('is-open');
      menu.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('menu-open');
    };
    burger.addEventListener('click', () => {
      const open = burger.getAttribute('aria-expanded') === 'true';
      if (open) return close();
      burger.setAttribute('aria-expanded', 'true');
      menu.classList.add('is-open');
      menu.setAttribute('aria-hidden', 'false');
      document.body.classList.add('menu-open');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') { close(); burger.focus(); }
    });
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  }

  /* Partners and the gallery preview are drawn by script, so they have to exist BEFORE
     the reveal observer starts looking for .reveal — otherwise they stay at opacity 0
     for good (that was the "empty" sections). The same observer serves every page. */
  renderPartners(document.getElementById('partners'));
  renderPreview(document.getElementById('preview'));
  initReveal();

  /* anchor links have to clear the fixed navigation */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#' || id === '#top') {
        if (id === '#top') { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        return;
      }
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const y = target.getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top: y, behavior: 'smooth' });
    });
  });

  initForms();
  initMagnetic();

  initBusinessCard();

  /* the two clips are silent renders: play them while they are on screen */
  const clips = document.querySelectorAll('.reel__video');
  if (clips.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) e.target.play().catch(() => {});
        else e.target.pause();
      }
    }, { threshold: 0.35 });
    clips.forEach((v) => io.observe(v));
  }

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  gsap.set('.site', { autoAlpha: 1 });
}

/**
 * The business card is a real object: you can pick it up and turn it over.
 *
 * Drag rotates it in both axes with the weight you would expect from a card
 * — it keeps spinning a little when you let go, then settles onto whichever
 * face is pointing at you rather than snapping back to a fixed pose. Arrow
 * keys do the same thing for anyone not using a pointer.
 */
function initBusinessCard() {
  const card = document.querySelector('.bizcard');
  if (!card) return;

  const REST_X = -8;
  let rx = REST_X, ry = -18;      // current rotation, degrees
  let vx = 0, vy = 0;             // angular velocity
  let dragging = false;
  let px = 0, py = 0;
  let idle = 0;
  let last = performance.now();

  card.style.animation = 'none';
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', 'Wizytówka aplikatorzy.pl — przeciągnij, aby obrócić');

  const down = (e) => {
    dragging = true;
    idle = 0;
    vx = vy = 0;
    px = e.clientX; py = e.clientY;
    card.classList.add('is-held');
    if (e.pointerId !== undefined && card.setPointerCapture) {
      try { card.setPointerCapture(e.pointerId); } catch (_) { /* not fatal */ }
    }
  };

  const move = (e) => {
    if (!dragging) return;
    const dx = e.clientX - px;
    const dy = e.clientY - py;
    px = e.clientX; py = e.clientY;
    ry += dx * 0.62;
    rx = Math.max(-72, Math.min(72, rx - dy * 0.45));
    vy = dx * 0.62;
    vx = -dy * 0.45;
    e.preventDefault();
  };

  const up = () => {
    if (!dragging) return;
    dragging = false;
    idle = 0;
    card.classList.remove('is-held');
  };

  card.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);

  card.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 45 : 15;
    if (e.key === 'ArrowLeft') { ry -= step; idle = 0; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { ry += step; idle = 0; e.preventDefault(); }
    else if (e.key === 'ArrowUp') { rx = Math.max(-72, rx - step); idle = 0; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { rx = Math.min(72, rx + step); idle = 0; e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'Enter') { ry += 180; idle = 0; e.preventDefault(); }
  });

  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (!dragging) {
      // let it run on, then bleed the speed away
      ry += vy * dt * 60;
      rx = Math.max(-72, Math.min(72, rx + vx * dt * 60));
      const decay = Math.pow(0.94, dt * 60);
      vx *= decay; vy *= decay;
      if (Math.abs(vx) < 0.02) vx = 0;
      if (Math.abs(vy) < 0.02) vy = 0;

      idle += dt;
      // once it has been still for a moment, settle onto the nearer face
      if (!vx && !vy && idle > 1.4) {
        const target = Math.round(ry / 180) * 180;
        ry += (target - ry) * Math.min(1, dt * 2.4);
        rx += (REST_X - rx) * Math.min(1, dt * 2.0);
      }
    }

    // a slow breath, so a card nobody is touching is not dead still
    const drift = dragging ? 0 : Math.sin(now / 2600) * 1.6;
    card.style.transform = `rotateX(${rx + drift * 0.4}deg) rotateY(${ry + drift}deg)`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
