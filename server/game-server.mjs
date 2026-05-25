import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MSG, validate } from './protocol.mjs';
import { Game, aiDecide } from './game.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3005;

// ── MIME ──
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// ── Room Manager ──
const rooms = new Map();

function genRoomCode() {
  for (let tries = 0; tries < 100; tries++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

function createRoom(ws, { playerName, totalRounds, maxPlayers }) {
  const code = genRoomCode();
  const playerId = 'p0';
  const player = { id: playerId, name: playerName, ws, isHost: true, isAI: false, connected: true };

  const room = {
    code,
    host: ws,
    players: [player],
    settings: { totalRounds: Math.min(20, Math.max(3, totalRounds)), maxPlayers: Math.min(6, Math.max(2, maxPlayers)) },
    state: 'waiting', // waiting | playing | finished
    game: null,
    actionBuffer: new Map(),
    actionsSubmitted: 0,
    wsToPlayer: new Map([[ws, playerId]]),
    playerMap: new Map([[playerId, player]]),
  };

  rooms.set(code, room);
  return { room, code };
}

function joinRoom(ws, { roomCode, playerName }) {
  const room = rooms.get(roomCode);
  if (!room) return { error: '房间不存在' };
  if (room.state !== 'waiting') return { error: '游戏已开始' };
  if (room.players.length >= room.settings.maxPlayers) return { error: '房间已满' };
  if (room.players.some(p => p.name === playerName)) return { error: '名称已被使用' };

  const playerId = `p${room.players.length}`;
  const player = { id: playerId, name: playerName, ws, isHost: false, isAI: false, connected: true };
  room.players.push(player);
  room.wsToPlayer.set(ws, playerId);
  room.playerMap.set(playerId, player);

  return { room, playerId };
}

function startGame(room) {
  if (room.state !== 'waiting') return { error: '游戏已开始' };

  const { totalRounds, maxPlayers } = room.settings;

  // 确保所有真人玩家已连接
  const humanPlayers = room.players.filter(p => !p.isAI);
  if (humanPlayers.length < 1) return { error: '至少需要 1 名真人玩家' };

  // 构建名字列表（真人 + AI）
  const names = room.players.map(p => p.name);
  const aiCount = maxPlayers - room.players.length;
  for (let i = 0; i < aiCount; i++) {
    const prefixes = ['暗', '影', '赤', '霜', '铁', '猎', '疾', '炎', '冰', '雷', '风', '钢', '血', '幽', '碎', '黑', '幻', '冥'];
    const suffixes = ['刃', '隼', '狼', '狐', '虎', '蛇', '鹰', '龙', '豹', '蝎', '熊', '鹤', '蟒', '鲨', '猿', '蜂', '鬼', '牙'];
    let name;
    do {
      name = prefixes[Math.floor(Math.random() * prefixes.length)] + suffixes[Math.floor(Math.random() * suffixes.length)];
    } while (names.includes(name));
    names.push(name);
  }

  // 匹配 player id
  const realPlayers = [...room.players];
  room.game = new Game(names, realPlayers.length, totalRounds);

  // 将服务端玩家对象与 Game 玩家对象关联
  for (let i = 0; i < room.game.players.length; i++) {
    const gp = room.game.players[i];
    if (i < realPlayers.length) {
      const rp = realPlayers[i];
      gp.id = rp.id;
      gp.name = rp.name;
      gp.isAI = false;
      // 更新 playerMap 引用
      room.playerMap.set(rp.id, rp);
    } else {
      gp.isAI = true;
    }
  }

  room.state = 'playing';
  room.actionBuffer.clear();
  room.actionsSubmitted = 0;
  return {};
}

function broadcast(room, type, payload, excludeWs = null) {
  const msg = JSON.stringify({ type, payload });
  for (const player of room.players) {
    if (player.ws && player.ws !== excludeWs && player.ws.readyState === 1) {
      player.ws.send(msg);
    }
  }
}

function sendTo(ws, type, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

function handlePlayerAction(room, playerId, action) {
  if (room.state !== 'playing') return;
  if (room.actionBuffer.has(playerId)) return; // 已提交

  const game = room.game;
  const player = game.players.find(p => p.id === playerId);
  if (!player || player.hp <= 0) return;

  // 简单验证
  if (action.type === 'shoot') {
    if (player.ammo <= 0) return;
    const targets = action.targets || [];
    if (targets.length === 0 || targets.length > player.ammo) return;
    // 不能瞄准自己或已阵亡玩家
    for (const tid of targets) {
      if (tid === playerId) return; // 不能自瞄
      const t = game.players.find(p => p.id === tid);
      if (!t || t.hp <= 0) return; // 目标不存在或已阵亡
    }
    action.targets = targets;
  }

  room.actionBuffer.set(playerId, action);
  room.actionsSubmitted++;

  const totalHumans = game.connectedHumans.length;
  broadcast(room, MSG.WAITING, { submitted: room.actionsSubmitted, total: totalHumans });
}

function resolveAndBroadcast(room) {
  const game = room.game;
  if (!game) return;

  // AI 玩家做决策
  for (const p of game.AIPlayers) {
    if (p.hp <= 0) continue;
    const action = aiDecide(p, game);
    p.action = action;
  }

  // 已断线的真人玩家默认装弹
  for (const p of game.humanPlayers) {
    if (p.disconnected && p.hp > 0) {
      p.action = { type: 'reload' };
    }
  }

  // 将缓存的真人动作应用
  for (const [pid, action] of room.actionBuffer) {
    const p = game.players.find(pl => pl.id === pid);
    if (p && p.hp > 0) p.action = action;
  }

  const rawEvents = game.resolveRound();

  // 将事件中的玩家引用转换为 ID 字符串（便于 JSON 序列化和客户端消费）
  const events = rawEvents.map(ev => {
    const normalized = { type: ev.type, msg: ev.msg };
    if (ev.from) normalized.from = typeof ev.from === 'object' ? ev.from.id : ev.from;
    if (ev.to) normalized.to = typeof ev.to === 'object' ? ev.to.id : ev.to;
    if (ev.player) normalized.player = typeof ev.player === 'object' ? ev.player.id : ev.player;
    return normalized;
  });

  // 生成历史摘要
  const historyEntry = buildHistoryEntry(game.round, game.players, events);

  broadcast(room, MSG.ROUND_RESULT, {
    events,
    players: game.getStateSnapshot(),
    round: game.round,
    history: historyEntry,
  });

  // 清除
  room.actionBuffer.clear();
  room.actionsSubmitted = 0;
  game.players.forEach(p => p.action = null);
}

function buildHistoryEntry(roundNum, players, events) {
  const actions = players.map(p => {
    if (!p.action) return { name: p.name, type: 'none', icon: '—', desc: '未行动' };
    if (p.action.type === 'shoot') {
      const targets = (p.action.targets || []).map(tid => {
        const t = players.find(pl => pl.id === tid);
        return t ? t.name : tid;
      }).join(',');
      return { name: p.name, type: 'shoot', icon: '🔫', desc: `→ ${targets}` };
    }
    if (p.action.type === 'shield') {
      return { name: p.name, type: 'shield', icon: '🛡️', desc: '举盾' };
    }
    return { name: p.name, type: 'reload', icon: '📦', desc: '装弹' };
  });

  const seen = new Set();
  const resultLines = [];
  for (const ev of events) {
    if (ev.type === 'dual') {
      const key = [ev.from, ev.to].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const fn = players.find(p => p.id === ev.from);
      const tn = players.find(p => p.id === ev.to);
      resultLines.push(`💥${fn?.name || ev.from}↔${tn?.name || ev.to} 各-1HP`);
    } else if (ev.type === 'hit') {
      const fn = players.find(p => p.id === ev.from);
      const tn = players.find(p => p.id === ev.to);
      resultLines.push(`💀${fn?.name || ev.from}→${tn?.name || ev.to} -1HP`);
    } else if (ev.type === 'block') {
      const fn = players.find(p => p.id === ev.from);
      const tn = players.find(p => p.id === ev.to);
      resultLines.push(`🛡️${fn?.name || ev.from}→${tn?.name || ev.to} ⛔`);
    } else if (ev.type === 'heal') {
      const p = players.find(pl => pl.id === ev.player);
      resultLines.push(`❤️${p?.name || ev.player} 战斗回复 +1HP`);
    } else if (ev.type === 'passivity') {
      const p = players.find(pl => pl.id === ev.player);
      resultLines.push(`💤${p?.name || ev.player} 怠战 -1HP`);
    } else if (ev.type === 'fatigue') {
      const p = players.find(pl => pl.id === ev.player);
      resultLines.push(`⚠️${p?.name || ev.player} 盾牌疲劳`);
    }
  }

  return { round: roundNum, actions, resultLines };
}

function handleDisconnect(ws) {
  for (const [code, room] of rooms) {
    const playerId = room.wsToPlayer.get(ws);
    if (!playerId) continue;

    const player = room.playerMap.get(playerId);
    if (!player) continue;

    if (player.isHost) {
      // 房主离开 → 关闭房间
      broadcast(room, MSG.ROOM_CLOSED, { reason: '房主离开' });
      rooms.delete(code);
      return;
    }

    // 非房主玩家离开
    player.connected = false;
    room.wsToPlayer.delete(ws);

    if (room.state === 'playing' && room.game) {
      const gp = room.game.players.find(p => p.id === playerId);
      if (gp) {
        gp.disconnected = true;
        // 如果该玩家已提交动作，从缓冲中移除
        if (room.actionBuffer.has(playerId)) {
          room.actionBuffer.delete(playerId);
          room.actionsSubmitted--;
        }
      }
      // 检查是否所有人都已就绪（断开连接的除外）
      checkAllReady(room);
    }

    broadcast(room, MSG.PLAYER_LEFT, {
      playerId,
      playerName: player.name,
      playerCount: room.players.filter(p => p.connected).length,
    });
    return;
  }
}

function checkAllReady(room) {
  if (!room.game || room.state !== 'playing') return;
  const game = room.game;
  const connectedHumans = game.connectedHumans.filter(p => p.hp > 0);
  if (room.actionsSubmitted >= connectedHumans.length) {
    resolveAndBroadcast(room);
  }
}

// ── HTTP Server ──
const server = http.createServer((req, res) => {
  // API: 获取服务器信息（包含外网地址）
  if (req.url === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ tunnelUrl, lanIPs: getLocalIPs(), port: PORT }));
  }

  let filePath = path.join(PUBLIC, req.url === '/' ? 'index.html' : req.url);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ── WebSocket Server ──
const wss = new WebSocketServer({ server });

function startNewRound(room) {
  if (!room.game || room.state !== 'playing') return;
  const game = room.game;

  if (game.finished) {
    room.state = 'finished';
    broadcast(room, MSG.GAME_OVER, { ranking: game.getStateSnapshot() });
    return;
  }

  broadcast(room, MSG.ROUND_STARTED, {
    round: game.round + 1,
    totalRounds: game.totalRounds,
    players: game.getStateSnapshot(),
  });

  // 通知每个连接的真人玩家轮到他们
  for (const p of game.humanPlayers) {
    if (!p.disconnected && p.hp > 0) {
      const rp = room.playerMap.get(p.id);
      if (rp && rp.ws && rp.ws.readyState === 1) {
        const aliveOpponents = game.alivePlayers
          .filter(op => op.id !== p.id)
          .map(op => ({ id: op.id, name: op.name, hp: op.hp }));
        sendTo(rp.ws, MSG.YOUR_TURN, {
          playerState: game.getStateSnapshot().find(s => s.id === p.id),
          aliveOpponents,
          isHost: rp.isHost,
        });
      }
    }
  }

  // 如果所有真人已断线，AI 自动对战
  if (game.connectedHumans.filter(p => p.hp > 0).length === 0) {
    resolveAndBroadcast(room);
    setTimeout(() => startNewRound(room), 2000);
  }
}

// ── 获取本机局域网 IP ──
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const [name, nets] of Object.entries(interfaces)) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

// ── 外网隧道（可选）──
// 如需外网对战，手动运行 ngrok 或其他隧道工具将端口暴露到公网
// 例如：ngrok http 3005
// 服务器本身仅提供局域网访问
let tunnelUrl = null;

export function start() {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('═'.repeat(50));
    console.log('  ⚡ 攻守游戏 · 联网对战服务器');
    console.log('═'.repeat(50));

    const ips = getLocalIPs();
    console.log(`\n  本地访问:  http://localhost:${PORT}`);

    if (ips.length > 0) {
      console.log('\n  📱 局域网访问 (同 WiFi):');
      for (const ip of ips) {
        console.log(`     http://${ip}:${PORT}`);
      }
    } else {
      console.log('\n  ⚠️  未检测到局域网 IP，请检查网络连接');
    }

    console.log('\n  房间码为 4 位数字，告诉朋友即可加入');
    console.log('\n  🌐 外网对战：手动运行 ngrok http ' + PORT + ' 或 natapp 等隧道工具');
    console.log('═'.repeat(50));
  });
}

