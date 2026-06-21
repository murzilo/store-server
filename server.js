const { Server, Room } = require("colyseus");
const { Schema, MapSchema, ArraySchema, type } = require("@colyseus/schema");
const { createServer } = require("http");
const express = require("express");

// ════════════════════════════════════════
//  StoreUpstairsRoom — мультиплеер движения
// ════════════════════════════════════════

class PlayerState extends Schema {}
type("string")(PlayerState.prototype, "sessionId");
type("number")(PlayerState.prototype, "x");
type("number")(PlayerState.prototype, "y");
type("number")(PlayerState.prototype, "z");
type("number")(PlayerState.prototype, "rotationY");
type("string")(PlayerState.prototype, "nickname");
type("string")(PlayerState.prototype, "anim");
type("number")(PlayerState.prototype, "colorR");
type("number")(PlayerState.prototype, "colorG");
type("number")(PlayerState.prototype, "colorB");

class RoomState extends Schema {
    constructor() {
        super();
        this.players = new MapSchema();
    }
}
type({ map: PlayerState })(RoomState.prototype, "players");

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
            player.anim = this._safeAnim(data.anim);
        });
    }

    onJoin(client) {
        const player = new PlayerState();
        player.sessionId = client.sessionId;
        player.x = 0; player.y = 0; player.z = 0; player.rotationY = 0;
        player.nickname = "Guest" + Math.floor(Math.random() * 9999);
        player.anim = "Idle";
        player.colorR = Math.random();
        player.colorG = Math.random();
        player.colorB = Math.random();
        this.state.players.set(client.sessionId, player);
        console.log("[Server] player joined:", client.sessionId, player.nickname);
    }

    onLeave(client) {
        this.state.players.delete(client.sessionId);
        console.log("[Server] player left:", client.sessionId);
    }

    onDispose() { console.log("[Server] StoreUpstairsRoom disposed"); }

    _safeNumber(value, fallback) {
        if (typeof value !== "number") return fallback;
        if (!Number.isFinite(value)) return fallback;
        return value;
    }

    _safeAnim(anim) {
        const allowed = {
            "Idle": true, "Forward": true, "Back": true, "Left": true, "Right": true,
            "Forward Left": true, "Forward Right": true, "Back Left": true, "Back Right": true,
            "sit": true, "sit_to_stand": true, "stand_to_sit": true
        };
        return (typeof anim === "string" && allowed[anim]) ? anim : "Idle";
    }
}

// ════════════════════════════════════════
//  PokerRoom — онлайн покер
// ════════════════════════════════════════

class PokerPlayer extends Schema {}
type("string")(PokerPlayer.prototype, "sessionId");
type("string")(PokerPlayer.prototype, "nickname");
type("number")(PokerPlayer.prototype, "seatIndex");
type("number")(PokerPlayer.prototype, "chips");
type("number")(PokerPlayer.prototype, "bet");
type("boolean")(PokerPlayer.prototype, "folded");
type("boolean")(PokerPlayer.prototype, "out");
type("boolean")(PokerPlayer.prototype, "acted");
type("boolean")(PokerPlayer.prototype, "ready");
type("string")(PokerPlayer.prototype, "hand");      // "Ace of Hearts,10 of Clubs"
type("string")(PokerPlayer.prototype, "result");    // имя комбинации после шоудауна
type("boolean")(PokerPlayer.prototype, "winner");

class PokerState extends Schema {
    constructor() {
        super();
        this.players  = new MapSchema();
        this.board    = new ArraySchema();
    }
}
type({ map: PokerPlayer })(PokerState.prototype, "players");
type(["string"])(PokerState.prototype, "board");
type("string")(PokerState.prototype, "phase");          // waiting/preflop/flop/turn/river/showdown
type("number")(PokerState.prototype, "pot");
type("number")(PokerState.prototype, "currentBet");
type("string")(PokerState.prototype, "currentTurn");    // sessionId чей ход
type("string")(PokerState.prototype, "dealerSeat");     // sessionId дилера
type("string")(PokerState.prototype, "statusText");     // текст статуса для UI

