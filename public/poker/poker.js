let userNickname = "YOU";
let appMode = null;
let onlineReady = false;
let onlinePlayers = [];

const BOT_RAISE_AMOUNT = 100;

function $(id) {
    return document.getElementById(id);
}

function showScreen(id) {
    ["nicknameScreen", "menuScreen", "lobbyScreen", "gameScreen"].forEach(screenId => {
        $(screenId).classList.add("hidden");
    });
    $(id).classList.remove("hidden");
}

function saveNickname() {
    userNickname = $("nicknameInput").value.trim() || "Player";

    players[0].name = userNickname;

    $("nicknameLabel").innerText = userNickname;
    $("playerName").innerText = userNickname;

    const nickScreen = $("nicknameScreen");

    if (nickScreen) {
        nickScreen.classList.add("hidden");
        nickScreen.style.display = "none";
        nickScreen.style.visibility = "hidden";
        nickScreen.style.pointerEvents = "none";
    }

    showScreen("menuScreen");
}

function startBotGame() {
    appMode = "bots";
    players[0].name = userNickname;
    $("playerName").innerText = userNickname;
    showScreen("gameScreen");
    setupRaiseSlider(); // FIX #4: перенесено сюда из init()
    newGame();
}

function showOnlineLobby() {
    appMode = "online";
    onlineReady = false;
    onlinePlayers = [{ name: userNickname, ready: false }];
    updateOnlineLobby();
    showScreen("lobbyScreen");
}

function backToMenu() {
    showScreen("menuScreen");
}

function toggleReady() {
    onlineReady = !onlineReady;
    onlinePlayers[0].ready = onlineReady;
    updateOnlineLobby();
}

function updateOnlineLobby() {
    $("readyButton").innerText = onlineReady ? "Ready ✓" : "Ready";

    $("lobbyPlayers").innerHTML = onlinePlayers.map(p => {
        return `<div>${p.name} — ${p.ready ? "Ready" : "Not ready"}</div>`;
    }).join("");

    if (onlinePlayers.length < 2) {
        $("lobbyPlayers").innerHTML += `<br><div>Waiting for other players...</div>`;
    }
}

function setupRaiseSlider() {
    const slider = $("raiseSlider");
    if (!slider) return;

    slider.addEventListener("input", updateBetUI);
}

function getSelectedBetAmount() {
    const slider = $("raiseSlider");
    if (!slider) return 0;
    return Number(slider.value) || 0;
}

function updateBetUI() {
    const slider = $("raiseSlider");
    const label = $("raiseAmountLabel");
    const button = $("betButton");

    if (!slider || !label || !button) return;

    const p = players[0];
    const need = Math.max(0, currentBet - p.bet);

    let min = need > 0 ? need : BIG_BLIND;
    let max = p.chips;

    if (max <= 0) {
        min = 0;
        max = 0;
    }

    if (min > max) min = max;

    slider.min = min;
    slider.max = max;
    slider.step = 50;

    let value = Number(slider.value) || min;
    if (value < min) value = min;
    if (value > max) value = max;
    slider.value = value;

    if (value === p.chips && p.chips > 0) {
        label.innerText = "ALL IN";
        button.innerText = need > 0 ? "Call / All-in" : "All-in";
    } else {
        label.innerText = value;
        button.innerText = need > 0 ? `Call ${need}+` : "Bet";
    }
}

class Deck {
    constructor() {
        this.deck = [];
        this.reset();
        this.shuffle();
    }

    reset() {
        this.deck = [];
        const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
        const values = ["Ace", 2, 3, 4, 5, 6, 7, 8, 9, 10, "Jack", "Queen", "King"];

        for (let suit of suits) {
            for (let value of values) {
                this.deck.push(value + " of " + suit);
            }
        }
    }

    shuffle() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    deal() {
        return this.deck.pop();
    }
}

