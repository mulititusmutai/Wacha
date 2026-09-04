// Beadazzle — pattern export — PNG rendering and JSON serialization (rectangular + diamond chain).
// Mixin: merged onto Beadazzle.prototype by studio.js
import {
    HEX_TO_NAME,
    hexToRgb
} from './constants.js';

export const exportMixin = {
        // ── diamond chain exports ───────────────────────────────────
        _exportChainPNG() {
            const chain = this.chain;
            const g = this._chainGeo || chain.derive();
            const XS = 3;
            const W = Math.ceil((g.bbox.maxX - g.bbox.minX) * XS);
            const H = Math.ceil((g.bbox.maxY - g.bbox.minY) * XS);
            const cv = document.createElement('canvas');
            cv.width = W; cv.height = H;
            const ctx = cv.getContext('2d');
            ctx.fillStyle = this.params.groundColor;
            ctx.fillRect(0, 0, W, H);

            const glyphMaps = chain.quantizedGrid || chain.quantize(g);
            const beadRadius = Math.max(2, g.bw * XS * 0.22);
            const minX = g.bbox.minX, minY = g.bbox.minY;

            g.centers.forEach((p, i) => {
                ctx.save();
                ctx.translate((p.cx - minX) * XS, (p.cy - minY) * XS);
                ctx.rotate(Math.PI / 4);
                for (let r = 0; r < g.rows; r++) {
                    const odd = r % 2 === 1;
                    const y = (r - g.rows / 2) * g.bh * XS;
                    for (let cc = 0; cc < g.cols; cc++) {
                        const cell = chain.cellFill(g, glyphMaps, i, r, cc);
                        if (cell.trimmed || !cell.fill || cell.fill === 'transparent') continue;
                        const x = ((odd ? g.bw / 2 : 0) + cc * g.bw - g.latticeW / 2) * XS;
                        const color = cell.fill;
                        const rgb = hexToRgb(color);
                        ctx.beginPath();
                        this._roundRect(ctx, x, y, g.bw * XS, g.bh * XS, beadRadius);
                        ctx.fillStyle = color;
                        ctx.fill();
                        ctx.beginPath();
                        this._roundRect(ctx, x + 0.5, y + 0.5, g.bw * XS - 1, g.bh * XS - 1, beadRadius);
                        ctx.strokeStyle = `rgba(255,255,255,0.18)`;
                        ctx.lineWidth = Math.max(0.5, g.bw * XS * 0.04);
                        ctx.stroke();
                        ctx.beginPath();
                        this._roundRect(ctx, x + 0.5, y + 0.5, g.bw * XS - 1, g.bh * XS - 1, beadRadius);
                        ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.55)`;
                        ctx.lineWidth = Math.max(0.5, g.bw * XS * 0.025);
                        ctx.stroke();
                    }
                }
                ctx.restore();
            });

            const link = document.createElement('a');
            link.download = 'beadazzle_diamond_chain.png';
            link.href = cv.toDataURL('image/png');
            link.click();
            this.exportModal.classList.remove('active');
            this._toast("PNG exported successfully.");
        },

        _exportChainJSON() {
            const chain = this.chain;
            const g = this._chainGeo;
            if (!g) return this._toast("Compute pattern first.", "error");
            const counts = {};
            const grids = chain.quantizedGrid || [];
            const diamonds = grids.map((grid, i) => {
                const sequences = grid.map((row, r) => row.map((cell, c) => {
                    // trimmed corner beads are not part of the pattern
                    if ((r < 2 && c === g.cols - 1) || (r >= g.rows - 2 && c === 0)) return null;
                    if (!cell) return null;
                    const name = HEX_TO_NAME[cell.finalColor] || "Unknown";
                    counts[name] = (counts[name] || 0) + 1;
                    return name;
                }));
                return {
                    diamond: i + 1,
                    char: chain.params.mode === 'TEXT' ? (Array.from(chain.params.text || '')[i] || '') : null,
                    row_sequences: sequences.map((row, r) => ({
                        row: r,
                        offset: r % 2 === 1 ? 'half-bead-right' : 'none',
                        beads: row
                    }))
                };
            });
            const beadsPer = g.cols * g.rows - 4;
            const exportData = {
                metadata: {
                    application: "Beadazzle",
                    structure: "diamond-chain",
                    generated_at: new Date().toISOString(),
                    diamonds: g.n,
                    chain_length_mm: chain.lengthMM,
                    diamond_height_mm: parseFloat(g.diamH.toFixed(2)),
                    lattice: { columns: g.cols, rows: g.rows, beads_per_diamond: beadsPer },
                    physical: {
                        bead_diameter_mm: g.bead.diam,
                        bead_pitch_mm: g.bead.pitch
                    }
                },
                bead_counts: counts,
                diamonds
            };
            const blob = new Blob([JSON.stringify(exportData, null, 4)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = 'beadazzle_diamond_chain.json';
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
            this.exportModal.classList.remove('active');
            this._toast("JSON data exported successfully.");
        },

        // ── Export ───────────────────────────────────────────────────────
        _getBeadStats() {
            const counts = {};
            // ROW-BASED: sequences[row][col]
            const sequences = Array.from({ length: this.params.rows }, () => Array(this.params.cols).fill(null));
            for (let r = 0; r < this.params.rows; r++) {
                for (let c = 0; c < this.params.cols; c++) {
                    const cell = this.quantizedGrid[r]?.[c];
                    if (cell) {
                        const name = HEX_TO_NAME[cell.finalColor] || "Unknown";
                        counts[name] = (counts[name] || 0) + 1;
                        sequences[r][c] = name;
                    }
                }
            }
            return { counts, sequences };
        },

        _roundRect(ctx, x, y, w, h, r) {
            if (ctx.roundRect) {
                ctx.roundRect(x, y, w, h, r);
            } else {
                const minR = Math.min(r, w / 2, h / 2);
                ctx.moveTo(x + minR, y);
                ctx.lineTo(x + w - minR, y);
                ctx.arcTo(x + w, y, x + w, y + minR, minR);
                ctx.lineTo(x + w, y + h - minR);
                ctx.arcTo(x + w, y + h, x + w - minR, y + h, minR);
                ctx.lineTo(x + minR, y + h);
                ctx.arcTo(x, y + h, x, y + h - minR, minR);
                ctx.lineTo(x, y + minR);
                ctx.arcTo(x, y, x + minR, y, minR);
                ctx.closePath();
            }
        },

        exportAsPNG() {
            if (this.params.mode === 'diamond') return this._exportChainPNG();
            // ── Export scale: render at 3× the on-screen pixel density for crispness
            const XS = 3;

            const { cols, rows } = this.params;
            const bw = this.bw * XS;
            const bh = this.bh * XS;
            const sw = this.sw * XS;
            const sh = this.sh * XS;

            // Grid-local size, then canvas = rotated bounding box
            const gridW = Math.ceil((cols + 0.5) * bw);
            const gridH = Math.ceil(rows * bh);
            const A = this.params.patternAngle * Math.PI / 180;
            const eC = Math.abs(Math.cos(A)), eS = Math.abs(Math.sin(A));
            const canvasW = Math.ceil(gridW * eC + gridH * eS);
            const canvasH = Math.ceil(gridW * eS + gridH * eC);

            const exportCanvas = document.createElement('canvas');
            exportCanvas.width  = canvasW;
            exportCanvas.height = canvasH;
            const ctx = exportCanvas.getContext('2d');

            // ── Background: ground color (matches what's shown on screen)
            ctx.fillStyle = this.params.groundColor;
            ctx.fillRect(0, 0, canvasW, canvasH);

            // Rotate the whole lattice as a unit about its center —
            // matches the on-screen CSS rotation of the grid layer.
            ctx.translate(canvasW / 2, canvasH / 2);
            ctx.rotate(A);
            ctx.translate(-gridW / 2, -gridH / 2);

            // ── Bead radius: match the CSS border-radius look
            // CSS uses 8px on a ~bw-sized element; we scale proportionally
            const beadRadius = Math.max(2, sw * 0.22);

            for (let r = 0; r < rows; r++) {
                const isOddRow = (r % 2 === 1);
                const xOff = isOddRow ? bw / 2 : 0;
                const y = r * bh;

                for (let c = 0; c < cols; c++) {
                    const cell = this.quantizedGrid[r]?.[c];
                    if (!cell) continue;

                    const x = xOff + c * bw;
                    const color = cell.finalColor;
                    const rgb   = hexToRgb(color);

                    // ── Draw bead fill (rounded rect)
                    ctx.beginPath();
                    this._roundRect(ctx, x, y, sw, sh, beadRadius);
                    ctx.fillStyle = color;
                    ctx.fill();

                    // ── Inset highlight: thin bright rim (gives glassy depth)
                    ctx.beginPath();
                    this._roundRect(ctx, x + 0.5, y + 0.5, sw - 1, sh - 1, beadRadius);
                    ctx.strokeStyle = `rgba(255,255,255,0.18)`;
                    ctx.lineWidth = Math.max(0.5, sw * 0.04);
                    ctx.stroke();

                    // ── Inset shadow: subtle rim matching bead color (matches .bead.computed)
                    ctx.beginPath();
                    this._roundRect(ctx, x + 0.5, y + 0.5, sw - 1, sh - 1, beadRadius);
                    ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.55)`;
                    ctx.lineWidth = Math.max(0.5, sw * 0.025);
                    ctx.stroke();
                }

                // ── Void areas (half-bead gaps on each row edge) — subtle hatched fill
                ctx.save();
                if (isOddRow) {
                    // left void
                    ctx.beginPath();
                    ctx.rect(0, y, bw / 2, sh);
                    ctx.fillStyle = 'rgba(168,118,90,0.07)';
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(168,118,90,0.15)';
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                } else {
                    // right void
                    const rx = cols * bw + bw / 2;
                    ctx.beginPath();
                    ctx.rect(rx - bw / 2, y, bw / 2, sh);
                    ctx.fillStyle = 'rgba(168,118,90,0.07)';
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(168,118,90,0.15)';
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
                ctx.restore();
            }

            const link = document.createElement('a');
            link.download = 'beadazzle_pattern.png';
            link.href = exportCanvas.toDataURL('image/png');
            link.click();
            this.exportModal.classList.remove('active');
            this._toast("PNG exported successfully.");
        },

        exportAsJSON() {
            if (this.params.mode === 'diamond') return this._exportChainJSON();
            const { counts, sequences } = this._getBeadStats();
            const physW = (this.params.cols * this.params.diam) + (this.params.diam / 2);
            const physH = this.params.rows * this.params.pitch;

            const exportData = {
                metadata: {
                    application: "Beadazzle",
                    generated_at: new Date().toISOString(),
                    grid: { columns: this.params.cols, rows: this.params.rows },
                    physical: {
                        width_mm: parseFloat(physW.toFixed(2)),
                        height_mm: parseFloat(physH.toFixed(2)),
                        bead_diameter_mm: this.params.diam,
                        bead_pitch_mm: this.params.pitch
                    }
                },
                bead_counts: counts,
                // Row-based: each entry is one row, reading left-to-right
                row_sequences: sequences.map((row, r) => ({
                    row: r,
                    offset: r % 2 === 1 ? 'half-bead-right' : 'none',
                    beads: row
                }))
            };

            const blob = new Blob([JSON.stringify(exportData, null, 4)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = 'beadazzle_pattern.json';
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
            this.exportModal.classList.remove('active');
            this._toast("JSON data exported successfully.");
        }
};
