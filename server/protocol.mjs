// 消息协议常量 — 客户端和服务端共享
export const MSG = {
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  START_GAME: 'start_game',
  PLAYER_ACTION: 'player_action',
  LEAVE_ROOM: 'leave_room',
  BACK_TO_LOBBY: 'back_to_lobby',
  REQUEST_STATE: 'request_state',

  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  GAME_STARTED: 'game_started',
  ROUND_STARTED: 'round_started',
  YOUR_TURN: 'your_turn',
  WAITING: 'waiting',
  ROUND_RESULT: 'round_result',
  GAME_OVER: 'game_over',
  ERROR: 'error',
  ROOM_CLOSED: 'room_closed',
};

const SCHEMAS = {
  [MSG.CREATE_ROOM]: { playerName: 'string', totalRounds: 'number', maxPlayers: 'number', humanCount: 'number' },
  [MSG.JOIN_ROOM]: { roomCode: 'string', playerName: 'string' },
  [MSG.START_GAME]: {},
  [MSG.PLAYER_ACTION]: { type: 'string' },
};

export function validate(type, data) {
  const schema = SCHEMAS[type];
  if (!schema) return [];
  const errors = [];
  for (const [key, expect] of Object.entries(schema)) {
    if (data[key] === undefined || data[key] === null) {
      errors.push(`缺少字段: ${key}`);
    } else if (typeof data[key] !== expect) {
      errors.push(`字段 ${key} 应为 ${expect}`);
    }
  }
  return errors;
}
