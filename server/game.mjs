// 服务端权威 Game 类 — 从 index.html 移植

export class Game {
  constructor(names, humanCount, rounds) {
    this.totalRounds = rounds;
    this.players = names.map((n, i) => ({
      id: `p${i}`,
      name: n,
      hp: rounds,
      ammo: 1,
      score: 0,
      action: null,
      isAI: i >= humanCount,
      maxHp: rounds,
      consecutiveShield: 0,
      passiveRounds: 0,
      shotsFired: 0,
      firstHitRound: 0,
      actionHistory: [],
      disconnected: false,
    }));
    this.round = 0;
    this.humanCount = humanCount;
  }

  get finished() { return this.round >= this.totalRounds; }
  get humanPlayers() { return this.players.filter(p => !p.isAI); }
  get AIPlayers() { return this.players.filter(p => p.isAI); }
  get alivePlayers() { return this.players.filter(p => p.hp > 0); }
  get connectedHumans() { return this.players.filter(p => !p.isAI && !p.disconnected); }

  setActions(map) {
    for (const [p, a] of map) p.action = a;
  }

  resolveRound() {
    this.round++;
    const events = [];
    const ammoSnap = new Map(this.players.map(p => [p, p.ammo]));
    const hpStart = new Map(this.players.map(p => [p, p.hp]));
    const shieldActive = new Set();

    // 盾牌评估
    for (const p of this.players) {
      if (p.action && p.action.type === 'shield') {
        if (p.consecutiveShield === 0) {
          shieldActive.add(p);
        } else if (p.consecutiveShield === 1 && Math.random() < 0.5) {
          shieldActive.add(p);
        }
        if (p.consecutiveShield >= 2) {
          events.push({ type: 'fatigue', player: p.id, msg: '盾牌完全失效！' });
        }
      }
      p.consecutiveShield = (p.action && p.action.type === 'shield') ? p.consecutiveShield + 1 : 0;
    }

    // 射击结算
    for (const shooter of this.players) {
      if (!shooter.action || shooter.action.type !== 'shoot') continue;
      const targets = shooter.action.targets || [];
      const shotCount = Math.min(targets.length, ammoSnap.get(shooter) || 0);
      let hitLand = 0;

      for (let i = 0; i < shotCount; i++) {
        const target = this.players.find(p => p.id === targets[i]);
        if (!target || target.hp <= 0) continue;
        shooter.ammo = Math.max(0, shooter.ammo - 1);
        shooter.passiveRounds = 0;

        if (shieldActive.has(target)) {
          shieldActive.delete(target);
          events.push({ type: 'block', from: shooter.id, to: target.id });
          if (!shieldActive.has(target)) {
            events.push({ type: 'shieldBreak', from: shooter.id, to: target.id, msg: '盾破！' });
          }
        } else {
          hitLand++;
          target.hp--;
          shooter.score++;
          if (shooter.firstHitRound === 0) shooter.firstHitRound = this.round;

          const targetShootsBack = target.action && target.action.type === 'shoot'
            && (target.action.targets || []).includes(shooter.id) && ammoSnap.get(target) > 0;

          if (targetShootsBack) {
            events.push({ type: 'dual', from: shooter.id, to: target.id });
          } else {
            events.push({ type: 'hit', from: shooter.id, to: target.id });
          }
          if (target.hp <= 0) events.push({ type: 'eliminated', player: target.id });
        }
      }

      shooter.shotsFired += shotCount;
      // 恢复：回合开始时受伤的玩家，命中后可回复 1 HP
      if (hitLand > 0 && hpStart.get(shooter) < shooter.maxHp) {
        shooter.hp++;
        events.push({ type: 'heal', player: shooter.id, msg: '+1 HP' });
      }
    }

    // 装弹
    for (const p of this.players) {
      if (p.action && p.action.type === 'reload') {
        p.ammo += p.ammo === 0 ? 2 : 1;
      }
      p.ammo = Math.min(p.ammo, 4);
    }

    // 怠战惩罚
    for (const p of this.players) {
      if (p.hp <= 0) continue;
      if (!p.action || p.action.type !== 'shoot') p.passiveRounds++;
      if (p.passiveRounds >= 3) {
        p.hp--;
        events.push({ type: 'passivity', player: p.id, msg: '怠战 -1 HP' });
        if (p.hp <= 0) events.push({ type: 'eliminated', player: p.id });
      }
    }

    // 记录历史
    this.players.forEach(p => {
      p.actionHistory.push(p.action || { type: 'none' });
    });

    return events;
  }