// ── WebSocket 连接处理 ──
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { type, payload = {} } = msg;

    const errors = validate(type, payload);
    if (errors.length > 0) {
      return sendTo(ws, MSG.ERROR, { message: errors.join('; ') });
    }

    switch (type) {

      case MSG.NEXT_ROUND: {
        const room = [...rooms.values()].find(r => r.host === ws);
        if (!room || room.state !== 'playing') return;
        startNewRound(room);
        break;
      }

      case MSG.CREATE_ROOM: {
        // 先清理此 ws 已有的旧房间
        for (const [code, r] of rooms) {
          if (r.wsToPlayer.has(ws)) {
            handleDisconnect(ws);
            break;
          }
        }
        const { room, code } = createRoom(ws, payload);
        sendTo(ws, MSG.ROOM_CREATED, {
          roomCode: code,
          players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost, isAI: p.isAI })),
          settings: room.settings,
          yourId: 'p0',
        });
        break;
      }

      case MSG.JOIN_ROOM: {
        for (const [code, r] of rooms) {
          if (r.wsToPlayer.has(ws)) {
            handleDisconnect(ws);
            break;
          }
        }
        const result = joinRoom(ws, payload);
        if (result.error) {
          sendTo(ws, MSG.ERROR, { message: result.error });
          return;
        }
        const { room, playerId } = result;
        sendTo(ws, MSG.ROOM_JOINED, {
          roomCode: room.code,
          players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost, isAI: p.isAI })),
          settings: room.settings,
          yourId: playerId,
        });
        broadcast(room, MSG.PLAYER_JOINED, {
          player: { id: playerId, name: payload.playerName, isHost: false, isAI: false },
          playerCount: room.players.length,
        }, ws);
        break;
      }

      case MSG.START_GAME: {
        const room = [...rooms.values()].find(r => r.host === ws);
        if (!room) return;
        const result = startGame(room);
        if (result.error) {
          sendTo(ws, MSG.ERROR, { message: result.error });
          return;
        }
        const state = room.game.getStateSnapshot();
        for (const player of room.players) {
          if (player.ws && player.ws.readyState === 1) {
            sendTo(player.ws, MSG.GAME_STARTED, {
              players: state,
              totalRounds: room.game.totalRounds,
              round: 0,
              yourId: player.id,
              isHost: player.isHost,
            });
          }
        }
        startNewRound(room);
        break;
      }

      case MSG.PLAYER_ACTION: {
        const room = [...rooms.values()].find(r => r.wsToPlayer.has(ws));
        if (!room) return;
        const playerId = room.wsToPlayer.get(ws);
        if (!playerId) return;
        handlePlayerAction(room, playerId, payload);
        checkAllReady(room);
        break;
      }

      case MSG.LEAVE_ROOM: {
        handleDisconnect(ws);
        break;
      }

      case MSG.BACK_TO_LOBBY: {
        const room = [...rooms.values()].find(r => r.host === ws);
        if (room) {
          room.state = 'waiting';
          room.game = null;
          room.actionBuffer.clear();
          room.actionsSubmitted = 0;

          const playerList = room.players
            .filter(p => p.connected)
            .map(p => ({ id: p.id, name: p.name, isHost: p.isHost, isAI: p.isAI }));

          // 向每个已连接玩家单独发送，带上各自的 yourId
          for (const p of room.players) {
            if (p.ws && p.ws.readyState === 1) {
              sendTo(p.ws, MSG.ROOM_JOINED, {
                roomCode: room.code,
                players: playerList,
                settings: room.settings,
                yourId: p.id,
              });
            }
          }
        }
        break;
      }

      case MSG.REQUEST_STATE: {
        // 重连或刷新后请求当前状态
        const room = [...rooms.values()].find(r => r.wsToPlayer.has(ws));
        if (!room) break;
        const playerId = room.wsToPlayer.get(ws);
        if (!playerId) break;

        if (room.state === 'waiting') {
          sendTo(ws, MSG.ROOM_JOINED, {
            roomCode: room.code,
            players: room.players.filter(p => p.connected).map(p => ({ id: p.id, name: p.name, isHost: p.isHost, isAI: p.isAI })),
            settings: room.settings,
            yourId: playerId,
          });
        } else if (room.state === 'playing' && room.game) {
          sendTo(ws, MSG.GAME_STARTED, {
            players: room.game.getStateSnapshot(),
            totalRounds: room.game.totalRounds,
            round: room.game.round,
            yourId: playerId,
            isHost: room.players.find(p => p.id === playerId)?.isHost || false,
          });
        }
        break;
      }
    }
  });

  ws.on('close', () => handleDisconnect(ws));
  ws.on('error', () => handleDisconnect(ws));
});
