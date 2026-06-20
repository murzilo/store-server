const { Server, Room } = require("colyseus");
const { Schema, MapSchema, type } = require("@colyseus/schema");
const { createServer } = require("http");
const express = require("express");

// ── Схема игрока ─────────────────────────────────────────────
class PlayerState extends Schema {}
type("string")(PlayerState.prototype, "sessionId");
type("number")(PlayerState.prototype, "x");
type("number")(PlayerState.prototype, "y");
type("number")(PlayerState.prototype, "z");
type("number")(PlayerState.prototype, "rotationY");
type("string")(PlayerState.prototype, "nickname");

// ── Схема комнаты ────────────────────────────────────────────
class RoomState extends Schema {
    constructor() {
        super();
        this.players = new MapSchema();
    }
}
type({ map: PlayerState })(RoomState.prototype, "players");

// ── Комната ──────────────────────────────────────────────────
class StoreUpstairsRoom extends Room {
    onCreate(options) {
        this.setState(new RoomState());
        console.log("[Server] StoreUpstairsRoom created");

        this.onMessage("move", (client, data) => {
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            player.x = Number(data.x) || 0;
            player.y = Number(data.y) || 0;
            player.z = Number(data.z) || 0;
            player.rotationY = Number(data.rotationY) || 0;
        });
    }

    onJoin(client, options) {
        const player = new PlayerState();

        player.sessionId = client.sessionId;
        player.x = 0;
        player.y = 0;
        player.z = 0;
        player.rotationY = 0;
        player.nickname = "Guest" + Math.floor(Math.random() * 9999);

        this.state.players.set(client.sessionId, player);

        console.log("[Server] player joined:", client.sessionId, player.nickname);
    }

    onLeave(client) {
        this.state.players.delete(client.sessionId);
        console.log("[Server] player left:", client.sessionId);
    }

    onDispose() {
        console.log("[Server] room disposed");
    }
}

// ── Запуск ───────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);

const gameServer = new Server({ server: httpServer });
gameServer.define("StoreUpstairsRoom", StoreUpstairsRoom);

httpServer.listen(2567, () => {
    console.log("[Server] Colyseus running on ws://localhost:2567");
});
