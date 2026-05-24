// 攻守游戏 — 客户端主控制器
import { MSG } from './protocol.mjs';
import { WSClient } from './ws-client.mjs';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ── 全局状态 ──
const ws = new WSClient();
let myId = null;
let myName = '';
let isHost = false;
let roomCode = '';
let gamePlayers = [];
let totalRounds = 10;
let currentRound = 0;
let myAmmo = 1;
let myHp = 0;
let submittedAction = false;
let roundResultReceived = false;
let publicTunnelUrl = null;

// 获取公网隧道地址
async function fetchPublicURL() {
  try {
    const res = await fetch('/api/info');
    const info = await res.json();
    if (info.tunnelUrl) {
      publicTunnelUrl = info.tunnelUrl;
      const urlEl = $('#lobby-url-text');
      const wrapEl = $('#lobby-public-url');
      if (urlEl) urlEl.textContent = publicTunnelUrl;
      if (wrapEl) wrapEl.style.display = 'block';
    }
  } catch (e) {
    // 无外网地址，不显示
  }
}

// ── 屏幕引用 ──
const screenSetup = $('#screen-setup');
const screenLobby = $('#screen-lobby');
const screenGame = $('#screen-game');
const screenFinal = $('#screen-final');

function showScreen(screen) {
  [screenSetup, screenLobby, screenGame, screenFinal].forEach(s => s.classList.add('hidden'));
  screen.classList.remove('hidden');
}

// ── 动画工具 ──
const flashEl = $('#screen-flash');
const combatLayer = $('#combat-layer');
const actionAnimLayer = $('#action-anim-layer');
const arena = $('#arena');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function flashScreen(c) {
  flashEl.className = 'screen-flash';
  if (c === 'cyan') flashEl.classList.add('cyan');
  flashEl.classList.add('active');
  setTimeout(() => flashEl.classList.remove('active'), 120);
}
function flashScreenLong(c) {
  flashEl.className = 'screen-flash';
  if (c === 'cyan') flashEl.classList.add('cyan');
  flashEl.classList.add('active');
  setTimeout(() => flashEl.classList.remove('active'), 300);
}

function getCardCenter(index) {
  const card = document.getElementById(`card-${index}`);
  if (!card) return { x: innerWidth / 2, y: innerHeight / 2 };
  const r = card.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function getCardBottom(index) {
  const card = document.getElementById(`card-${index}`);
  if (!card) return { x: innerWidth / 2, y: innerHeight / 2 };
  const r = card.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.bottom + 10 };
}