  getRanking() {
    return [...this.players].sort((a, b) => {
      if (b.hp !== a.hp) return b.hp - a.hp;
      if (b.score !== a.score) return b.score - a.score;
      if (b.shotsFired !== a.shotsFired) return b.shotsFired - a.shotsFired;
      return (a.firstHitRound || 999) - (b.firstHitRound || 999);
    });
  }

  // 返回可序列化的玩家状态快照
  getStateSnapshot() {
    return this.players.map(p => ({
      id: p.id,
      name: p.name,
      hp: p.hp,
      maxHp: p.maxHp,
      ammo: p.ammo,
      score: p.score,
      isAI: p.isAI,
      isAlive: p.hp > 0,
      action: p.action ? { type: p.action.type, targets: p.action.targets || [] } : null,
      consecutiveShield: p.consecutiveShield,
      passiveRounds: p.passiveRounds,
      shotsFired: p.shotsFired,
      actionHistory: p.actionHistory.map(a => a ? { type: a.type, targets: a.targets || [] } : { type: 'none' }),
      disconnected: p.disconnected,
    }));
  }
}

// AI 决策 — 从 index.html 移植
export function aiDecide(player, game) {
  const round = game.round + 1;
  const others = game.players.filter(p => p.id !== player.id && p.hp > 0);
  if (others.length === 0) return { type: 'reload' };

  const fatigueRisk = player.consecutiveShield >= 1;
  const passivityRisk = player.passiveRounds >= 2;
  const hpRatio = Math.max(0, player.hp) / game.totalRounds;
  const ammoRatio = Math.min(player.ammo, 4) / 4;
  const progress = round / game.totalRounds;

  let wShoot = 0.35 + progress * 0.2 + ammoRatio * 0.1 + passivityRisk * 0.25;
  let wShield = 0.3 + (1 - hpRatio) * 0.15 - fatigueRisk * 0.2;
  let wReload = 0.35 - progress * 0.1 - (1 - ammoRatio) * 0.15;

  if (player.ammo === 0) { wShoot = 0; wReload += 0.2; wShield -= 0.1; }
  if (player.ammo >= 4) { wShoot += 0.1; wReload -= 0.25; }
  if (hpRatio < 0.3) { wShoot += 0.1; wShield += 0.1; wReload -= 0.1; }
  if (passivityRisk) { wShoot += 0.3; wReload -= 0.15; }
  if (fatigueRisk && player.consecutiveShield >= 2) { wShield -= 0.4; wShoot += 0.2; }

  const total = Math.max(0.01, wShoot + wShield + wReload);
  const roll = Math.random() * total;

  if (roll < wShoot && player.ammo > 0) {
    const maxShots = Math.min(player.ammo, others.length, 4);
    let shotCount = 1;
    if (maxShots >= 2) {
      const msChance = 0.3 + ammoRatio * 0.2 + progress * 0.15;
      while (shotCount < maxShots && Math.random() < msChance) shotCount++;
    }
    const threatList = others.map(o => ({
      id: o.id,
      threat: o.score * 2 + (game.totalRounds - o.hp) + o.ammo + Math.random() * 4,
    }));
    threatList.sort((a, b) => b.threat - a.threat);
    const targets = [];
    const spread = shotCount >= 2 && others.length >= 2 && Math.random() < 0.35;
    if (spread) {
      for (let i = 0; i < shotCount; i++) targets.push(threatList[i % threatList.length].id);
    } else {
      for (let i = 0; i < shotCount; i++) targets.push(threatList[0].id);
    }
    return { type: 'shoot', targets };
  }
  if (roll < wShoot + wShield && !fatigueRisk) return { type: 'shield' };
  return { type: 'reload' };
}
