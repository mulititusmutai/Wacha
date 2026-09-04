// Beadazzle — asset pipelines — image, text, and stripes generation plus their transforms.
// Mixin: merged onto Beadazzle.prototype by studio.js
import {
    SIZE_LEVELS
} from './constants.js';

export const assetsMixin = {
        // ── Shared image draw: used by both _renderImage and runQuantization ──
        _drawImageToContext(ctx) {
            if (!this.loadedImage) return;
            const w = ctx.canvas.width;
            const baseScale = w / this.loadedImage.width;
            const finalW = this.loadedImage.width * baseScale * this.params.scale;
            const finalH = this.loadedImage.height * baseScale * this.params.scale;
            ctx.save();
            ctx.filter = `saturate(${this.params.saturate})`;
            ctx.translate(this.params.tx + finalW / 2, this.params.ty + finalH / 2);
            ctx.rotate((this.params.rot * Math.PI) / 180);
            ctx.scale(this.flipH ? -1 : 1, this.flipV ? -1 : 1);
            ctx.drawImage(this.loadedImage, -finalW / 2, -finalH / 2, finalW, finalH);
            ctx.restore();
            ctx.filter = 'none';
        },

        _renderImage() {
            const ctx = this.xImg;
            const w = ctx.canvas.width, h = ctx.canvas.height;
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = this.params.groundColor;
            ctx.fillRect(0, 0, w, h);
            if (this.params.mode === 'diamond') {
                // raw TEXT preview: the shared glyph canvas sits beneath
                // the transparent bead grid — WYSIWYG with quantization
                if (this.chain.params.mode === 'TEXT' && this.appState === "LAYOUT" && this._chainGeo)
                    this.chain.drawAssetBase(ctx, this._chainGeo, this.chain.assetRes(this._chainGeo).res);
                return;
            }
            if (this.loadedImage && this.appState === "LAYOUT") {
                this._drawImageToContext(ctx);
            }
        },

        checkOverflow() {
            if (!this.loadedImage) return;
            const baseScale = this.cImage.width / this.loadedImage.width;
            const finalW = this.loadedImage.width * baseScale * this.params.scale;
            const finalH = this.loadedImage.height * baseScale * this.params.scale;
            const centerX = this.params.tx + finalW / 2;
            const centerY = this.params.ty + finalH / 2;
            const rad = this.params.rot * Math.PI / 180;
            const hw = finalW / 2, hh = finalH / 2;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            const cornersFixed = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([x,y]) => ({
                x: centerX + x * cos - y * sin, y: centerY + x * sin + y * cos
            }));
            const minX = Math.min(...cornersFixed.map(p => p.x));
            const maxX = Math.max(...cornersFixed.map(p => p.x));
            const minY = Math.min(...cornersFixed.map(p => p.y));
            const maxY = Math.max(...cornersFixed.map(p => p.y));
            const overflow = (minX < 0) || (minY < 0) || (maxX > this.cImage.width) || (maxY > this.cImage.height);
            const warnEl = document.getElementById('overflow-warning');
            if (warnEl) warnEl.style.display = overflow ? 'block' : 'none';
        },

        // ── Text Asset Pipeline ──────────────────────────────────────────
        _checkTextBlocks(text, font) {
            if (this.params.mode === 'diamond') return false; // one diamond per char, auto-added
            // Blocked only if the text cannot fit even at small rows with
            // large columns (the longest/thinnest level combination).
            const tempCtx = document.createElement('canvas').getContext('2d');
            const maxCols = this._levelMM().cols.L / this.params.diam;
            const reqCols = rowLv => {
                tempCtx.font = `bold ${this._levelMM().rows[rowLv] * 0.75}px ${font}`;
                return tempCtx.measureText(text).width / this.params.diam;
            };
            if (reqCols('M') <= maxCols) return false;
            return reqCols('S') > maxCols;
        },

        _onTextBeforeInput(e) {
            if (e.inputType && e.inputType.startsWith('insert') && e.data) {
                const el = document.getElementById('text-input');
                const start = el.selectionStart, end = el.selectionEnd;
                const candidate = el.value.slice(0, start) + e.data + el.value.slice(end);
                if (this._checkTextBlocks(candidate, document.getElementById('font-select').value)) {
                    e.preventDefault();
                    this._toast("Max grid limit reached. Text too long.", "error");
                }
            }
        },

        generateTextAsset() {
            if (this.params.mode === 'diamond') {
                const text = document.getElementById('text-input').value;
                document.getElementById('char-count').innerText = `${Array.from(text).length} chars`;
                document.getElementById('text-grid-readout').innerText = 'One diamond per character';
                // text edits are structural — drop any computed pattern
                this._resetQuantizationState();
                this._renderDiamondSwatches();
                this._updateCalculationsChain();
                return;
            }
            const text = document.getElementById('text-input').value;
            const font = document.getElementById('font-select').value;
            document.getElementById('char-count').innerText = `${text.length} chars`;

            if (!text) {
                this.loadedImage = null;
                document.getElementById('text-grid-readout').innerText = `Auto Grid: -- × --`;
                this._resetQuantizationState();
                this.dirty.img = true;
                return;
            }

            // Text autosizing across size levels: start at medium rows
            // and grow columns S -> M -> L as the text gets longer; if it
            // no longer fits even at large columns, drop to small rows
            // (longer, thinner strip) and grow columns again.
            const tempCtx = document.createElement('canvas').getContext('2d');
            const MM = this._levelMM();
            const colsCount = lv => MM.cols[lv] / this.params.diam;
            const reqCols = rowLv => {
                tempCtx.font = `bold ${MM.rows[rowLv] * 0.75}px ${font}`;
                return tempCtx.measureText(text).width / this.params.diam;
            };
            const fitLevel = req => SIZE_LEVELS.find(lv => req <= colsCount(lv)) || 'L';

            let blocked = false;
            let rowLv = 'M';
            if (reqCols('M') > colsCount('L')) {
                rowLv = 'S';
                if (reqCols('S') > colsCount('L')) blocked = true;
            }
            const colLv = fitLevel(reqCols(rowLv));

            this.params.rowLevel = rowLv;
            this.params.colLevel = colLv;
            this._updateLevelButtons();
            this._updateCalculations();

            const readout = document.getElementById('text-grid-readout');
            readout.innerText = `Auto Grid: ${colLv}/${rowLv} (${this.params.cols} × ${this.params.rows})`;
            readout.style.color = blocked ? 'var(--accent-warning)' : 'var(--text-muted)';

            const renderCanvas = document.createElement('canvas');
            const res = 15;
            renderCanvas.width = this.params.cols * this.params.diam * res;
            renderCanvas.height = this.params.rows * this.params.pitch * res;
            const ctx = renderCanvas.getContext('2d', { willReadFrequently: true });

            ctx.clearRect(0, 0, renderCanvas.width, renderCanvas.height);
            ctx.fillStyle = this.textBgColor;
            ctx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);

            const textH = this.params.rows * this.params.pitch * res;
            ctx.font = `bold ${textH * 0.75}px ${font}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = this.textColor;
            ctx.fillText(text, renderCanvas.width / 2, renderCanvas.height / 2);

            const img = new Image();
            img.onload = () => {
                this.loadedImage = img;
                this.params.tx = 0; this.params.ty = 0; this.params.scale = 1.0; this.params.rot = 0;
                this.flipH = false; this.flipV = false;
                document.getElementById('readout-tx').innerText = 0;
                document.getElementById('readout-ty').innerText = 0;
                document.getElementById('input-scale').value = 1.0;
                document.getElementById('val-scale').innerText = '1.00x';
                this.clearManualOverrides();
                this._resetQuantizationState();
                this.dirty.img = true;
                this.checkOverflow();
            };
            img.src = renderCanvas.toDataURL();
        },

        autoCenterAsset() {
            // diamond chain has no movable asset — re-fit the viewport
            if (this.params.mode === 'diamond') return this.fitToScreen();
            if (!this.loadedImage) return;
            const baseScale = this.cImage.width / this.loadedImage.width;
            const finalW = this.loadedImage.width * baseScale * this.params.scale;
            const finalH = this.loadedImage.height * baseScale * this.params.scale;
            this.params.tx = Math.round((this.cImage.width - finalW) / 2);
            this.params.ty = Math.round((this.cImage.height - finalH) / 2);
            document.getElementById('readout-tx').innerText = this.params.tx;
            document.getElementById('readout-ty').innerText = this.params.ty;
            this.dirty.img = true;
            this.checkOverflow();
        },

        _syncTxTy() {
            document.getElementById('readout-tx').innerText = this.params.tx;
            document.getElementById('readout-ty').innerText = this.params.ty;
            this._resetQuantizationState(); this.dirty.img = true; this.checkOverflow();
        },

        _syncScale() {
            const el = document.getElementById('input-scale');
            el.value = this.params.scale;
            document.getElementById('val-scale').innerText = this.params.scale.toFixed(2) + 'x';
            this._updateSliderFill(el);
            this._resetQuantizationState(); this.dirty.img = true; this.checkOverflow();
        },

        // ── Stripes Panel ────────────────────────────────────────────────
        _initStripes() {
            this._renderStripeList();
        },

        _renderStripeList() {
            ['stripe-list', 'mob-stripe-list'].forEach(listId => {
                const list = document.getElementById(listId);
                if (!list) return;
                list.innerHTML = '';
                this.stripes.forEach((stripe, i) => {
                    list.appendChild(this._buildStripeRow(stripe, i));
                });
            });
            this._updateStripePreview();
        },

        _buildStripeRow(stripe, i) {
            const row = document.createElement('div');
            row.className = 'stripe-row';

            // Color swatch with hidden color input
            const swatch = document.createElement('div');
            swatch.className = 'stripe-color-swatch';
            swatch.style.backgroundColor = stripe.color;
            const colorIn = document.createElement('input');
            colorIn.type = 'color';
            colorIn.value = stripe.color;
            colorIn.addEventListener('input', e => {
                this.stripes[i].color = e.target.value;
                swatch.style.backgroundColor = e.target.value;
                this._updateStripePreview();
                if (this.assetMode === 'STRIPES') this.generateStripesAsset();
            });
            swatch.appendChild(colorIn);
            swatch.addEventListener('click', () => colorIn.click());

            const lbl = document.createElement('span');
            lbl.className = 'stripe-label';
            lbl.textContent = `Stripe ${i + 1}`;

            const wLabel = document.createElement('span');
            wLabel.style.cssText = 'font-size:9px;color:var(--text-muted);font-family:var(--font-mono);';
            wLabel.textContent = 'wt';

            const weightIn = document.createElement('input');
            weightIn.type = 'number';
            weightIn.className = 'stripe-weight-input';
            weightIn.min = '1'; weightIn.max = '20'; weightIn.step = '1';
            weightIn.value = stripe.weight;
            weightIn.addEventListener('input', e => {
                this.stripes[i].weight = Math.max(1, parseInt(e.target.value) || 1);
                this._updateStripePreview();
                if (this.assetMode === 'STRIPES') this.generateStripesAsset();
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'stripe-del';
            delBtn.textContent = '×';
            delBtn.title = 'Remove stripe';
            delBtn.addEventListener('click', () => {
                if (this.stripes.length <= 1) { this._toast("Need at least one stripe.", "error"); return; }
                this.stripes.splice(i, 1);
                this._renderStripeList();
                if (this.assetMode === 'STRIPES') this.generateStripesAsset();
            });

            row.appendChild(swatch);
            row.appendChild(lbl);
            row.appendChild(wLabel);
            row.appendChild(weightIn);
            row.appendChild(delBtn);
            return row;
        },

        _updateStripePreview() {
            ['stripe-preview', 'mob-stripe-preview'].forEach(previewId => {
                const preview = document.getElementById(previewId);
                if (!preview) return;
                preview.innerHTML = '';
                const totalWeight = this.stripes.reduce((s, st) => s + st.weight, 0);
                this.stripes.forEach(st => {
                    const seg = document.createElement('div');
                    seg.style.flex = st.weight / totalWeight;
                    seg.style.backgroundColor = st.color;
                    preview.appendChild(seg);
                });
            });
        },

        generateStripesAsset() {
            if (!this.stripes.length) return;
            const totalWeight = this.stripes.reduce((s, st) => s + st.weight, 0);
            const res = 4;
            const cw = Math.max(1, this.cImage.width);
            const ch = Math.max(1, this.cImage.height);
            const rc = document.createElement('canvas');
            rc.width = cw * res; rc.height = ch * res;
            const ctx = rc.getContext('2d');
            let y = 0;
            this.stripes.forEach(st => {
                const h = (st.weight / totalWeight) * rc.height;
                ctx.fillStyle = st.color;
                ctx.fillRect(0, Math.round(y), rc.width, Math.ceil(h));
                y += h;
            });
            const img = new Image();
            img.onload = () => {
                this.loadedImage = img;
                this.params.tx = 0; this.params.ty = 0;
                this.params.scale = 1.0; this.params.rot = 0;
                this.clearManualOverrides();
                this._resetQuantizationState();
                this.dirty.img = true;
            };
            img.src = rc.toDataURL();
        },

        handleImageFile(file) {
            if (!file || !file.type.startsWith('image/')) { this._toast("Invalid file type. Please upload an image.", "error"); return; }
            const reader = new FileReader();
            reader.onload = event => {
                const imgObj = new Image();
                imgObj.onload = () => {
                    this.loadedImage = imgObj;
                    this.flipH = false; this.flipV = false;
                    this.params.rot = 0; this.params.scale = 1.0;
                    document.getElementById('input-scale').value = 1.0;
                    document.getElementById('val-scale').innerText = '1.00x';
                    this.clearManualOverrides();
                    this._resetQuantizationState();
                    this.autoCenterAsset();
                    this._toast("Image loaded successfully.");
                };
                imgObj.onerror = () => this._toast("Failed to decode image. File may be corrupted.", "error");
                imgObj.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
};