class PokerRoom extends Room {
    onCreate() {
        this.setState(new PokerState());
        this.state.phase = "waiting";
        this.state.pot = 0;
        this.state.currentBet = 0;
        this.state.statusText = "Waiting for players...";

        this._deck = [];
        this._boardCards = [];   // полные названия для логики
        this._smallBlind = 25;
        this._bigBlind = 50;
        this._startingChips = 1000;
        this._dealerSessionId = null;
        this._turnTimer = null;

        this.onMessage("setNickname", (client, data) => {
            const p = this.state.players.get(client.sessionId);
            if (!p) return;
            p.nickname = String(data.nickname || "Guest").slice(0, 16);
        });

        this.onMessage("setReady", (client) => {
            const p = this.state.players.get(client.sessionId);
            if (!p || this.state.phase !== "waiting") return;
            p.ready = !p.ready;
            this._checkAllReady();
        });

        this.onMessage("action", (client, data) => {
            if (this.state.currentTurn !== client.sessionId) return;
            if (!["fold","check","bet"].includes(data.type)) return;
            this._handleAction(client.sessionId, data.type, data.amount || 0);
        });

        console.log("[Server] PokerRoom created");
    }

    onJoin(client, options) {
        const p = new PokerPlayer();
        p.sessionId = client.sessionId;
        p.nickname  = String(options && options.nickname ? options.nickname : "Guest").slice(0, 16);
        p.seatIndex = this._nextSeat();
        p.chips     = this._startingChips;
        p.bet       = 0;
        p.folded    = false;
        p.out       = false;
        p.acted     = false;
        p.ready     = false;
        p.hand      = "";
        p.result    = "";
        p.winner    = false;
        this.state.players.set(client.sessionId, p);
        this.state.statusText = `${this._activePlayers().length}/5 players. Press Ready to start.`;
        console.log("[Poker] joined:", client.sessionId, p.nickname, "seat", p.seatIndex);
    }

    onLeave(client, consented) {
        const p = this.state.players.get(client.sessionId);
        if (p) {
            // если игра идёт — помечаем как фолд и продолжаем
            if (this.state.phase !== "waiting") {
                p.folded = true;
                p.out    = true;
                if (this.state.currentTurn === client.sessionId) {
                    this._advanceTurn();
                }
            }
            this.state.players.delete(client.sessionId);
        }
        console.log("[Poker] left:", client.sessionId);
    }

    onDispose() {
        if (this._turnTimer) clearTimeout(this._turnTimer);
        console.log("[Poker] room disposed");
    }

    // ─── Утилиты ─────────────────────────────────────────────

    _nextSeat() {
        const taken = new Set();
        this.state.players.forEach(p => taken.add(p.seatIndex));
        for (let i = 0; i < 5; i++) { if (!taken.has(i)) return i; }
        return taken.size;
    }

    _activePlayers() {
        const arr = [];
        this.state.players.forEach(p => { if (!p.out) arr.push(p); });
        return arr.sort((a, b) => a.seatIndex - b.seatIndex);
    }

    _aliveNotFolded() {
        return this._activePlayers().filter(p => !p.folded);
    }

    _checkAllReady() {
        const active = this._activePlayers();
        if (active.length < 2) return;
        if (active.every(p => p.ready)) {
            setTimeout(() => this._startGame(), 1000);
        }
    }

    // ─── Игра ────────────────────────────────────────────────

    _startGame() {
        this._activePlayers().forEach(p => {
            p.chips   = this._startingChips;
            p.out     = false;
            p.ready   = false;
        });
        this._dealerSessionId = this._activePlayers()[0].sessionId;
        this._newRound();
    }

