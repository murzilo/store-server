let userNickname = "Guest";
let appMode = null;

const BOT_RAISE_AMOUNT = 100;
const SERVER_URL = "wss://store-server-3m1q.onrender.com";

let _room = null;
let _mySessionId = null;
let _onlinePlayers = {};
let _onlineBoard = [];
let _onlinePhase = "waiting";
let _onlinePot = 0;
let _onlineCurrentBet = 0;
let _onlineCurrentTurn = null;
let _onlineStatusText = "";
let _onlineBoardRendered = []; // карты которые уже отрисованы на борде

function $(id) { return document.getElementById(id); }

function showScreen(id) {
    ["menuScreen", "lobbyScreen", "gameScreen"].forEach(screenId => {
        const el = $(screenId);
        if (!el) return;
        el.classList.add("hidden");
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("visibility", "hidden", "important");
        el.style.setProperty("pointer-events", "none", "important");
    });
    const target = $(id);
    if (!target) return;
    target.classList.remove("hidden");
    target.style.setProperty("display", id === "gameScreen" ? "block" : "flex", "important");
    target.style.setProperty("visibility", "visible", "important");
    target.style.setProperty("pointer-events", "auto", "important");
}

// ════════════════════════════════════════
//  МЕНЮ
// ════════════════════════════════════════

function startBotGame() {
    appMode = "bots";
    players[0].name = userNickname;
    $("playerName").innerText = userNickname;
    showScreen("gameScreen");
    setupRaiseSlider();
    newGame();
}

function showOnlineLobby() {
    appMode = "online";
    _onlineBoardRendered = [];
    showScreen("lobbyScreen");
    $("lobbyPlayers").innerHTML = "Connecting...";
    $("readyButton").disabled = true;
    _connectToPokerRoom();
}

function backToMenu() {
    if (_room) { _room.leave(); _room = null; }
    _onlinePlayers = {};
    _onlineBoard = [];
    _onlineBoardRendered = [];
    appMode = null;
    showScreen("menuScreen");
}

function toggleReady() {
    if (!_room) return;
    _room.send("setReady");
}

function _updateLobbyUI() {
    const ps = Object.values(_onlinePlayers);
    $("lobbyPlayers").innerHTML = ps.map(p =>
        `<div>${p.nickname} — ${p.ready ? "✓ Ready" : "Not ready"}</div>`
    ).join("") + (ps.length < 2 ? "<br><div>Waiting for other players...</div>" : "");
    const me = _onlinePlayers[_mySessionId];
    $("readyButton").innerText = (me && me.ready) ? "Ready ✓" : "Ready";
    $("readyButton").disabled = false;
}

// ════════════════════════════════════════
//  COLYSEUS
// ════════════════════════════════════════

function _connectToPokerRoom() {
    if (typeof Colyseus === "undefined") {
        const s = document.createElement("script");
        s.src = "https://unpkg.com/colyseus.js@0.15.16/dist/colyseus.js";
        s.onload = () => _doConnect();
        s.onerror = () => { $("lobbyPlayers").innerHTML = "Failed to load SDK"; };
        document.head.appendChild(s);
    } else {
        _doConnect();
    }
}

function _doConnect() {
    const client = new Colyseus.Client(SERVER_URL);
    client.joinOrCreate("PokerRoom", { nickname: userNickname })
        .then(room => {
            _room = room;
            _mySessionId = room.sessionId;

            room.state.players.onAdd((player, sessionId) => {
                _onlinePlayers[sessionId] = {
                    sessionId,
                    nickname:  player.nickname,
                    chips:     player.chips,
                    bet:       player.bet,
                    folded:    player.folded,
                    out:       player.out,
                    acted:     player.acted,
                    ready:     player.ready,
                    hand:      player.hand,
                    result:    player.result,
                    winner:    player.winner,
                    seatIndex: player.seatIndex
                };
                player.onChange(() => {
                    if (!_onlinePlayers[sessionId]) return;
                    const p = _onlinePlayers[sessionId];
                    p.nickname  = player.nickname;
                    p.chips     = player.chips;
                    p.bet       = player.bet;
                    p.folded    = player.folded;
                    p.out       = player.out;
                    p.acted     = player.acted;
                    p.ready     = player.ready;
                    p.hand      = player.hand;
                    p.result    = player.result;
                    p.winner    = player.winner;
                    p.seatIndex = player.seatIndex;
                    _onRoomStateChanged();
                });
                _onRoomStateChanged();
            });

            room.state.players.onRemove((_, sessionId) => {
                delete _onlinePlayers[sessionId];
                _onRoomStateChanged();
            });

            room.state.board.onChange(() => {
                _onlineBoard = [];
                room.state.board.forEach(card => _onlineBoard.push(card));
                _onRoomStateChanged();
            });

            room.state.onChange(() => {
                const prevPhase = _onlinePhase;
                _onlinePhase       = room.state.phase;
                _onlinePot         = room.state.pot;
                _onlineCurrentBet  = room.state.currentBet;
                _onlineCurrentTurn = room.state.currentTurn;
                _onlineStatusText  = room.state.statusText;

                // сбрасываем рендер борда при новом раунде
                if (prevPhase === "waiting" && _onlinePhase === "preflop") {
                    _onlineBoardRendered = [];
                    clearCards();
                }

                _onRoomStateChanged();
            });
        })
        .catch(err => {
            console.error("[Poker] join error:", err);
            $("lobbyPlayers").innerHTML = "Connection error. Try again.";
        });
}