class Card {
    constructor(card) {
        this.card = card;

        const values = { Ace: 14, Jack: 11, Queen: 12, King: 13 };
        const spriteValues = { Ace: 1, Jack: 11, Queen: 12, King: 13 };
        const suits = { Hearts: 0, Diamonds: 13, Clubs: 26, Spades: 39 };

        const parts = String(card).split(" of ");
        this.valueName = parts[0];
        this.suit = parts[1];
        this.value = values[this.valueName] || Number(this.valueName);

        const spriteValue = spriteValues[this.valueName] || Number(this.valueName);
        this.position = suits[this.suit] + spriteValue;

        this.placeHolder = null;
        this.flipped = false;
    }

    displayCard(placeHolder, flipped = true, dealDelay = 0) {
        this.placeHolder = $(placeHolder);
        if (!this.placeHolder) return;

        this.placeHolder.classList.add("card");
        this.flipped = flipped;
        this.setFace(flipped);

        this.placeHolder.classList.remove("deal-in");
        this.placeHolder.style.animationDelay = `${dealDelay}ms`;

        requestAnimationFrame(() => {
            this.placeHolder.classList.add("deal-in");
        });

        setTimeout(() => {
            if (this.placeHolder) {
                this.placeHolder.classList.remove("deal-in");
                this.placeHolder.style.animationDelay = "";
            }
        }, dealDelay + 500);
    }

    setFace(flipped) {
        if (!this.placeHolder) return;

        if (flipped) {
            this.placeHolder.style.backgroundPosition = -150 * this.position + "px";
        } else {
            this.placeHolder.style.backgroundPosition = "0px";
        }
    }

    flip() {
        if (!this.placeHolder || this.flipped) return;
        this.flipped = true;
        this.setFace(true);
    }
}

let deck;
let phase = "preflop";
let pot = 0;
let currentBet = 0;
let dealerIndex = 0;
let currentTurnIndex = 0;
let boardCards = [];
let isDealing = false;

const SMALL_BLIND = 25;
const BIG_BLIND = 50;
const STARTING_CHIPS = 1000;

let players = [
    { name: "YOU",   chips: STARTING_CHIPS, hand: [], folded: false, out: false, bet: 0, acted: false, result: null, isHuman: true },
    { name: "Alex",  chips: STARTING_CHIPS, hand: [], folded: false, out: false, bet: 0, acted: false, result: null, isHuman: false },
    { name: "Sasha", chips: STARTING_CHIPS, hand: [], folded: false, out: false, bet: 0, acted: false, result: null, isHuman: false },
    { name: "Guest", chips: STARTING_CHIPS, hand: [], folded: false, out: false, bet: 0, acted: false, result: null, isHuman: false }
];

function setStatus(text) {
    $("status").innerText = text;
}

function updatePot() {
    $("potAmount").innerText = pot;
    $("playerChips").innerText = players[0].chips;
    updateBetUI();
}

function activePlayers() {
    return players.filter(p => !p.out);
}

function aliveNotFolded() {
    return players.filter(p => !p.out && !p.folded);
}

function nextActiveIndex(fromIndex) {
    for (let i = 1; i <= players.length; i++) {
        const index = (fromIndex + i + players.length) % players.length;
        const p = players[index];

        if (!p.out && !p.folded && p.chips > 0 && !p.acted) {
            return index;
        }
    }

    return -1;
}

function clearCards() {
    ["card1", "card2", "card3", "card4", "card5", "playerCard1", "playerCard2"].forEach(id => {
        const el = $(id);
        if (!el) return;
        el.className = "";
        el.style.backgroundPosition = "";
        el.style.animationDelay = "";
    });
}

function placeBet(playerIndex, amount) {
    const p = players[playerIndex];
    const realAmount = Math.min(amount, p.chips);

    p.chips -= realAmount;
    p.bet += realAmount;
    pot += realAmount;

    if (p.bet > currentBet) {
        currentBet = p.bet;

        players.forEach((other, i) => {
            if (i !== playerIndex && !other.out && !other.folded && other.chips > 0) {
                other.acted = false;
            }
        });
    }

    p.acted = true;
    updatePot();
}