function spawnImpactParticles(x, y, count, c1, c2) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'impact-particle';
    const size = 3 + Math.random() * 6;
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 80;
    const hue = Math.random() < 0.5 ? c1 : c2;
    p.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${hue};box-shadow:0 0 6px ${hue},0 0 12px ${hue};animation:shardFly .7s ease-out forwards`;
    combatLayer.appendChild(p);
    const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist;
    p.style.setProperty('--dx', dx + 'px');
    p.style.setProperty('--dy', dy + 'px');
    p.addEventListener('animationend', () => p.remove());
  }
}

function spawnShieldShard(pos) {
  const shard = document.createElement('div');
  const angle = Math.random() * Math.PI * 2, dist = 30 + Math.random() * 60;
  shard.style.cssText = `position:absolute;left:${pos.x}px;top:${pos.y}px;font-size:${0.6 + Math.random() * 0.8}rem;pointer-events:none;z-index:303;animation:shardFly .5s ease-out forwards`;
  shard.textContent = '\u{1F4A0}';
  combatLayer.appendChild(shard);
  const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist;
  shard.style.setProperty('--dx', dx + 'px');
  shard.style.setProperty('--dy', dy + 'px');
  shard.addEventListener('animationend', () => shard.remove());
}

function spawnMuzzleFlash(index) {
  const pos = getCardCenter(index);
  const flash = document.createElement('div');
  flash.className = 'muzzle-flash';
  flash.style.left = pos.x + 'px';
  flash.style.top = pos.y + 'px';
  combatLayer.appendChild(flash);
  flash.addEventListener('animationend', () => flash.remove());
}

async function animateBullet(fromIdx, toIdx, blocked) {
  const from = getCardCenter(fromIdx), to = getCardCenter(toIdx);
  const bullet = document.createElement('div');
  bullet.className = 'bullet';
  bullet.textContent = blocked ? '\u{1F4A5}' : '\u{1F525}';
  bullet.style.left = from.x + 'px';
  bullet.style.top = from.y + 'px';
  bullet.style.fontSize = '2.8rem';
  combatLayer.appendChild(bullet);

  const trail = document.createElement('div');
  trail.className = 'bullet-trail';
  combatLayer.appendChild(trail);

  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const duration = Math.max(300, Math.min(550, dist / 1.5));
  const start = performance.now();
  flashScreen();

  await new Promise(resolve => {
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      const cx = from.x + dx * e, cy = from.y + dy * e;
      bullet.style.left = cx + 'px';
      bullet.style.top = cy + 'px';
      const angle = Math.atan2(dy, dx);
      const trailLen = Math.min(60, dist * 0.15);
      trail.style.left = (cx - Math.cos(angle) * trailLen) + 'px';
      trail.style.top = cy + 'px';
      trail.style.width = trailLen + 'px';
      trail.style.transform = `rotate(${angle}rad)`;
      trail.style.opacity = 0.7 * (1 - t);
      if (t < 1) requestAnimationFrame(frame);
      else { bullet.remove(); trail.remove(); resolve(); }
    }
    requestAnimationFrame(frame);
  });
}

function spawnImpactBurst(index) {
  const pos = getCardCenter(index);
  const ring = document.createElement('div');
  ring.className = 'impact-ring';
  ring.style.left = (pos.x - 40) + 'px';
  ring.style.top = (pos.y - 40) + 'px';
  combatLayer.appendChild(ring);
  ring.addEventListener('animationend', () => ring.remove());
  spawnImpactParticles(pos.x, pos.y, 12, 'var(--neon-crimson)', 'var(--neon-gold)');
}

function spawnImpactText(index, text, color) {
  const pos = getCardCenter(index);
  const el = document.createElement('div');
  el.className = 'impact-text';
  el.textContent = text;
  el.style.left = pos.x + 'px';
  el.style.top = pos.y + 'px';
  el.style.color = color;
  combatLayer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function shakeScreen() {
  const app = $('#app');
  app.classList.add('screen-shake');
  setTimeout(() => app.classList.remove('screen-shake'), 500);
}

function flashCard(index) {
  const card = document.getElementById(`card-${index}`);
  if (!card) return;
  card.classList.add('hit-flash');
  setTimeout(() => card.classList.remove('hit-flash'), 600);
}

function showBigAction(index, emoji, cssClass) {
  const pos = getCardBottom(index);
  const el = document.createElement('div');
  el.className = `big-action ${cssClass}`;
  el.textContent = emoji;
  el.style.left = pos.x + 'px';
  el.style.top = pos.y + 'px';
  el.style.transform = 'translate(-50%,0)';
  actionAnimLayer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function flashAmmoIncrease(index) {
  const card = document.getElementById(`card-${index}`);
  if (!card) return;
  const ammoRow = card.querySelector('.card-ammo-row .ammo-dots');
  if (!ammoRow) return;
  const newDot = document.createElement('span');
  newDot.className = 'ammo-dot new-ammo';
  ammoRow.appendChild(newDot);
  newDot.addEventListener('animationend', () => {
    newDot.className = 'ammo-dot filled';
    newDot.style.animation = '';
  });
}

function spawnBulletReload(center) {
  const colors = ['\u{1F7E1}', '\u{1F7E2}', '\u{1F535}', '\u{1F7E3}'];
  const cnt = 6;
  for (let i = 0; i < cnt; i++) {
    const angle = (Math.PI * 2 * i) / cnt - Math.PI / 2;
    const startDist = 80 + Math.random() * 40;
    const sx = center.x + Math.cos(angle) * startDist, sy = center.y + Math.sin(angle) * startDist;
    const dx = center.x - sx, dy = center.y - sy;

    const trail = document.createElement('div');
    trail.className = 'reload-trail';
    trail.style.cssText = `position:absolute;left:${sx}px;top:${sy}px;width:5px;height:5px;border-radius:50%;background:#fbbf24;pointer-events:none;z-index:60;box-shadow:0 0 8px #f59e0b,0 0 16px #fbbf24`;
    trail.style.setProperty('--dx', dx + 'px');
    trail.style.setProperty('--dy', dy + 'px');
    trail.style.setProperty('--delay', (i * 0.05) + 's');
    actionAnimLayer.appendChild(trail);
    trail.addEventListener('animationend', () => trail.remove());

    const bullet = document.createElement('div');
    bullet.className = 'reload-bullet';
    bullet.textContent = colors[i % colors.length];
    bullet.style.cssText = `position:absolute;left:${sx}px;top:${sy}px;font-size:1.8rem;pointer-events:none;z-index:61;filter:drop-shadow(0 0 12px rgba(251,191,36,0.9))`;
    bullet.style.setProperty('--dx', dx + 'px');
    bullet.style.setProperty('--dy', dy + 'px');
    bullet.style.setProperty('--delay', (i * 0.05) + 's');
    actionAnimLayer.appendChild(bullet);
    bullet.addEventListener('animationend', () => bullet.remove());
  }

  const flash = document.createElement('div');
  flash.className = 'reload-flash';
  flash.textContent = '✨';
  flash.style.cssText = `position:absolute;left:${center.x}px;top:${center.y}px;font-size:4rem;pointer-events:none;z-index:62;transform:translate(-50%,-50%);filter:drop-shadow(0 0 30px rgba(0,138,80,0.8))`;
  actionAnimLayer.appendChild(flash);
  flash.addEventListener('animationend', () => flash.remove());
}

function spawnReloadLabel(pos) {
  const el = document.createElement('div');
  el.className = 'reload-label';
  el.textContent = '+1 弹药 ✦';
  el.style.left = pos.x + 'px';
  el.style.top = (pos.y + 30) + 'px';
  actionAnimLayer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

async function animateActionReveal(players) {
  actionAnimLayer.innerHTML = '';
  const promises = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p.action) continue;
    promises.push(new Promise(resolve => {
      setTimeout(() => {
        if (p.action.type === 'shoot') showBigAction(i, '\u{1F52B}', 'big-gun');
        else if (p.action.type === 'shield') showBigAction(i, '\u{1F6E1}️', 'big-shield');
        else if (p.action.type === 'reload') {
          spawnBulletReload(getCardBottom(i));
          spawnReloadLabel(getCardBottom(i));
          flashAmmoIncrease(i);
        }
        resolve();
      }, i * 120);
    }));
  }
  await Promise.all(promises);
  await sleep(300);
}