// ════════════════════════════════════════
//  ОТРИСОВКА ОНЛАЙН
// ════════════════════════════════════════

function _onRoomStateChanged() {
    if (_onlinePhase === "waiting") {
        // если была игра и вернулись в waiting — возврат в меню
        if ($("gameScreen") && !$("gameScreen").classList.contains("hidden")) {
            setTimeout(() => {
                backToMenu();
            }, 1000);
            return;
        }
        _updateLobbyUI();
        return;
    }

    if ($("lobbyScreen") && !$("lobbyScreen").classList.contains("hidden")) {
        showScreen("gameScreen");
        setupRaiseSlider();
        _onlineBoardRendered = [];
    }

    _renderOnlineGame();
}

function _renderOnlineGame() {
    setStatus(_onlineStatusText || _onlinePhase);
    $("potAmount").innerText = _onlinePot;

    const me = _onlinePlayers[_mySessionId];
    if (me) {
        $("playerName").innerText = me.nickname;
        $("playerChips").innerText = me.chips;
        _renderMyCards(me);
    }

    _renderOnlineBoardIncremental();
    _renderOnlineOpponents();

    const myTurn = _onlineCurrentTurn === _mySessionId
        && _onlinePhase !== "showdown"
        && _onlinePhase !== "waiting";

    const foldBtn  = document.querySelector("button[onclick=\"playerAction('fold')\"]");
    const checkBtn = document.querySelector("button[onclick=\"playerAction('check')\"]");
    const betBtn   = $("betButton");
    if (foldBtn)  foldBtn.disabled  = !myTurn;
    if (checkBtn) checkBtn.disabled = !myTurn;
    if (betBtn)   betBtn.disabled   = !myTurn;

    if (myTurn && me) {
        const need = _onlineCurrentBet - me.bet;
        const handInfo = me.hand ? _getOnlineHandInfo(me.hand) : null;
        setStatus(`${_onlinePhase} — your move ${need > 0 ? `(call ${need})` : "(check allowed)"}${handInfo ? " — " + handInfo : ""}`);
        _updateOnlineBetUI(me);
    }
}

function _renderMyCards(me) {
    if (!me.hand || me.hand === "") { clearPlayerCards(); return; }
    const parts = me.hand.split(",");
    if (parts.length < 2) return;

    // показываем только если карты изменились
    const key = me.hand;
    if (_renderMyCards._lastHand === key) return;
    _renderMyCards._lastHand = key;

    new Card(parts[0].trim()).displayCard("playerCard1", true, 0);
    new Card(parts[1].trim()).displayCard("playerCard2", true, 100);
}
_renderMyCards._lastHand = "";

function clearPlayerCards() {
    _renderMyCards._lastHand = "";
    ["playerCard1", "playerCard2"].forEach(id => {
        const el = $(id); if (!el) return;
        el.className = ""; el.style.backgroundPosition = "";
    });
}

