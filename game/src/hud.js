// The DOM HUD: crosshair, hit marker, health, ammo, money, round timer, score,
// team strength, kill feed, minimap, buy menu and the overlay panels. It never
// touches the simulation; main.js pushes numbers in and reads clicks out.
import { WEAPONS, GRENADE } from './weapon.js';

const COPY = {
  start: { title: 'MERIDIAN FOUNDRY', copy: 'Three versus three. Plant the charge at Furnace or Crane Bay, or clear the Azure squad. Click to play.', action: 'Click to play' },
  paused: { title: 'MERIDIAN FOUNDRY', copy: 'Paused. Click to resume.', action: 'Click to resume' },
  roundEnd: { title: 'Round over', copy: '', action: 'Next round' },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoBox = $('ammo');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const moneyVal = $('money-val');
  const timerVal = $('timer-val');
  const scoreEmber = $('score-ember');
  const scoreAzure = $('score-azure');
  const roundVal = $('round-val');
  const aliveEmber = $('alive-ember');
  const aliveAzure = $('alive-azure');
  const nadeVal = $('nade-val');
  const chargeTag = $('charge-tag');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const flashOverlay = $('flash-overlay');
  const damageOverlay = $('damage-overlay');
  const minimap = $('minimap');
  const mapCtx = minimap.getContext('2d');
  const buyPanel = $('buy-panel');
  const buyGrid = $('buy-grid');
  const buyMoney = $('buy-money');
  const deployBtn = $('deploy');

  let hitTimer = 0;
  let bannerTimer = 0;
  let last = { mag: -1, reserve: -1, hp: -1, money: -1, timer: -1, se: -1, sa: -1, round: -1, ae: -1, aa: -1, nade: -1, weapon: '' };
  let playHandler = null;
  let buyHandler = null;

  function buildBuyMenu() {
    buyGrid.innerHTML = '';
    for (const def of Object.values(WEAPONS)) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'buy-card';
      card.dataset.id = def.id;
      card.innerHTML = `<b>${def.name}</b><span class="buy-kind">${def.kind} · ${def.damage} dmg · ${def.mag} rnd</span><span class="buy-blurb">${def.blurb}</span><span class="buy-price">$${def.price}</span>`;
      card.addEventListener('click', () => buyHandler && buyHandler(def.id));
      buyGrid.appendChild(card);
    }
    const nade = document.createElement('button');
    nade.type = 'button';
    nade.className = 'buy-card';
    nade.dataset.id = 'grenade';
    nade.innerHTML = `<b>${GRENADE.name}</b><span class="buy-kind">Grenade · press G to throw</span><span class="buy-blurb">${GRENADE.blurb}</span><span class="buy-price">$${GRENADE.price}</span>`;
    nade.addEventListener('click', () => buyHandler && buyHandler('grenade'));
    buyGrid.appendChild(nade);
  }
  buildBuyMenu();
  deployBtn.addEventListener('click', () => buyHandler && buyHandler('deploy'));
  play.addEventListener('click', () => playHandler && playHandler());

  return {
    setHealth(hp) {
      if (hp === last.hp) return;
      last.hp = hp;
      healthFill.style.width = `${Math.max(0, hp)}%`;
      healthFill.classList.toggle('low', hp <= 30);
      healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
    },
    setAmmo(mag, reserve) {
      if (mag === last.mag && reserve === last.reserve) return;
      last.mag = mag; last.reserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      if (name === last.weapon) return;
      last.weapon = name;
      weaponName.textContent = name;
    },
    setMoney(n) {
      if (n === last.money) return;
      last.money = n;
      moneyVal.textContent = `$${n}`;
      buyMoney.textContent = `$${n}`;
    },
    setTimer(seconds, phase) {
      const v = Math.max(0, Math.ceil(seconds));
      if (v === last.timer && phase === last.phase) return;
      last.timer = v; last.phase = phase;
      timerVal.textContent = `${String(Math.floor(v / 60)).padStart(1, '0')}:${String(v % 60).padStart(2, '0')}`;
      timerVal.classList.toggle('buy', phase === 'buy');
    },
    setScore(ember, azure, round) {
      if (ember === last.se && azure === last.sa && round === last.round) return;
      last.se = ember; last.sa = azure; last.round = round;
      scoreEmber.textContent = String(ember);
      scoreAzure.textContent = String(azure);
      roundVal.textContent = `ROUND ${round}`;
    },
    setAlive(ember, azure) {
      if (ember === last.ae && azure === last.aa) return;
      last.ae = ember; last.aa = azure;
      aliveEmber.textContent = '●'.repeat(ember) + '○'.repeat(Math.max(0, 3 - ember));
      aliveAzure.textContent = '●'.repeat(azure) + '○'.repeat(Math.max(0, 3 - azure));
    },
    setGrenades(n) {
      if (n === last.nade) return;
      last.nade = n;
      nadeVal.textContent = n > 0 ? `G · SPARK-9 ×${n}` : 'G · no grenade';
    },
    setCharge(carrying) {
      chargeTag.hidden = !carrying;
    },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--spread', `${px}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    killfeed(killer, victim, weapon, headshot) {
      const row = document.createElement('div');
      row.className = 'kf-row';
      row.innerHTML = `<span class="kf-killer">${killer}</span><span class="kf-weapon">${headshot ? '⌖ ' : ''}${weapon}</span><span class="kf-victim">${victim}</span>`;
      killfeed.prepend(row);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => row.remove(), 6000);
    },
    banner(text, sub, ms = 2600) {
      bannerTitle.textContent = text;
      bannerSub.textContent = sub || '';
      banner.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('show'), ms);
    },
    plant(progress, label) {
      if (progress == null) { plantBar.hidden = true; return; }
      plantBar.hidden = false;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
      plantLabel.textContent = label;
    },
    flash() {
      flashOverlay.classList.add('on');
      setTimeout(() => flashOverlay.classList.remove('on'), 420);
    },
    damage() {
      damageOverlay.classList.add('on');
      setTimeout(() => damageOverlay.classList.remove('on'), 260);
    },
    markBuyAffordable(money, owned) {
      for (const card of buyGrid.children) {
        const id = card.dataset.id;
        const price = id === 'grenade' ? GRENADE.price : WEAPONS[id].price;
        card.classList.toggle('owned', owned === id);
        card.classList.toggle('cant', price > money && owned !== id);
      }
    },
    showOverlay(mode, data = {}) {
      const text = COPY[mode] || COPY.start;
      title.textContent = mode === 'roundEnd' ? data.title || text.title : text.title;
      copy.textContent = mode === 'roundEnd' ? (data.copy || '') : text.copy;
      play.textContent = data.action || text.action;
      overlay.hidden = false;
      buyPanel.hidden = true;
      if (mode === 'start') play.focus();
    },
    showBuy(round) {
      overlay.hidden = true;
      buyPanel.hidden = false;
      $('buy-title').textContent = `BUY PHASE — ROUND ${round}`;
    },
    hideOverlays() {
      overlay.hidden = true;
      buyPanel.hidden = true;
    },
    onPlay(handler) { playHandler = handler; },
    onBuy(handler) { buyHandler = handler; },
    drawMinimap(view) {
      // view: { player:{x,z,yaw,alive}, bots:[{x,z,team,alive}], planted:{x,z}|null, sites:{A:{x,z},B:{x,z}} }
      const W = minimap.width;
      const H = minimap.height;
      mapCtx.clearRect(0, 0, W, H);
      mapCtx.fillStyle = 'rgba(20,16,12,0.85)';
      mapCtx.fillRect(0, 0, W, H);
      const sx = (x) => ((x + 20) / 40) * W;
      const sz = (z) => ((z + 18) / 36) * H;
      // Site zones
      for (const [key, site] of Object.entries(view.sites)) {
        mapCtx.strokeStyle = '#f0a830';
        mapCtx.lineWidth = 1.5;
        mapCtx.beginPath();
        mapCtx.arc(sx(site.x), sz(site.z), 9, 0, Math.PI * 2);
        mapCtx.stroke();
        mapCtx.fillStyle = '#f0a830';
        mapCtx.font = 'bold 10px monospace';
        mapCtx.textAlign = 'center';
        mapCtx.fillText(key, sx(site.x), sz(site.z) + 3);
      }
      if (view.planted) {
        mapCtx.fillStyle = Math.floor(performance.now() / 250) % 2 ? '#ff2a1a' : '#ffd27a';
        mapCtx.beginPath();
        mapCtx.arc(sx(view.planted.x), sz(view.planted.z), 5, 0, Math.PI * 2);
        mapCtx.fill();
      }
      for (const bot of view.bots) {
        if (!bot.alive) continue;
        mapCtx.fillStyle = bot.team === 'ember' ? '#e8702a' : '#3a86ff';
        mapCtx.beginPath();
        mapCtx.arc(sx(bot.x), sz(bot.z), 3.5, 0, Math.PI * 2);
        mapCtx.fill();
      }
      if (view.player.alive) {
        const px = sx(view.player.x);
        const pz = sz(view.player.z);
        mapCtx.fillStyle = '#ffffff';
        mapCtx.beginPath();
        mapCtx.moveTo(px + Math.sin(view.player.yaw) * -7, pz + Math.cos(view.player.yaw) * -7);
        mapCtx.lineTo(px + 5, pz + 5);
        mapCtx.lineTo(px - 5, pz + 5);
        mapCtx.closePath();
        mapCtx.fill();
      }
    },
  };
}
