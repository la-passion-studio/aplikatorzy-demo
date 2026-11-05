/**
 * aplikatorzy.pl — behaviour shared by every page (no WebGL, no GSAP).
 * The home page pulls in the pieces it needs from site.js; the plain pages
 * call initPage() and get everything.
 */
import { PARTNERS } from './partners.js';
import { SHOTS, FILTERS } from './realizacje.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const MAIL = 'biuro@aplikatorzy.pl';

/* --- partners ----------------------------------------------------------- */
export function renderPartners(root) {
  if (!root) return;
  root.innerHTML = PARTNERS.map((p) => {
    const inner = `<b>${esc(p.name)}</b>${p.sub ? `<small>${esc(p.sub)}</small>` : (p.url ? '<small>strona partnera</small>' : '')}`;
    return p.url
      ? `<a class="partner reveal" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(p.name)} — strona partnera">${inner}</a>`
      : `<div class="partner reveal">${inner}</div>`;
  }).join('');
}

/* --- gallery ------------------------------------------------------------- */
function tile(s, i) {
  return `<button class="shot reveal${s.shape ? ' shot--' + s.shape : ''}" style="--d:${(i % 3) * 90}ms" type="button" data-i="${i}" data-type="${esc(s.type)}" aria-label="Powiększ: ${esc(s.title)}">
    <img src="${esc(s.src)}" alt="${esc(s.title)}${s.car ? ' — ' + esc(s.car) : ''}" loading="lazy" decoding="async" width="1600" height="900" />
    ${s.viz ? '<span class="shot__viz">WIZUALIZACJA 3D</span>' : ''}
    <span class="shot__cap">${esc(s.title)}${s.car ? `<small>${esc(s.car)}</small>` : ''}</span>
  </button>`;
}

/** masonry: each picture drifts a little against the scroll, so the columns feel layered */
function driftTiles(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  const live = new Set();
  const watch = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? live.add(e.target) : live.delete(e.target))), { rootMargin: '10% 0px' });
  $$('.shot', root).forEach((t) => watch.observe(t));
  let ticking = false;
  const drift = () => {
    ticking = false;
    for (const t of live) {
      const r = t.getBoundingClientRect();
      const c = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
      t.style.setProperty('--py', (-c * 26).toFixed(1) + 'px');
    }
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(drift); } }, { passive: true });
}

/** The six tiles on the home page. */
// column heights stay within a few percent of each other (columns fill top to bottom)
const PREVIEW_SHAPES = ['sq', 'wide', '', 'sq', '', 'sq'];

export function renderPreview(root, n = 6) {
  if (!root) return;
  // one work per type first, so the preview is not five photos of the same car
  const seen = new Set(), pick = [];
  for (const s of SHOTS) if (!seen.has(s.type)) { seen.add(s.type); pick.push(s); }
  for (const s of SHOTS) if (pick.length < n && !pick.includes(s)) pick.push(s);
  root.innerHTML = pick.slice(0, n).map((s, i) =>
    `<a class="shot reveal${PREVIEW_SHAPES[i] ? ' shot--' + PREVIEW_SHAPES[i] : ''}" style="--d:${(i % 3) * 90}ms" href="realizacje.html" aria-label="${esc(s.title)} — zobacz realizacje">
      <img src="${esc(s.src)}" alt="${esc(s.title)}${s.car ? ' — ' + esc(s.car) : ''}" loading="lazy" decoding="async" width="1600" height="900" />
      ${s.viz ? '<span class="shot__viz">WIZUALIZACJA 3D</span>' : ''}
      <span class="shot__cap">${esc(s.title)}${s.car ? `<small>${esc(s.car)}</small>` : ''}</span>
    </a>`).join('');
  driftTiles(root);
}

