// The match: rounds, money, the buy phase, the charge, and who won. One place
// holds all match state so main.js and the bots read the same truth. First to
// five rounds takes the match; a round is won by eliminating the other squad,
// by the charge detonating, by a defuse, or by the clock when nothing is planted.
import { WEAPONS, GRENADE, SMOKE } from './weapon.js';
import { SITES } from './world.js';
import { sfx } from './audio.js';

export const BUY_SECONDS = 20;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 5;
export const FUSE_SECONDS = 35;
export const WIN_ROUNDS = 5;
const WIN_BONUS = 3250;
const LOSS_BONUS = 1900;
const KILL_BONUS = 300;

export function siteAt(x, z) {
  for (const [key, site] of Object.entries(SITES)) {
    const d = Math.hypot(x - site.center.x, z - site.center.z);
    if (d <= site.radius) return key;
  }
  return null;
}

export function createMatch(hud) {
  const match = {
    phase: 'lobby', // 'lobby' | 'buy' | 'live' | 'roundEnd' | 'matchEnd'
    round: 1,
    score: { ember: 0, azure: 0 },
    money: 800,
    grenades: 0,
    smokes: 0,
    ownedWeapon: 'sidewinder',
    buyTime: BUY_SECONDS,
    roundTime: ROUND_SECONDS,
    endTime: 0,
    planted: null, // { x, z, site, fuse }
    plantProgress: 0,
    winner: null,
    stats: { kills: 0, deaths: 0, plants: 0, defuses: 0 },
    // Per-round record, oldest first: { winner, reason }. The HUD renders it
    // as win/loss pips under the score, so the match's shape is visible.
    history: [],
  };

  function pushHud() {
    hud.setMoney(match.money);
    hud.setScore(match.score.ember, match.score.azure, match.round);
    hud.setGrenades(match.grenades);
    hud.setSmokes(match.smokes);
    hud.setHistory(match.history);
    hud.setCharge(true);
  }

  function startRound() {
    match.phase = 'buy';
    match.buyTime = BUY_SECONDS;
    match.roundTime = ROUND_SECONDS;
    match.planted = null;
    match.plantProgress = 0;
    match.endTime = 0;
    hud.setTimer(match.buyTime, 'buy');
    hud.showBuy(match.round);
    pushHud();
  }

  function deploy() {
    if (match.phase !== 'buy') return;
    match.phase = 'live';
    match.roundTime = ROUND_SECONDS;
    hud.hideOverlays();
    hud.banner(`ROUND ${match.round}`, match.round === 1 ? 'Plant the charge — or clear the Azure squad' : 'Good luck. Stay low, aim true.');
    sfx.buy();
    pushHud();
  }

  function endRound(winner, reason) {
    if (match.phase !== 'live' && match.phase !== 'buy') return;
    match.phase = 'roundEnd';
    match.endTime = 4.5;
    match.plantProgress = 0;
    match.score[winner] += 1;
    match.history.push({ winner, reason });
    const playerWon = winner === 'ember';
    match.money += playerWon ? WIN_BONUS : LOSS_BONUS;
    if (playerWon) sfx.roundWin(); else sfx.roundLose();
    const title = playerWon ? 'EMBER TAKES THE ROUND' : 'AZURE TAKES THE ROUND';
    hud.banner(title, reason, 4200);
    hud.setTimer(0, 'roundEnd');
    pushHud();
    match._pendingWinner = winner;
    match._pendingReason = reason;
  }

  function endMatch() {
    match.phase = 'matchEnd';
    match.winner = match.score.ember > match.score.azure ? 'ember' : 'azure';
    hud.setCharge(false);
    // The score screen reads like a match report, not a bare number: the
    // round-by-round shape, the player's own line, and who carried it.
    const roundsLine = match.history.length
      ? match.history.map((h, i) => `R${i + 1} ${h.winner === 'ember' ? 'W' : 'L'}`).join(' · ') + '. '
      : '';
    const best = match.stats.kills >= 5 ? 'Top fragger on the yard.' : 'A hard-fought yard.';
    hud.showOverlay('roundEnd', {
      title: match.winner === 'ember' ? 'EMBER WINS THE MATCH' : 'AZURE WINS THE MATCH',
      copy: `Final score — Ember ${match.score.ember} · Azure ${match.score.azure}. ${roundsLine}You: ${match.stats.kills} eliminations, ${match.stats.deaths} deaths, ${match.stats.plants} plant${match.stats.plants === 1 ? '' : 's'}. ${best}`,
      action: 'Play again',
    });
  }

  return {
    state: match,
    startMatch() {
      match.round = 1;
      match.score = { ember: 0, azure: 0 };
      match.money = 800;
      match.grenades = 0;
      match.smokes = 0;
      match.ownedWeapon = 'sidewinder';
      match.stats = { kills: 0, deaths: 0, plants: 0, defuses: 0 };
      match.history = [];
      match.winner = null;
      startRound();
    },
    startRound,
    deploy,
    endRound,
    endMatch,
    buy(itemId) {
      if (match.phase !== 'buy') return false;
      if (itemId === 'grenade') {
        if (match.grenades >= 2 || match.money < GRENADE.price) { sfx.denied(); return false; }
        match.money -= GRENADE.price;
        match.grenades += 1;
        sfx.buy();
        pushHud();
        return true;
      }
      if (itemId === 'smoke') {
        if (match.smokes >= 2 || match.money < SMOKE.price) { sfx.denied(); return false; }
        match.money -= SMOKE.price;
        match.smokes += 1;
        sfx.buy();
        pushHud();
        return true;
      }
      const def = WEAPONS[itemId];
      if (!def) return false;
      if (match.ownedWeapon === itemId) { sfx.buy(); return true; }
      if (match.money < def.price) { sfx.denied(); return false; }
      match.money -= def.price;
      match.ownedWeapon = itemId;
      sfx.buy();
      pushHud();
      return true;
    },
    awardKill() {
      match.money += KILL_BONUS;
      match.stats.kills += 1;
      pushHud();
    },
    onPlayerDeath() {
      match.stats.deaths += 1;
    },
    plantTick(dt, planting) {
      if (match.phase !== 'live' || match.planted) { match.plantProgress = 0; return null; }
      if (!planting) { match.plantProgress = 0; return null; }
      match.plantProgress += dt / PLANT_SECONDS;
      if (match.plantProgress >= 1) {
        match.plantProgress = 0;
        return 'planted';
      }
      return 'planting';
    },
    plantAt(x, z, site) {
      match.planted = { x, z, site, fuse: FUSE_SECONDS };
      match.stats.plants += 1;
      sfx.explosion();
      return match.planted;
    },
    onDefused(defuser) {
      if (!match.planted) return;
      match.planted = null;
      match.stats.defuses += 1;
      endRound('azure', `${defuser} defused the charge.`);
    },
    step(dt, ctx) {
      if (match.phase === 'buy') {
        match.buyTime -= dt;
        hud.setTimer(match.buyTime, 'buy');
        if (match.buyTime <= 0) deploy();
        return;
      }
      if (match.phase === 'live') {
        if (match.planted) {
          match.planted.fuse -= dt;
          hud.setTimer(match.planted.fuse, 'planted');
          if (match.planted.fuse <= 0) {
            const site = match.planted;
            match.planted = null;
            ctx.onDetonation(site);
            endRound('ember', 'The charge detonated at ' + (site.site === 'A' ? 'Furnace' : 'Crane Bay') + '.');
            return;
          }
        } else {
          match.roundTime -= dt;
          hud.setTimer(match.roundTime, 'live');
          if (match.roundTime <= 0) {
            endRound('azure', 'Time expired — nothing planted.');
            return;
          }
        }
        // Elimination decides the round only while the charge is not live.
        if (ctx.alive.azure === 0 && !match.planted) {
          endRound('ember', 'Azure squad eliminated.');
          return;
        }
        if (ctx.alive.ember === 0 && !match.planted) {
          endRound('azure', 'Ember squad eliminated.');
        }
        return;
      }
      if (match.phase === 'roundEnd') {
        match.endTime -= dt;
        if (match.endTime <= 0) {
          if (match.score.ember >= WIN_ROUNDS || match.score.azure >= WIN_ROUNDS) {
            endMatch();
          } else {
            match.round += 1;
            ctx.onNextRound(match.round);
            startRound();
          }
        }
      }
    },
    pushHud,
  };
}
