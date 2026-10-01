/*
 * hud.js — 対戦 HUD（Phase 9）
 *   ・上端の左右に「名前・蓄積ダメージ・ストック」（コタロは必殺の再使用待ちバーも小さく）
 *   ・画面中央のカウントダウン（3 → 2 → 1 → START!）
 *   ・勝敗表示（「〇〇 WIN」と「もう一度」ボタン）
 * DOM は最初に作ったものを使い回し、値が変わった時だけ書き換える（毎フレーム DOM を作らない）。
 */
(function (KG) {
  'use strict';

  class RulesHud {
    constructor(root, resultOverlay, countdownEl) {
      this.root = root;
      this.resultOverlay = resultOverlay;
      this.countdownEl = countdownEl;
      this.cards = new Map(); // entity -> { el, dmg, stocks, key, sp, spKey }
      this.cdKey = null;
      this.resultKey = null;
    }

    card(e, index) {
      let c = this.cards.get(e);
      if (c) return c;
      const el = document.createElement('div');
      el.className = 'rules-card ' + (index === 0 ? 'side-left' : 'side-right');
      el.innerHTML =
        '<span class="rc-name"></span>' +
        '<span class="rc-main"><span class="rc-dmg">0<small>%</small></span>' +
        '<span class="rc-stocks"></span></span>';
      el.querySelector('.rc-name').textContent = e.displayName;
      this.root.appendChild(el);
      c = { el, dmg: el.querySelector('.rc-dmg'), stocks: el.querySelector('.rc-stocks'), key: '', sp: null, spKey: '' };
      // 必殺技を持つキャラだけ、再使用待ちの小さなバーを付ける
      if (e.cooldownState && e.cooldownState('Special')) {
        const bar = document.createElement('span');
        bar.className = 'rc-sp';
        bar.title = '必殺（クラゲ電撃）';
        bar.innerHTML = '<i></i>';
        el.appendChild(bar);
        c.sp = bar;
      }
      this.cards.set(e, c);
      return c;
    }

    update(game) {
      const entities = game.entities;
      entities.forEach((e, index) => {
        if (!e.status) return;
        const s = e.status;
        const c = this.card(e, index);
        if (c.sp) {
          const cs = e.cooldownState('Special');
          const fill = cs.inUse ? 0 : 1 - cs.ratio;
          const spKey = fill.toFixed(2);
          if (spKey !== c.spKey) {
            c.spKey = spKey;
            c.sp.firstChild.style.transform = `scaleX(${spKey})`;
            c.sp.classList.toggle('ready', fill >= 1);
          }
        }
        const key = `${s.damage}|${s.stocks}|${s.lifeState}`;
        if (key === c.key) return; // 変化がある時だけ DOM を更新
        const damageUp = c.key && s.damage > Number(c.key.split('|')[0]);
        c.key = key;
        c.dmg.innerHTML = s.lifeState === 'alive' ? `${s.damage}<small>%</small>` : (s.lifeState === 'ko' ? 'KO' : '—');
        c.dmg.style.setProperty('--heat', Math.min(1, s.damage / 120).toFixed(3));
        if (damageUp) { c.dmg.classList.remove('bump'); void c.dmg.offsetWidth; c.dmg.classList.add('bump'); }
        const max = Number.isFinite(s.initialStocks) ? s.initialStocks : 0;
        let dots = '';
        for (let i = 0; i < max; i++) dots += `<i class="${i < s.stocks ? 'on' : ''}"></i>`;
        c.stocks.innerHTML = dots;
        c.el.classList.toggle('is-out', s.lifeState !== 'alive');
      });

      // カウントダウン（表示が切り替わった時だけアニメーションをやり直す）
      const cd = game.countdownLabel();
      const cdKey = cd ? cd.key : null;
      if (cdKey !== this.cdKey) {
        this.cdKey = cdKey;
        if (cd) {
          this.countdownEl.textContent = cd.text;
          this.countdownEl.className = cd.key === 'start' ? 'is-start' : '';
          void this.countdownEl.offsetWidth;
          this.countdownEl.classList.add('play');
          this.countdownEl.hidden = false;
        } else {
          this.countdownEl.hidden = true;
        }
      }

      // 勝敗表示
      const show = game.phase === 'result';
      const rKey = show ? game.result : null;
      if (rKey !== this.resultKey) {
        this.resultKey = rKey;
        this.resultOverlay.hidden = !show;
        if (show) {
          this.resultOverlay.querySelector('.ko-title').textContent = game.result;
          this.resultOverlay.classList.toggle('player-won', game.winner === game.player);
        }
      }
    }
  }

  KG.RulesHud = RulesHud;
})(window.KG = window.KG || {});