    _newRound() {
        const active = this._activePlayers();

        // проверяем выбывших
        active.forEach(p => { if (p.chips <= 0) p.out = true; });

        const alive = this._activePlayers();
        if (alive.length <= 1) {
            const winner = alive[0];
            this.state.phase = "waiting";
            this.state.statusText = winner
                ? `${winner.nickname} wins the game! Waiting for ready...`
                : "Game over. Waiting for ready...";
            alive.forEach(p => { p.ready = false; });
            return;
        }

        // сброс раунда
        this.state.pot        = 0;
        this.state.currentBet = 0;
        this.state.board      = new ArraySchema();
        this._boardCards      = [];

        alive.forEach(p => {
            p.bet    = 0;
            p.folded = false;
            p.acted  = false;
            p.hand   = "";
            p.result = "";
            p.winner = false;
        });

        // колода
        this._deck = this._buildDeck();
        this._shuffle(this._deck);

        // раздаём 5 карт борда
        this._boardCards = [
            this._deck.pop(), this._deck.pop(), this._deck.pop(),
            this._deck.pop(), this._deck.pop()
        ];

        // раздаём карты игрокам
        alive.forEach(p => {
            p.hand = this._deck.pop() + "," + this._deck.pop();
        });

        // двигаем дилера
        this._dealerSessionId = this._nextDealer(this._dealerSessionId, alive);

        // блайнды
        const dealerIdx = alive.findIndex(p => p.sessionId === this._dealerSessionId);
        const sbIdx     = (dealerIdx + 1) % alive.length;
        const bbIdx     = (dealerIdx + 2) % alive.length;
        const sbPlayer  = alive[sbIdx];
        const bbPlayer  = alive[bbIdx];

        this._placeBet(sbPlayer, this._smallBlind);
        this._placeBet(bbPlayer, this._bigBlind);

        // BB не acted (может raise)
        sbPlayer.acted = true;
        bbPlayer.acted = false;

        // первый ход — после BB
        const firstIdx = (bbIdx + 1) % alive.length;

        this.state.phase      = "preflop";
        this.state.statusText = "Preflop";
        this.state.currentTurn = alive[firstIdx].sessionId;

        this._scheduleTurnTimeout();
        console.log("[Poker] new round started, phase=preflop");
    }

    _nextDealer(currentId, alive) {
        if (!currentId) return alive[0].sessionId;
        const idx = alive.findIndex(p => p.sessionId === currentId);
        return alive[(idx + 1) % alive.length].sessionId;
    }

    _placeBet(player, amount) {
        const real = Math.min(amount, player.chips);
        player.chips     -= real;
        player.bet       += real;
        this.state.pot   += real;

        if (player.bet > this.state.currentBet) {
            this.state.currentBet = player.bet;
            // все остальные должны переставить acted = false
            this._aliveNotFolded().forEach(p => {
                if (p.sessionId !== player.sessionId && p.chips > 0) {
                    p.acted = false;
                }
            });
        }

        player.acted = true;
    }

    _handleAction(sessionId, type, amount) {
        const p = this.state.players.get(sessionId);
        if (!p) return;

        const need = this.state.currentBet - p.bet;

        if (type === "fold") {
            p.folded = true;
            p.acted  = true;
        } else if (type === "check") {
            if (need > 0) return; // нельзя чекнуть
            p.acted = true;
        } else if (type === "bet") {
            if (amount <= 0) {
                if (need > 0) return;
                p.acted = true;
            } else {
                this._placeBet(p, amount);
            }
        }

        this._advanceTurn();
    }

    _advanceTurn() {
        if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }

        const alive = this._aliveNotFolded();

        // остался один — победитель
        if (alive.length <= 1) {
            this._finishRound(alive[0] || null, true);
            return;
        }

        // раунд ставок завершён?
        if (this._bettingComplete()) {
            this._nextPhase();
            return;
        }

        // следующий ход
        const currentIdx = alive.findIndex(p => p.sessionId === this.state.currentTurn);
        for (let i = 1; i <= alive.length; i++) {
            const candidate = alive[(currentIdx + i) % alive.length];
            if (!candidate.acted && candidate.chips > 0) {
                this.state.currentTurn = candidate.sessionId;
                this.state.statusText  = `${candidate.nickname}'s turn`;
                this._scheduleTurnTimeout();
                return;
            }
        }