// ── 卡牌渲染 ──
function renderArena(players) {
  arena.innerHTML = '';
  if (players.length === 2) {
    arena.classList.add('duel');
    const vsZone = $('#vs-zone');
    if (vsZone) vsZone.classList.remove('hidden');
  } else {
    arena.classList.remove('duel');
    const vsZone = $('#vs-zone');
    if (vsZone) vsZone.classList.add('hidden');
  }

  players.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.style.animationDelay = `${i * 0.12}s`;
    card.id = `card-${i}`;

    const hpVal = Math.max(0, p.hp);
    const maxHp = p.maxHp || totalRounds;
    const hpPct = Math.min(100, (hpVal / maxHp) * 100);
    const hpClass = hpPct >= 60 ? 'high' : hpPct >= 30 ? 'mid' : 'low';

    let ammoDots = '';
    const show = Math.min(p.ammo, 8);
    for (let a = 0; a < show; a++) ammoDots += '<span class="ammo-dot filled"></span>';
    if (p.ammo > 8) ammoDots += `<span style="font-size:.7rem;color:var(--neon-gold);margin-left:2px">+${p.ammo - 8}</span>`;

    const badge = p.isAI ? '<span class="card-ai-badge">\u{1F916} AI</span>' :
      (p.disconnected ? '<span class="card-ai-badge">\u{1F4A4} 断线</span>' : '<span class="card-ai-badge">\u{1F464} 真人</span>');

    card.innerHTML = `
      <div class="card-header"><span class="card-name">${p.name}</span>${badge}</div>
      <div class="card-hp">
        <div class="hp-label">❤️ HP ${hpVal}/${maxHp}</div>
        <div class="hp-bar-track"><div class="hp-bar-fill ${hpClass}" style="width:${hpPct}%"></div></div>
      </div>
      <div class="card-ammo-row">
        <span class="ammo-label">\u{1F52B} 弹药</span>
        <div class="ammo-dots">${ammoDots}</div>
      </div>
      <div class="card-info">
        <span class="card-damage">⚔️ 伤害 ${p.score}</span>
      </div>
      <div class="card-action-tag hidden"></div>`;
    if (hpVal <= 0) card.classList.add('defeated');
    arena.appendChild(card);
  });
}

function updateAllCards(players) {
  players.forEach((p, i) => {
    const card = document.getElementById(`card-${i}`);
    if (!card) return;
    const maxHp = p.maxHp || totalRounds;
    const hpVal = Math.max(0, p.hp);
    const hpPct = Math.min(100, (hpVal / maxHp) * 100);
    const hpClass = hpPct >= 60 ? 'high' : hpPct >= 30 ? 'mid' : 'low';

    const label = card.querySelector('.hp-label');
    if (label) {
      label.textContent = `❤️ HP ${hpVal}/${maxHp}`;
      label.classList.remove('hp-value-jump');
      void label.offsetWidth;
      label.classList.add('hp-value-jump');
    }

    const fill = card.querySelector('.hp-bar-fill');
    if (fill) { fill.style.width = `${hpPct}%`; fill.className = `hp-bar-fill ${hpClass}`; }

    const dmg = card.querySelector('.card-damage');
    if (dmg) dmg.textContent = `⚔️ 伤害 ${p.score}`;

    const ammoRow = card.querySelector('.card-ammo-row .ammo-dots');
    if (ammoRow) {
      let dots = '';
      const show = Math.min(p.ammo, 8);
      for (let a = 0; a < show; a++) dots += '<span class="ammo-dot filled"></span>';
      if (p.ammo > 8) dots += `<span style="font-size:.7rem;color:var(--neon-gold);margin-left:2px">+${p.ammo - 8}</span>`;
      ammoRow.innerHTML = dots;
    }

    if (hpVal <= 0) card.classList.add('defeated');
  });
}

function updateCardAction(player, index) {
  const card = document.getElementById(`card-${index}`);
  if (!card || !player.action) return;
  const tag = card.querySelector('.card-action-tag');
  tag.classList.remove('hidden');
  if (player.action.type === 'shoot') {
    tag.className = 'card-action-tag shoot';
    const targets = (player.action.targets || []).map(tid => {
      const tp = gamePlayers.find(p => p.id === tid);
      return tp ? tp.name : tid;
    }).join(',');
    tag.textContent = `\u{1F52B} 射击 ${targets}`;
  } else if (player.action.type === 'shield') {
    tag.className = 'card-action-tag shield';
    tag.textContent = '\u{1F6E1}️ 举盾';
  } else {
    tag.className = 'card-action-tag reload';
    tag.textContent = '\u{1F4E6} 装弹';
  }
  card.classList.add('revealed');
}

function highlightCard(index, action) {
  const card = document.getElementById(`card-${index}`);
  if (!card) return;
  card.classList.remove('shooter', 'shielder', 'reloader');
  if (action.type === 'shoot') card.classList.add('shooter');
  if (action.type === 'shield') card.classList.add('shielder');
  if (action.type === 'reload') card.classList.add('reloader');
}

function clearCardHighlights() {
  gamePlayers.forEach((p, i) => {
    const card = document.getElementById(`card-${i}`);
    if (card) { card.classList.remove('shooter', 'shielder', 'reloader', 'revealed'); }
    const tag = card?.querySelector('.card-action-tag');
    if (tag) tag.classList.add('hidden');
  });
}

