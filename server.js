const { Server, Room } = require("colyseus");
const { Schema, MapSchema, type } = require("@colyseus/schema");
const { createServer } = require("http");
const express = require("express");

// ---------------- PLAYER ----------------

class PlayerState extends Schema {}

type("string")(PlayerState.prototype, "sessionId");
type("number")(PlayerState.prototype, "x");
type("number")(PlayerState.prototype, "y");
type("number")(PlayerState.prototype, "z");
type("number")(PlayerState.prototype, "rotationY");
type("string")(PlayerState.prototype, "nickname");

// animation state
type("string")(PlayerState.prototype, "anim");

// stable marker color
type("number")(PlayerState.prototype, "colorR");
type("number")(PlayerState.prototype, "colorG");
type("number")(PlayerState.prototype, "colorB");

// ---------------- ROOM STATE ----------------

class RoomState extends Schema {
    constructor() {
        super();
        this.players = new MapSchema();
    }
}

type({ map: PlayerState })(RoomState.prototype, "players");

// ---------------- ROOM ----------------

class StoreUpstairsRoom extends Room {
    onCreate() {
        this.setState(new RoomState());

        console.log("[Server] StoreUpstairsRoom created");

        this.onMessage("move", (client, data) => {
            const player = this.state.players.get(client.sessionId);

            if (!player) return;

            player.x = this._safeNumber(data.x, 0);
            player.y = this._safeNumber(data.y, 0);
            player.z = this._safeNumber(data.z, 0);
            player.rotationY = this._safeNumber(data.rotationY, 0);

            // Allowed animation names from your PlayCanvas graph
            player.anim = this._safeAnim(data.anim);
        });
    }

    onJoin(client) {
        const player = new PlayerState();

        player.sessionId = client.sessionId;

        player.x = 0;
        player.y = 0;
        player.z = 0;
        player.rotationY = 0;

        player.nickname = "Guest" + Math.floor(Math.random() * 9999);

        player.anim = "Idle";

        // One random color per player, synced to everyone
        player.colorR = Math.random();
        player.colorG = Math.random();
        player.colorB = Math.random();

        this.state.players.set(client.sessionId, player);

        console.log(
            "[Server] player joined:",
            client.sessionId,
            player.nickname
        );
    }

    onLeave(client) {
        this.state.players.delete(client.sessionId);

        console.log("[Server] player left:", client.sessionId);
    }

    onDispose() {
        console.log("[Server] room disposed");
    }

    _safeNumber(value, fallback) {
        if (typeof value !== "number") return fallback;
        if (!Number.isFinite(value)) return fallback;
        return value;
    }

    _safeAnim(anim) {
        const allowed = {
            "Idle": true,
            "Forward": true,
            "Back": true,
            "Left": true,
            "Right": true,
            "Forward Left": true,
            "Forward Right": true,
            "Back Left": true,
            "Back Right": true,
            "sit": true,
            "sit_to_stand": true,
            "stand_to_sit": true
        };

        if (typeof anim !== "string") return "Idle";
        if (!allowed[anim]) return "Idle";

        return anim;
    }
}

// ---------------- EXPRESS ----------------

const app = express();

app.use(express.static("public"));
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");

    res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    );

    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }

    next();
});

app.get("/", (req, res) => {
    res.send("Colyseus server is running");
});

// ---------------- SERVER ----------------

const httpServer = createServer(app);

const gameServer = new Server({
    server: httpServer
});

gameServer.define("StoreUpstairsRoom", StoreUpstairsRoom);

const PORT = process.env.PORT || 2567;

httpServer.listen(PORT, "0.0.0.0", () => {
    console.log("[Server] Colyseus running on port", PORT);
});