// FIX: карты добавляются на борд только когда появляются новые — без перерисовки
function _renderOnlineBoardIncremental() {
    const ids = ["card1","card2","card3","card4","card5"];

    // если борд обнулился (новый раунд) — очищаем
    if (_onlineBoard.length < _onlineBoardRendered.length) {
        _onlineBoardRendered = [];
        ids.forEach(id => {
            const el = $(id); if (!el) return;
            el.className = ""; el.style.backgroundPosition = "";
        });
    }

    // добавляем только новые карты
    for (let i = _onlineBoardRendered.length; i < _onlineBoard.length; i++) {
        const card = new Card(_onlineBoard[i]);
        card.displayCard(ids[i], true, (i - _onlineBoardRendered.length) * 120);
        _onlineBoardRendered.push(_onlineBoard[i]);
    }
}

function _renderOnlineOpponents() {
    const container = $("opponents");
    container.innerHTML = "";

    const others = Object.values(_onlinePlayers)
        .filter(p => p.sessionId !== _mySessionId)
        .sort((a, b) => a.seatIndex - b.seatIndex);

    others.forEach((p, i) => {
        const div = document.createElement("div");
        div.className = "opponent";

        if (p.out) {
            div.innerHTML = `<div class="opponent-name">${p.nickname}</div><div class="opponent-chips">OUT</div>`;
            container.appendChild(div);
            return;
        }

        const isCurrentTurn = p.sessionId === _onlineCurrentTurn;
        const winnerClass   = (_onlinePhase === "showdown" && p.winner) ? "winner-cards" : "";
        const turnMark      = isCurrentTurn ? " ▶" : "";
        const foldedMark    = p.folded ? " (folded)" : "";

        div.innerHTML = `
            <div class="opponent-name">${p.nickname}${turnMark}${foldedMark}</div>
            <div class="opponent-chips">${p.chips} chips${p.bet > 0 ? ` · bet ${p.bet}` : ""}</div>
            <div id="onlineBubble${i}" class="action-bubble"></div>
            <div class="hidden-cards ${winnerClass}">
                <div id="onlineOpp${i}c1"></div>
                <div id="onlineOpp${i}c2"></div>
            </div>`;
        container.appendChild(div);

        const showCards = _onlinePhase === "showdown" && !p.folded && p.hand;
        if (showCards && p.hand) {
            const parts = p.hand.split(",");
            if (parts.length >= 2) {
                new Card(parts[0].trim()).displayCard(`onlineOpp${i}c1`, true, 0);
                new Card(parts[1].trim()).displayCard(`onlineOpp${i}c2`, true, 100);
            }
        } else {
            const c1el = $(`onlineOpp${i}c1`);
            const c2el = $(`onlineOpp${i}c2`);
            if (c1el) c1el.classList.add("card");
            if (c2el) c2el.classList.add("card");
        }

        if (_onlinePhase === "showdown" && p.result) {
            const bubble = $(`onlineBubble${i}`);
            if (bubble) {
                bubble.innerText = p.winner ? `🏆 ${p.result}` : p.result;
                bubble.classList.add("show");
            }
        }
    });
}

// FIX: слайдер онлайн — убрали ранний return
function _updateOnlineBetUI(me) {
    const slider = $("raiseSlider");
    const label  = $("raiseAmountLabel");
    const button = $("betButton");
    if (!slider || !label || !button) return;

    const need = Math.max(0, _onlineCurrentBet - me.bet);
    let min = need > 0 ? need : 50;
    let max = me.chips;
    if (max <= 0) { min = 0; max = 0; }
    if (min > max) min = max;

    slider.min = min; slider.max = max; slider.step = 50;
    let value = Number(slider.value) || min;
    if (value < min) value = min;
    if (value > max) value = max;
    slider.value = value;

    if (value === me.chips && me.chips > 0) {
        label.innerText = "ALL IN";
        button.innerText = need > 0 ? "Call / All-in" : "All-in";
    } else {
        label.innerText = value;
        button.innerText = need > 0 ? `Call ${need}+` : "Bet";
    }
}

function _getOnlineHandInfo(handStr) {
    if (_onlineBoard.length < 3) return null;
    try {
        const hand  = handStr.split(",").map(s => new Card(s.trim()));
        const board = _onlineBoard.map(s => new Card(s));
        return evaluateSevenCards([...hand, ...board]).name;
    } catch(e) { return null; }
}

// ════════════════════════════════════════
//  ДЕЙСТВИЯ ИГРОКА
// ════════════════════════════════════════

