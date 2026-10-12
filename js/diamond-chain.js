import {
    BEAD_SIZES, DC_SIZES, MM_TO_PX_C, getClosestPaletteColors, hexToRgb
} from './constants.js';

        // ╔═════════════════════════════════════════════════════════════════════╗
        // ║  MODULE: DiamondChainCore — diamond chain matrix (pure logic)       ║
        // ║                                                                     ║
        // ║  Geometry: the lattice is square in PHYSICAL dimensions —          ║
        // ║  diamond height = chain length / count (the square's diagonal),    ║
        // ║  side = height/√2, even peyote rows from the bead pitch, columns   ║
        // ║  matched so cols·diam ≈ rows·pitch. The square is rotated 45°      ║
        // ║  as a unit → a diamond; diamonds chain so diamond N's top-right    ║
        // ║  corner lands adjacent to diamond N+1's bottom-left corner with    ║
        // ║  a fixed nudge in bead units (−2.5 col, +2.0 row; peyote           ║
        // ║  odd-row stagger).                                                 ║
        // ║                                                                     ║
        // ║  Cell schema matches Beadazzle.quantizedGrid:                    ║
        // ║  grid[i][r][c] = { finalColor, isAmbiguous, manualOverride,        ║
        // ║  tabs, isOutline } — consumed by renderDOMGrid / node popover.     ║
        // ╚═════════════════════════════════════════════════════════════════════╝
        export class DiamondChainCore {
            constructor(params = {}) {
                this.params = Object.assign({
                    sizeLevel: 'M',        // S | M | L — enforces the chain length
                    chainCount: 2,         // unbounded; 6-row clamp is the only limit
                    beadIdx: 3,            // index into BEAD_SIZES.rocaille
                    mode: 'SOLID',         // SOLID fills | TEXT (one char per diamond)
                    text: 'HI',
                    font: 'Arial',
                    textColor: '#ece3d2',
                    outlineEnabled: true,
                    outlineColor: '#1c1813',
                    groundColor: '#0d0f1c',
                    algoMode: 'Blended',   // Dominant | Blended
                    autoCenter: true,      // re-center chain bbox at the origin
                    // locked junction nudge ∥ rotated lattice axes, in beads
                    nudgeX: -2.5,
                    nudgeY: 2.0,
                }, params);
                // per-diamond fill overrides; unset diamonds default to white
                this.diamondColors = {};
                // TEXT mode: quantization is deferred until Compute Pattern
                this.quantized = false;
                this.quantizedGrid = null;
                this._overrides = {};   // keyed "i:r:c", survives re-computation
            }

            get lengthMM() { return DC_SIZES[this.params.sizeLevel] || DC_SIZES.M; }

            // TEXT mode auto-adds one diamond per character (letters and
            // emoji alike); SOLID mode uses the count control.
            _count() {
                return this.params.mode === 'TEXT'
                    ? Math.max(1, Array.from(this.params.text || '').length)
                    : Math.max(1, this.params.chainCount);
            }

            // Would this count / bead combination still derive the minimum
            // row count? (The count/bead adjusters' rejection guard.)
            rowsForCount(count, beadIdx = this.params.beadIdx) {
                const sideMM = (this.lengthMM / Math.max(1, count)) / Math.SQRT2;
                return Math.max(2, 2 * Math.round(sideMM / BEAD_SIZES.rocaille[beadIdx].pitch / 2));
            }

            // Cascade: enforced length → diamond height (length/count) →
            // square side (height/√2) → even rows → cols. Auto-centers the
            // chain bbox at the origin.
            derive() {
                const bead = BEAD_SIZES.rocaille[this.params.beadIdx];
                const n = this._count();
                const diamHTarget = this.lengthMM / n;
                const sideT = diamHTarget / Math.SQRT2;
                const rows = Math.max(2, 2 * Math.round(sideT / bead.pitch / 2));
                const sideMM = rows * bead.pitch;                        // actual square side (mm)
                const cols = Math.max(1, Math.round(sideMM / bead.diam)); // match width to height
                const bw = bead.diam * MM_TO_PX_C;
                const bh = bead.pitch * MM_TO_PX_C;
                const latticeW = (cols + 0.5) * bw;  // +half bead for peyote odd-row offset
                const latticeH = rows * bh;
                const diamH = sideMM * Math.SQRT2;   // actual diamond height (square diagonal)

                // 45° clockwise; CSS rotate() convention, y down
                const rad = Math.PI / 4;
                const c = Math.cos(rad), s = Math.sin(rad);
                const bboxW = latticeW * c + latticeH * s;
                const bboxH = latticeW * s + latticeH * c;
                const rot = (x, y) => [x * c - y * s, x * s + y * c];

                // center of diamond i+1 = center of diamond i
                //   + (rot(TR corner) − rot(BL corner)) + nudge
                const cornerTR = rot(latticeW / 2, -latticeH / 2); // → diamond's East
                const cornerBL = rot(-latticeW / 2, latticeH / 2); // → diamond's West
                const nudge = rot(this.params.nudgeX * bw, this.params.nudgeY * bh);
                const stepX = (cornerTR[0] - cornerBL[0]) + nudge[0];
                const stepY = (cornerTR[1] - cornerBL[1]) + nudge[1];

                const centers = [];
                let cx = 0, cy = 0;
                for (let i = 0; i < n; i++) {
                    centers.push({ cx, cy });
                    cx += stepX; cy += stepY;
                }

                // shift the chain bbox center onto the origin
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                centers.forEach(p => {
                    minX = Math.min(minX, p.cx - bboxW / 2); maxX = Math.max(maxX, p.cx + bboxW / 2);
                    minY = Math.min(minY, p.cy - bboxH / 2); maxY = Math.max(maxY, p.cy + bboxH / 2);
                });
                if (this.params.autoCenter) {
                    const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;
                    centers.forEach(p => { p.cx -= ox; p.cy -= oy; });
                    minX -= ox; maxX -= ox; minY -= oy; maxY -= oy;
                }

                return { n, bead, rows, cols, sideMM, diamH, bw, bh,
                         latticeW, latticeH, bboxW, bboxH,
                         centers, bbox: { minX, minY, maxX, maxY } };
            }

            // ── outline map ─────────────────────────────────────────────
            // Every perimeter bead of a diamond is an outline bead, EXCEPT
            // the junction connectors: rightmost bead of the 2nd row from
            // the top, leftmost bead of the 2nd row from the bottom. The
            // corner trim removes the rightmost bead of the top 2 rows and
            // leftmost of the bottom 2, so rightmost/leftmost means the
            // outermost EXISTING bead.
            isOutlineBead(g, r, cc) {
                const { rows, cols } = g;
                const rightmostCol = r => (r < 2 ? cols - 2 : cols - 1);
                const leftmostCol = r => (r >= rows - 2 ? 1 : 0);
                const onEdge = r === 0 || r === rows - 1 ||
                               cc === leftmostCol(r) || cc === rightmostCol(r);
                if (!onEdge) return false;
                if (r === 1 && cc === rightmostCol(r)) return false;
                if (r === rows - 2 && cc === leftmostCol(r)) return false;
                return true;
            }

            _diamColor(i) {
                if (this.diamondColors[i]) return this.diamondColors[i];
                if (this.params.mode === 'TEXT' && this.params.textBg) return this.params.textBg;
                return this.params.mode === 'TEXT' ? (this._textBgFallback || '#ffffff') : '#ffffff';
            }

            // ── asset rendering (compute-pattern input) ─────────────────
            // One shared canvas covers the whole chain; a single
            // getImageData serves every bead. Glyphs are drawn upright in
            // world (screen) space — only the bead lattice is rotated
            // 45° — so the raw preview is exactly what quantization
            // samples: WYSIWYG.
            assetRes(g) {
                const MAX_DIM = 1600, MAX_PX = 24e6;
                const maxLattice = Math.max(g.latticeW, g.latticeH);
                const totalW = Math.max(1, g.bbox.maxX - g.bbox.minX);
                const totalH = Math.max(1, g.bbox.maxY - g.bbox.minY);
                let res = Math.min(6, MAX_DIM / maxLattice);
                if (totalW * res * totalH * res > MAX_PX)
                    res *= Math.sqrt(MAX_PX / (totalW * res * totalH * res));
                return { res, totalW, totalH,
                         wPx: Math.max(1, Math.ceil(totalW * res)),
                         hPx: Math.max(1, Math.ceil(totalH * res)) };
            }

            _fontCss() {
                const fam = this.params.font || 'Arial';
                return /\s/.test(fam) ? `"${fam}"` : fam;
            }

            // TEXT asset: ground pre-fill + diamond backgrounds + one
            // upright glyph per diamond (mirrors runQuantization's
            // groundColor pre-fill)
            drawAssetBase(ctx, g, res) {
                const chars = Array.from(this.params.text || '');
                const { bbox } = g;
                ctx.fillStyle = this.params.groundColor;
                ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                g.centers.forEach((p, i) => {
                    ctx.fillStyle = this._diamColor(i);
                    ctx.fillRect((p.cx - bbox.minX) * res - g.latticeW * res / 2,
                                 (p.cy - bbox.minY) * res - g.latticeH * res / 2,
                                 g.latticeW * res, g.latticeH * res);
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = this.params.textColor;
                    ctx.font = `bold ${Math.floor(g.latticeH * res * 0.75)}px ${this._fontCss()}, sans-serif`;
                    // drop glyphs 10% of the diamond height — font middle
                    // baselines (esp. emoji) sit high otherwise
                    ctx.fillText(chars[i] || ' ',
                                 (p.cx - bbox.minX) * res,
                                 (p.cy - bbox.minY) * res + g.latticeH * res * 0.10);
                });
            }

            // ── quantization ("compute pattern") ────────────────────────
            // Port of Beadazzle.runQuantization() for the chain: shared
            // canvas pre-filled with groundColor, rotated-rect sampling
            // per bead, 16-bin dominant-color histogram, Blended/Dominant
            // algo, 3-tier tabs, ambiguity flag, nearest-palette outline
            // post-pass, and manual-override preservation.
            quantize(g) {
                const { rows, cols, bw, bh, latticeW, latticeH } = g;
                const { res, wPx, hPx } = this.assetRes(g);
                const sBw = bw * res, sBh = bh * res;
                const step = Math.max(1, Math.round(Math.sqrt((sBw * sBh) / 256)));
                const cv = document.createElement('canvas');
                cv.width = wPx; cv.height = hPx;
                this.drawAssetBase(cv.getContext('2d', { willReadFrequently: true }), g, res);
                const img = cv.getContext('2d', { willReadFrequently: true })
                              .getImageData(0, 0, wPx, hPx).data;
                const alpha = (this.params.algoMode === "Blended") ? 1 : 0;
                // lattice rotation (45° CW, CSS convention, y down)
                const rad = Math.PI / 4, rc = Math.cos(rad), rs = Math.sin(rad);
                const oc = hexToRgb(this.params.outlineColor);
                const outlineHex = getClosestPaletteColors(oc.r, oc.g, oc.b, 1)[0];
                this.quantizedGrid = g.centers.map((p, i) => {
                    const cx0 = (p.cx - g.bbox.minX) * res, cy0 = (p.cy - g.bbox.minY) * res;
                    const halfW = latticeW * res / 2, halfH = latticeH * res / 2;
                    const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
                    for (let r = 0; r < rows; r++) {
                        const odd = r % 2 === 1;
                        const y0 = r * sBh;
                        for (let cc = 0; cc < cols; cc++) {
                            const x0 = (odd ? bw / 2 : 0) * res + cc * sBw;
                            // rotated bead rect → axis-aligned bbox on canvas
                            let minXb = Infinity, minYb = Infinity, maxXb = -Infinity, maxYb = -Infinity;
                            for (const [lx, ly] of [[x0,y0],[x0+sBw,y0],[x0+sBw,y0+sBh],[x0,y0+sBh]]) {
                                const dx = lx - halfW, dy = ly - halfH;
                                const px = cx0 + dx * rc - dy * rs;
                                const py = cy0 + dx * rs + dy * rc;
                                if (px < minXb) minXb = px; if (px > maxXb) maxXb = px;
                                if (py < minYb) minYb = py; if (py > maxYb) maxYb = py;
                            }
                            // dominant-color histogram over the rotated rect
                            const colorHistogram = {}; let totalValidPixels = 0;
                            for (let py = Math.floor(minYb); py <= Math.ceil(maxYb); py += step) {
                                if (py < 0 || py >= hPx) continue;
                                for (let px = Math.floor(minXb); px <= Math.ceil(maxXb); px += step) {
                                    if (px < 0 || px >= wPx) continue;
                                    // inverse-rotate into lattice-local, point-in-rect
                                    const dx = px - cx0, dy = py - cy0;
                                    const lx = halfW + dx * rc + dy * rs;
                                    const ly = halfH - dx * rs + dy * rc;
                                    if (lx < x0 || lx >= x0 + sBw || ly < y0 || ly >= y0 + sBh) continue;
                                    const di = (py * wPx + px) * 4;
                                    if (img[di + 3] < 128) continue; // alpha skip
                                    totalValidPixels++;
                                    const binKey = `${Math.floor(img[di]/16)},${Math.floor(img[di+1]/16)},${Math.floor(img[di+2]/16)}`;
                                    if (!colorHistogram[binKey]) colorHistogram[binKey] = { count: 0, r: 0, g: 0, b: 0 };
                                    colorHistogram[binKey].count++;
                                    colorHistogram[binKey].r += img[di];
                                    colorHistogram[binKey].g += img[di + 1];
                                    colorHistogram[binKey].b += img[di + 2];
                                }
                            }
                            const sortedBins = Object.keys(colorHistogram).map(k => ({ ...colorHistogram[k] })).sort((a, b) => b.count - a.count);
                            let cell;
                            if (sortedBins.length > 0) {
                                const b1 = sortedBins[0]; const b2 = sortedBins[1] || null;
                                const r1 = Math.round(b1.r / b1.count); const g1 = Math.round(b1.g / b1.count); const b1Val = Math.round(b1.b / b1.count);
                                const t1Options = getClosestPaletteColors(r1, g1, b1Val, 3);
                                let t2Options = null, blendOptions = null;
                                let defaultR = r1, defaultG = g1, defaultB = b1Val;
                                let r2 = 0, g2 = 0, b2Val = 0, blendR = r1, blendG = g1, blendB = b1Val;
                                if (b2) {
                                    r2 = Math.round(b2.r / b2.count); g2 = Math.round(b2.g / b2.count); b2Val = Math.round(b2.b / b2.count);
                                    t2Options = getClosestPaletteColors(r2, g2, b2Val, 3);
                                    const ratio1 = b1.count / (b1.count + b2.count);
                                    const ratio2 = b2.count / (b1.count + b2.count);
                                    blendR = Math.round(r1 * ratio1 + r2 * ratio2);
                                    blendG = Math.round(g1 * ratio1 + g2 * ratio2);
                                    blendB = Math.round(b1Val * ratio1 + b2Val * ratio2);
                                    blendOptions = getClosestPaletteColors(blendR, blendG, blendB, 3);
                                    defaultR = Math.round(r1 * (1 - alpha) + blendR * alpha);
                                    defaultG = Math.round(g1 * (1 - alpha) + blendG * alpha);
                                    defaultB = Math.round(b1Val * (1 - alpha) + blendB * alpha);
                                }
                                const dynamicDefaultColor = getClosestPaletteColors(defaultR, defaultG, defaultB, 1)[0];
                                const isAmbiguous = (b1.count < totalValidPixels * 0.5) || (b2 && b1.count < b2.count * 2);
                                cell = {
                                    finalColor: dynamicDefaultColor, isAmbiguous,
                                    manualOverride: false,
                                    tabs: [
                                        { rawColor: `rgb(${r1},${g1},${b1Val})`, options: t1Options },
                                        b2 ? { rawColor: `rgb(${r2},${g2},${b2Val})`, options: t2Options } : null,
                                        b2 ? { rawColor: `rgb(${blendR},${blendG},${blendB})`, options: blendOptions } : null
                                    ]
                                };
                            } else {
                                cell = { finalColor: this.params.groundColor, isAmbiguous: false, manualOverride: false, tabs: null };
                            }
                            // outline post-pass: perimeter beads take the
                            // outline color matched to the palette; tabs are
                            // cleared so the popover can't restore non-outline
                            if (this.params.outlineEnabled && this.isOutlineBead(g, r, cc)) {
                                cell.finalColor = outlineHex;
                                cell.isOutline = true;
                                cell.tabs = null;
                            }
                            // manual overrides survive re-computation
                            const ov = this._overrides[`${i}:${r}:${cc}`];
                            if (ov) { cell.finalColor = ov; cell.manualOverride = true; }
                            grid[r][cc] = cell;
                        }
                    }
                    return grid;
                });
                return this.quantizedGrid;
            }

            // ── cell fill resolution ────────────────────────────────────
            // Corner trim: rightmost bead of the top 2 rows and leftmost of
            // the bottom 2 rows are omitted from the lattice in every mode,
            // opening a notch at the two junction corners.
            cellFill(g, glyphMaps, i, r, cc) {
                const raw = this.params.mode === 'TEXT' && !this.quantized;
                const trimmed = (r < 2 && cc === g.cols - 1) || (r >= g.rows - 2 && cc === 0);
                if (trimmed)
                    return { fill: null, isOutline: false, trimmed: true };
                const onOutline = !raw && this.params.outlineEnabled && this.isOutlineBead(g, r, cc);
                const fill = raw ? 'transparent'   // raw preview: asset shows through
                           : onOutline ? this.params.outlineColor
                           : (glyphMaps && glyphMaps[i] && glyphMaps[i][r][cc]) ? glyphMaps[i][r][cc].finalColor
                           : this._diamColor(i);
                return { fill, isOutline: onOutline, trimmed: false };
            }
        }