function formatAction(action, amount = 0) {
    if (action === "check") return "CHECK";
    if (action === "call")  return `CALL ${amount}`;
    if (action === "bet")   return amount === 0 ? "CHECK" : `BET ${amount}`;
    if (action === "raise") return `RAISE +${amount}`;
    if (action === "fold")  return "FOLD";
    if (action === "blind") return `BLIND ${amount}`;
    return "";
}

function renderOpponents(showCards = false, winnerIndex = null, dealMode = false) {
    const container = $("opponents");
    container.innerHTML = "";

    players.forEach((p, index) => {
        if (p.isHuman) return;

        const div = document.createElement("div");
        div.className = "opponent";

        if (p.out) {
            div.innerHTML = `
                <div class="opponent-name">${p.name}</div>
                <div class="opponent-chips">OUT</div>
            `;
            container.appendChild(div);
            return;
        }

        const winnerClass = showCards && index === winnerIndex ? "winner-cards" : "";

        div.innerHTML = `
            <div class="opponent-name">${p.name}</div>
            <div class="opponent-chips">${p.chips} chips</div>
            <div id="actionBubble${index}" class="action-bubble"></div>
            <div class="hidden-cards ${winnerClass}">
                <div id="opponent${index}card1"></div>
                <div id="opponent${index}card2"></div>
            </div>
        `;

        container.appendChild(div);

        const c1 = `opponent${index}card1`;
        const c2 = `opponent${index}card2`;

        if (showCards && !p.folded) {
            p.hand[0].displayCard(c1, true);
            p.hand[1].displayCard(c2, true);
        } else {
            if (dealMode && p.hand.length >= 2) {
                p.hand[0].displayCard(c1, false, index * 120);
                p.hand[1].displayCard(c2, false, 480 + index * 120);
            } else {
                $(c1).classList.add("card");
                $(c2).classList.add("card");
            }
        }
    });
}

function showOpponentAction(index, text) {
    const bubble = $(`actionBubble${index}`);
    if (!bubble) return;

    bubble.innerText = text;
    bubble.classList.add("show");

    setTimeout(() => {
        bubble.classList.remove("show");
    }, 1300);
}

function newGame() {
    players.forEach((p, index) => {
        p.chips = STARTING_CHIPS;
        p.out = false;
        p.folded = false;
        p.bet = 0;
        p.acted = false;
        p.result = null;
        p.hand = [];

        if (index === 0) {
            p.name = userNickname;
        }
    });

    dealerIndex = 0;
    newRound();
}

function newRound() {
    players.forEach(p => {
        if (p.chips <= 0) p.out = true;
    });

    if (players[0].out) {
        setStatus("You are out. New game starting...");
        setTimeout(newGame, 2000);
        return;
    }

    const active = activePlayers();

    if (active.length <= 1) {
        setStatus(`${active[0].name} wins the game! New game starting...`);
        setTimeout(newGame, 2500);
        return;
    }

    isDealing = true;

    deck = new Deck();
    phase = "preflop";
    pot = 0;
    currentBet = 0;
    boardCards = [];

    players.forEach(p => {
        p.folded = false;
        p.bet = 0;
        p.acted = false;
        p.result = null;
        p.hand = [];
    });

    clearCards();

    boardCards = [
        new Card(deck.deal()),
        new Card(deck.deal()),
        new Card(deck.deal()),
        new Card(deck.deal()),
        new Card(deck.deal())
    ];

    players.forEach(p => {
        if (!p.out) {
            p.hand = [new Card(deck.deal()), new Card(deck.deal())];
        }
    });

    boardCards[0].displayCard("card1", false, 960);
    boardCards[1].displayCard("card2", false, 1080);
    boardCards[2].displayCard("card3", false, 1200);
    boardCards[3].displayCard("card4", false, 1320);
    boardCards[4].displayCard("card5", false, 1440);

    players[0].hand[0].displayCard("playerCard1", true, 360);
    players[0].hand[1].displayCard("playerCard2", true, 840);

    dealerIndex = nextDealerIndex(dealerIndex);
    const smallBlindIndex = nextPlayerWithChips(dealerIndex);
    const bigBlindIndex = nextPlayerWithChips(smallBlindIndex);

    placeBet(smallBlindIndex, SMALL_BLIND);
    placeBet(bigBlindIndex, BIG_BLIND);

    players[smallBlindIndex].acted = true;
    players[bigBlindIndex].acted = false;

    currentTurnIndex = nextPlayerWithChips(bigBlindIndex);

    renderOpponents(false, null, true);
    updatePot();

    setStatus("Dealing...");

    setTimeout(() => {
        showOpponentAction(smallBlindIndex, formatAction("blind", SMALL_BLIND));
        showOpponentAction(bigBlindIndex, formatAction("blind", BIG_BLIND));

        setStatus(`Preflop — dealer: ${players[dealerIndex].name}`);

        isDealing = false;
        processTurn();
    }, 1700);
}