function playerAction(action) {
    if (appMode === "online") { _onlinePlayerAction(action); return; }

    const p = players[0];
    if (isDealing) return;
    if (phase === "showdown" || p.out || p.folded) return;
    if (currentTurnIndex !== 0) return;

    const need = currentBet - p.bet;
    if (action === "check") {
        if (need > 0) { setStatus(`You can't check. Need to call ${need}.`); return; }
        p.acted = true;
    }
    if (action === "bet") {
        const selected = getSelectedBetAmount();
        if (selected <= 0) {
            if (need > 0) { setStatus(`You can't check. Need to call ${need}.`); return; }
            p.acted = true;
        } else { placeBet(0, selected); }
    }
    if (action === "fold") { p.folded = true; p.acted = true; }

    currentTurnIndex = nextActiveIndex(currentTurnIndex);
    renderOpponents(false); updatePot(); processTurn();
}

function _onlinePlayerAction(action) {
    if (!_room) return;
    if (_onlineCurrentTurn !== _mySessionId) return;
    if (_onlinePhase === "showdown" || _onlinePhase === "waiting") return;
    const me = _onlinePlayers[_mySessionId];
    if (!me || me.folded || me.out) return;
    const need = _onlineCurrentBet - me.bet;

    if (action === "check") {
        if (need > 0) { setStatus(`Can't check. Need to call ${need}.`); return; }
        _room.send("action", { type: "check" }); return;
    }
    if (action === "bet") {
        const selected = getSelectedBetAmount();
        if (selected <= 0) {
            if (need > 0) { setStatus(`Can't check. Need to call ${need}.`); return; }
            _room.send("action", { type: "check" });
        } else {
            _room.send("action", { type: "bet", amount: selected });
        }
        return;
    }
    if (action === "fold") { _room.send("action", { type: "fold" }); }
}

// ════════════════════════════════════════
//  СЛАЙДЕР
// ════════════════════════════════════════

function setupRaiseSlider() {
    const slider = $("raiseSlider");
    if (!slider) return;
    // убираем старый listener если был
    slider.removeEventListener("input", _onSliderInput);
    slider.addEventListener("input", _onSliderInput);
}

function _onSliderInput() {
    if (appMode === "online") {
        // обновляем лейбл для онлайна
        const me = _onlinePlayers[_mySessionId];
        if (me) _updateOnlineBetUI(me);
    } else {
        updateBetUI();
    }
}

function getSelectedBetAmount() {
    const slider = $("raiseSlider");
    if (!slider) return 0;
    return Number(slider.value) || 0;
}

