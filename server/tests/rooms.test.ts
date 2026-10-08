import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { RoomManager, GameRoom } from '../src/rooms';

describe('RoomManager - Player Color Assignment', () => {
  test('creator receives WHITE', () => {
    const manager = new RoomManager();
    const { room, color } = manager.createRoom('socket-creator');
    
    assert.strictEqual(color, 'w');
    assert.strictEqual(room.players.w?.socketId, 'socket-creator');
    assert.strictEqual(room.players.b, undefined);
  });

  test('second player receives BLACK', () => {
    const manager = new RoomManager();
    const { room } = manager.createRoom('socket-creator');
    
    const result = manager.joinRoom(room.id, 'socket-joiner');
    
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.color, 'b');
    assert.strictEqual(result.room?.players.b?.socketId, 'socket-joiner');
  });

  test('both players receive different colors and room state is correct', () => {
    const manager = new RoomManager();
    const { room } = manager.createRoom('socket-1');
    const result = manager.joinRoom(room.id, 'socket-2');
    
    assert.strictEqual(result.room?.players.w?.socketId, 'socket-1');
    assert.strictEqual(result.room?.players.b?.socketId, 'socket-2');
    assert.strictEqual(result.gameReady, true);
  });

  test('third player is rejected', () => {
    const manager = new RoomManager();
    const { room } = manager.createRoom('socket-1');
    manager.joinRoom(room.id, 'socket-2'); // Game is now ready
    
    // simulate game start
    room.startGame();

    const result = manager.joinRoom(room.id, 'socket-3');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'Room is already in progress or finished');
  });

  test('existing player color remains unchanged on rejoin', () => {
    const manager = new RoomManager();
    const { room } = manager.createRoom('socket-1');
    
    const rejoinResult = manager.joinRoom(room.id, 'socket-1');
    assert.strictEqual(rejoinResult.success, true);
    assert.strictEqual(rejoinResult.color, 'w');
    assert.strictEqual(rejoinResult.gameReady, false);
  });

  test('white can only make white moves', () => {
    const manager = new RoomManager();
    const { room } = manager.createRoom('socket-1');
    manager.joinRoom(room.id, 'socket-2');
    room.startGame();

    // black tries to move white pawn
    const res = room.makeMove('socket-2', 'e2', 'e4');
    assert.strictEqual(res.success, false);
    assert.match(res.error || '', /It is not your turn/);

    // white moves white pawn
    const res2 = room.makeMove('socket-1', 'e2', 'e4');
    assert.strictEqual(res2.success, true);
  });

  test('black can only make black moves', () => {
    const manager = new RoomManager();
    const { room } = manager.createRoom('socket-1');
    manager.joinRoom(room.id, 'socket-2');
    room.startGame();

    // white moves
    room.makeMove('socket-1', 'e2', 'e4');

    // white tries to move black pawn
    const res = room.makeMove('socket-1', 'e7', 'e5');
    assert.strictEqual(res.success, false);
    assert.match(res.error || '', /It is not your turn/);

    // black moves black pawn
    const res2 = room.makeMove('socket-2', 'e7', 'e5');
    assert.strictEqual(res2.success, true);
  });
});