function nextDealerIndex(fromIndex) {
    for (let i = 1; i <= players.length; i++) {
        const index = (fromIndex + i) % players.length;
        if (!players[index].out && players[index].chips > 0) return index;
    }

    return 0;
}

function nextPlayerWithChips(fromIndex) {
    for (let i = 1; i <= players.length; i++) {
        const index = (fromIndex + i) % players.length;
        const p = players[index];

        if (!p.out && !p.folded && p.chips > 0) return index;
    }

    return -1;
}

function processTurn() {
    if (isDealing) return;

    const stillIn = aliveNotFolded();

    if (stillIn.length === 1) {
        finishRound(players.indexOf(stillIn[0]), true);
        return;
    }

    if (isBettingRoundComplete()) {
        nextPhase();
        return;
    }

    const nextIndex = nextActiveIndex(currentTurnIndex - 1);

    if (nextIndex === -1) {
        nextPhase();
        return;
    }

    currentTurnIndex = nextIndex;
    const currentPlayer = players[currentTurnIndex];

    if (currentPlayer.isHuman) {
        const need = currentBet - currentPlayer.bet;
        const handInfo = getHandInfo();

        updateBetUI();

        setStatus(`${phaseName()} — your move ${need > 0 ? `(call ${need})` : "(check allowed)"}${handInfo ? " — " + handInfo : ""}`);
        return;
    }

    setTimeout(() => {
        botAction(currentTurnIndex);
        processTurn();
    }, 700);
}

function isBettingRoundComplete() {
    const contenders = aliveNotFolded();

    if (contenders.length <= 1) return true;

    return contenders.every(p => {
        if (p.chips === 0) return true;
        if (!p.acted) return false;
        return p.bet === currentBet;
    });
}

function playerAction(action) {
    const p = players[0];

    if (isDealing) return;
    if (appMode !== "bots") return;
    if (phase === "showdown" || p.out || p.folded) return;
    if (currentTurnIndex !== 0) return;

    const need = currentBet - p.bet;

    if (action === "check") {
        if (need > 0) {
            setStatus(`You can't check. Need to call ${need}, bet more, or fold.`);
            return;
        }
        p.acted = true;
    }

    // FIX #5: bet с 0 теперь проверяет разрешён ли чек
    if (action === "bet") {
        const selected = getSelectedBetAmount();

        if (selected <= 0) {
            if (need > 0) {
                setStatus(`You can't check. Need to call ${need} or fold.`);
                return;
            }
            p.acted = true;
        } else {
            placeBet(0, selected);
        }
    }

    if (action === "fold") {
        p.folded = true;
        p.acted = true;
    }

    currentTurnIndex = nextActiveIndex(currentTurnIndex);
    renderOpponents(false);
    updatePot();
    processTurn();
}

function estimateHandStrength(hand) {
    if (!hand || hand.length < 2) return 0.3;

    const v1 = hand[0].value;
    const v2 = hand[1].value;
    const suited = hand[0].suit === hand[1].suit;
    const paired = v1 === v2;

    if (paired) return 0.5 + Math.min(v1 / 14, 1) * 0.4;

    const high = Math.max(v1, v2);
    const low = Math.min(v1, v2);

    let strength = (high / 14) * 0.5 + (low / 14) * 0.25;

    if (suited) strength += 0.1;
    if (Math.abs(v1 - v2) <= 2) strength += 0.05;

    return Math.min(strength, 1);
}