// ── 回合动画 ──
async function animateCombat(events, players) {
  if (events.length === 0) return;
  combatLayer.classList.remove('hidden');

  const seen = new Set();
  const unique = [];
  for (const ev of events) {
    if (ev.type === 'dual') {
      const key = [ev.from, ev.to].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
    }
    unique.push(ev);
  }

  const shieldHits = new Map();
  let hitCount = 0;

  for (const ev of unique) {
    const fromIdx = players.findIndex(p => p.id === ev.from);
    const toIdx = players.findIndex(p => p.id === ev.to);
    const playerIdx = players.findIndex(p => p.id === ev.player);

    if (ev.type === 'fatigue') {
      const pos = playerIdx >= 0 ? getCardCenter(playerIdx) : { x: innerWidth / 2, y: innerHeight / 2 };
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${pos.x}px;top:${pos.y - 40}px;font-size:1.5rem;font-weight:900;color:#cc4400;text-shadow:0 0 20px rgba(204,68,0,0.5);white-space:nowrap;pointer-events:none;z-index:303;animation:impactPop .8s ease-out forwards`;
      el.textContent = '⚠️ 盾牌疲劳！';
      combatLayer.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }

    if (ev.type === 'passivity') {
      const pos = playerIdx >= 0 ? getCardCenter(playerIdx) : { x: innerWidth / 2, y: innerHeight / 2 };
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${pos.x}px;top:${pos.y - 30}px;font-size:1.5rem;font-weight:900;color:#8888aa;text-shadow:0 0 15px rgba(0,0,0,0.3);white-space:nowrap;pointer-events:none;z-index:303;animation:impactPop .8s ease-out forwards`;
      el.textContent = '\u{1F4A4} 怠战 -1';
      combatLayer.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }

    if (ev.type === 'heal') {
      spawnImpactText(playerIdx >= 0 ? playerIdx : 0, '+1 ❤️', '#00a85e');
    }

    if (ev.type === 'shieldBreak') {
      const pos = toIdx >= 0 ? getCardCenter(toIdx) : { x: innerWidth / 2, y: innerHeight / 2 };
      const el = document.createElement('div');
      el.className = 'block-text shield-crack';
      el.textContent = '\u{1F4A5} 盾破！';
      el.style.left = pos.x + 'px';
      el.style.top = (pos.y - 20) + 'px';
      combatLayer.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
      for (let p = 0; p < 6; p++) spawnShieldShard(pos);
    }

    if (ev.type === 'eliminated') continue;

    if (ev.type === 'hit') {
      spawnMuzzleFlash(fromIdx);
      await sleep(80);
      await animateBullet(fromIdx, toIdx);
      spawnImpactBurst(toIdx);
      spawnImpactText(toIdx, '-1', '#c41028');
      flashCard(toIdx);
      if (hitCount % 2 === 0) shakeScreen();
      if (hitCount % 3 === 0) flashScreenLong();
      hitCount++;
    } else if (ev.type === 'dual') {
      spawnMuzzleFlash(fromIdx);
      spawnMuzzleFlash(toIdx);
      await sleep(80);
      flashScreenLong();
      await Promise.all([animateBullet(fromIdx, toIdx), animateBullet(toIdx, fromIdx)]);
      spawnImpactBurst(toIdx);
      spawnImpactBurst(fromIdx);
      spawnImpactText(toIdx, '-1', '#c41028');
      spawnImpactText(fromIdx, '-1', '#c41028');
      flashCard(toIdx);
      flashCard(fromIdx);
      shakeScreen();
      hitCount += 2;
    } else if (ev.type === 'block') {
      spawnMuzzleFlash(fromIdx);
      await sleep(80);
      const times = (shieldHits.get(ev.to) || 0) + 1;
      shieldHits.set(ev.to, times);
      await animateBullet(fromIdx, toIdx, true);
      const pos = getCardCenter(toIdx);
      const blockEl = document.createElement('div');
      if (times === 1) {
        blockEl.className = 'block-text';
        blockEl.textContent = '\u{1F6E1}️';
        spawnImpactParticles(pos.x, pos.y, 6, 'var(--neon-cyan)', 'rgba(0,119,170,0.6)');
      } else {
        blockEl.className = 'block-text shield-crack';
        blockEl.textContent = '\u{1F494}';
        spawnImpactParticles(pos.x, pos.y, 10, 'var(--neon-crimson)', 'var(--neon-gold)');
      }
      blockEl.style.left = pos.x + 'px';
      blockEl.style.top = pos.y + 'px';
      combatLayer.appendChild(blockEl);
      blockEl.addEventListener('animationend', () => blockEl.remove());
      if (times >= 2) { for (let p = 0; p < 6; p++) spawnShieldShard(pos); }
    }

    updateAllCards(players);
    await sleep(120);
  }

  updateAllCards(players);
  await sleep(200);
  combatLayer.innerHTML = '';
  combatLayer.classList.add('hidden');
}

// ── 历史面板 ──
function addHistoryEntry(history) {
  const list = $('#history-list');
  const empty = list.querySelector('.history-empty');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = 'history-entry';

  const actions = history.actions || [];
  const resultLines = history.resultLines || [];

  const actionsHTML = Array.isArray(actions)
    ? actions.map(a => {
        const typeClass = a.type || 'none';
        return `<span class="h-action-badge ${typeClass}">${a.icon || ''} ${a.name}: ${a.desc || ''}</span>`;
      }).join('')
    : `<span class="h-action-badge none">${actions}</span>`;

  entry.innerHTML = `
    <div class="h-round">⚡ 第 ${history.round} 回合</div>
    <div class="h-actions">${actionsHTML}</div>
    ${resultLines.length ? `<div class="h-result">${resultLines.join('<br>')}</div>` : '<div class="h-result">\u{1F4A4} 无事发生</div>'}`;
  list.insertBefore(entry, list.firstChild);
}

