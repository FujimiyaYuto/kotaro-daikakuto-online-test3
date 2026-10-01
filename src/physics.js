/*
 * physics.js — 地形との衝突処理（AABB）
 *
 * body は { x, y, vx, vy, w, h } を持つ物体。x は中心、y は足元（下端）。
 * 足場の種類:
 *   solid  … 四方から当たる地面（横からも壁としてぶつかる）
 *   oneway … 下からすり抜けて上に乗れる足場（プラットフォーム型対戦の定番）
 * 移動は X → Y の順に分けて解決し、すり抜けを防ぎます。
 */
(function (KG) {
  'use strict';

  function overlaps(body, p) {
    const left = body.x - body.w / 2;
    const right = body.x + body.w / 2;
    const top = body.y - body.h;
    const bottom = body.y;
    return left < p.x + p.w && right > p.x && top < p.y + p.h && bottom > p.y;
  }

  function horizontalOverlap(body, p) {
    return body.x + body.w / 2 > p.x && body.x - body.w / 2 < p.x + p.w;
  }

  KG.Physics = {
    moveAndCollide(body, stage, dt) {
      const result = { landed: false, ground: null, hitWall: 0, hitCeiling: false };
      const prevBottom = body.y;

      // ---- X ----
      body.x += body.vx * dt;
      for (const p of stage.solids) {
        if (!overlaps(body, p)) continue;
        if (body.vx > 0) {
          body.x = p.x - body.w / 2;
          result.hitWall = 1;
        } else if (body.vx < 0) {
          body.x = p.x + p.w + body.w / 2;
          result.hitWall = -1;
        } else {
          // 速度0で重なっている場合（出現位置など）は近い側へ押し出す
          const toLeft = (body.x + body.w / 2) - p.x;
          const toRight = (p.x + p.w) - (body.x - body.w / 2);
          body.x += toLeft < toRight ? -toLeft : toRight;
        }
        body.vx = 0;
      }

      // ---- Y ----
      body.y += body.vy * dt;
      for (const p of stage.solids) {
        if (!overlaps(body, p)) continue;
        if (body.vy >= 0) {
          body.y = p.y;
          body.vy = 0;
          result.landed = true;
          result.ground = p;
        } else {
          body.y = p.y + p.h + body.h;
          body.vy = 0;
          result.hitCeiling = true;
        }
      }
      if (body.vy >= 0 && !result.landed) {
        for (const p of stage.oneways) {
          // 前フレームで足元が足場の上面より上にあり、今フレームで上面を越えた時だけ着地
          if (prevBottom <= p.y + 0.01 && body.y >= p.y && horizontalOverlap(body, p)) {
            body.y = p.y;
            body.vy = 0;
            result.landed = true;
            result.ground = p;
            break;
          }
        }
      }
      return result;
    },
  };
})(window.KG = window.KG || {});
