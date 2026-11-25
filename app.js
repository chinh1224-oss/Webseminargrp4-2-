/* ==========================================================================
   Sổ Phân liều — app.js
   Bốn module BED / tái sinh / chuyển đổi phác đồ / bù gián đoạn,
   cộng bảng đối chiếu, xuất CSV và chế độ in.
   Toàn bộ chạy trong trình duyệt, không cần máy chủ.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------- tiện ích */

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function readNum(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    const v = parseFloat(String(el.value).replace(',', '.'));
    return Number.isFinite(v) ? v : fallback;
  }

  const fmt = (v, dec = 2) => (Number.isFinite(v) ? (Math.abs(v) < 0.5 * Math.pow(10, -dec) ? 0 : v).toFixed(dec) : '—');
  const signed = (v, dec = 1) => (v >= 0 ? '+' : '\u2212') + Math.abs(v).toFixed(dec);
  const minus = (v, dec = 1) => (v < 0 ? '\u2212' : '') + Math.abs(v).toFixed(dec);
  const signedPct = (v, dec = 1) =>
    Math.abs(v) < 0.5 * Math.pow(10, -dec) ? `${(0).toFixed(dec)}%` : `${signed(v, dec)}%`;
  const fmtN = (n) => (Number.isInteger(n) ? String(n) : fmt(n, 1));

  const bed = (n, d, ab) => (n > 0 && d > 0 && ab > 0 ? n * d * (1 + d / ab) : 0);
  const eqd2 = (b, ab) => (ab > 0 ? b / (1 + 2 / ab) : 0);
  const solveD = (target, n, ab) => {
    if (!(target > 0) || !(n > 0) || !(ab > 0)) return 0;
    return (-ab + Math.sqrt(Math.max(0, ab * ab + (4 * ab * target) / n))) / 2;
  };

  const toastEl = $('toast');
  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2600);
  }

  /* ---------------------------------------------------------------- màu vẽ */

  const C = {
    grid: '#DDE4D9',
    axis: '#5A685F',
    ink: '#17231E',
    magenta: '#A3215B',
    petrol: '#1D5B54',
    ochre: '#8A5A0F',
    sheet: '#FCFDF8',
    paper: '#F0F2EA'
  };
  const SANS = '"Be Vietnam Pro", "Segoe UI", sans-serif';

  function surface(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 280;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function hatchPattern(ctx, color) {
    const tile = document.createElement('canvas');
    tile.width = 7;
    tile.height = 7;
    const t = tile.getContext('2d');
    t.strokeStyle = color;
    t.lineWidth = 1;
    t.beginPath();
    t.moveTo(-1, 8);
    t.lineTo(8, -1);
    t.stroke();
    return ctx.createPattern(tile, 'repeat');
  }

  function frame(ctx, w, h, pad, xMin, xMax, yMin, yMax, opts) {
    const cw = w - pad.l - pad.r;
    const ch = h - pad.t - pad.b;
    const sx = (v) => pad.l + ((v - xMin) / (xMax - xMin || 1)) * cw;
    const sy = (v) => pad.t + ch - ((v - yMin) / (yMax - yMin || 1)) * ch;

    ctx.font = `10.5px ${SANS}`;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
      const v = yMin + ((yMax - yMin) * i) / 4;
      const y = Math.round(sy(v)) + 0.5;
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillStyle = C.axis;
      ctx.fillText(opts.yFmt ? opts.yFmt(v) : v.toFixed(0), pad.l - 8, y);
    }

    const xTicks = opts.xTicks || 5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= xTicks; i++) {
      const v = xMin + ((xMax - xMin) * i) / xTicks;
      const x = clamp(sx(v), pad.l, w - pad.r);
      ctx.fillStyle = C.axis;
      ctx.fillText(opts.xFmt ? opts.xFmt(v) : v.toFixed(0), x, h - pad.b + 8);
    }

    ctx.strokeStyle = '#B9C6B9';
    ctx.beginPath();
    ctx.moveTo(pad.l, Math.round(sy(yMin)) + 0.5);
    ctx.lineTo(w - pad.r, Math.round(sy(yMin)) + 0.5);
    ctx.stroke();

    return { sx, sy, cw, ch };
  }

  function legend(ctx, xRight, items) {
    ctx.font = `11px ${SANS}`;
    ctx.textBaseline = 'middle';
    const gap = 16;
    const widths = items.map((it) => ctx.measureText(it.label).width + 18);
    let x = xRight - widths.reduce((a, b) => a + b, 0) - gap * (items.length - 1);
    items.forEach((it, i) => {
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(it.dash || []);
      ctx.beginPath();
      ctx.moveTo(x, it.y);
      ctx.lineTo(x + 12, it.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.axis;
      ctx.textAlign = 'left';
      ctx.fillText(it.label, x + 16, it.y);
      x += widths[i] + gap;
    });
  }

  function dot(ctx, x, y, color, r = 4) {
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = C.sheet;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /* -------------------------------------------------------------- module 1 */

  const m1Presets = {
    prostate_conv: { n: 39, d: 2.0, abt: 1.5, abn: 3.0, alpha: 0.15 },
    prostate_chhip: { n: 20, d: 3.0, abt: 1.5, abn: 3.0, alpha: 0.15 },
    prostate_paceb: { n: 5, d: 7.25, abt: 1.5, abn: 3.0, alpha: 0.15 },
    breast_startb: { n: 15, d: 2.67, abt: 3.5, abn: 3.0, alpha: 0.25 },
    breast_fast: { n: 5, d: 5.2, abt: 3.5, abn: 3.0, alpha: 0.25 },
    lung_sbrt: { n: 3, d: 18.0, abt: 10.0, abn: 3.0, alpha: 0.30 }
  };

  let m1Mode = 'survival';
  let m1State = null;

  function guardrail(id, d, extra) {
    const el = $(id);
    if (!el) return;
    const msgs = [];
    if (d > 10) {
      msgs.push(
        `Liều mỗi lần ${fmt(d)} Gy vượt phạm vi hiệu lực của mô hình LQ. Ở mức này LQ đánh giá quá cao hiệu quả diệt tế bào; cần đối chiếu mô hình USC hoặc LQL và tuân thủ AAPM TG-101.`
      );
    } else if (d > 8) {
      msgs.push(
        `Liều mỗi lần ${fmt(d)} Gy đã vào vùng cần thận trọng của mô hình LQ (trên 8 Gy). Kiểm tra lại chỉ định và quy trình IGRT trước khi dùng kết quả.`
      );
    }
    if (extra) msgs.push(extra);
    el.textContent = msgs.join(' ');
    el.classList.toggle('hidden', msgs.length === 0);
  }

  function updateM1() {
    const n = Math.max(1, readNum('m1-n', 20));
    const d = Math.max(0.1, readNum('m1-d', 3));
    const abt = Math.max(0.3, readNum('m1-ab-tumor', 1.5));
    const abn = Math.max(0.3, readNum('m1-ab-normal', 3));
    const alpha = Math.max(0.01, readNum('m1-alpha', 0.15));
    const unc = Math.max(0, readNum('m1-uncert', 0.5));

    const D = n * d;
    const bT = bed(n, d, abt);
    const bN = bed(n, d, abn);
    const eT = eqd2(bT, abt);
    const eN = eqd2(bN, abn);
    const ratio = bN > 0 ? bT / bN : 0;

    const lo = Math.max(0.2, abt - unc);
    const hi = abt + unc;
    const bTlo = bed(n, d, lo);
    const bThi = bed(n, d, hi);

    const nLo = Math.max(0.2, abn - unc);
    const nHi = abn + unc;
    const bNlo = bed(n, d, nLo);
    const bNhi = bed(n, d, nHi);

    const lnS = -(alpha * D + (alpha / abt) * d * D);
    const nEq = bT / (2 * (1 + 2 / abt));
    const Deq = nEq * 2;

    m1State = { n, d, abt, abn, alpha, unc, D, bT, bN, eT, eN, ratio, nEq, Deq, lnS };

    $('m1-D').innerHTML = `${fmt(D)} <i>Gy</i>`;
    $('m1-D-sub').textContent = `${fmtN(n)} lần × ${fmt(d)} Gy`;
    $('m1-bedT').innerHTML = `${fmt(bT)} <i>Gy</i>`;
    $('m1-bedT-sub').textContent =
      unc > 0
        ? `EQD2 ${fmt(eT)} Gy. Với α/β lệch ±${fmt(unc, 1)} Gy: ${fmt(bThi, 1)} – ${fmt(bTlo, 1)} Gy.`
        : `EQD2 ${fmt(eT)} Gy`;
    $('m1-bedN').innerHTML = `${fmt(bN)} <i>Gy</i>`;
    $('m1-bedN-sub').textContent =
      unc > 0
        ? `EQD2 ${fmt(eN)} Gy. Với α/β lệch ±${fmt(unc, 1)} Gy: ${fmt(bNhi, 1)} – ${fmt(bNlo, 1)} Gy.`
        : `EQD2 ${fmt(eN)} Gy`;
    $('m1-ratio').textContent = fmt(ratio);
    $('m1-ratio-sub').textContent = `ln S mô bướu = ${minus(lnS, 1)}`;

    guardrail('m1-guardrail', d);

    /* dải phân liều */
    const maxD = Math.max(D, Deq);
    setStrip($('m1-strip-a'), n, d, maxD, 'tumor');
    setStrip($('m1-strip-b'), nEq, 2, maxD, 'normal');
    $('m1-strip-a-spec').textContent = `${fmtN(n)} × ${fmt(d, d % 1 ? 2 : 1)} Gy, tổng ${fmt(D, 1)} Gy`;
    $('m1-strip-a-num').textContent = `BED ${fmt(bT, 1)} Gy`;
    $('m1-strip-b-spec').textContent = `${fmt(nEq, 1)} × 2 Gy, tổng ${fmt(Deq, 1)} Gy`;
    $('m1-strip-b-num').textContent = `BED ${fmt(bT, 1)} Gy`;

    const dd = Deq - D;
    $('m1-strip-note').textContent =
      Math.abs(dd) < 0.05
        ? `Phác đồ đang xét đã chia 2 Gy mỗi lần, nên hai thanh trùng nhau.`
        : `Muốn đạt đúng BED mô bướu ${fmt(bT, 1)} Gy bằng cách chia 2 Gy mỗi lần, phải chiếu ${fmt(Deq, 1)} Gy, ${
            dd > 0 ? 'nhiều hơn' : 'ít hơn'
          } ${fmt(Math.abs(dd), 1)} Gy so với phác đồ đang xét. Phần chênh lệch đó là lợi thế sinh học của việc tăng liều mỗi lần. Độ dài thanh biểu diễn tổng liều vật lý, số bên phải là BED.`;

    /* đọc kết quả */
    if (abt < abn && d > 2) {
      $('m1-note').textContent = `Mô bướu nhạy hơn với liều cao (α/β ${fmt(abt, 1)} Gy, thấp hơn ${fmt(
        abn,
        1
      )} Gy của mô lành), nên tăng liều mỗi lần đẩy BED bướu lên nhanh hơn BED mô lành. Tỷ số bướu trên lành đạt ${fmt(
        ratio
      )}.`;
    } else if (abt > abn) {
      $('m1-note').textContent = `Mô bướu có α/β cao hơn mô lành (${fmt(abt, 1)} so với ${fmt(
        abn,
        1
      )} Gy), nên tăng liều mỗi lần không có lợi thế chọn lọc: BED mô lành tăng nhanh hơn. Tỷ số bướu trên lành chỉ ${fmt(
        ratio
      )}.`;
    } else {
      $('m1-note').textContent = `Phác đồ ${fmtN(n)} lần × ${fmt(d)} Gy cho BED mô bướu ${fmt(
        bT
      )} Gy và BED mô lành muộn ${fmt(bN)} Gy, tương đương EQD2 ${fmt(eT)} Gy và ${fmt(eN)} Gy.`;
    }

    if (m1Mode === 'survival') {
      $('m1-chart-title').textContent = 'Đường cong sống sót tế bào';
      $('m1-chart-cap').textContent = `Dựng từ S = exp(−αD − βdD), với β = α/(α/β). Nét đứt là phác đồ 2 Gy mỗi lần, chấm tròn là tổng liều hiện tại.`;
      drawSurvival(m1State);
    } else {
      $('m1-chart-title').textContent = 'BED theo liều mỗi lần';
      $('m1-chart-cap').textContent = `Giữ nguyên tổng liều ${fmt(
        D,
        1
      )} Gy và thay đổi cách chia. Dải màu là khoảng bất định ±${fmt(unc, 1)} Gy của α/β mô bướu.`;
      drawBedVsD(m1State);
    }
  }

  function drawSurvival(s) {
    const cv = $('m1-chart');
    const { ctx, w, h } = surface(cv);
    const pad = { l: 46, r: 16, t: 34, b: 34 };

    const Dmax = Math.ceil(Math.max(s.D * 1.2, 8) / 10) * 10;
    const beta = s.alpha / s.abt;
    const cur = (D) => -(s.alpha * D + beta * s.d * D);
    const std = (D) => -(s.alpha * D + beta * 2 * D);
    const yMin = Math.min(-1, Math.min(cur(Dmax), std(Dmax)) * 1.02);

    const { sx, sy } = frame(ctx, w, h, pad, 0, Dmax, yMin, 0, {
      xTicks: 5,
      yFmt: (v) => v.toFixed(Math.abs(yMin) < 12 ? 1 : 0)
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b);
    ctx.clip();

    const curve = (fn, color, dash, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      for (let i = 0; i <= 80; i++) {
        const D = (Dmax * i) / 80;
        const y = sy(fn(D));
        if (i === 0) ctx.moveTo(sx(D), y);
        else ctx.lineTo(sx(D), y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    curve(std, C.petrol, [5, 4], 1.8);
    curve(cur, C.magenta, [], 2.3);
    ctx.restore();

    dot(ctx, sx(s.D), sy(cur(s.D)), C.magenta, 4);

    ctx.fillStyle = C.axis;
    ctx.font = `10.5px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('ln S', pad.l - 38, pad.t - 10);

    legend(ctx, w - pad.r, [
      { label: `Hiện tại, d = ${fmt(s.d, 1)} Gy`, color: C.magenta, y: 14 },
      { label: 'Chuẩn 2 Gy', color: C.petrol, dash: [4, 3], y: 30 }
    ]);

    cv.setAttribute(
      'aria-label',
      `Đường cong ln S theo tổng liều từ 0 tới ${Math.round(Dmax)} Gy. Phác đồ hiện tại ${fmtN(
        s.n
      )} lần × ${fmt(s.d, 1)} Gy có ln S = ${fmt(s.lnS, 1)}.`
    );
  }

  function drawBedVsD(s) {
    const cv = $('m1-chart');
    const { ctx, w, h } = surface(cv);
    const pad = { l: 46, r: 16, t: 34, b: 34 };

    const dMax = Math.ceil(Math.max(8, s.d * 1.4) * 2) / 2;
    const dMin = 0.5;
    const abLo = Math.max(0.2, s.abt - s.unc);
    const abHi = s.abt + s.unc;
    const yMax = Math.ceil((s.D * (1 + dMax / abLo) * 1.06) / 10) * 10;

    const { sx, sy } = frame(ctx, w, h, pad, dMin, dMax, 0, yMax, {
      xTicks: 5,
      xFmt: (v) => v.toFixed(1)
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b);
    ctx.clip();

    if (s.unc > 0) {
      ctx.fillStyle = 'rgba(163, 33, 91, 0.12)';
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const d = dMin + ((dMax - dMin) * i) / 40;
        const y = sy(s.D * (1 + d / abHi));
        if (i === 0) ctx.moveTo(sx(d), y);
        else ctx.lineTo(sx(d), y);
      }
      for (let i = 40; i >= 0; i--) {
        const d = dMin + ((dMax - dMin) * i) / 40;
        ctx.lineTo(sx(d), sy(s.D * (1 + d / abLo)));
      }
      ctx.closePath();
      ctx.fill();
    }

    const line = (ab, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(sx(dMin), sy(s.D * (1 + dMin / ab)));
      ctx.lineTo(sx(dMax), sy(s.D * (1 + dMax / ab)));
      ctx.stroke();
    };

    line(s.abt, C.magenta);
    line(s.abn, C.petrol);

    if (s.d >= dMin && s.d <= dMax) {
      ctx.strokeStyle = C.ochre;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(sx(s.d), pad.t);
      ctx.lineTo(sx(s.d), h - pad.b);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    if (s.d >= dMin && s.d <= dMax) {
      dot(ctx, sx(s.d), sy(s.bT), C.magenta, 3.5);
      dot(ctx, sx(s.d), sy(s.bN), C.petrol, 3.5);
    }

    ctx.fillStyle = C.axis;
    ctx.font = `10.5px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('BED, Gy', pad.l - 40, pad.t - 10);

    legend(ctx, w - pad.r, [
      { label: 'Mô bướu, ±Δα/β', color: C.magenta, y: 14 },
      { label: 'Mô lành muộn', color: C.petrol, y: 30 }
    ]);

    cv.setAttribute(
      'aria-label',
      `BED theo liều mỗi lần từ ${dMin} tới ${dMax} Gy, giữ tổng liều ${fmt(s.D, 1)} Gy. Dải magenta là khoảng bất định của α/β mô bướu.`
    );
  }

  /* -------------------------------------------------------------- module 2 */

  const m2Presets = {
    hnscc_conv: { n: 35, d: 2.0, T: 47, Tk: 21, abt: 10, abn: 3, alpha: 0.30, tpot: 4.0 },
    hnscc_prolong: { n: 35, d: 2.0, T: 60, Tk: 21, abt: 10, abn: 3, alpha: 0.30, tpot: 4.0 },
    lung_hypo: { n: 20, d: 3.0, T: 26, Tk: 21, abt: 10, abn: 3, alpha: 0.30, tpot: 4.5 },
    lung_sbrt: { n: 3, d: 18.0, T: 8, Tk: 21, abt: 10, abn: 3, alpha: 0.30, tpot: 4.5 }
  };

  let m2State = null;

  function updateM2() {
    const n = Math.max(1, readNum('m2-n', 35));
    const d = Math.max(0.1, readNum('m2-d', 2));
    const T = Math.max(1, readNum('m2-T', 47));
    const Tk = Math.max(0, readNum('m2-Tk', 21));
    const abt = Math.max(0.3, readNum('m2-ab-tumor', 10));
    const abn = Math.max(0.3, readNum('m2-ab-normal', 3));
    const alpha = Math.max(0.01, readNum('m2-alpha', 0.3));
    const tpot = Math.max(0.1, readNum('m2-tpot', 4));

    const K = Math.LN2 / (alpha * tpot);
    const over = Math.max(0, T - Tk);
    const loss = K * over;
    const gross = bed(n, d, abt);
    const net = Math.max(0, gross - loss);
    const eNet = eqd2(net, abt);
    const bN = bed(n, d, abn);
    const eN = eqd2(bN, abn);
    const pct = gross > 0 ? (loss / gross) * 100 : 0;
    const lossEqd2 = eqd2(loss, abt);

    m2State = { n, d, T, Tk, abt, abn, alpha, tpot, K, over, loss, gross, net, eNet, bN, eN, pct };

    $('m2-K').innerHTML = `${fmt(K, 3)} <i>Gy/ngày</i>`;
    $('m2-K-sub').textContent = `α ${fmt(alpha, 2)} 1/Gy, Tpot ${fmt(tpot, 1)} ngày`;
    $('m2-loss').innerHTML = `${fmt(loss)} <i>Gy</i>`;
    $('m2-loss-sub').textContent =
      over > 0 ? `${fmt(pct, 1)}% BED thô, tương đương ${fmt(lossEqd2, 1)} Gy EQD2` : 'Chưa vượt Tk, chưa mất BED';
    $('m2-bedT').innerHTML = `${fmt(net)} <i>Gy</i>`;
    $('m2-bedT-sub').textContent = `BED thô ${fmt(gross)} Gy, EQD2 ${fmt(eNet)} Gy`;
    $('m2-bedN').innerHTML = `${fmt(bN)} <i>Gy</i>`;
    $('m2-bedN-sub').textContent = `EQD2 ${fmt(eN)} Gy, không trừ tái sinh`;

    guardrail('m2-guardrail', d);

    $('m2-note').textContent =
      over === 0
        ? `Thời gian điều trị ${fmt(T, 0)} ngày không vượt quá Tk (${fmt(
            Tk,
            0
          )} ngày), nên chưa có tái sinh bù. BED mô bướu giữ ở ${fmt(gross)} Gy.`
        : `Từ ngày ${fmt(Tk, 0)} tới ngày ${fmt(T, 0)}, mô bướu tăng sinh bù lại ${fmt(
            loss
          )} Gy BED. BED hiệu dụng còn ${fmt(net)} Gy, thấp hơn ${fmt(pct, 1)}% so với BED thô ${fmt(gross)} Gy.`;

    $('m2-chart-cap').textContent = `Đường liền là BED hiệu dụng; đường đứt là BED thô tính từ phác đồ. Vùng gạch chéo là phần BED mất do tái sinh từ ngày thứ ${fmt(
      Tk,
      0
    )}.`;

    drawRepop(m2State);
  }

  function drawRepop(s) {
    const cv = $('m2-chart');
    const { ctx, w, h } = surface(cv);
    const pad = { l: 46, r: 16, t: 34, b: 34 };

    const Tmax = Math.ceil(Math.max(s.T * 1.25, s.Tk + 20, 40) / 5) * 5;
    const yMax = Math.max(10, Math.ceil((s.gross * 1.12) / 10) * 10);
    const { sx, sy } = frame(ctx, w, h, pad, 0, Tmax, 0, yMax, { xTicks: 5 });
    const netAt = (t) => Math.max(0, s.gross - s.K * Math.max(0, t - s.Tk));

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b);
    ctx.clip();

    if (s.Tk < Tmax) {
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const t = s.Tk + ((Tmax - s.Tk) * i) / 40;
        const y = sy(s.gross);
        if (i === 0) ctx.moveTo(sx(t), y);
        else ctx.lineTo(sx(t), y);
      }
      for (let i = 40; i >= 0; i--) {
        const t = s.Tk + ((Tmax - s.Tk) * i) / 40;
        ctx.lineTo(sx(t), sy(netAt(t)));
      }
      ctx.closePath();
      ctx.fillStyle = hatchPattern(ctx, 'rgba(138, 90, 15, 0.32)');
      ctx.fill();
    }

    ctx.strokeStyle = C.petrol;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, sy(s.gross));
    ctx.lineTo(w - pad.r, sy(s.gross));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = C.magenta;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const t = (Tmax * i) / 80;
      const y = sy(netAt(t));
      if (i === 0) ctx.moveTo(sx(t), y);
      else ctx.lineTo(sx(t), y);
    }
    ctx.stroke();

    if (s.Tk <= Tmax) {
      ctx.strokeStyle = C.ochre;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(sx(s.Tk), pad.t);
      ctx.lineTo(sx(s.Tk), h - pad.b);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    if (s.Tk <= Tmax) {
      ctx.fillStyle = C.ochre;
      ctx.font = `10.5px ${SANS}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`Tk = ${fmt(s.Tk, 0)} ngày`, clamp(sx(s.Tk) + 6, pad.l, w - pad.r - 62), pad.t + 2);
    }

    if (s.T <= Tmax) dot(ctx, sx(s.T), sy(netAt(s.T)), C.magenta, 4);

    ctx.fillStyle = C.axis;
    ctx.font = `10.5px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('BED, Gy', pad.l - 40, pad.t - 10);

    legend(ctx, w - pad.r, [
      { label: 'BED hiệu dụng', color: C.magenta, y: 14 },
      { label: 'BED thô', color: C.petrol, dash: [5, 4], y: 30 }
    ]);

    cv.setAttribute(
      'aria-label',
      `BED hiệu dụng giảm từ ${fmt(s.gross, 1)} Gy xuống ${fmt(s.net, 1)} Gy khi thời gian điều trị kéo dài tới ${fmt(
        s.T,
        0
      )} ngày.`
    );
  }

  /* -------------------------------------------------------------- module 3 */

  const m3Presets = {
    prostate_20: { n1: 39, d1: 2.0, abt: 1.5, abn: 3.0, match: 'tumor', mode: 'given_n2', n2: 20 },
    breast_15: { n1: 25, d1: 2.0, abt: 3.5, abn: 3.0, match: 'tumor', mode: 'given_n2', n2: 15 },
    brain_5: { n1: 10, d1: 3.0, abt: 10.0, abn: 3.0, match: 'tumor', mode: 'given_n2', n2: 5 }
  };

  let m3State = null;

  function toggleM3() {
    const mode = $('m3-mode').value;
    $('m3-n2-field').classList.toggle('hidden', mode !== 'given_n2');
    $('m3-d2-field').classList.toggle('hidden', mode !== 'given_d2');
    $('m3-repop-fields').classList.toggle('hidden', !$('m3-repop').checked);
  }

  function updateM3() {
    const n1 = Math.max(1, readNum('m3-n1', 39));
    const d1 = Math.max(0.1, readNum('m3-d1', 2));
    const abt = Math.max(0.3, readNum('m3-ab-tumor', 1.5));
    const abn = Math.max(0.3, readNum('m3-ab-normal', 3));
    const match = $('m3-match').value;
    const mode = $('m3-mode').value;
    const useRepop = $('m3-repop').checked;
    const T1 = readNum('m3-T1', 53);
    const T2 = readNum('m3-T2', 26);
    const Tk = readNum('m3-Tk', 21);
    const K = Math.max(0, readNum('m3-K', 0.6));

    const loss1 = useRepop ? K * Math.max(0, T1 - Tk) : 0;
    const loss2 = useRepop ? K * Math.max(0, T2 - Tk) : 0;

    const D1 = n1 * d1;
    const bT1 = Math.max(0, bed(n1, d1, abt) - loss1);
    const bN1 = bed(n1, d1, abn);

    let n2 = Math.max(0.1, readNum('m3-n2', 20));
    let d2 = Math.max(0.1, readNum('m3-d2', 3));
    const target = match === 'tumor' ? bT1 + loss2 : bN1;
    const ab = match === 'tumor' ? abt : abn;

    if (mode === 'given_n2') {
      d2 = solveD(target, n2, ab);
    } else {
      const perFx = d2 * (1 + d2 / ab);
      n2 = perFx > 0 ? target / perFx : 0;
    }

    const D2 = n2 * d2;
    const bT2 = Math.max(0, bed(n2, d2, abt) - loss2);
    const bN2 = bed(n2, d2, abn);
    const pctD = D1 > 0 ? ((D2 - D1) / D1) * 100 : 0;
    const pctT = bT1 > 0 ? ((bT2 - bT1) / bT1) * 100 : 0;
    const pctN = bN1 > 0 ? ((bN2 - bN1) / bN1) * 100 : 0;

    m3State = { n1, d1, D1, bT1, bN1, n2, d2, D2, bT2, bN2, abt, abn, T: useRepop ? T2 : null };

    $('m3-new').innerHTML = `${fmtN(n2)} × ${fmt(d2)} <i>Gy</i>`;
    $('m3-new-sub').textContent = `Tổng liều ${fmt(D2)} Gy, gốc ${fmt(D1)} Gy`;
    $('m3-diff').textContent = `${signedPct(pctD)}`;
    $('m3-diff-sub').textContent = `${fmt(D1)} Gy → ${fmt(D2)} Gy`;
    $('m3-bedT').innerHTML = `${fmt(bT1, 1)} → ${fmt(bT2, 1)} <i>Gy</i>`;
    $('m3-bedT-sub').textContent = `${signedPct(pctT)} so với phác đồ gốc`;
    $('m3-bedN').innerHTML = `${fmt(bN1, 1)} → ${fmt(bN2, 1)} <i>Gy</i>`;
    $('m3-bedN-sub').textContent = `${signedPct(pctN)} so với phác đồ gốc`;

    guardrail('m3-guardrail', d2);

    /* dải phân liều */
    const maxD = Math.max(D1, D2, 1);
    setStrip($('m3-strip-a'), n1, d1, maxD, 'normal');
    setStrip($('m3-strip-b'), n2, d2, maxD, 'tumor');
    $('m3-strip-a-spec').textContent = `${fmtN(n1)} × ${fmt(d1, 2)} Gy, ${fmt(D1, 1)} Gy`;
    $('m3-strip-a-num').textContent = `${fmt(D1, 1)} Gy`;
    $('m3-strip-b-spec').textContent = `${fmtN(n2)} × ${fmt(d2, 2)} Gy, ${fmt(D2, 1)} Gy`;
    $('m3-strip-b-num').textContent = `${fmt(D2, 1)} Gy`;

    /* thanh BED */
    const maxBed = Math.max(bT1, bT2, bN1, bN2, 1);
    const setBar = (id, idV, v) => {
      $(id).style.width = `${clamp((v / maxBed) * 100, 0, 100)}%`;
      $(idV).textContent = fmt(v, 1);
    };
    setBar('m3-bar-tumor-old', 'm3-bar-tumor-old-v', bT1);
    setBar('m3-bar-tumor-new', 'm3-bar-tumor-new-v', bT2);
    setBar('m3-bar-normal-old', 'm3-bar-normal-old-v', bN1);
    setBar('m3-bar-normal-new', 'm3-bar-normal-new-v', bN2);

    /* bảng */
    const rows = [
      ['Số lần chiếu', fmtN(n1), fmtN(n2), fmt(n2 - n1, 1)],
      ['Liều mỗi lần', `${fmt(d1)} Gy`, `${fmt(d2)} Gy`, `${fmt(d2 - d1)} Gy`],
      ['Tổng liều', `${fmt(D1)} Gy`, `${fmt(D2)} Gy`, `${signedPct(pctD)}`],
      ['BED mô bướu', `${fmt(bT1)} Gy`, `${fmt(bT2)} Gy`, `${signedPct(pctT)}`],
      ['BED mô lành muộn', `${fmt(bN1)} Gy`, `${fmt(bN2)} Gy`, `${signedPct(pctN)}`]
    ];
    $('m3-table').innerHTML = rows
      .map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`)
      .join('');

    $('m3-note').textContent =
      match === 'tumor'
        ? `Giữ BED mô bướu ở ${fmt(bT1, 1)} Gy. Phác đồ mới làm BED mô lành muộn ${
            pctN >= 0 ? 'tăng' : 'giảm'
          } ${fmt(Math.abs(pctN), 1)}%, tức ${pctN >= 0 ? 'bất lợi hơn' : 'an toàn hơn'} cho mô lành.`
        : `Giữ BED mô lành ở ${fmt(bN1, 1)} Gy để bảo vệ cơ quan nguy cấp. Khi đó BED mô bướu ${
            pctT >= 0 ? 'tăng' : 'giảm'
          } ${fmt(Math.abs(pctT), 1)}%.`;
  }

  /* -------------------------------------------------------------- module 4 */

  const m4Presets = {
    hnscc_gap7: { nplan: 35, dplan: 2.0, ndone: 15, gap: 7, Tplan: 47, Tk: 21, abt: 10, abn: 3, K: 0.6 },
    pelvis_gap5: { nplan: 25, dplan: 2.0, ndone: 10, gap: 5, Tplan: 33, Tk: 21, abt: 10, abn: 3, K: 0.5 },
    hypo_gap4: { nplan: 20, dplan: 3.0, ndone: 10, gap: 4, Tplan: 26, Tk: 21, abt: 10, abn: 3, K: 0.6 }
  };

  function updateM4() {
    const nplan = Math.max(2, readNum('m4-nplan', 35));
    const dplan = Math.max(0.1, readNum('m4-dplan', 2));
    const ndone = clamp(readNum('m4-ndone', 15), 0, nplan - 1);
    const gap = Math.max(0, readNum('m4-gap', 7));
    const Tplan = Math.max(1, readNum('m4-Tplan', 47));
    const Tk = Math.max(0, readNum('m4-Tk', 21));
    const abt = Math.max(0.3, readNum('m4-ab-tumor', 10));
    const abn = Math.max(0.3, readNum('m4-ab-normal', 3));
    const K = Math.max(0, readNum('m4-K', 0.6));

    const nrem = Math.max(1, nplan - ndone);
    const Tnew = Tplan + gap;
    const bDone = bed(ndone, dplan, abt);
    const bPlanN = bed(nplan, dplan, abn);
    const extraLoss = Math.max(0, K * Math.max(0, Tnew - Tk) - K * Math.max(0, Tplan - Tk));

    $('m4-nrem').innerHTML = `${fmt(nrem, 0)} <i>lần</i>`;
    $('m4-nrem-sub').textContent = `Đã tích lũy ${fmt(bDone)} Gy BED mô bướu`;
    $('m4-loss').innerHTML = `${fmt(extraLoss)} <i>Gy</i>`;
    $('m4-loss-sub').textContent = `Thời gian điều trị ${fmt(Tplan, 0)} → ${fmt(Tnew, 0)} ngày`;

    /* timeline */
    const maxT = Math.max(Tplan, Tnew, 1);
    const gapStart = clamp((Tplan * ndone) / nplan, 0, Tplan);
    $('m4-tl-plan').style.width = `${(Tplan / maxT) * 100}%`;
    $('m4-tl-plan').style.left = '0';
    $('m4-tl-plan-num').textContent = `${fmt(Tplan, 0)} ngày`;
    $('m4-tl-real-a').style.left = '0';
    $('m4-tl-real-a').style.width = `${(gapStart / maxT) * 100}%`;
    $('m4-tl-gap').style.left = `${(gapStart / maxT) * 100}%`;
    $('m4-tl-gap').style.width = `${(gap / maxT) * 100}%`;
    $('m4-tl-real-b').style.left = `${((gapStart + gap) / maxT) * 100}%`;
    $('m4-tl-real-b').style.width = `${(Math.max(0, Tnew - gapStart - gap) / maxT) * 100}%`;
    $('m4-tl-real-num').textContent = `${fmt(Tnew, 0)} ngày`;
    $('m4-timeline-note').textContent =
      gap > 0
        ? `Vị trí gián đoạn đặt sau ${fmt(ndone, 0)} lần chiếu, khoảng ngày thứ ${fmt(gapStart, 0)} của kế hoạch. Phần gạch chéo là ${fmt(
            gap,
            0
          )} ngày nghỉ.`
        : `Không có ngày nghỉ, hai thanh trùng nhau.`;

    guardrail('m4-guardrail', dplan);

    /* ba phương án */
    const bidDays = Math.min(gap, Math.floor(nrem / 2));
    const dNew = solveD(bed(nrem, dplan, abt) + extraLoss, nrem, abt);
    const bN2 = bed(ndone, dplan, abn) + bed(nrem, dNew, abn);
    const pct2 = bPlanN > 0 ? ((bN2 - bPlanN) / bPlanN) * 100 : 0;

    const gainPerFx = bed(1, dplan, abt) - K * 1.4;
    const nExtra = extraLoss > 0 && gainPerFx > 0 ? Math.ceil(extraLoss / gainPerFx) : 0;
    const bN3 = bed(nplan + nExtra, dplan, abn);
    const pct3 = bPlanN > 0 ? ((bN3 - bPlanN) / bPlanN) * 100 : 0;

    const level = (pct) => (pct > 5 ? 'alert' : pct > 2 ? 'warn' : 'ok');
    const mod = (lvl) => (lvl === 'ok' ? '' : `option--${lvl}`);
    const badge = (lvl) => `badge--${lvl}`;

    const l2 = level(pct2);
    const l3 = level(pct3);

    $('m4-options').innerHTML = `
      <article class="option">
        <div class="option-head">
          <h3 class="option-title">Giữ nguyên tổng thời gian ${fmt(Tplan, 0)} ngày</h3>
          <span class="badge badge--ok">BED mô lành không đổi</span>
        </div>
        <p>Vẫn chiếu ${fmt(dplan)} Gy mỗi lần cho ${fmt(nrem, 0)} lần còn lại, nhưng dồn lịch: chiếu hai lần mỗi ngày trong ${
          bidDays > 0 ? `${bidDays} ngày` : 'một số ngày'
        } hoặc chiếu bù vào cuối tuần. Hai lần trong ngày phải cách nhau ít nhất 6 giờ.</p>
      </article>
      <article class="option ${mod(l2)}">
        <div class="option-head">
          <h3 class="option-title">Tăng liều cho ${fmt(nrem, 0)} lần còn lại</h3>
          <span class="badge ${badge(l2)}">BED mô lành ${signedPct(pct2)}</span>
        </div>
        <p>Chấp nhận kéo dài tới ${fmt(Tnew, 0)} ngày, nâng liều từ ${fmt(dplan)} lên <strong>${fmt(
      dNew,
      2
    )} Gy mỗi lần</strong> để bù ${fmt(extraLoss)} Gy BED. BED mô lành tăng từ ${fmt(bPlanN)} lên <strong>${fmt(
      bN2
    )} Gy</strong>.</p>
      </article>
      <article class="option ${mod(l3)}">
        <div class="option-head">
          <h3 class="option-title">Chiếu thêm phân liều</h3>
          <span class="badge ${badge(l3)}">Thêm ${fmt(nExtra, 0)} lần, mô lành ${signedPct(pct3)}</span>
        </div>
        <p>Bổ sung <strong>${fmt(nExtra, 0)} lần</strong> với liều ${fmt(
      dplan
    )} Gy, tổng cộng ${fmt(nplan + nExtra, 0)} lần, giả định tuần chiếu năm ngày. BED mô lành lên ${fmt(bN3)} Gy.</p>
      </article>
    `;
  }

  /* --------------------------------------------------------- dải phân liều */

  function setStrip(stripEl, n, d, maxDose, tone) {
    if (!stripEl) return;
    const bar = stripEl.querySelector('.strip-bar');
    const total = Math.max(0, n * d);
    const pct = maxDose > 0 ? clamp((total / maxDose) * 100, 0, 100) : 0;
    bar.style.width = `${pct.toFixed(2)}%`;
    bar.style.setProperty('--n', String(Math.max(1, Math.min(60, Math.round(n)))));
    bar.classList.toggle('is-tumor', tone === 'tumor');
    bar.classList.toggle('is-normal', tone === 'normal');
    stripEl.setAttribute(
      'aria-label',
      `${fmtN(n)} lần chiếu, mỗi lần ${fmt(d, 2)} Gy, tổng ${fmt(total, 1)} Gy`
    );
  }

  /* -------------------------------------------------------- bảng đối chiếu */

  const seedRows = [
    { name: 'Tuyến tiền liệt, chuẩn', n: 39, d: 2, abt: 1.5, note: 'Báo cáo, Bảng 3.1' },
    { name: 'Tuyến tiền liệt, CHHiP', n: 20, d: 3, abt: 1.5, note: 'Báo cáo, 26 ngày' },
    { name: 'Tuyến tiền liệt, PACE-B', n: 5, d: 7.25, abt: 1.5, note: 'Báo cáo, 5 ngày' },
    { name: 'Ung thư vú, chuẩn', n: 25, d: 2, abt: 3.5, note: 'Báo cáo, Bảng 3.1' },
    { name: 'Ung thư vú, START-B', n: 15, d: 2.67, abt: 3.5, note: 'Báo cáo, 21 ngày' },
    { name: 'Ung thư vú, FAST-Forward', n: 5, d: 5.2, abt: 3.5, note: 'Báo cáo, 5 ngày' },
    { name: 'Phổi NSCLC, RTOG 0236', n: 3, d: 18, abt: 10, note: 'SBRT, cần IGRT' }
  ];

  let rows = [];
  const AB_N = 3.0;

  function loadSeed() {
    rows = seedRows.map((r) => ({ ...r, abn: AB_N, seed: true }));
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderRows() {
    const body = $('cmp-body');
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="7" class="empty-cell">Bảng đang trống. Thêm phác đồ từ một module ở trên.</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map((r, i) => {
        const D = r.n * r.d;
        const bT = bed(r.n, r.d, r.abt);
        const bN = bed(r.n, r.d, r.abn);
        return `<tr>
          <td>${esc(r.name)}${r.seed ? '' : '<span class="tag">Đã thêm</span>'}</td>
          <td>${fmtN(r.n)} × ${fmt(r.d, 2)} Gy</td>
          <td>${fmt(D, 2)} Gy</td>
          <td>${fmt(bT, 1)} Gy (${fmt(eqd2(bT, r.abt), 1)})</td>
          <td>${fmt(bN, 1)} Gy (${fmt(eqd2(bN, r.abn), 1)})</td>
          <td>${esc(r.note)}</td>
          <td class="no-print"><button type="button" class="row-del" data-idx="${i}" aria-label="Bỏ ${esc(
          r.name
        )} khỏi bảng">&times;</button></td>
        </tr>`;
      })
      .join('');
  }

  function addRow(row) {
    rows.push({ ...row, abn: AB_N, seed: false });
    renderRows();
    toast(`Đã thêm ${row.name} vào bảng đối chiếu.`);
  }

  function presetName(selId, fallback) {
    const sel = $(selId);
    if (!sel || !sel.value) return fallback;
    return sel.options[sel.selectedIndex].text.split(':')[0].trim();
  }

  /* ------------------------------------------------------------------ sự kiện */

  function bind() {
    /* Enter trong ô số không được gửi form và tải lại trang */
    document.querySelectorAll('form').forEach((form) => {
      form.addEventListener('submit', (e) => e.preventDefault());
      form.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
          e.preventDefault();
          e.target.blur();
        }
      });
    });

    /* module 1 */
    $('m1-preset').addEventListener('change', (e) => {
      const p = m1Presets[e.target.value];
      if (!p) return;
      $('m1-n').value = p.n;
      $('m1-d').value = p.d;
      $('m1-ab-tumor').value = p.abt;
      $('m1-ab-normal').value = p.abn;
      $('m1-alpha').value = p.alpha;
      updateM1();
    });

    document.querySelectorAll('[data-m1chart]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-m1chart]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        m1Mode = btn.dataset.m1chart;
        updateM1();
      });
    });

    $('m1-save').addEventListener('click', () => {
      const s = m1State;
      if (!s) return;
      addRow({
        name: presetName('m1-preset', `Tự nhập, ${fmtN(s.n)} × ${fmt(s.d, 2)} Gy`),
        n: s.n,
        d: s.d,
        abt: s.abt,
        note: `Module 1, EQD2 bướu ${fmt(s.eT, 1)} Gy`
      });
    });

    /* module 2 */
    $('m2-preset').addEventListener('change', (e) => {
      const p = m2Presets[e.target.value];
      if (!p) return;
      $('m2-n').value = p.n;
      $('m2-d').value = p.d;
      $('m2-T').value = p.T;
      $('m2-Tk').value = p.Tk;
      $('m2-ab-tumor').value = p.abt;
      $('m2-ab-normal').value = p.abn;
      $('m2-alpha').value = p.alpha;
      $('m2-tpot').value = p.tpot;
      updateM2();
    });

    $('m2-save').addEventListener('click', () => {
      if (!m2State) return;
      const s = m2State;
      addRow({
        name: presetName('m2-preset', `Có tái sinh, ${fmtN(s.n)} × ${fmt(s.d, 2)} Gy`),
        n: s.n,
        d: s.d,
        abt: s.abt,
        note: `Module 2, T = ${fmt(s.T, 0)} ngày, BED net ${fmt(s.net, 1)} Gy`
      });
    });

    /* module 3 */
    $('m3-preset').addEventListener('change', (e) => {
      const p = m3Presets[e.target.value];
      if (!p) return;
      $('m3-n1').value = p.n1;
      $('m3-d1').value = p.d1;
      $('m3-ab-tumor').value = p.abt;
      $('m3-ab-normal').value = p.abn;
      $('m3-match').value = p.match;
      $('m3-mode').value = p.mode;
      $('m3-n2').value = p.n2;
      toggleM3();
      updateM3();
    });

    $('m3-mode').addEventListener('change', () => {
      toggleM3();
      updateM3();
    });
    $('m3-repop').addEventListener('change', () => {
      toggleM3();
      updateM3();
    });

    $('m3-save').addEventListener('click', () => {
      if (!m3State) return;
      const s = m3State;
      addRow({
        name: presetName('m3-preset', `Chuyển đổi, ${fmtN(s.n2)} × ${fmt(s.d2, 2)} Gy`),
        n: s.n2,
        d: s.d2,
        abt: s.abt,
        note: `Module 3, từ ${fmtN(s.n1)} × ${fmt(s.d1, 2)} Gy`
      });
    });

    /* module 4 */
    $('m4-preset').addEventListener('change', (e) => {
      const p = m4Presets[e.target.value];
      if (!p) return;
      $('m4-nplan').value = p.nplan;
      $('m4-dplan').value = p.dplan;
      $('m4-ndone').value = p.ndone;
      $('m4-gap').value = p.gap;
      $('m4-Tplan').value = p.Tplan;
      $('m4-Tk').value = p.Tk;
      $('m4-ab-tumor').value = p.abt;
      $('m4-ab-normal').value = p.abn;
      $('m4-K').value = p.K;
      updateM4();
    });

    /* bảng */
    $('cmp-body').addEventListener('click', (e) => {
      const btn = e.target.closest('.row-del');
      if (!btn) return;
      rows.splice(Number(btn.dataset.idx), 1);
      renderRows();
    });

    $('btn-reset').addEventListener('click', () => {
      loadSeed();
      renderRows();
      toast('Bảng đã trở về bảy phác đồ trong báo cáo.');
    });

    $('btn-export').addEventListener('click', exportCsv);
    $('btn-print').addEventListener('click', () => window.print());

    window.addEventListener('beforeprint', () => {
      document.querySelectorAll('details').forEach((d) => (d.open = true));
    });

    /* mọi thay đổi số */
    const inputs = document.querySelectorAll('input[type="number"], input[type="checkbox"], select');
    inputs.forEach((el) => {
      if (el.id.endsWith('-preset')) return;
      const ev = el.type === 'number' ? 'input' : 'change';
      el.addEventListener(ev, () => {
        if (el.type === 'number' && String(el.value).trim() === '') return;
        updateAll();
      });
    });

    /* cuộn tới đâu, mục lục sáng tới đó */
    setupSpy();

    let raf = null;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateAll);
    });
  }

  function setupSpy() {
    const links = Array.from(document.querySelectorAll('.rail-link'));
    const items = links
      .map((link) => ({ link, sec: document.querySelector(link.getAttribute('href')) }))
      .filter((it) => it.sec);
    if (!items.length) return;

    let ticking = false;
    const apply = () => {
      ticking = false;
      const line = 150;
      let current = items[0];
      items.forEach((it) => {
        if (it.sec.getBoundingClientRect().top <= line) current = it;
      });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) {
        current = items[items.length - 1];
      }
      items.forEach((it) => {
        const on = it === current;
        it.link.classList.toggle('is-active', on);
        if (on) it.link.setAttribute('aria-current', 'true');
        else it.link.removeAttribute('aria-current');
      });
    };

    window.addEventListener(
      'scroll',
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(apply);
      },
      { passive: true }
    );
    window.addEventListener('resize', apply);
    apply();
  }

  /* ---------------------------------------------------------------- xuất CSV */

  function exportCsv() {
    if (!rows.length) {
      toast('Bảng đang trống, chưa có gì để xuất.');
      return;
    }
    const head = [
      'Phac_do',
      'So_lan',
      'Lieu_moi_lan_Gy',
      'Tong_lieu_Gy',
      'ab_buou_Gy',
      'ab_lanh_Gy',
      'BED_buou_Gy',
      'EQD2_buou_Gy',
      'BED_lanh_Gy',
      'EQD2_lanh_Gy',
      'Ghi_chu'
    ];
    const line = (r) => {
      const bT = bed(r.n, r.d, r.abt);
      const bN = bed(r.n, r.d, r.abn);
      return [
        `"${String(r.name).replace(/"/g, '""')}"`,
        r.n,
        r.d,
        (r.n * r.d).toFixed(2),
        r.abt.toFixed(1),
        r.abn.toFixed(1),
        bT.toFixed(2),
        eqd2(bT, r.abt).toFixed(2),
        bN.toFixed(2),
        eqd2(bN, r.abn).toFixed(2),
        `"${String(r.note).replace(/"/g, '""')}"`
      ].join(',');
    };
    const csv = '\uFEFF' + [head.join(','), ...rows.map(line)].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'so-phan-lieu-nhom4.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast(`Đã xuất ${rows.length} phác đồ ra CSV.`);
  }

  /* ------------------------------------------------------------------- khởi động */

  function updateAll() {
    updateM1();
    updateM2();
    updateM3();
    updateM4();
  }

  loadSeed();
  renderRows();
  bind();
  toggleM3();
  updateAll();

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => updateAll());
  }
})();