function botAction(index) {
    const p = players[index];
    const need = currentBet - p.bet;
    const handStrength = estimateHandStrength(p.hand);

    let action;
    let amount = 0;

    if (need <= 0) {
        if (handStrength > 0.7 && Math.random() < 0.5) {
            action = "raise";
            amount = Math.min(BOT_RAISE_AMOUNT, p.chips);
        } else {
            action = "check";
        }
    } else {
        const callThreshold = 0.3 + handStrength * 0.5;
        const r = Math.random();

        if (r > callThreshold) {
            action = "fold";
        } else if (handStrength > 0.75 && Math.random() < 0.35) {
            action = "raise";
            amount = Math.min(need + BOT_RAISE_AMOUNT, p.chips);
        } else {
            action = "call";
            amount = need;
        }
    }

    if (action === "check") p.acted = true;
    if (action === "call")  placeBet(index, amount);
    if (action === "raise") placeBet(index, amount);
    if (action === "fold")  { p.folded = true; p.acted = true; }

    renderOpponents(false);
    updatePot();

    showOpponentAction(index, formatAction(action, amount));
}

function resetStreetBets() {
    players.forEach(p => {
        p.bet = 0;
        p.acted = p.chips === 0 || p.out || p.folded;
    });

    currentBet = 0;
    currentTurnIndex = nextPlayerWithChips(dealerIndex);
    updateBetUI();
}

function nextPhase() {
    if (phase === "preflop") {
        boardCards[0].flip();
        boardCards[1].flip();
        boardCards[2].flip();
        phase = "flop";
        resetStreetBets();
        setStatus("Flop");
        setTimeout(processTurn, 700);
        return;
    }

    if (phase === "flop") {
        boardCards[3].flip();
        phase = "turn";
        resetStreetBets();
        setStatus("Turn");
        setTimeout(processTurn, 700);
        return;
    }

    if (phase === "turn") {
        boardCards[4].flip();
        phase = "river";
        resetStreetBets();
        setStatus("River");
        setTimeout(processTurn, 700);
        return;
    }

    if (phase === "river") {
        showdown();
    }
}

function showdown() {
    phase = "showdown";
    boardCards.forEach(c => c.flip());

    const contenders = aliveNotFolded();
    let bestResult = null;

    contenders.forEach(p => {
        const result = evaluateSevenCards([...p.hand, ...boardCards]);
        p.result = result;

        if (!bestResult || compareHands(result, bestResult) > 0) {
            bestResult = result;
        }
    });

    const winners = contenders.filter(p => compareHands(p.result, bestResult) === 0);
    const share = Math.floor(pot / winners.length);

    winners.forEach(w => { w.chips += share; });
    winners[0].chips += pot - share * winners.length;

    players.forEach(p => {
        if (p.chips <= 0) { p.chips = 0; p.out = true; }
    });

    const firstWinnerIndex = players.indexOf(winners[0]);
    renderOpponents(true, firstWinnerIndex);

    const names = winners.map(w => w.name).join(" & ");
    const reason = winners.length > 1 ? "SPLIT POT" : winners[0].result.name;

    // FIX #3: сохраняем сумму до обнуления пота
    const wonAmount = pot;
    pot = 0;
    updatePot();

    setStatus(`${names} win${winners.length > 1 ? "" : "s"} ${wonAmount} chips — ${reason}`);

    setTimeout(newRound, 5000);
}

function finishRound(winnerIndex, wonByFold) {
    if (!wonByFold) {
        showdown();
        return;
    }

    phase = "showdown";

    const winner = players[winnerIndex];

    // FIX #3: сохраняем сумму до обнуления пота
    const wonAmount = pot;
    winner.chips += wonAmount;

    players.forEach(p => {
        if (p.chips <= 0) { p.chips = 0; p.out = true; }
    });

    renderOpponents(true, winnerIndex);

    pot = 0;
    updatePot();

    setStatus(`${winner.name} wins ${wonAmount} chips — everyone folded`);

    setTimeout(newRound, 5000);
}

