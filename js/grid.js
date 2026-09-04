// Beadazzle — grid rendering — rectangular + diamond DOM grids, swatches, and the bead popover.
// Mixin: merged onto Beadazzle.prototype by studio.js
import {
    HEX_TO_NAME,
    hexToRgb
} from './constants.js';

export const gridMixin = {
        renderDOMGrid() {
            if (this.params.mode === 'diamond') return this._renderDiamondGrid();
            const { cols, rows } = this.params;
            const fragment = document.createDocumentFragment();
            for (let r = 0; r < rows; r++) {
                const isOddRow = (r % 2 === 1);
                const xOff = isOddRow ? this.bw / 2 : 0;
                const y = r * this.bh;
                if (isOddRow) {
                    const voidDiv = document.createElement('div');
                    voidDiv.className = 'bead-void';
                    voidDiv.style.cssText = `left:0px;top:${y}px;width:${this.bw/2}px;height:${this.sh}px;`;
                    fragment.appendChild(voidDiv);
                }
                for (let c = 0; c < cols; c++) {
                    const x = c * this.bw + xOff;
                    const bead = document.createElement('div');
                    bead.className = 'bead';
                    bead.style.cssText = `left:${x}px;top:${y}px;width:${this.sw}px;height:${this.sh}px;`;
                    bead.dataset.row = r; bead.dataset.col = c;
                    if (this.appState === "COMPUTED") {
                        bead.classList.add('computed');
                        const cell = this.quantizedGrid[r]?.[c];
                        if (cell) {
                            bead.style.backgroundColor = cell.finalColor;
                            const rgb = hexToRgb(cell.finalColor);
                            bead.style.setProperty('--bead-line-color', `rgba(${rgb.r},${rgb.g},${rgb.b},0.55)`);
                        }
                    } else {
                        bead.style.backgroundColor = 'transparent';
                    }
                    fragment.appendChild(bead);
                }
                if (!isOddRow) {
                    const rx = cols * this.bw;
                    const voidDiv = document.createElement('div');
                    voidDiv.className = 'bead-void';
                    voidDiv.style.cssText = `left:${rx}px;top:${y}px;width:${this.bw/2}px;height:${this.sh}px;`;
                    fragment.appendChild(voidDiv);
                }
            }
            this.gridContainer.innerHTML = '';
            this.gridContainer.appendChild(fragment);
        },

        openNodePopover(col, row, screenX, screenY, cell) {
            document.getElementById('popover-coords').innerText = `[Col: ${col}, Row: ${row}]`;
            this._setupTierDisplay('1', cell.tabs[0], col, row);
            this._setupTierDisplay('2', cell.tabs[1], col, row);
            this._setupTierDisplay('3', cell.tabs[2], col, row);
            this.popover.style.display = 'block';
            const vpRect = this.viewport.getBoundingClientRect();
            this.popover.style.left = Math.min(screenX - vpRect.left + 15, this.viewport.clientWidth - 340) + 'px';
            this.popover.style.top  = Math.min(screenY - vpRect.top  + 15, this.viewport.clientHeight - 320) + 'px';
        },

        _setupTierDisplay(tierNum, tabData, col, row) {
            const block = document.getElementById(`tier-${tierNum}-block`);
            if (!tabData) { block.style.display = 'none'; return; }
            block.style.display = 'block';
            document.getElementById(`t${tierNum}-src`).style.backgroundColor = tabData.rawColor;
            const container = document.getElementById(`t${tierNum}-opts`);
            container.innerHTML = '';
            tabData.options.forEach(hex => {
                const btn = document.createElement('button');
                btn.className = 'btn-palette-opt';
                btn.innerHTML = `<div class="opt-swatch" style="background:${hex}"></div><div class="opt-label">${hex.toUpperCase()}</div>`;
                btn.onclick = () => this.injectOverride(col, row, hex);
                container.appendChild(btn);
            });
        },

        injectOverride(col, row, hexColor) {
            if (this.quantizedGrid[row]?.[col]) {
                this.quantizedGrid[row][col].finalColor = hexColor;
                this.quantizedGrid[row][col].manualOverride = true;
                this.renderDOMGrid();
            }
            this.closePopover();
        },

        closePopover() { this.popover.style.display = 'none'; },

        // ╔════════════════════════════════════════════════════════════════╗
        // ║  Diamond chain matrix integration (item type "diamond")        ║
        // ╚════════════════════════════════════════════════════════════════╝

        // Diamond chain DOM: one rotated lattice per diamond, placed at
        // its derived center inside the chain bbox. Bead fills come
        // from cellFill (raw asset preview / per-diamond fills /
        // quantized pattern / outline), matching the rectangular
        // grid's LAYOUT vs COMPUTED states.
        _renderDiamondGrid() {
            const chain = this.chain;
            const g = this._chainGeo;
            if (!g) return;
            const computed = this.appState === 'COMPUTED';
            let glyphMaps = null;
            if (computed) glyphMaps = chain.quantize(g);
            const chars = Array.from(chain.params.text || '');
            const minX = g.bbox.minX, minY = g.bbox.minY;
            const frag = document.createDocumentFragment();

            g.centers.forEach((p, i) => {
                const unit = document.createElement('div');
                unit.className = 'diamond-unit';
                unit.style.cssText =
                    `left:${p.cx - g.bboxW / 2 - minX}px;top:${p.cy - g.bboxH / 2 - minY}px;` +
                    `width:${g.bboxW}px;height:${g.bboxH}px;`;

                const lattice = document.createElement('div');
                lattice.className = 'lattice';
                lattice.style.cssText =
                    `position:absolute;left:${(g.bboxW - g.latticeW) / 2}px;top:${(g.bboxH - g.latticeH) / 2}px;` +
                    `width:${g.latticeW}px;height:${g.latticeH}px;transform:rotate(45deg);`;

                const label = document.createElement('div');
                label.className = 'diamond-label';
                label.textContent = (chain.params.mode === 'TEXT' ? `${chars[i] || '·'} · ` : `◆ ${i + 1} · `) +
                    `${g.diamH.toFixed(1)}mm · ${g.cols}×${g.rows}`;
                lattice.appendChild(label);

                const lf = document.createDocumentFragment();
                for (let r = 0; r < g.rows; r++) {
                    const odd = r % 2 === 1;
                    const y = r * g.bh;
                    if (odd) {
                        const v = document.createElement('div');
                        v.className = 'bead-void';
                        // peyote half-bead edge strips stay seethrough —
                        // they are lattice overhang, not beads
                        v.style.cssText = `left:0;top:${y}px;width:${g.bw / 2}px;height:${g.bh}px;`;
                        lf.appendChild(v);
                    }
                    for (let cc = 0; cc < g.cols; cc++) {
                        const cell = chain.cellFill(g, glyphMaps, i, r, cc);
                        if (cell.trimmed) continue;
                        const bead = document.createElement('div');
                        bead.className = 'bead' + (computed ? ' computed' : '');
                        const rgb = cell.fill && cell.fill[0] === '#' ? hexToRgb(cell.fill) : null;
                        bead.style.cssText =
                            `left:${(odd ? g.bw / 2 : 0) + cc * g.bw}px;top:${y}px;width:${g.bw}px;height:${g.bh}px;` +
                            `background-color:${cell.fill};` +
                            `--bead-line-color:${rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},0.55)` : 'rgba(255,255,255,0.18)'};`;
                        // diamond-local indexing: each diamond is its own
                        // matrix — [row, col] restart per unit
                        bead.dataset.unit = i; bead.dataset.row = r; bead.dataset.col = cc;
                        bead.title = `Diamond ${i + 1} · row ${r} · col ${cc}` +
                            (cell.isOutline ? ' · outline' : '');
                        lf.appendChild(bead);
                    }
                    if (!odd) {
                        const v = document.createElement('div');
                        v.className = 'bead-void';
                        v.style.cssText = `left:${g.cols * g.bw}px;top:${y}px;width:${g.bw / 2}px;height:${g.bh}px;`;
                        lf.appendChild(v);
                    }
                }
                lattice.appendChild(lf);
                unit.appendChild(lattice);
                frag.appendChild(unit);
            });
            this.gridContainer.innerHTML = '';
            this.gridContainer.appendChild(frag);
        },

        // Per-diamond solid fill swatches (SOLID mode direct fills;
        // in TEXT mode they tint the quantization asset background)
        _renderDiamondSwatches() {
            const wrap = document.getElementById('diamond-colors');
            if (!wrap) return;
            wrap.innerHTML = '';
            if (this.params.mode !== 'diamond') return;
            const n = this.chain._count();
            for (let i = 0; i < n; i++) {
                const inp = document.createElement('input');
                inp.type = 'color';
                inp.disabled = this.chain.params.mode === 'TEXT';
                inp.value = this.chain._diamColor(i);
                inp.title = `Diamond ${i + 1}`;
                inp.style.cssText = 'width:28px; height:26px; padding:2px;';
                inp.addEventListener('input', e => {
                    this.chain.diamondColors[i] = e.target.value;
                    this.renderDOMGrid();
                    this.dirty.img = true;
                });
                wrap.appendChild(inp);
            }
        },

        // ── diamond chain node popover ──────────────────────────────
        openChainPopover(beadEl, u, r, c, cell, screenX, screenY) {
            document.getElementById('popover-coords').innerText =
                `D${u + 1} [Col: ${c}, Row: ${r}]` +
                (cell.manualOverride ? ' · EDIT' : cell.isAmbiguous ? ' · AMBIG' : '');
            [['1', cell.tabs[0]], ['2', cell.tabs[1]], ['3', cell.tabs[2]]].forEach(([n, tab]) => {
                const block = document.getElementById(`tier-${n}-block`);
                if (!tab) { block.style.display = 'none'; return; }
                block.style.display = 'block';
                document.getElementById(`t${n}-src`).style.backgroundColor = tab.rawColor;
                const container = document.getElementById(`t${n}-opts`);
                container.innerHTML = '';
                tab.options.forEach(hex => {
                    const btn = document.createElement('button');
                    btn.className = 'btn-palette-opt';
                    btn.title = HEX_TO_NAME[hex] || hex;
                    btn.innerHTML = `<div class="opt-swatch" style="background:${hex}"></div>` +
                        `<div class="opt-label">${(HEX_TO_NAME[hex] || hex).split(' ')[0]}</div>`;
                    btn.onclick = () => this.injectChainOverride(beadEl, u, r, c, hex);
                    container.appendChild(btn);
                });
            });
            this.popover.style.display = 'block';
            const vpRect = this.viewport.getBoundingClientRect();
            this.popover.style.left = Math.min(screenX - vpRect.left + 15, this.viewport.clientWidth - 340) + 'px';
            this.popover.style.top  = Math.min(screenY - vpRect.top  + 15, this.viewport.clientHeight - 320) + 'px';
        },

        injectChainOverride(beadEl, u, r, c, hex) {
            const cell = this.chain.quantizedGrid?.[u]?.[r]?.[c];
            if (cell) {
                cell.finalColor = hex;
                cell.manualOverride = true;
                this.chain._overrides[`${u}:${r}:${c}`] = hex;
                beadEl.style.backgroundColor = hex;
                const rgb = hexToRgb(hex);
                beadEl.style.setProperty('--bead-line-color', `rgba(${rgb.r},${rgb.g},${rgb.b},0.55)`);
            }
            this.closePopover();
        }
};