function updateBetUI() {
    const slider = $("raiseSlider");
    const label  = $("raiseAmountLabel");
    const button = $("betButton");
    if (!slider || !label || !button) return;

    const p    = players[0];
    const need = Math.max(0, currentBet - p.bet);
    let min = need > 0 ? need : BIG_BLIND;
    let max = p.chips;
    if (max <= 0) { min = 0; max = 0; }
    if (min > max) min = max;

    slider.min = min; slider.max = max; slider.step = 50;
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

// ════════════════════════════════════════
//  БОТ РЕЖИМ
// ════════════════════════════════════════

class Deck {
    constructor() { this.deck = []; this.reset(); this.shuffle(); }
    reset() {
        this.deck = [];
        const suits  = ["Hearts","Diamonds","Clubs","Spades"];
        const values = ["Ace",2,3,4,5,6,7,8,9,10,"Jack","Queen","King"];
        for (const suit of suits) for (const val of values) this.deck.push(val + " of " + suit);
    }
    shuffle() { for (let i=this.deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[this.deck[i],this.deck[j]]=[this.deck[j],this.deck[i]];} }
    deal() { return this.deck.pop(); }
}

class Card {
    constructor(card) {
        this.card = card;
        const values       = { Ace:14, Jack:11, Queen:12, King:13 };
        const spriteValues = { Ace:1,  Jack:11, Queen:12, King:13 };
        const suits        = { Hearts:0, Diamonds:13, Clubs:26, Spades:39 };
        const parts = String(card).split(" of ");
        this.valueName = parts[0]; this.suit = parts[1];
        this.value    = values[this.valueName] || Number(this.valueName);
        const sv      = spriteValues[this.valueName] || Number(this.valueName);
        this.position = (suits[this.suit] || 0) + sv;
        this.placeHolder = null; this.flipped = false;
    }
    displayCard(placeHolder, flipped=true, dealDelay=0) {
        this.placeHolder = $(placeHolder);
        if (!this.placeHolder) return;
        this.placeHolder.classList.add("card");
        this.flipped = flipped;
        this.setFace(flipped);
        // анимация только при первом появлении
        if (!this.placeHolder.dataset.dealt) {
            this.placeHolder.dataset.dealt = "1";
            this.placeHolder.classList.remove("deal-in");
            this.placeHolder.style.animationDelay = `${dealDelay}ms`;
            requestAnimationFrame(() => { this.placeHolder.classList.add("deal-in"); });
            setTimeout(() => {
                if (this.placeHolder) {
                    this.placeHolder.classList.remove("deal-in");
                    this.placeHolder.style.animationDelay = "";
                }
            }, dealDelay + 500);
        }
    }
    setFace(flipped) {
        if (!this.placeHolder) return;
        this.placeHolder.style.backgroundPosition = flipped ? -150*this.position+"px" : "0px";
    }
    flip() {
        if (!this.placeHolder || this.flipped) return;
        this.flipped = true; this.setFace(true);
    }
}

let deck, phase="preflop", pot=0, currentBet=0;
let dealerIndex=0, currentTurnIndex=0, boardCards=[], isDealing=false;
const SMALL_BLIND=25, BIG_BLIND=50, STARTING_CHIPS=1000;

let players = [
    { name:"YOU",   chips:STARTING_CHIPS, hand:[], folded:false, out:false, bet:0, acted:false, result:null, isHuman:true },
    { name:"Alex",  chips:STARTING_CHIPS, hand:[], folded:false, out:false, bet:0, acted:false, result:null, isHuman:false },
    { name:"Sasha", chips:STARTING_CHIPS, hand:[], folded:false, out:false, bet:0, acted:false, result:null, isHuman:false },
    { name:"Guest", chips:STARTING_CHIPS, hand:[], folded:false, out:false, bet:0, acted:false, result:null, isHuman:false }
];

function setStatus(text) { $("status").innerText = text; }
function updatePot() { $("potAmount").innerText = pot; $("playerChips").innerText = players[0].chips; updateBetUI(); }
function activePlayers() { return players.filter(p => !p.out); }
function aliveNotFolded() { return players.filter(p => !p.out && !p.folded); }

function nextActiveIndex(fromIndex) {
    for (let i=1;i<=players.length;i++){const index=(fromIndex+i+players.length)%players.length;const p=players[index];if(!p.out&&!p.folded&&p.chips>0&&!p.acted)return index;}
    return -1;
}

// FIX: сбрасываем dataset.dealt при очистке
function clearCards() {
    ["card1","card2","card3","card4","card5","playerCard1","playerCard2"].forEach(id => {
        const el = $(id); if (!el) return;
        el.className = ""; el.style.backgroundPosition = ""; el.style.animationDelay = "";
        delete el.dataset.dealt;
    });
}

function placeBet(playerIndex, amount) {
    const p=players[playerIndex]; const realAmount=Math.min(amount,p.chips);
    p.chips-=realAmount; p.bet+=realAmount; pot+=realAmount;
    if(p.bet>currentBet){currentBet=p.bet;players.forEach((other,i)=>{if(i!==playerIndex&&!other.out&&!other.folded&&other.chips>0)other.acted=false;});}
    p.acted=true; updatePot();
}

function formatAction(action, amount=0) {
    if(action==="check")return"CHECK"; if(action==="call")return`CALL ${amount}`;
    if(action==="bet")return amount===0?"CHECK":`BET ${amount}`; if(action==="raise")return`RAISE +${amount}`;
    if(action==="fold")return"FOLD"; if(action==="blind")return`BLIND ${amount}`; return"";
}

function renderOpponents(showCards=false, winnerIndex=null, dealMode=false) {
    const container=$("opponents"); container.innerHTML="";
    players.forEach((p,index)=>{
        if(p.isHuman)return;
        const div=document.createElement("div"); div.className="opponent";
        if(p.out){div.innerHTML=`<div class="opponent-name">${p.name}</div><div class="opponent-chips">OUT</div>`;container.appendChild(div);return;}
        const winnerClass=showCards&&index===winnerIndex?"winner-cards":"";
        div.innerHTML=`<div class="opponent-name">${p.name}</div><div class="opponent-chips">${p.chips} chips</div><div id="actionBubble${index}" class="action-bubble"></div><div class="hidden-cards ${winnerClass}"><div id="opponent${index}card1"></div><div id="opponent${index}card2"></div></div>`;
        container.appendChild(div);
        const c1=`opponent${index}card1`,c2=`opponent${index}card2`;
        if(showCards&&!p.folded){p.hand[0].displayCard(c1,true);p.hand[1].displayCard(c2,true);}
        else if(dealMode&&p.hand.length>=2){p.hand[0].displayCard(c1,false,index*120);p.hand[1].displayCard(c2,false,480+index*120);}
        else{$(c1).classList.add("card");$(c2).classList.add("card");}
    });
}

function showOpponentAction(index, text) {
    const bubble=$(`actionBubble${index}`); if(!bubble)return;
    bubble.innerText=text; bubble.classList.add("show");
    setTimeout(()=>{bubble.classList.remove("show");},1300);
}

function newGame() {
    players.forEach((p,i)=>{p.chips=STARTING_CHIPS;p.out=false;p.folded=false;p.bet=0;p.acted=false;p.result=null;p.hand=[];if(i===0)p.name=userNickname;});
    dealerIndex=0; newRound();
}

function newRound() {
    players.forEach(p=>{if(p.chips<=0)p.out=true;});
    if(players[0].out){setStatus("You are out. New game starting...");setTimeout(newGame,2000);return;}
    const active=activePlayers();
    if(active.length<=1){
        setStatus(`${active[0].name} wins the game! Returning to menu...`);
        // FIX: возврат в меню через 3 секунды
        setTimeout(()=>{
            appMode=null;
            showScreen("menuScreen");
        },3000);
        return;
    }
    isDealing=true; deck=new Deck(); phase="preflop"; pot=0; currentBet=0; boardCards=[];
    players.forEach(p=>{p.folded=false;p.bet=0;p.acted=false;p.result=null;p.hand=[];});
    clearCards();
    boardCards=[new Card(deck.deal()),new Card(deck.deal()),new Card(deck.deal()),new Card(deck.deal()),new Card(deck.deal())];
    players.forEach(p=>{if(!p.out)p.hand=[new Card(deck.deal()),new Card(deck.deal())];});
    boardCards[0].displayCard("card1",false,960); boardCards[1].displayCard("card2",false,1080);
    boardCards[2].displayCard("card3",false,1200); boardCards[3].displayCard("card4",false,1320);
    boardCards[4].displayCard("card5",false,1440);
    players[0].hand[0].displayCard("playerCard1",true,360);
    players[0].hand[1].displayCard("playerCard2",true,840);
    dealerIndex=nextDealerIndex(dealerIndex);
    const sbIdx=nextPlayerWithChips(dealerIndex),bbIdx=nextPlayerWithChips(sbIdx);
    placeBet(sbIdx,SMALL_BLIND); placeBet(bbIdx,BIG_BLIND);
    players[sbIdx].acted=true; players[bbIdx].acted=false;
    currentTurnIndex=nextPlayerWithChips(bbIdx);
    renderOpponents(false,null,true); updatePot(); setStatus("Dealing...");
    setTimeout(()=>{
        showOpponentAction(sbIdx,formatAction("blind",SMALL_BLIND));
        showOpponentAction(bbIdx,formatAction("blind",BIG_BLIND));
        setStatus(`Preflop — dealer: ${players[dealerIndex].name}`);
        isDealing=false; processTurn();
    },1700);
}

function nextDealerIndex(fromIndex) {
    for(let i=1;i<=players.length;i++){const index=(fromIndex+i)%players.length;if(!players[index].out&&players[index].chips>0)return index;}
    return 0;
}

function nextPlayerWithChips(fromIndex) {
    for(let i=1;i<=players.length;i++){const index=(fromIndex+i)%players.length;const p=players[index];if(!p.out&&!p.folded&&p.chips>0)return index;}
    return -1;
}

function processTurn() {
    if(isDealing)return;
    const stillIn=aliveNotFolded();
    if(stillIn.length===1){finishRound(players.indexOf(stillIn[0]),true);return;}
    if(isBettingRoundComplete()){nextPhase();return;}
    const nextIndex=nextActiveIndex(currentTurnIndex-1);
    if(nextIndex===-1){nextPhase();return;}
    currentTurnIndex=nextIndex;
    const currentPlayer=players[currentTurnIndex];
    if(currentPlayer.isHuman){
        const need=currentBet-currentPlayer.bet;
        const handInfo=getHandInfo();
        updateBetUI();
        setStatus(`${phaseName()} — your move ${need>0?`(call ${need})`:"(check allowed)"}${handInfo?" — "+handInfo:""}`);
        return;
    }
    setTimeout(()=>{botAction(currentTurnIndex);processTurn();},700);
}

function isBettingRoundComplete() {
    const c=aliveNotFolded(); if(c.length<=1)return true;
    return c.every(p=>{if(p.chips===0)return true;if(!p.acted)return false;return p.bet===currentBet;});
}

function estimateHandStrength(hand) {
    if(!hand||hand.length<2)return 0.3;
    const v1=hand[0].value,v2=hand[1].value,suited=hand[0].suit===hand[1].suit,paired=v1===v2;
    if(paired)return 0.5+Math.min(v1/14,1)*0.4;
    let s=(Math.max(v1,v2)/14)*0.5+(Math.min(v1,v2)/14)*0.25;
    if(suited)s+=0.1; if(Math.abs(v1-v2)<=2)s+=0.05; return Math.min(s,1);
}

function botAction(index) {
    const p=players[index],need=currentBet-p.bet,hs=estimateHandStrength(p.hand);
    let action,amount=0;
    if(need<=0){if(hs>0.7&&Math.random()<0.5){action="raise";amount=Math.min(BOT_RAISE_AMOUNT,p.chips);}else action="check";}
    else{const r=Math.random(),ct=0.3+hs*0.5;if(r>ct)action="fold";else if(hs>0.75&&Math.random()<0.35){action="raise";amount=Math.min(need+BOT_RAISE_AMOUNT,p.chips);}else{action="call";amount=need;}}
    if(action==="check")p.acted=true;
    if(action==="call")placeBet(index,amount);
    if(action==="raise")placeBet(index,amount);
    if(action==="fold"){p.folded=true;p.acted=true;}
    renderOpponents(false); updatePot(); showOpponentAction(index,formatAction(action,amount));
}

function resetStreetBets() {
    players.forEach(p=>{p.bet=0;p.acted=p.chips===0||p.out||p.folded;});
    currentBet=0; currentTurnIndex=nextPlayerWithChips(dealerIndex); updateBetUI();
}

function nextPhase() {
    if(phase==="preflop"){boardCards[0].flip();boardCards[1].flip();boardCards[2].flip();phase="flop";resetStreetBets();setStatus("Flop");setTimeout(processTurn,700);return;}
    if(phase==="flop"){boardCards[3].flip();phase="turn";resetStreetBets();setStatus("Turn");setTimeout(processTurn,700);return;}
    if(phase==="turn"){boardCards[4].flip();phase="river";resetStreetBets();setStatus("River");setTimeout(processTurn,700);return;}
    if(phase==="river")showdown();
}

function showdown() {
    phase="showdown"; boardCards.forEach(c=>c.flip());
    const contenders=aliveNotFolded(); let bestResult=null;
    contenders.forEach(p=>{const r=evaluateSevenCards([...p.hand,...boardCards]);p.result=r;if(!bestResult||compareHands(r,bestResult)>0)bestResult=r;});
    const winners=contenders.filter(p=>compareHands(p.result,bestResult)===0);
    const share=Math.floor(pot/winners.length);
    winners.forEach(w=>{w.chips+=share;}); winners[0].chips+=pot-share*winners.length;
    players.forEach(p=>{if(p.chips<=0){p.chips=0;p.out=true;}});
    renderOpponents(true,players.indexOf(winners[0]));
    const wonAmount=pot; pot=0; updatePot();
    setStatus(`${winners.map(w=>w.name).join(" & ")} win${winners.length>1?"":"s"} ${wonAmount} chips — ${winners.length>1?"SPLIT POT":winners[0].result.name}`);
    setTimeout(newRound,5000);
}

function finishRound(winnerIndex, wonByFold) {
    if(!wonByFold){showdown();return;}
    phase="showdown"; const winner=players[winnerIndex]; const wonAmount=pot;
    winner.chips+=wonAmount; players.forEach(p=>{if(p.chips<=0){p.chips=0;p.out=true;}});
    renderOpponents(true,winnerIndex); pot=0; updatePot();
    setStatus(`${winner.name} wins ${wonAmount} chips — everyone folded`); setTimeout(newRound,5000);
}

function phaseName() { return{preflop:"Preflop",flop:"Flop",turn:"Turn",river:"River"}[phase]||"Showdown"; }

function getHandInfo() {
    const vb=boardCards.filter(c=>c.flipped); if(vb.length<3)return null;
    return evaluateSevenCards([...players[0].hand,...vb]).name;
}

function evaluateSevenCards(cards) {
    const values=cards.map(c=>c.value).sort((a,b)=>b-a);
    const suits={}; cards.forEach(c=>{if(!suits[c.suit])suits[c.suit]=[];suits[c.suit].push(c.value);});
    const counts={}; values.forEach(v=>counts[v]=(counts[v]||0)+1);
    const unique=[...new Set(values)].sort((a,b)=>b-a);
    const findStraight=vals=>{let arr=[...new Set(vals)].sort((a,b)=>b-a);if(arr.includes(14))arr.push(1);for(let i=0;i<=arr.length-5;i++){const sl=arr.slice(i,i+5);if(sl[0]-sl[4]===4)return sl[0];}return null;};
    let flushSuit=null; for(const s in suits){if(suits[s].length>=5)flushSuit=s;}
    if(flushSuit){const fv=suits[flushSuit].sort((a,b)=>b-a);const sf=findStraight(fv);if(sf===14)return{rank:9,name:"Royal Flush",tiebreakers:[14]};if(sf)return{rank:8,name:"Straight Flush",tiebreakers:[sf]};}
    const groups=Object.keys(counts).map(v=>({value:Number(v),count:counts[v]})).sort((a,b)=>b.count-a.count||b.value-a.value);
    const four=groups.find(g=>g.count===4); if(four)return{rank:7,name:"Four of a Kind",tiebreakers:[four.value,unique.find(v=>v!==four.value)]};
    const trips=groups.filter(g=>g.count===3),pairs=groups.filter(g=>g.count===2);
    if(trips.length&&(pairs.length||trips.length>1))return{rank:6,name:"Full House",tiebreakers:[trips[0].value,pairs.length?pairs[0].value:trips[1].value]};
    if(flushSuit)return{rank:5,name:"Flush",tiebreakers:suits[flushSuit].sort((a,b)=>b-a).slice(0,5)};
    const straight=findStraight(values); if(straight)return{rank:4,name:"Straight",tiebreakers:[straight]};
    if(trips.length)return{rank:3,name:"Three of a Kind",tiebreakers:[trips[0].value,...unique.filter(v=>v!==trips[0].value).slice(0,2)]};
    if(pairs.length>=2)return{rank:2,name:"Two Pair",tiebreakers:[pairs[0].value,pairs[1].value,unique.find(v=>v!==pairs[0].value&&v!==pairs[1].value)]};
    if(pairs.length===1)return{rank:1,name:"One Pair",tiebreakers:[pairs[0].value,...unique.filter(v=>v!==pairs[0].value).slice(0,3)]};
    return{rank:0,name:"High Card",tiebreakers:unique.slice(0,5)};
}

function compareHands(a,b) {
    if(a.rank!==b.rank)return a.rank-b.rank;
    for(let i=0;i<Math.max(a.tiebreakers.length,b.tiebreakers.length);i++){const av=a.tiebreakers[i]||0,bv=b.tiebreakers[i]||0;if(av!==bv)return av-bv;}
    return 0;
}

function init() {
    const params=new URLSearchParams(window.location.search);
    const nick=params.get("nickname");
    userNickname=(nick&&nick.trim().length>0)?nick.trim():"Guest"+Math.floor(Math.random()*999+1);
    players[0].name=userNickname;

    const label=$("nicknameLabel");
    if(label){
        label.innerText=userNickname;
        label.addEventListener("blur",function(){
            let val=label.innerText.trim();
            if(val.length===0)val="Guest"+Math.floor(Math.random()*999+1);
            if(val.length>16)val=val.slice(0,16);
            label.innerText=val; userNickname=val; players[0].name=val;
            $("playerName").innerText=val;
            if(_room)_room.send("setNickname",{nickname:val});
        });
        label.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();label.blur();}});
    }

    $("playerName").innerText=userNickname;
    showScreen("menuScreen");
}

init();