// ── 回合结算面板 ──
function showRoundSummary(events, players, history, roundNum) {
  const old = document.querySelector('.round-summary');
  if (old) old.remove();

  const summary = document.createElement('div');
  summary.className = 'round-summary';
  summary.innerHTML = '<h3>\u{1F4CB} 回合结算</h3>';

  if (events.length === 0) {
    summary.innerHTML += '<div class="empty-log">\u{1F4A4} 无事发生</div>';
  } else {
    const seen = new Set(), unique = [];
    for (const ev of events) {
      if (ev.type === 'dual') {
        const key = [ev.from, ev.to].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
      }
      unique.push(ev);
    }
    for (const ev of unique) {
      const div = document.createElement('div');
      div.className = 'log-entry';
      const fromP = players.find(p => p.id === ev.from);
      const toP = players.find(p => p.id === ev.to);
      const playerP = players.find(p => p.id === ev.player);
      const fn = fromP?.name || ev.from || '?';
      const tn = toP?.name || ev.to || '?';
      const pn = playerP?.name || ev.player || '?';

      if (ev.type === 'hit') div.innerHTML = `\u{1F480} <b>${fn}</b> 射中 <b>${tn}</b>（-1HP）`;
      else if (ev.type === 'dual') div.innerHTML = `\u{1F4A5} <b>${fn}</b> ↔ <b>${tn}</b> 对射！各 -1HP`;
      else if (ev.type === 'block') div.innerHTML = `\u{1F6E1}️ <b>${tn}</b> 格挡了 <b>${fn}</b> 的攻击`;
      else if (ev.type === 'shieldBreak') div.innerHTML = `\u{1F4A5} <b>${tn}</b> 盾牌被 <b>${fn}</b> 击破！`;
      else if (ev.type === 'fatigue') div.innerHTML = `⚠️ <b>${pn}</b> ${ev.msg || '盾牌疲劳失效'}`;
      else if (ev.type === 'passivity') div.innerHTML = `\u{1F4A4} <b>${pn}</b> 怠战惩罚！${ev.msg || '-1HP'}`;
      else if (ev.type === 'heal') div.innerHTML = `❤️ <b>${pn}</b> ${ev.msg || '战斗回复 +1HP'}`;
      else if (ev.type === 'eliminated') div.innerHTML = `\u{1F480} <b>${pn}</b> 被击败！`;
      summary.appendChild(div);
    }
  }

  const btn = document.createElement('button');
  btn.className = 'btn-continue';

  if (currentRound >= totalRounds) {
    if (isHost) {
      btn.textContent = '\u{1F3C6} 查看最终排名 →';
      btn.onclick = () => {
        summary.remove();
        ws.send(MSG.NEXT_ROUND);
      };
    } else {
      btn.textContent = '⌛ 等待房主结算...';
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    }
  } else {
    if (isHost) {
      btn.textContent = '⚡ 下一回合 →';
      btn.onclick = () => {
        summary.remove();
        clearCardHighlights();
        updateAllCards(gamePlayers);
        renderArena(gamePlayers);
        ws.send(MSG.NEXT_ROUND);
      };
    } else {
      btn.textContent = '⌛ 等待房主推进...';
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    }
  }
  summary.appendChild(btn);
  screenGame.appendChild(summary);
  summary.scrollIntoView({ behavior: 'smooth' });
}

// ── 游戏屏幕：选择界面 ──
function showSelection(playerState, opponents) {
  return new Promise(resolve => {
    const selectOverlay = $('#selection-overlay');
    const mainActions = $('#main-actions');
    const targetSelect = $('#target-select');
    const multiConfirm = $('#multi-shot-confirm');
    const btnShoot = $('#btn-shoot');

    mainActions.classList.remove('hidden');
    targetSelect.classList.add('hidden');
    multiConfirm.classList.add('hidden');
    selectOverlay.classList.remove('hidden');

    $('#select-player-name').textContent = myName;
    $('#select-hp').textContent = `❤️ HP ${Math.max(0, playerState.hp)}/${totalRounds}`;
    $('#select-ammo').textContent = `\u{1F52B} 弹药 ×${playerState.ammo}`;
    $('#select-score').textContent = `⚔️ 伤害 ${playerState.score}`;

    const canShoot = playerState.ammo > 0 && opponents.length > 0;
    btnShoot.disabled = !canShoot;
    $('#shoot-desc').textContent = playerState.ammo <= 0 ? '弹药不足' :
      opponents.length === 0 ? '无可用目标' : `剩余 ${playerState.ammo} 发`;

    const targets = [];

    function buildTargetButtons() {
      const container = $('#target-buttons');
      container.innerHTML = '';
      if (opponents.length === 0) { finish(); return; }
      if (opponents.length === 1 && targets.length === 0) {
        targets.push(opponents[0].id);
        afterShot();
        return;
      }
      opponents.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'target-btn';
        btn.innerHTML = `<span class="target-icon">\u{1F3AF}</span> ${t.name} (❤️${Math.max(0, t.hp)})`;
        btn.onclick = () => { targets.push(t.id); afterShot(); };
        container.appendChild(btn);
      });
    }

    function afterShot() {
      targetSelect.classList.add('hidden');
      multiConfirm.classList.add('hidden');
      const remaining = playerState.ammo - targets.length;
      if (remaining > 0 && opponents.length > 0) {
        multiConfirm.classList.remove('hidden');
        $('#multi-shot-msg').textContent = `\u{1F3AF} 已瞄准 ${targets.length} 发，剩余 ${remaining} 发弹药。继续射击？`;
      } else {
        finish();
      }
    }

    function finish() {
      selectOverlay.classList.add('hidden');
      if (targets.length > 0) resolve({ type: 'shoot', targets: [...targets] });
      else resolve({ type: 'shield' });
    }

    btnShoot.onclick = () => {
      if (opponents.length === 1) {
        targets.push(opponents[0].id);
        afterShot();
      } else {
        mainActions.classList.add('hidden');
        targetSelect.classList.remove('hidden');
        multiConfirm.classList.add('hidden');
        $('#shots-left').textContent = `(剩余 ${playerState.ammo} 发)`;
        buildTargetButtons();
      }
    };

    $('#btn-back-target').onclick = () => {
      targets.length = 0;
      targetSelect.classList.add('hidden');
      mainActions.classList.remove('hidden');
    };

    $('#btn-shield').onclick = () => { selectOverlay.classList.add('hidden'); resolve({ type: 'shield' }); };
    $('#btn-reload').onclick = () => { selectOverlay.classList.add('hidden'); resolve({ type: 'reload' }); };

    $('#btn-shoot-again').onclick = () => {
      mainActions.classList.add('hidden');
      targetSelect.classList.remove('hidden');
      multiConfirm.classList.add('hidden');
      $('#shots-left').textContent = `(剩余 ${playerState.ammo - targets.length} 发)`;
      buildTargetButtons();
    };

    $('#btn-done-shooting').onclick = () => finish();
  });
}