export function initGallery(root, filtersRoot) {
  if (!root) return;
  root.innerHTML = SHOTS.map(tile).join('');
  const present = new Set(SHOTS.map((s) => s.type));
  if (filtersRoot) {
    filtersRoot.innerHTML = FILTERS.filter((f) => f.key === 'all' || present.has(f.key))
      .map((f, i) => `<button type="button" data-f="${f.key}" aria-pressed="${i === 0}">${esc(f.label)}</button>`).join('');
    filtersRoot.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-f]');
      if (!b) return;
      const key = b.dataset.f;
      $$('button', filtersRoot).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $$('.shot', root).forEach((el) => { el.hidden = key !== 'all' && el.dataset.type !== key; });
    });
  }

  driftTiles(root);

  // lightbox: focus moves into it, stays inside it, and returns to the tile that opened it
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', 'Podgląd zdjęcia');
  lb.innerHTML = '<button class="lightbox__x" aria-label="Zamknij">✕</button><button class="lightbox__p" aria-label="Poprzednie">‹</button><button class="lightbox__n" aria-label="Następne">›</button><figure><img alt="" /><figcaption></figcaption></figure>';
  document.body.appendChild(lb);
  const img = $('img', lb), cap = $('figcaption', lb);
  let cur = 0;
  const visible = () => $$('.shot', root).filter((el) => !el.hidden).map((el) => +el.dataset.i);
  const show = (i) => {
    cur = i; const s = SHOTS[i];
    img.src = s.src; img.alt = s.title;
    for (const d of [-1, 1]) { const v = visible(); const n = SHOTS[v[(v.indexOf(i) + d + v.length) % v.length]]; if (n) new Image().src = n.src; }
    cap.textContent = s.title + (s.car ? ' — ' + s.car : '') + (s.credit ? ' · ' + s.credit : '');
  };
  const step = (d) => { const v = visible(); const at = v.indexOf(cur); show(v[(at + d + v.length) % v.length]); };
  let opener = null;
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.shot'); if (!b) return;
    opener = b;
    show(+b.dataset.i); lb.classList.add('is-open'); document.body.style.overflow = 'hidden';
    $('.lightbox__x', lb).focus();
    lb.style.opacity = '0';
    // the picture grows out of the tile it was clicked on
    (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => { lb.style.opacity = ''; flip(false); });
  });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flip = (reverse, done) => {
    const from = opener && $('img', opener) && $('img', opener).getBoundingClientRect();
    const to = img.getBoundingClientRect();
    if (reduced || !from || !to.width || from.bottom < 0 || from.top > innerHeight) { if (done) done(); return; }
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const k = [{ transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})`, opacity: 0.4 }, { transform: 'none', opacity: 1 }];
    const a = img.animate(reverse ? k.reverse() : k, { duration: 440, easing: 'cubic-bezier(.2,.7,.1,1)', fill: 'none' });
    if (done) a.onfinish = done;
  };
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    const end = () => { lb.classList.remove('is-open'); lb.style.opacity = ''; closing = false; document.body.style.overflow = ''; if (opener) opener.focus(); };
    if (reduced) return end();
    lb.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease', fill: 'forwards' }).onfinish = end;
    flip(true);
  };
  // swipe on touch screens
  let sx = null, sy = 0;
  lb.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { sx = e.clientX; sy = e.clientY; } });
  lb.addEventListener('pointerup', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 90) step(dx < 0 ? 1 : -1);
  });
  // a small "zobacz" follows the pointer over the tiles (mouse only)
  if (matchMedia('(hover: hover) and (pointer: fine)').matches && !reduced) {
    const cur = document.createElement('div');
    cur.className = 'cursor'; cur.setAttribute('aria-hidden', 'true'); cur.textContent = 'ZOBACZ';
    document.body.appendChild(cur);
    let cx = 0, cy = 0, raf = 0;
    root.addEventListener('pointermove', (e) => {
      cx = e.clientX; cy = e.clientY;
      cur.classList.toggle('is-on', !!e.target.closest('.shot'));
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; cur.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`; });
    });
    root.addEventListener('pointerleave', () => cur.classList.remove('is-on'));
  }
  $('.lightbox__x', lb).addEventListener('click', close);
  $('.lightbox__p', lb).addEventListener('click', () => step(-1));
  $('.lightbox__n', lb).addEventListener('click', () => step(1));
  lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
  window.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('is-open')) return;
    if (e.key === 'Tab') {
      const f = $$('button', lb); const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    } else if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });
}