function phaseName() {
    if (phase === "preflop") return "Preflop";
    if (phase === "flop")    return "Flop";
    if (phase === "turn")    return "Turn";
    if (phase === "river")   return "River";
    return "Showdown";
}

function getHandInfo() {
    const visibleBoard = boardCards.filter(c => c.flipped);

    if (visibleBoard.length < 3) return null;

    const result = evaluateSevenCards([...players[0].hand, ...visibleBoard]);
    return result.name;
}

function evaluateSevenCards(cards) {
    const values = cards.map(c => c.value).sort((a, b) => b - a);
    const suits = {};

    cards.forEach(c => {
        if (!suits[c.suit]) suits[c.suit] = [];
        suits[c.suit].push(c.value);
    });

    const counts = {};
    values.forEach(v => counts[v] = (counts[v] || 0) + 1);

    const unique = [...new Set(values)].sort((a, b) => b - a);

    function findStraight(vals) {
        let arr = [...new Set(vals)].sort((a, b) => b - a);

        if (arr.includes(14)) arr.push(1);

        for (let i = 0; i <= arr.length - 5; i++) {
            const slice = arr.slice(i, i + 5);

            if (slice[0] - slice[4] === 4) {
                return slice[0];
            }
        }

        return null;
    }

    let flushSuit = null;

    for (let suit in suits) {
        if (suits[suit].length >= 5) flushSuit = suit;
    }

    if (flushSuit) {
        const flushValues = suits[flushSuit].sort((a, b) => b - a);
        const straightFlush = findStraight(flushValues);

        if (straightFlush === 14) {
            return { rank: 9, name: "Royal Flush", tiebreakers: [14] };
        }

        if (straightFlush) {
            return { rank: 8, name: "Straight Flush", tiebreakers: [straightFlush] };
        }
    }

    const groups = Object.keys(counts)
        .map(v => ({ value: Number(v), count: counts[v] }))
        .sort((a, b) => b.count - a.count || b.value - a.value);

    const four = groups.find(g => g.count === 4);

    if (four) {
        const kicker = unique.find(v => v !== four.value);
        return { rank: 7, name: "Four of a Kind", tiebreakers: [four.value, kicker] };
    }

    const trips = groups.filter(g => g.count === 3);
    const pairs = groups.filter(g => g.count === 2);

    if (trips.length && (pairs.length || trips.length > 1)) {
        const trip = trips[0].value;
        const pair = pairs.length ? pairs[0].value : trips[1].value;
        return { rank: 6, name: "Full House", tiebreakers: [trip, pair] };
    }

    if (flushSuit) {
        const topFlush = suits[flushSuit].sort((a, b) => b - a).slice(0, 5);
        return { rank: 5, name: "Flush", tiebreakers: topFlush };
    }

    const straight = findStraight(values);

    if (straight) {
        return { rank: 4, name: "Straight", tiebreakers: [straight] };
    }

    if (trips.length) {
        const trip = trips[0].value;
        const kickers = unique.filter(v => v !== trip).slice(0, 2);
        return { rank: 3, name: "Three of a Kind", tiebreakers: [trip, ...kickers] };
    }

    if (pairs.length >= 2) {
        const pair1 = pairs[0].value;
        const pair2 = pairs[1].value;
        const kicker = unique.find(v => v !== pair1 && v !== pair2);
        return { rank: 2, name: "Two Pair", tiebreakers: [pair1, pair2, kicker] };
    }

    if (pairs.length === 1) {
        const pair = pairs[0].value;
        const kickers = unique.filter(v => v !== pair).slice(0, 3);
        return { rank: 1, name: "One Pair", tiebreakers: [pair, ...kickers] };
    }

    return { rank: 0, name: "High Card", tiebreakers: unique.slice(0, 5) };
}

function compareHands(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;

    for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
        const av = a.tiebreakers[i] || 0;
        const bv = b.tiebreakers[i] || 0;

        if (av !== bv) return av - bv;
    }

    return 0;
}

function init() {
    showScreen("nicknameScreen");
    // FIX #4: setupRaiseSlider убран отсюда, перенесён в startBotGame()
}

init();