// ── 等待遮罩 ──
function showWaitingOverlay(submitted, total) {
  let overlay = $('#waiting-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'waiting-overlay';
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="selection-card">
        <h2>⌛ 等待其他玩家...</h2>
        <p id="waiting-progress" style="font-size:1.2rem;color:var(--text-secondary);margin:16px 0"></p>
        <p style="font-size:.85rem;color:var(--text-muted)">所有玩家选择完成后自动结算</p>
      </div>`;
    document.body.appendChild(overlay);
  }
  overlay.classList.remove('hidden');
  const progress = overlay.querySelector('#waiting-progress');
  if (progress) progress.textContent = `已提交: ${submitted}/${total}`;
}

function hideWaitingOverlay() {
  const overlay = $('#waiting-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// ── 设置屏幕 ──
function initSetupScreen() {
  const roundsSpan = $('#rounds-count');
  const totalSpan = $('#total-count');
  const humanSpan = $('#human-count');
  const aiHint = $('#ai-hint');
  const hpHint = $('#hp-hint');
  let rounds = 10, total = 2, human = 1;

  function clampHuman(v) { return Math.max(0, Math.min(total, v)); }

  function update() {
    roundsSpan.textContent = rounds;
    totalSpan.textContent = total;
    human = clampHuman(human);
    humanSpan.textContent = human;
    aiHint.textContent = `其余 ${total - human} 人由 AI 操控`;
    hpHint.textContent = `初始 HP = ${rounds}`;
    $('#rounds-minus').disabled = rounds <= 3;
    $('#rounds-plus').disabled = rounds >= 20;
    $('#total-minus').disabled = total <= 2;
    $('#total-plus').disabled = total >= 6;
    $('#human-minus').disabled = human <= 0;
    $('#human-plus').disabled = human >= total;
  }

  $('#rounds-minus').onclick = () => { if (rounds > 3) rounds--; update(); };
  $('#rounds-plus').onclick = () => { if (rounds < 20) rounds++; update(); };
  $('#total-minus').onclick = () => { if (total > 2) total--; update(); };
  $('#total-plus').onclick = () => { if (total < 6) total++; update(); };
  $('#human-minus').onclick = () => { human--; update(); };
  $('#human-plus').onclick = () => { human++; update(); };
  update();

  // 创建房间
  $('#btn-create-room').onclick = () => {
    if (!wsConnected) {
      showError('正在连接服务器，请稍候...');
      return;
    }
    const nameInput = $('#setup-player-name');
    myName = nameInput.value.trim() || `玩家${Math.floor(Math.random() * 100)}`;
    ws.send(MSG.CREATE_ROOM, {
      playerName: myName,
      totalRounds: rounds,
      maxPlayers: total,
      humanCount: human,
    });
  };

  // 加入房间
  $('#btn-join-room').onclick = () => {
    if (!wsConnected) {
      showError('正在连接服务器，请稍候...');
      return;
    }
    const nameInput = $('#setup-player-name');
    const codeInput = $('#room-code-input');
    myName = nameInput.value.trim() || `玩家${Math.floor(Math.random() * 100)}`;
    const code = codeInput.value.trim();
    if (!code || code.length !== 4) {
      showError('请输入 4 位房间码');
      return;
    }
    ws.send(MSG.JOIN_ROOM, { roomCode: code, playerName: myName });
  };
}

function showError(msg) {
  const el = $('#error-toast');
  if (el) { el.textContent = msg; el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 3000); }
}

// ── Lobby 屏幕 ──
function updateLobbyPlayers(players) {
  const list = $('#lobby-player-list');
  if (!list) return;
  list.innerHTML = players.map(p =>
    `<div class="lobby-player"><span class="lobby-player-name">${p.name}</span><span class="lobby-player-badge">${p.isHost ? '\u{1F451} 房主' : p.isAI ? '\u{1F916} AI' : '\u{1F464} 真人'}</span></div>`
  ).join('');
}

// ── 最终屏幕 ──
let confettiPieces = [], confettiAnimId = null;

function startConfetti() {
  const c = $('#confetti-canvas');
  if (!c) return;
  c.style.display = 'block';
  const ctx = c.getContext('2d');
  let w, h;
  function resize() { w = c.width = innerWidth; h = c.height = innerHeight; }
  resize();
  const colors = ['#c41028', '#0077aa', '#008a50', '#b8860b', '#7733cc', '#cc4400', '#e84393', '#d4a017', '#1a1a2e'];
  confettiPieces = [];
  for (let i = 0; i < 100; i++) {
    confettiPieces.push({
      x: Math.random() * w, y: Math.random() * h - h,
      w: 5 + Math.random() * 8, h: 3 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      vy: 1 + Math.random() * 3, vx: (Math.random() - 0.5) * 2,
      rot: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 6,
      swing: Math.random() * 2, swingSpeed: 0.02 + Math.random() * 0.03,
      phase: Math.random() * Math.PI * 2,
    });
  }
  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (const p of confettiPieces) {
      p.y += p.vy; p.x += p.vx + Math.sin(Date.now() * p.swingSpeed + p.phase) * p.swing;
      p.rot += p.rotSpeed;
      if (p.y > h + 20) { p.y = -20; p.x = Math.random() * w; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 4;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    confettiAnimId = requestAnimationFrame(draw);
  }
  draw();
}

function stopConfetti() {
  if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
  confettiAnimId = null;
  const c = $('#confetti-canvas');
  if (c) c.style.display = 'none';
}

function showFinalScreen(ranking) {
  showScreen(screenFinal);
  startConfetti();
  flashScreenLong();

  const podium = $('#podium');
  podium.innerHTML = '';
  const medals = ['gold', 'silver', 'bronze'];
  const emoji = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  for (let i = 0; i < Math.min(3, ranking.length); i++) {
    const p = ranking[i];
    const spot = document.createElement('div');
    spot.className = `podium-spot ${medals[i]}`;
    spot.innerHTML = `<div class="spot-medal">${emoji[i]}</div><div class="spot-name">${p.name}${p.isAI ? ' \u{1F916}' : ''}</div><div class="spot-stat">❤️ HP ${Math.max(0, p.hp)} · ⚔️ 伤害 ${p.score}</div>`;
    podium.appendChild(spot);
  }

  const list = $('#ranking-list');
  list.innerHTML = '';
  ranking.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'ranking-row';
    row.style.animationDelay = `${i * 0.08}s`;
    const n = i + 1;
    row.innerHTML = `<span class="rank-num">${n === 1 ? '\u{1F947}' : n === 2 ? '\u{1F948}' : n === 3 ? '\u{1F949}' : n}</span><span class="rank-name">${p.name}${p.isAI ? ' \u{1F916}' : ''}</span><span class="rank-stat">❤️ HP ${Math.max(0, p.hp)}</span><span class="rank-stat">⚔️ 伤害 ${p.score}</span>`;
    list.appendChild(row);
  });

  // 更新按钮状态
  const btnRestart = $('#btn-restart');
  if (btnRestart) {
    if (isHost) {
      btnRestart.textContent = '⚔️ 再来一局';
      btnRestart.disabled = false;
      btnRestart.style.opacity = '';
    } else {
      btnRestart.textContent = '⌛ 等待房主操作...';
      btnRestart.disabled = true;
      btnRestart.style.opacity = '0.5';
    }
  }
}

// ── WebSocket 消息处理 ──
let wsConnected = false;

function updateConnectionUI() {
  const statusEl = $('#ws-status');
  const btnCreate = $('#btn-create-room');
  const btnJoin = $('#btn-join-room');
  if (statusEl) {
    if (wsConnected) {
      statusEl.textContent = '已连接';
      statusEl.style.color = 'var(--neon-green)';
    } else {
      statusEl.textContent = '连接中...';
      statusEl.style.color = 'var(--neon-orange)';
    }
  }
  if (btnCreate) btnCreate.disabled = !wsConnected;
  if (btnJoin) btnJoin.disabled = !wsConnected;
}

function setupWSHandlers() {
  ws.on('open', () => {
    wsConnected = true;
    updateConnectionUI();
    console.log('WebSocket connected');
  });

  ws.on('close', () => {
    wsConnected = false;
    updateConnectionUI();
    console.log('WebSocket disconnected, reconnecting...');
  });

  ws.on('error', () => {
    wsConnected = false;
    updateConnectionUI();
  });

  ws.on(MSG.ERROR, (payload) => {
    showError(payload.message);
  });

  ws.on(MSG.ROOM_CREATED, (payload) => {
    roomCode = payload.roomCode;
    myId = payload.yourId;
    isHost = true;
    totalRounds = payload.settings.totalRounds;
    gamePlayers = payload.players;
    updateLobbyGameSettings(payload.settings);
    showScreen(screenLobby);
    $('#lobby-room-code').textContent = roomCode;
    updateLobbyPlayers(payload.players);
    $('#btn-start-game').classList.remove('hidden');
    fetchPublicURL();
  });

  ws.on(MSG.ROOM_JOINED, (payload) => {
    roomCode = payload.roomCode;
    myId = payload.yourId;
    isHost = payload.players.find(p => p.id === myId)?.isHost || false;
    totalRounds = payload.settings.totalRounds;
    gamePlayers = payload.players;
    updateLobbyGameSettings(payload.settings);
    showScreen(screenLobby);
    $('#lobby-room-code').textContent = roomCode;
    updateLobbyPlayers(payload.players);
    if (isHost) $('#btn-start-game').classList.remove('hidden');
    fetchPublicURL();
    else $('#btn-start-game').classList.add('hidden');
  });

  ws.on(MSG.PLAYER_JOINED, (payload) => {
    if (!gamePlayers.find(p => p.id === payload.player.id)) {
      gamePlayers.push(payload.player);
    }
    updateLobbyPlayers(gamePlayers);
  });

  ws.on(MSG.PLAYER_LEFT, (payload) => {
    gamePlayers = gamePlayers.filter(p => p.id !== payload.playerId);
    updateLobbyPlayers(gamePlayers);
  });

  ws.on(MSG.GAME_STARTED, (payload) => {
    gamePlayers = payload.players;
    totalRounds = payload.totalRounds;
    currentRound = payload.round;
    myId = payload.yourId;
    isHost = payload.isHost;
    showScreen(screenGame);
    renderArena(gamePlayers);
    updateRoundDisplay();
    $('#history-list').innerHTML = '<p class="history-empty">⚡ 对局开始...</p>';
    $('#phase-label').textContent = '⌛ 等待回合开始...';
  });

  ws.on(MSG.ROUND_STARTED, (payload) => {
    currentRound = payload.round;
    totalRounds = payload.totalRounds;
    gamePlayers = payload.players;
    updateRoundDisplay();
    renderArena(gamePlayers);
    clearCardHighlights();
    submittedAction = false;
    roundResultReceived = false;
    $('#phase-label').textContent = '⌛ 等待其他玩家...';
    // 移除旧的结算面板
    const old = document.querySelector('.round-summary');
    if (old) old.remove();
    hideWaitingOverlay();
  });

  ws.on(MSG.YOUR_TURN, (payload) => {
    myHp = payload.playerState.hp;
    myAmmo = payload.playerState.ammo;
    isHost = payload.isHost;
    $('#phase-label').textContent = '\u{1F3AE} 请选择动作';

    // 自动弹出选择界面
    showSelection(payload.playerState, payload.aliveOpponents).then(action => {
      if (!submittedAction) {
        submittedAction = true;
        ws.send(MSG.PLAYER_ACTION, action);
        showWaitingOverlay(1, 99); // 服务器会更新实际数字
      }
    });
  });

  ws.on(MSG.WAITING, (payload) => {
    if (submittedAction) {
      showWaitingOverlay(payload.submitted, payload.total);
    }
  });

  ws.on(MSG.ROUND_RESULT, async (payload) => {
    roundResultReceived = true;
    hideWaitingOverlay();
    gamePlayers = payload.players;
    currentRound = payload.round;

    // 显示结算动画面板
    $('#phase-label').textContent = '⚡ 对决！';

    // 显示所有人的行动
    for (let i = 0; i < gamePlayers.length; i++) {
      await sleep(60);
      updateCardAction(gamePlayers[i], i);
      highlightCard(i, gamePlayers[i].action);
    }

    await sleep(300);
    await animateActionReveal(gamePlayers);
    await sleep(200);
    flashScreen();

    // 播放战斗动画
    await animateCombat(payload.events, gamePlayers);

    // 添加历史
    if (payload.history) {
      addHistoryEntry(payload.history);
    }

    // 显示结算
    showRoundSummary(payload.events, gamePlayers, payload.history, payload.round);

    if (currentRound >= totalRounds) {
      // 等待 GAME_OVER 消息
      $('#phase-label').textContent = '⌛ 等待最终结算...';
    }
  });

  ws.on(MSG.GAME_OVER, (payload) => {
    showFinalScreen(payload.ranking);
  });

  ws.on(MSG.ROOM_CLOSED, (payload) => {
    showScreen(screenSetup);
    showError(payload.reason || '房间已关闭');
    ws.disconnect();
  });
}

function updateRoundDisplay() {
  const r = currentRound + 1;
  const label = $('#round-label');
  if (label) label.textContent = `第 ${r}/${totalRounds} 回合`;
  const fill = $('#round-progress-fill');
  if (fill) fill.style.width = `${(r / totalRounds) * 100}%`;
  const phase = $('#phase-label');
  if (phase) phase.textContent = '';
}

function updateLobbyGameSettings(settings) {
  const info = $('#lobby-game-info');
  if (info) {
    info.textContent = `回合数: ${settings.totalRounds} | 玩家: ${settings.maxPlayers} | 真人: ${settings.humanCount}`;
  }
}

// ── 启动 ──
function init() {
  setupWSHandlers();
  initSetupScreen();

  // Lobby 开始按钮
  $('#btn-start-game').onclick = () => {
    if (isHost) ws.send(MSG.START_GAME);
  };

  // 最终屏幕重新开始
  $('#btn-restart').onclick = () => {
    stopConfetti();
    ws.send(MSG.BACK_TO_LOBBY);
  };

  // 游戏中的重新开始按钮
  $('#btn-game-restart').onclick = () => {
    stopConfetti();
    ws.send(MSG.BACK_TO_LOBBY);
  };

  // 复制外网地址
  $('#btn-copy-url').onclick = () => {
    if (publicTunnelUrl) {
      navigator.clipboard.writeText(publicTunnelUrl).then(() => {
        const btn = $('#btn-copy-url');
        if (btn) { btn.textContent = '已复制!'; setTimeout(() => { btn.textContent = '复制'; }, 2000); }
      }).catch(() => { /* 降级 */ });
    }
  };

  // 连接 WebSocket
  ws.connect();
}

// 页面加载完成后启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
