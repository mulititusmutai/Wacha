// Beadazzle — Build → Checkout hand-off.
// Serializes the computed pattern into sessionStorage and navigates to the
// checkout page. Mixin: merged onto Beadazzle.prototype by the page script.
import { HEX_TO_NAME } from './constants.js';

const PALETTE_HEX = Object.fromEntries(
    Object.entries(HEX_TO_NAME).map(([hex, name]) => [name, hex])
);

export const handoffMixin = {
        _orderCounts() {
            if (this.params.mode === 'diamond') {
                const g = this._chainGeo;
                if (!g) return {};
                const counts = {};
                const grids = this.chain.quantizedGrid || [];
                grids.forEach(grid => grid.forEach((row, r) => row.forEach((cell, c) => {
                    // trimmed corner beads are not part of the pattern
                    if ((r < 2 && c === g.cols - 1) || (r >= g.rows - 2 && c === 0)) return;
                    if (!cell) return;
                    const name = HEX_TO_NAME[cell.finalColor] || "Unknown";
                    counts[name] = (counts[name] || 0) + 1;
                })));
                return counts;
            }
            return this._getBeadStats().counts;
        },

        /* Render the pattern itself (the on-screen cImage canvas only holds
           the source asset layer, so we draw quantizedGrid from data). */
        _orderPreview() {
            try {
                const XS = 3;
                const cv = document.createElement('canvas');
                const ctx = cv.getContext('2d');
                const bw = this.bw * XS, bh = this.bh * XS;
                const sw = this.sw * XS, sh = this.sh * XS;
                const beadR = Math.max(2, sw * 0.22);
                let maxCols = 0;

                if (this.params.mode === 'diamond') {
                    const g = this._chainGeo;
                    const grids = this.chain.quantizedGrid || [];
                    const dbw = g.bw * XS, dbh = g.bh * XS;
                    const dsw = dbw, dsh = dbh;
                    cv.width = grids.length * Math.ceil(g.cols * dbw + dbw / 2) + 20;
                    cv.height = Math.ceil(g.rows * dbh) + 20;
                    ctx.fillStyle = this.params.groundColor;
                    ctx.fillRect(0, 0, cv.width, cv.height);
                    grids.forEach((grid, di) => {
                        const x0 = 10 + di * Math.ceil(g.cols * dbw + dbw / 2);
                        grid.forEach((row, r) => row.forEach((cell, c) => {
                            if ((r < 2 && c === g.cols - 1) || (r >= g.rows - 2 && c === 0)) return;
                            if (!cell) return;
                            const odd = r % 2 === 1;
                            const x = x0 + (odd ? dbw / 2 : 0) + c * dbw;
                            const y = 10 + r * dbh;
                            ctx.beginPath();
                            this._roundRect(ctx, x, y, dsw, dsh, Math.max(2, dsw * 0.22));
                            ctx.fillStyle = cell.finalColor;
                            ctx.fill();
                        }));
                    });
                } else {
                    const { cols, rows } = this.params;
                    maxCols = cols;
                    cv.width = Math.ceil((cols + 0.5) * bw) + 20;
                    cv.height = Math.ceil(rows * bh) + 20;
                    ctx.fillStyle = this.params.groundColor;
                    ctx.fillRect(0, 0, cv.width, cv.height);
                    for (let r = 0; r < rows; r++) {
                        const odd = r % 2 === 1;
                        for (let c = 0; c < cols; c++) {
                            const cell = this.quantizedGrid[r]?.[c];
                            if (!cell) continue;
                            ctx.beginPath();
                            this._roundRect(ctx, 10 + (odd ? bw / 2 : 0) + c * bw, 10 + r * bh, sw, sh, beadR);
                            ctx.fillStyle = cell.finalColor;
                            ctx.fill();
                        }
                    }
                }

                // downscale to a checkout-sized thumbnail
                const maxW = 520;
                const scale = Math.min(1, maxW / cv.width);
                const out = document.createElement('canvas');
                out.width = Math.max(1, Math.round(cv.width * scale));
                out.height = Math.max(1, Math.round(cv.height * scale));
                out.getContext('2d').drawImage(cv, 0, 0, out.width, out.height);
                return out.toDataURL('image/png');
            } catch (e) {
                return null;
            }
        },

        orderKit() {
            if (this.appState !== 'COMPUTED') {
                return this._toast("Compute a pattern first.", "error");
            }
            const counts = this._orderCounts();
            const names = Object.keys(counts);
            if (!names.length) return this._toast("Nothing to order yet.", "error");

            const beads = names
                .map(name => ({ name, hex: PALETTE_HEX[name] || "#888888", count: counts[name] }))
                .sort((a, b) => b.count - a.count);
            const totalBeads = beads.reduce((sum, b) => sum + b.count, 0);

            let layout = null;
            if (this.params.mode === 'diamond') {
                const g = this._chainGeo || (this.chain && this.chain.derive ? this.chain.derive() : null);
                const grids = this.chain?.quantizedGrid || [];
                layout = {
                    mode: 'diamond',
                    chainParams: this.chain?.params ? JSON.parse(JSON.stringify(this.chain.params)) : null,
                    numDiamonds: grids.length,
                    diamonds: grids.map(grid => grid.map(row => row.map(cell => {
                        if (!cell) return null;
                        return {
                            color: cell.finalColor,
                            name: HEX_TO_NAME[cell.finalColor] || "Unknown"
                        };
                    })))
                };
            } else {
                const { cols, rows } = this.params;
                const matrix = [];
                for (let r = 0; r < rows; r++) {
                    const row = [];
                    for (let c = 0; c < cols; c++) {
                        const cell = this.quantizedGrid?.[r]?.[c];
                        row.push(cell ? { color: cell.finalColor, name: HEX_TO_NAME[cell.finalColor] || "Unknown" } : null);
                    }
                    matrix.push(row);
                }
                layout = {
                    mode: 'peyote',
                    matrix
                };
            }

            const payload = {
                created: new Date().toISOString(),
                mode: this.params.mode,
                settings: {
                    colLevel: this.params.colLevel,
                    rowLevel: this.params.rowLevel,
                    groundColor: this.params.groundColor,
                    outlineEnabled: this.params.outlineEnabled,
                    outlineColor: this.params.outlineColor,
                    algoMode: this.algoMode
                },
                grid: { columns: this.params.cols, rows: this.params.rows },
                bead: { diameter_mm: this.params.diam, pitch_mm: this.params.pitch },
                physical: {
                    width_mm: parseFloat((this.params.cols * this.params.diam + this.params.diam / 2).toFixed(2)),
                    height_mm: parseFloat((this.params.rows * this.params.pitch).toFixed(2))
                },
                totalBeads,
                beads,
                layout,
                preview: this._orderPreview()
            };
            sessionStorage.setItem('beadazzle_order', JSON.stringify(payload));
            this.exportModal.classList.remove('active');
            location.href = 'checkout.html';
        }
};