        // все acted — следующая фаза
        this._nextPhase();
    }

    _bettingComplete() {
        return this._aliveNotFolded().every(p => {
            if (p.chips === 0) return true;
            if (!p.acted)      return false;
            return p.bet === this.state.currentBet;
        });
    }

    _scheduleTurnTimeout() {
        if (this._turnTimer) clearTimeout(this._turnTimer);
        // авто-фолд если игрок не ходит 30 секунд
        this._turnTimer = setTimeout(() => {
            const p = this.state.players.get(this.state.currentTurn);
            if (p) { p.folded = true; p.acted = true; }
            this._advanceTurn();
        }, 30000);
    }

    _nextPhase() {
        if (this.state.phase === "preflop") {
            this.state.board.push(this._boardCards[0]);
            this.state.board.push(this._boardCards[1]);
            this.state.board.push(this._boardCards[2]);
            this.state.phase      = "flop";
            this.state.statusText = "Flop";
        } else if (this.state.phase === "flop") {
            this.state.board.push(this._boardCards[3]);
            this.state.phase      = "turn";
            this.state.statusText = "Turn";
        } else if (this.state.phase === "turn") {
            this.state.board.push(this._boardCards[4]);
            this.state.phase      = "river";
            this.state.statusText = "River";
        } else if (this.state.phase === "river") {
            this._showdown();
            return;
        }

        // сброс ставок для новой улицы
        this._resetStreetBets();
        this._scheduleTurnTimeout();
    }

    _resetStreetBets() {
        const alive = this._activePlayers();
        this.state.currentBet = 0;
        alive.forEach(p => {
            p.bet   = 0;
            p.acted = p.chips === 0 || p.out || p.folded;
        });

        // первый ход после дилера
        const dealerIdx = alive.findIndex(p => p.sessionId === this._dealerSessionId);
        for (let i = 1; i <= alive.length; i++) {
            const candidate = alive[(dealerIdx + i) % alive.length];
            if (!candidate.folded && !candidate.out && candidate.chips > 0) {
                this.state.currentTurn = candidate.sessionId;
                this.state.statusText  = `${candidate.nickname}'s turn`;
                return;
            }
        }
    }

    _showdown() {
        this.state.phase = "showdown";

        const contenders = this._aliveNotFolded();
        const boardCards = this._boardCards.map(s => this._parseCard(s));

        let bestResult = null;
        contenders.forEach(p => {
            const hand = p.hand.split(",").map(s => this._parseCard(s));
            const result = this._evaluateSeven([...hand, ...boardCards]);
            p.result = result.name;
            if (!bestResult || this._compareHands(result, bestResult) > 0) {
                bestResult = result;
            }
        });

        const winners = contenders.filter(p => {
            const hand   = p.hand.split(",").map(s => this._parseCard(s));
            const result = this._evaluateSeven([...hand, ...boardCards]);
            return this._compareHands(result, bestResult) === 0;
        });

        const share = Math.floor(this.state.pot / winners.length);
        winners.forEach(w => { w.chips += share; w.winner = true; });
        winners[0].chips += this.state.pot - share * winners.length;

        const names = winners.map(w => w.nickname).join(" & ");
        const reason = winners.length > 1 ? "SPLIT POT" : bestResult.name;
        const wonAmount = this.state.pot;
        this.state.pot = 0;
        this.state.statusText = `${names} wins ${wonAmount} chips — ${reason}`;

        // отмечаем выбывших
        this._activePlayers().forEach(p => { if (p.chips <= 0) p.out = true; });

        console.log("[Poker] showdown:", this.state.statusText);

        // следующий раунд через 5 секунд
        setTimeout(() => this._newRound(), 5000);
    }

    _finishRound(winner, wonByFold) {
        if (!wonByFold) { this._showdown(); return; }

        if (winner) {
            winner.chips  += this.state.pot;
            winner.winner  = true;
        }

        const wonAmount = this.state.pot;
        this.state.pot  = 0;
        this.state.phase = "showdown";
        this.state.statusText = winner
            ? `${winner.nickname} wins ${wonAmount} chips — everyone folded`
            : "Round over";

        this._activePlayers().forEach(p => { if (p.chips <= 0) p.out = true; });

        console.log("[Poker] finish (fold):", this.state.statusText);
        setTimeout(() => this._newRound(), 5000);
    }

    // ─── Колода ──────────────────────────────────────────────

    _buildDeck() {
        const suits  = ["Hearts", "Diamonds", "Clubs", "Spades"];
        const values = ["Ace",2,3,4,5,6,7,8,9,10,"Jack","Queen","King"];
        const deck   = [];
        for (const suit of suits) for (const val of values) deck.push(`${val} of ${suit}`);
        return deck;
    }

    _shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    // ─── Оценка рук ──────────────────────────────────────────

    _parseCard(str) {
        const VALUES = { Ace: 14, Jack: 11, Queen: 12, King: 13 };
        const SUITS  = { Hearts: 0, Diamonds: 13, Clubs: 26, Spades: 39 };
        const SPRITE = { Ace: 1, Jack: 11, Queen: 12, King: 13 };
        const parts  = String(str).trim().split(" of ");
        const vName  = parts[0];
        const suit   = parts[1];
        const value  = VALUES[vName] || Number(vName);
        const sv     = SPRITE[vName] || Number(vName);
        return { value, suit, valueName: vName, position: (SUITS[suit] || 0) + sv, raw: str };
    }

    _evaluateSeven(cards) {
        const values = cards.map(c => c.value).sort((a, b) => b - a);
        const suits  = {};
        cards.forEach(c => { if (!suits[c.suit]) suits[c.suit] = []; suits[c.suit].push(c.value); });
        const counts = {};
        values.forEach(v => counts[v] = (counts[v] || 0) + 1);
        const unique = [...new Set(values)].sort((a, b) => b - a);

        const findStraight = (vals) => {
            let arr = [...new Set(vals)].sort((a, b) => b - a);
            if (arr.includes(14)) arr.push(1);
            for (let i = 0; i <= arr.length - 5; i++) {
                const sl = arr.slice(i, i + 5);
                if (sl[0] - sl[4] === 4) return sl[0];
            }
            return null;
        };

        let flushSuit = null;
        for (const s in suits) { if (suits[s].length >= 5) flushSuit = s; }

        if (flushSuit) {
            const fv = suits[flushSuit].sort((a, b) => b - a);
            const sf = findStraight(fv);
            if (sf === 14) return { rank: 9, name: "Royal Flush",    tiebreakers: [14] };
            if (sf)        return { rank: 8, name: "Straight Flush", tiebreakers: [sf] };
        }

        const groups = Object.keys(counts)
            .map(v => ({ value: Number(v), count: counts[v] }))
            .sort((a, b) => b.count - a.count || b.value - a.value);

        const four  = groups.find(g => g.count === 4);
        if (four) return { rank: 7, name: "Four of a Kind", tiebreakers: [four.value, unique.find(v => v !== four.value)] };

        const trips = groups.filter(g => g.count === 3);
        const pairs = groups.filter(g => g.count === 2);

        if (trips.length && (pairs.length || trips.length > 1))
            return { rank: 6, name: "Full House", tiebreakers: [trips[0].value, pairs.length ? pairs[0].value : trips[1].value] };

        if (flushSuit)
            return { rank: 5, name: "Flush", tiebreakers: suits[flushSuit].sort((a, b) => b - a).slice(0, 5) };

        const straight = findStraight(values);
        if (straight) return { rank: 4, name: "Straight", tiebreakers: [straight] };

        if (trips.length)
            return { rank: 3, name: "Three of a Kind", tiebreakers: [trips[0].value, ...unique.filter(v => v !== trips[0].value).slice(0, 2)] };

        if (pairs.length >= 2)
            return { rank: 2, name: "Two Pair", tiebreakers: [pairs[0].value, pairs[1].value, unique.find(v => v !== pairs[0].value && v !== pairs[1].value)] };

        if (pairs.length === 1)
            return { rank: 1, name: "One Pair", tiebreakers: [pairs[0].value, ...unique.filter(v => v !== pairs[0].value).slice(0, 3)] };

        return { rank: 0, name: "High Card", tiebreakers: unique.slice(0, 5) };
    }

    _compareHands(a, b) {
        if (a.rank !== b.rank) return a.rank - b.rank;
        for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
            const av = a.tiebreakers[i] || 0;
            const bv = b.tiebreakers[i] || 0;
            if (av !== bv) return av - bv;
        }
        return 0;
    }
}

// ════════════════════════════════════════
//  Express
// ════════════════════════════════════════

const app = express();
app.use(express.static("public"));
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});
app.get("/", (req, res) => { res.send("Colyseus server is running"); });

// ════════════════════════════════════════
//  HTTP + Colyseus
// ════════════════════════════════════════

const httpServer = createServer(app);
const gameServer = new Server({ server: httpServer });

gameServer.define("StoreUpstairsRoom", StoreUpstairsRoom);
gameServer.define("PokerRoom", PokerRoom);

const PORT = process.env.PORT || 2567;
httpServer.listen(PORT, "0.0.0.0", () => {
    console.log("[Server] Colyseus running on port", PORT);
});