/* --- forms: no backend, so the message is handed to the visitor's mail app */
export function initForms() {
  for (const form of $$('form[data-mail]')) {
    const note = $('.form__note', form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = new FormData(form);
      const name = String(d.get('name') || '').trim();
      const phone = String(d.get('phone') || '').trim();
      const email = String(d.get('email') || '').trim();
      if (!name || (!phone && !email)) { if (note) note.textContent = 'Podaj imię oraz telefon lub e-mail.'; return; }
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { if (note) note.textContent = 'Sprawdź adres e-mail.'; return; }
      const lines = [`Imię i nazwisko: ${name}`, phone && `Telefon: ${phone}`, email && `E-mail: ${email}`, '', String(d.get('message') || '').trim()].filter((x) => x !== false && x !== '');
      const subject = form.dataset.subject || 'Zapytanie ze strony';
      location.href = `mailto:${MAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
      if (note) note.innerHTML = `Otwieramy Twój program pocztowy z gotową wiadomością. Jeśli nic się nie otworzyło, napisz na <a href="mailto:${MAIL}">${MAIL}</a>.`;
    });
  }
}

/* --- nav, menu, reveals ---------------------------------------------------- */
export function initNav() {
  const nav = $('#nav'), burger = $('#burger'), menu = $('#menu');
  const onScroll = () => nav && nav.classList.toggle('is-scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (burger && menu) {
    const close = () => { burger.setAttribute('aria-expanded', 'false'); menu.classList.remove('is-open'); menu.setAttribute('aria-hidden', 'true'); document.body.classList.remove('menu-open'); };
    burger.addEventListener('click', () => {
      if (burger.getAttribute('aria-expanded') === 'true') return close();
      burger.setAttribute('aria-expanded', 'true'); menu.classList.add('is-open'); menu.setAttribute('aria-hidden', 'false'); document.body.classList.add('menu-open');
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') { close(); burger.focus(); } });
    $$('a', menu).forEach((a) => a.addEventListener('click', close));
  }
}

export function initProgress() {
  if (document.getElementById('progress')) return;
  const bar = document.createElement('div');
  bar.id = 'progress'; bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);
  const upd = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`;
  };
  addEventListener('scroll', upd, { passive: true }); addEventListener('resize', upd); upd();
}

export function initReveal() {
  const els = $$('.reveal:not(.is-in)');
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.forEach((e) => e.classList.add('is-in')); return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  els.forEach((e) => io.observe(e));
}

/** Buttons lean a few pixels towards the pointer. Pointer devices only, never with reduced motion. */
export function initMagnetic() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const b of $$('.btn, .nav__cta')) {
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      b.style.transition = 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)';
      b.style.transform = `translate(${(dx * 10).toFixed(1)}px, ${(dy * 8).toFixed(1)}px)`;
    });
    b.addEventListener('pointerleave', () => {
      b.style.transition = 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)';
      b.style.transform = '';
    });
  }
}

/** Content is visible unless this script is known to run: no opacity:0 without a way back. */
export function enableReveal() { document.documentElement.classList.add('js-reveal'); }

export function initPage() {
  enableReveal();
  renderPartners($('#partners'));
  initGallery($('#gallery'), $('#filters'));
  initNav();
  initForms();
  initReveal();
  initProgress();
  initMagnetic();
  const y = $('#year'); if (y) y.textContent = String(new Date().getFullYear());
}
