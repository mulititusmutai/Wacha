        // ╔═════════════════════════════════════════════════════════════════════╗
        // ║  FEATURE NOTES                                                      ║
        // ║  · Pattern Angle: the peyote lattice rotates as a unit —           ║
        // ║    canvas grows to the rotated bounding box, the DOM grid layer    ║
        // ║    is CSS-rotated about its center, and quantization samples the   ║
        // ║    rotated bead rects via inverse mapping.                         ║
        // ║  · Image Rotation: continuous slider (-180..+180); the CCW/CW      ║
        // ║    buttons now step it by 15 degrees. Optional MUTUAL link         ║
        // ║    mirrors rotation between image and lattice.                     ║
        // ║  · S/M/L size levels per item type (bracelet/earring/keychain)     ║
        // ║    with cascade (col level >= row level); delica removed.          ║
        // ║  · Outline beads: first/last rows+cols use a palette-quantized     ║
        // ║    outline color overriding the asset-derived color.               ║
        // ║  · 3D beads: corner radius 0.45, 12-point profile, 48 path segs.   ║
        // ╚═════════════════════════════════════════════════════════════════════╝
import {
    BEAD_SIZES, DC_MIN_ROWS, DC_SIZES, HEX_TO_NAME, LV_IDX, MODE_LEVELS,
    MM_TO_PX_C, RAW_PALETTE, SIZE_LEVELS, ZOOM_STOPS, ZOOM_TRUE_SCALE,
    getClosestPaletteColors, hexToRgb, stopToViewportZoom
} from './constants.js';
import { DiamondChainCore } from './diamond-chain.js?v=2';
import { Viewer3D } from './viewer3d.js';
import { exportMixin } from './exports.js';
import { gridMixin } from './grid.js?v=2';
import { assetsMixin } from './assets.js?v=2';
import { viewportMixin } from './viewport.js';
import { handoffMixin } from './handoff.js';



        // ╔═════════════════════════════════════════════════════════════════════╗
        // ║  MODULE: Beadazzle — main application class                        ║
        // ║                                                                    ║
        // ║  Owns app state, the S/M/L level system, quantization, the          ║
        // ║  diamond-chain integration, state transitions, and all DOM          ║
        // ║  event wiring. Subsystems live in sibling modules and are           ║
        // ║  merged onto Beadazzle.prototype at the bottom of this file:        ║
        // ║    viewport.js  — zoom / pan / fit / render loop                    ║
        // ║    assets.js    — image · text · stripes pipelines                  ║
        // ║    grid.js      — DOM grids, swatches, bead popover                 ║
        // ║    exports.js   — PNG / JSON export                                 ║
        // ╚════════════════════════════════════════════════════════════════════╝
        class Beadazzle {
            constructor() {
                this.MM_TO_PX = 96 / 25.4;
                this.params = {
                    mode: 'bracelet', rotLink: false,
                    colLevel: 'M', rowLevel: 'M',
                    cols: 52, rows: 28, diam: 2.3, pitch: 1.5,
                    scale: 1.0, rot: 0, tx: 0, ty: 0, patternAngle: 0,
                    zoom: ZOOM_TRUE_SCALE, // default = 1x real
                    groundColor: "#0d0f1c",
                    saturate: 1.0,
                    outlineEnabled: false,
                    outlineColor: "#1c1813"
                };
                this.flipH = false;
                this.flipV = false;
                this.appState = "LAYOUT";
                this.assetMode = "IMAGE";
                this.algoMode = "Blended";
                this.chainFillMode = "TEXT";   // diamond chain: TEXT | FILL
                this.loadedImage = null;
                this.quantizedGrid = [];
                this.textColor = "#ffffff";
                this.textBgColor = "#ffffff";

                // Diamond chain matrix (item type "diamond")
                this.chain = new DiamondChainCore();
                this._chainGeo = null;

                // Stripes state: array of { color, weight }
                this.stripes = [
                    { color: '#c0392b', weight: 2 },
                    { color: '#ece3d2', weight: 1 },
                    { color: '#1c1813', weight: 2 },
                    { color: '#ece3d2', weight: 1 },
                    { color: '#3a5c44', weight: 2 },
                ];

                this.activeView = '2d';
                this.viewer3d   = null;

                this.vpX = 0; this.vpY = 0;
                this.dirty = { img: true, vp: true };
                this._isDragging = false;
                this._dragStartX = 0; this._dragStartY = 0;
                this._vpStartX = 0; this._vpStartY = 0;
                this.bw = 0; this.bh = 0; this.physW = 0; this.physH = 0; this.canvasScale = 0;
                this.gridPxW = 0; this.gridPxH = 0;

                this._cacheDOM();
                this._initLayers();
                this._initBeadSizePanel();
                this._initEmojiPicker();
                this._initAccordions();
                this._initThemeSwitcher();
                this._initAngleControls();
                this._initStripes();
                this._updateCalculations();
                this._bindEvents();
                this._loop();
                // Defer fitToScreen until after the browser has resolved
                // the CSS grid layout — otherwise getBoundingClientRect()
                // returns zero dimensions and the canvas lands at top-left.
                requestAnimationFrame(() => this.fitToScreen());
            }

            _cacheDOM() {
                const $ = id => document.getElementById(id);
                this.viewport = $('viewport');
                this.wrapper = $('canvas-wrapper');
                this.cImage = $('cImage');
                this.gridContainer = $('grid-container');
                this.xImg = this.cImage.getContext('2d', { willReadFrequently: true });
                this.popover = $('node-popover');
                this.popoverCancel = $('popover-cancel');
                this.exportModal = $('export-modal-overlay');
            }

            _initLayers() {
                this.cImage.width = 10; this.cImage.height = 10;
                this.cImage.style.width = '10px'; this.cImage.style.height = '10px';
            }

            _initAccordions() {
                document.querySelectorAll('.accordion-header').forEach(header => {
                    header.addEventListener('click', () => header.parentElement.classList.toggle('open'));
                });
            }

            _initThemeSwitcher() {
                this.themeBtn = document.getElementById('theme-switcher');
                this.themeIcon = document.getElementById('theme-icon');
                this.themeText = document.getElementById('theme-text');
                this.currentTheme = 'dark';
                this._toggleTheme = () => {
                    if (this.currentTheme === 'dark') { this.currentTheme = 'light'; this.themeIcon.textContent = '☀️'; this.themeText.textContent = 'LIGHT'; }
                    else { this.currentTheme = 'dark'; this.themeIcon.textContent = '🌙'; this.themeText.textContent = 'DARK'; }
                    document.documentElement.setAttribute('data-theme', this.currentTheme);
                    // Keep the mobile icon in sync with the desktop labels
                    const mobThemeBtn = document.getElementById('mob-theme-btn');
                    if (mobThemeBtn) mobThemeBtn.textContent = this.currentTheme === 'dark' ? '🌙' : '☀️';
                    // CSS vars have changed — bust cache and repaint all slider fills
                    this._invalidateCSSVarCache();
                    document.querySelectorAll('input[type="range"]').forEach(sl => this._updateSliderFill(sl));
                    // Update 3D background if viewer is active
                    if (this.viewer3d) this.viewer3d.updateBackground();
                };
                this.themeBtn.addEventListener('click', this._toggleTheme);
            }

            // ── Angle Controls (experimental) ─────────────────────────────────
            // Injects two continuous sliders into the existing desktop panels:
            //  - Image Rotation (-180..+180) inside "Rotation & Reflection"
            //  - Pattern Angle (-180..+180) appended to "Image Telemetry";
            //    rotates the whole peyote lattice as a unit (Option B).
            _initAngleControls() {
                const makeSliderRow = (labelText, id, val) => {
                    const wrap = document.createElement('div');
                    wrap.className = 'control-group';
                    wrap.innerHTML = `
                        <label>${labelText}</label>
                        <div class="range-wrapper">
                            <button class="btn-step" data-target="${id}" data-dir="-1">-</button>
                            <input type="range" id="${id}" min="-180" max="180" step="1" value="${val}">
                            <button class="btn-step" data-target="${id}" data-dir="1">+</button>
                            <span class="range-val" id="val-${id}" style="width:44px;">${val}°</span>
                        </div>`;
                    return wrap;
                };

                // Rotation Link toggle: MUTUAL mirrors a rotation on one
                // slider into the other; INDIVIDUAL keeps them independent.
                const linkGroup = document.createElement('div');
                linkGroup.className = 'control-group';
                linkGroup.innerHTML = '<label>Rotation Link</label>' +
                    '<div class="rocker-switch" id="rot-link-switch">' +
                    '<button id="rot-link-ind" class="active">INDIVIDUAL</button>' +
                    '<button id="rot-link-mut">MUTUAL</button></div>';
                const setLink = mutual => {
                    this.params.rotLink = mutual;
                    document.getElementById('rot-link-ind').classList.toggle('active', !mutual);
                    document.getElementById('rot-link-mut').classList.toggle('active', mutual);
                };

                // Image rotation slider — replaces the 90°-step-only behavior.
                // The CCW/CW buttons below now step this same value by 15°.
                const rotGroup = document.getElementById('btn-rot-ccw').closest('.control-group');
                const imgRow = makeSliderRow('Image Rotation', 'input-rot', 0);
                rotGroup.insertBefore(imgRow, rotGroup.firstChild);
                rotGroup.insertBefore(linkGroup, rotGroup.firstChild);
                // bind only after insertion — getElementById needs the DOM
                document.getElementById('rot-link-ind').addEventListener('click', () => setLink(false));
                document.getElementById('rot-link-mut').addEventListener('click', () => setLink(true));
                const rotEl = document.getElementById('input-rot');
                rotEl.addEventListener('input', e => {
                    this.params.rot = parseFloat(e.target.value);
                    document.getElementById('val-input-rot').innerText = `${Math.round(this.params.rot)}°`;
                    this._updateSliderFill(rotEl);
                    if (this.params.rotLink) {
                        // mirror into the lattice angle
                        this.params.patternAngle = this.params.rot;
                        const pe = document.getElementById('input-pat-angle');
                        if (pe) {
                            pe.value = this.params.patternAngle;
                            document.getElementById('val-input-pat-angle').innerText = `${Math.round(this.params.patternAngle)}°`;
                            this._updateSliderFill(pe);
                        }
                        this._updateCalculations();
                    }
                    this._resetQuantizationState(); this.dirty.img = true; this.checkOverflow();
                });
                this._updateSliderFill(rotEl);

                // Pattern angle slider — rotates the lattice as a unit.
                const telemetry = document.querySelector('aside.sidebar.left section[data-section="3"] .accordion-inner');
                const patRow = makeSliderRow('Pattern Angle (grid)', 'input-pat-angle', 0);
                telemetry.appendChild(patRow);
                const patEl = document.getElementById('input-pat-angle');
                patEl.addEventListener('input', e => {
                    this.params.patternAngle = parseFloat(e.target.value);
                    document.getElementById('val-input-pat-angle').innerText = `${Math.round(this.params.patternAngle)}°`;
                    this._updateSliderFill(patEl);
                    if (this.params.rotLink) {
                        // mirror into the image rotation
                        this.params.rot = this.params.patternAngle;
                        const re = document.getElementById('input-rot');
                        if (re) {
                            re.value = this.params.rot;
                            document.getElementById('val-input-rot').innerText = `${Math.round(this.params.rot)}°`;
                            this._updateSliderFill(re);
                        }
                        this.dirty.img = true; this.checkOverflow();
                    }
                    this._updateCalculations();
                    this._resetQuantizationState();
                });
                this._updateSliderFill(patEl);
            }

            // ── Bead Size Panel ──────────────────────────────────────────────
            _initBeadSizePanel() {
                const typeEl = document.getElementById('bead-type-select');
                const sizeEl = document.getElementById('bead-size-select');
                const readout = document.getElementById('bead-dim-readout');

                const populateSizes = () => {
                    const type = typeEl.value;
                    sizeEl.innerHTML = '';
                    BEAD_SIZES[type].forEach((s, i) => {
                        const opt = document.createElement('option');
                        opt.value = i;
                        opt.textContent = s.label;
                        sizeEl.appendChild(opt);
                    });
                    applySize();
                };

                const applySize = () => {
                    const type = typeEl.value;
                    const s = BEAD_SIZES[type][parseInt(sizeEl.value) || 0];
                    if (!s) return;
                    // diamond chain guard: keep ≥6 peyote rows per diamond
                    if (this.params.mode === 'diamond' &&
                        this.chain.rowsForCount(this.chain._count(), parseInt(sizeEl.value) || 0) < DC_MIN_ROWS) {
                        this._toast("Min 6 rows per diamond with this bead size.", "error");
                        sizeEl.value = this.chain.params.beadIdx;
                        return;
                    }
                    this.params.diam = s.diam;
                    this.params.pitch = s.pitch;
                    document.getElementById('input-diam').value = s.diam;
                    document.getElementById('input-pitch').value = s.pitch;
                    readout.innerText = `${s.diam}mm × ${s.pitch}mm`;
                    const mobVal = document.getElementById('mob-bead-val');
                    if (mobVal) mobVal.textContent = s.label.split(' ')[0];
                    this._updateCalculations();
                    this._resetQuantizationState();
                };

                typeEl.addEventListener('change', populateSizes);
                sizeEl.addEventListener('change', applySize);

                // Mode toggle
                document.getElementById('bead-mode-standard').addEventListener('click', () => {
                    document.getElementById('bead-mode-standard').classList.add('active');
                    document.getElementById('bead-mode-direct').classList.remove('active');
                    document.getElementById('bead-standard-panel').style.display = 'block';
                    document.getElementById('bead-direct-panel').style.display = 'none';
                    applySize();
                });
                document.getElementById('bead-mode-direct').addEventListener('click', () => {
                    document.getElementById('bead-mode-direct').classList.add('active');
                    document.getElementById('bead-mode-standard').classList.remove('active');
                    document.getElementById('bead-standard-panel').style.display = 'none';
                    document.getElementById('bead-direct-panel').style.display = 'block';
                });

                populateSizes(); // Initial population
            }

            // ── Emoji Picker ─────────────────────────────────────────────────
            _initEmojiPicker() {
                const categories = {
                    Smileys: ['😀','😁','😂','😅','😉','😊','😍','😎','🤔','😭','😡','🥳'],
                    Hearts:  ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💕','💖','💔','💘'],
                    Animals: ['🐶','🐱','🦊','🐻','🐼','🦁','🐸','🐵','🦋','🐢','🦄','🐝'],
                    Nature:  ['🌸','🌻','🌵','🌲','🍀','🌈','⭐','🌙','☀️','⚡','🔥','❄️'],
                    Objects: ['🎉','🎈','🎵','💎','🔑','📌','💡','🎯','🏆','🚀','⚓','🎨'],
                    Flags:   ['🇰🇪','🇺🇸','🇬🇧','🇩🇪','🇫🇷','🇮🇹','🇪🇸','🇯🇵','🇨🇳','🇮🇳',
                              '🇧🇷','🇲🇽','🇨🇦','🇦🇺','🇳🇬','🇿🇦','🇪🇬','🇬🇭','🇪🇹','🇹🇿',
                              '🇷🇺','🇵🇹','🇳🇱','🇸🇪','🇳🇴','🇩🇰','🇫🇮','🇵🇱','🇺🇦','🇦🇷',
                              '🇨🇴','🇨🇱','🇵🇪','🇻🇪','🇮🇩','🇵🇭','🇹🇭','🇻🇳','🇰🇷','🇸🇦'],
                };
                const tabsEl = document.getElementById('emoji-tabs');
                const gridEl = document.getElementById('emoji-grid');
                const textInput = document.getElementById('text-input');

                const renderCategory = (name) => {
                    gridEl.innerHTML = '';
                    categories[name].forEach(em => {
                        const btn = document.createElement('button');
                        btn.className = 'emoji-opt';
                        btn.textContent = em;
                        btn.onclick = () => {
                            const candidate = textInput.value + em;
                            if (!this._checkTextBlocks(candidate, document.getElementById('font-select').value)) {
                                textInput.value = candidate;
                                this.generateTextAsset();
                            } else {
                                this._toast("Max grid limit reached.", "error");
                            }
                            textInput.focus();
                        };
                        gridEl.appendChild(btn);
                    });
                };

                Object.keys(categories).forEach((name, i) => {
                    const btn = document.createElement('button');
                    btn.className = `emoji-tab-btn ${i === 0 ? 'active' : ''}`;
                    btn.textContent = name;
                    btn.onclick = () => {
                        tabsEl.querySelectorAll('.emoji-tab-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        renderCategory(name);
                    };
                    tabsEl.appendChild(btn);
                });
                renderCategory('Smileys');
            }

            _updateCalculations() {
                if (this.params.mode === 'diamond') return this._updateCalculationsChain();
                this._syncLevelCounts();
                const physW = (this.params.cols * this.params.diam) + (this.params.diam / 2);
                const physH = this.params.rows * this.params.pitch;
                const totalBeads = this.params.cols * this.params.rows;
                const gridPxW = Math.max(1, Math.round(physW * this.MM_TO_PX));
                const gridPxH = Math.max(1, Math.round(physH * this.MM_TO_PX));
                // Canvas = bounding box of the whole lattice rotated by the
                // pattern angle, so a 45° turn still fits without clipping.
                const A = this.params.patternAngle * Math.PI / 180;
                const cA = Math.abs(Math.cos(A)), sA = Math.abs(Math.sin(A));
                const cw = Math.max(1, Math.round(gridPxW * cA + gridPxH * sA));
                const ch = Math.max(1, Math.round(gridPxW * sA + gridPxH * cA));
                this.gridPxW = gridPxW; this.gridPxH = gridPxH;

                document.getElementById('readout-dims').innerText = `${physW.toFixed(1)} × ${physH.toFixed(1)} mm`;
                document.getElementById('readout-volume').innerText = `${totalBeads.toLocaleString()} beads`;

                // oldCw/oldCh must be the previous ON-SCREEN canvas size in
                // CSS px — cImage.width is asset resolution in diamond mode
                // and mixing the two throws the view off-screen
                const oldCw = this._onScreenW || this.cImage.width,
                      oldCh = this._onScreenH || this.cImage.height;
                this.cImage.width = cw; this.cImage.height = ch;
                this.cImage.style.width = cw + 'px'; this.cImage.style.height = ch + 'px';
                this.gridContainer.style.width = gridPxW + 'px';
                this.gridContainer.style.height = gridPxH + 'px';
                // Center the lattice inside the bbox canvas, then rotate the
                // whole grid layer as a unit about its own center. The browser
                // transforms click hit-testing too, so the node popover and
                // bead dataset.row/col lookups keep working unchanged.
                this.gridContainer.style.left = ((cw - gridPxW) / 2) + 'px';
                this.gridContainer.style.top = ((ch - gridPxH) / 2) + 'px';
                this.gridContainer.style.transform = `rotate(${this.params.patternAngle}deg)`;

                this.canvasScale = gridPxW / physW;
                this.bw = this.params.diam * this.canvasScale;
                this.bh = this.params.pitch * this.canvasScale;
                this.sw = this.bw; this.sh = this.bh;
                this._onScreenW = cw; this._onScreenH = ch;

                this.vpX -= ((cw - oldCw) * this.params.zoom) / 2;
                this.vpY -= ((ch - oldCh) * this.params.zoom) / 2;

                // Auto-fit: snap to nearest stop that fits
                const padding = 40;
                const maxW = this.viewport.clientWidth - padding;
                const maxH = this.viewport.clientHeight - padding;
                if (maxW > 0 && maxH > 0) {
                    if (cw * this.params.zoom > maxW || ch * this.params.zoom > maxH) {
                        const rect = this.viewport.getBoundingClientRect();
                        const rawFit = Math.min(maxW / cw, maxH / ch);
                        // Snap to nearest zoom stop that fits
                        const fittingStop = [...ZOOM_STOPS].reverse().find(s => s.zoom <= rawFit) || ZOOM_STOPS[0];
                        this._zoomAtPoint(fittingStop.zoom, rect.width / 2, rect.height / 2);
                    }
                }

                this.renderDOMGrid();
                this.dirty.img = true; this.dirty.vp = true;
                this.checkOverflow();
            }

            // ── Size level system (S/M/L) ─────────────────────────────────────
            _levelMM() {
                // diamond chain has no MODE_LEVELS entry: the column table
                // doubles as the chain-length targets (DC_SIZES)
                return MODE_LEVELS[this.params.mode] || { cols: DC_SIZES, rows: DC_SIZES };
            }

            _syncLevelCounts() {
                // Convert the S/M/L physical targets into bead counts using the
                // current bead dimensions; rows are forced even for peyote.
                const MM = this._levelMM();
                this.params.cols = Math.max(1, Math.round(MM.cols[this.params.colLevel] / this.params.diam));
                let rows = Math.round(MM.rows[this.params.rowLevel] / this.params.pitch);
                if (rows % 2 !== 0) rows += 1;
                this.params.rows = Math.max(2, rows);
            }

            _updateLevelButtons() {
                document.querySelectorAll('#col-level-group button').forEach(b =>
                    b.classList.toggle('active', b.dataset.level === this.params.colLevel));
                document.querySelectorAll('#row-level-group button').forEach(b =>
                    b.classList.toggle('active', b.dataset.level === this.params.rowLevel));
                const mc = document.getElementById('mob-cols-val');
                const mr = document.getElementById('mob-rows-val');
                if (mc) mc.textContent = this.params.colLevel;
                if (mr) mr.textContent = this.params.rowLevel;
                const readout = document.getElementById('level-count-readout');
                if (readout) readout.textContent = this.params.cols + ' \u00d7 ' + this.params.rows + ' beads';
            }

            _applyLevelChange() {
                this._updateLevelButtons();
                this._updateCalculations();
                if (this.assetMode === 'TEXT') this.generateTextAsset();
                if (this.assetMode === 'STRIPES') this.generateStripesAsset();
                this._resetQuantizationState();
                this.dirty.img = true;
                this.checkOverflow();
            }

            _setColLevel(lv) {
                if (!this._levelMM().cols[lv] || lv === this.params.colLevel) return;
                this.params.colLevel = lv;
                // cascade: column level must be >= row level
                if (LV_IDX[this.params.rowLevel] > LV_IDX[lv]) this.params.rowLevel = lv;
                this._applyLevelChange();
            }

            _setRowLevel(lv) {
                if (!this._levelMM().rows[lv] || lv === this.params.rowLevel) return;
                this.params.rowLevel = lv;
                // cascade: column level must be >= row level
                if (LV_IDX[this.params.colLevel] < LV_IDX[lv]) this.params.colLevel = lv;
                this._applyLevelChange();
            }

            // ── Quantization ─────────────────────────────────────────────────
            runQuantization() {
                const oldGrid = this.quantizedGrid;
                const alpha = (this.algoMode === "Blended") ? 1 : 0;

                this.xImg.fillStyle = this.params.groundColor;
                this.xImg.fillRect(0, 0, this.cImage.width, this.cImage.height);
                this._drawImageToContext(this.xImg);

                const imgData = this.xImg.getImageData(0, 0, this.cImage.width, this.cImage.height);
                this.quantizedGrid = Array.from({ length: this.params.rows }, () => Array(this.params.cols).fill(null));

                // Pattern-angle sampling: beads live in grid-local (unrotated)
                // coordinates; canvas pixels map back through the inverse of
                // the CSS rotate() applied to the grid layer. CSS rotation is
                // clockwise in screen space: forward is (x·cos−y·sin, x·sin+y·cos)
                // about the shared center, so the inverse below undoes it.
                const A = this.params.patternAngle * Math.PI / 180;
                const cosA = Math.cos(A), sinA = Math.sin(A);
                const cCX = this.cImage.width / 2, cCY = this.cImage.height / 2;
                const glCX = this.gridPxW / 2, glCY = this.gridPxH / 2;
                const toLocal = (px, py) => {
                    const dx = px + 0.5 - cCX, dy = py + 0.5 - cCY;
                    return [glCX + dx * cosA + dy * sinA, glCY - dx * sinA + dy * cosA];
                };
                const toCanvas = (lx, ly) => {
                    const dx = lx - glCX, dy = ly - glCY;
                    return [cCX + dx * cosA - dy * sinA, cCY + dx * sinA + dy * cosA];
                };

                for (let r = 0; r < this.params.rows; r++) {
                    const offset = (r % 2 === 1) ? this.bw / 2 : 0;
                    const y0 = r * this.bh;
                    for (let c = 0; c < this.params.cols; c++) {
                        const x0 = offset + c * this.bw;
                        const colorHistogram = {}; let totalValidPixels = 0;
                        // Canvas-space bounding box of the rotated bead rect
                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                        for (const [clx, cly] of [[x0,y0],[x0+this.bw,y0],[x0+this.bw,y0+this.bh],[x0,y0+this.bh]]) {
                            const [px, py] = toCanvas(clx, cly);
                            if (px < minX) minX = px; if (px > maxX) maxX = px;
                            if (py < minY) minY = py; if (py > maxY) maxY = py;
                        }
                        for (let py = Math.floor(minY); py <= Math.ceil(maxY); py++) {
                            if (py < 0 || py >= this.cImage.height) continue;
                            for (let px = Math.floor(minX); px <= Math.ceil(maxX); px++) {
                                if (px < 0 || px >= this.cImage.width) continue;
                                // point-in-rect test in grid-local space
                                const [lx, ly] = toLocal(px, py);
                                if (lx < x0 || lx >= x0 + this.bw || ly < y0 || ly >= y0 + this.bh) continue;
                                const idx = (py * this.cImage.width + px) * 4;
                                if (imgData.data[idx + 3] < 128) continue;
                                totalValidPixels++;
                                const binKey = `${Math.floor(imgData.data[idx]/16)},${Math.floor(imgData.data[idx+1]/16)},${Math.floor(imgData.data[idx+2]/16)}`;
                                if (!colorHistogram[binKey]) colorHistogram[binKey] = { count: 0, r: 0, g: 0, b: 0 };
                                colorHistogram[binKey].count++;
                                colorHistogram[binKey].r += imgData.data[idx];
                                colorHistogram[binKey].g += imgData.data[idx + 1];
                                colorHistogram[binKey].b += imgData.data[idx + 2];
                            }
                        }
                        const sortedBins = Object.keys(colorHistogram).map(k => ({ ...colorHistogram[k] })).sort((a, b) => b.count - a.count);
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
                            this.quantizedGrid[r][c] = {
                                finalColor: dynamicDefaultColor, isAmbiguous,
                                manualOverride: false,
                                tabs: [
                                    { rawColor: `rgb(${r1},${g1},${b1Val})`, options: t1Options },
                                    b2 ? { rawColor: `rgb(${r2},${g2},${b2Val})`, options: t2Options } : null,
                                    b2 ? { rawColor: `rgb(${blendR},${blendG},${blendB})`, options: blendOptions } : null
                                ]
                            };
                            if (oldGrid && oldGrid[r] && oldGrid[r][c] && oldGrid[r][c].manualOverride) {
                                this.quantizedGrid[r][c].finalColor = oldGrid[r][c].finalColor;
                                this.quantizedGrid[r][c].manualOverride = true;
                            }
                        } else {
                            this.quantizedGrid[r][c] = { finalColor: this.params.groundColor, isAmbiguous: false, manualOverride: false, tabs: null };
                        }
                    }
                }

                // Outline beads: first/last rows and columns take the chosen
                // outline color, quantized to the nearest palette entry. This
                // overrides whatever the image/text/stripes produced for those
                // cells (including ground-filled cells). tabs are cleared so
                // the node popover can't put a non-outline color back.
                if (this.params.outlineEnabled) {
                    const oc = hexToRgb(this.params.outlineColor);
                    const outlineHex = getClosestPaletteColors(oc.r, oc.g, oc.b, 1)[0];
                    const lastR = this.params.rows - 1, lastC = this.params.cols - 1;
                    for (let r = 0; r < this.params.rows; r++) {
                        for (let c = 0; c < this.params.cols; c++) {
                            if (r === 0 || r === lastR || c === 0 || c === lastC) {
                                const cell = this.quantizedGrid[r][c];
                                cell.finalColor = outlineHex;
                                cell.isOutline = true;
                                cell.tabs = null;
                            }
                        }
                    }
                }
                this.renderDOMGrid();
                this.dirty.img = true;
            }

            _resetQuantizationState() {
                if (this.appState === "COMPUTED") this.transitionToLayout();
            }
            clearManualOverrides() { this.quantizedGrid = []; }

            transitionToComputed() {
                if (this.params.mode === 'diamond') {
                    this.appState = "COMPUTED";
                    document.getElementById('state-badge').innerText = "QUANTIZED PATTERN MODE";
                    document.getElementById('btn-revert').disabled = false;
                    // 3D stays disabled: Viewer3D only speaks rectangular lattices
                    document.getElementById('btn-view-3d').disabled = true;
                    this._updateCalculationsChain();
                    return;
                }
                if (!this.loadedImage) return this._toast("Provide an asset (Image/Text/Stripes) first.", "error");
                this.appState = "COMPUTED";
                document.getElementById('state-badge').innerText = "QUANTIZED PATTERN MODE";
                document.getElementById('btn-revert').disabled = false;
                document.getElementById('btn-view-3d').disabled = false;
                // Always land in 2D and refit on mode change
                if (this.activeView === '3d') this._switchTo2D();
                this.runQuantization();
                this.fitToScreen();
            }
            transitionToLayout() {
                if (this.params.mode === 'diamond') {
                    this.appState = "LAYOUT";
                    document.getElementById('state-badge').innerText = "LAYOUT MODE";
                    document.getElementById('btn-revert').disabled = true;
                    document.getElementById('btn-view-3d').disabled = true;
                    this.closePopover();
                    this._updateCalculationsChain();
                    return;
                }
                this.appState = "LAYOUT";
                document.getElementById('state-badge').innerText = "LAYOUT MODE";
                document.getElementById('btn-revert').disabled = true;
                document.getElementById('btn-view-3d').disabled = true;
                // Switch back to 2D and refit
                this._switchTo2D();
                this.closePopover();
                this.renderDOMGrid();
                this.dirty.img = true;
                this.fitToScreen();
            }

            _adjustSlider(id, direction) {
                const el = document.getElementById(id);
                if (!el) return;
                const step = parseFloat(el.step) || 1;
                let val = parseFloat(el.value) + (direction * step);
                val = Math.max(parseFloat(el.min), Math.min(parseFloat(el.max), val));
                el.value = val;
                el.dispatchEvent(new Event('input'));
            }

            _getCSSVar(name) {
                // Cached CSS variable reader — invalidated on theme switch
                if (!this._cssVarCache) this._cssVarCache = {};
                if (!(name in this._cssVarCache)) {
                    this._cssVarCache[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
                }
                return this._cssVarCache[name];
            }

            _invalidateCSSVarCache() {
                this._cssVarCache = {};
            }

            _updateSliderFill(sl) {
                if (!sl) return;
                const min = parseFloat(sl.min), max = parseFloat(sl.max), val = parseFloat(sl.value);
                const pct = ((val - min) / (max - min)) * 100;
                const accentColor = this._getCSSVar('--accent-mid');
                const borderColor = this._getCSSVar('--border');
                sl.style.background = `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${pct}%, ${borderColor} ${pct}%, ${borderColor} 100%)`;
            }

            // ── Events ───────────────────────────────────────────────────────
            _bindEvents() {
                this.viewport.addEventListener('wheel', e => this._onWheel(e), { passive: false });
                window.addEventListener('mousedown', e => this._onMouseDown(e));
                window.addEventListener('mousemove', e => this._onMouseMove(e));
                window.addEventListener('mouseup', () => this._onMouseUp());
                window.addEventListener('resize', () => this._updateCalculations());

                // Zoom stop buttons
                document.querySelectorAll('.zoom-stop-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const stop = parseFloat(btn.dataset.stop);
                        const rect = this.viewport.getBoundingClientRect();
                        this._zoomAtPoint(stopToViewportZoom(stop), rect.width / 2, rect.height / 2);
                    });
                });

                document.addEventListener('click', e => {
                    if (e.target.closest('.btn-step')) {
                        const btn = e.target.closest('.btn-step');
                        if (btn.id === 'close-export-modal') return;
                        this._adjustSlider(btn.dataset.target, parseInt(btn.dataset.dir));
                    }
                });

                // Rotation buttons (CCW / CW in 90° steps)
                // Continuous rotation kept in the -180..+180 range so the
                // slider and buttons never fight over the canonical value.
                const stepRot = delta => {
                    this.params.rot = ((this.params.rot + delta + 540) % 360) - 180;
                    const el = document.getElementById('input-rot');
                    if (el) {
                        el.value = this.params.rot;
                        // route through the input handler so the UI and the
                        // mutual-rotation mirror stay in sync
                        el.dispatchEvent(new Event('input'));
                    }
                };
                document.getElementById('btn-rot-ccw').addEventListener('click', () => stepRot(-15));
                document.getElementById('btn-rot-cw').addEventListener('click', () => stepRot(15));

                // Flip buttons
                document.getElementById('btn-flip-h').addEventListener('click', () => {
                    this.flipH = !this.flipH;
                    this._resetQuantizationState(); this.dirty.img = true;
                });
                document.getElementById('btn-flip-v').addEventListener('click', () => {
                    this.flipV = !this.flipV;
                    this._resetQuantizationState(); this.dirty.img = true;
                });

                // D-pad translation buttons
                const DPAD_STEP = 4;
                document.getElementById('dpad-up').addEventListener('click', () => { this.params.ty -= DPAD_STEP; this._syncTxTy(); });
                document.getElementById('dpad-down').addEventListener('click', () => { this.params.ty += DPAD_STEP; this._syncTxTy(); });
                document.getElementById('dpad-left').addEventListener('click', () => { this.params.tx -= DPAD_STEP; this._syncTxTy(); });
                document.getElementById('dpad-right').addEventListener('click', () => { this.params.tx += DPAD_STEP; this._syncTxTy(); });

                document.querySelectorAll('.rocker-switch button').forEach(btn => {
                    btn.addEventListener('click', () => {
                        this.algoMode = btn.dataset.mode;
                        document.getElementById('mode-dominant').classList.toggle('active', this.algoMode === 'Dominant');
                        document.getElementById('mode-blended').classList.toggle('active', this.algoMode === 'Blended');
                        if (this.params.mode === 'diamond') this.renderDOMGrid();
                        else if (this.appState === "COMPUTED") this.runQuantization();
                    });
                });

                document.getElementById('btn-revert').addEventListener('click', () => this.transitionToLayout());
                document.getElementById('btn-center').addEventListener('click', () => this.autoCenterAsset());
                document.getElementById('btn-compute').addEventListener('click', () => this.transitionToComputed());
                document.getElementById('btn-view-2d').addEventListener('click', () => this._switchTo2D());
                document.getElementById('btn-view-3d').addEventListener('click', () => this._switchTo3D());
                this.popoverCancel.addEventListener('click', () => this.closePopover());

                document.getElementById('btn-export').addEventListener('click', () => {
                    if (this.appState !== "COMPUTED") return this._toast("Compute pattern first before exporting.", "error");
                    this.exportModal.classList.add('active');
                });
                document.getElementById('close-export-modal').addEventListener('click', () => this.exportModal.classList.remove('active'));
                this.exportModal.addEventListener('click', e => { if (e.target === this.exportModal) this.exportModal.classList.remove('active'); });
                document.getElementById('export-png-opt').addEventListener('click', () => this.exportAsPNG());
                document.getElementById('export-json-opt').addEventListener('click', () => this.exportAsJSON());

                // Asset Tabs
                const switchTab = (mode) => {
                    document.getElementById('panel-image').style.display   = mode === 'IMAGE'   ? 'block' : 'none';
                    document.getElementById('panel-text').style.display    = mode === 'TEXT'    ? 'block' : 'none';
                    document.getElementById('panel-stripes').style.display = mode === 'STRIPES' ? 'block' : 'none';
                    document.getElementById('tab-image').classList.toggle('active',   mode === 'IMAGE');
                    document.getElementById('tab-text').classList.toggle('active',    mode === 'TEXT');
                    document.getElementById('tab-stripes').classList.toggle('active', mode === 'STRIPES');
                    this.assetMode = mode;
                };
                document.getElementById('tab-image').addEventListener('click', () => { switchTab('IMAGE'); });
                document.getElementById('tab-text').addEventListener('click',  () => { switchTab('TEXT'); this.generateTextAsset(); });
                document.getElementById('tab-stripes').addEventListener('click', () => {
                    switchTab('STRIPES');
                    this.generateStripesAsset();
                });

                // Add stripe button
                document.getElementById('btn-add-stripe').addEventListener('click', () => {
                    this.stripes.push({ color: '#888888', weight: 1 });
                    this._renderStripeList();
                    if (this.assetMode === 'STRIPES') this.generateStripesAsset();
                });

                // Text events
                const textInput = document.getElementById('text-input');
                textInput.addEventListener('beforeinput', e => this._onTextBeforeInput(e));
                textInput.addEventListener('input', () => this.generateTextAsset());
                document.getElementById('font-select').addEventListener('change', () => this.generateTextAsset());
                document.getElementById('text-color-input').addEventListener('input', e => {
                    this.textColor = e.target.value;
                    this.generateTextAsset();
                });
                document.getElementById('text-bg-color-input').addEventListener('input', e => {
                    this.textBgColor = e.target.value;
                    this.generateTextAsset();
                });
                document.getElementById('heart-btn').addEventListener('click', () => {
                    const p = document.getElementById('emoji-picker');
                    p.style.display = p.style.display === 'block' ? 'none' : 'block';
                });

                // Matrix structure binds (no max on cols/rows)
                const bind = (id, key, transform, extra) => {
                    document.getElementById(id).addEventListener('input', e => {
                        this.params[key] = parseFloat(e.target.value) || 0;
                        if (transform) transform(e.target.value);
                        if (extra) extra();
                        if (this.assetMode === 'TEXT') this.generateTextAsset();
                        if (this.assetMode === 'STRIPES') this.generateStripesAsset();
                        this._resetQuantizationState();
                        this.dirty.img = true;
                        this.checkOverflow();
                    });
                };
                // S/M/L level buttons (cascade: column level >= row level)
                document.querySelectorAll('#col-level-group button').forEach(btn => {
                    btn.addEventListener('click', () => this._setColLevel(btn.dataset.level));
                });
                document.querySelectorAll('#row-level-group button').forEach(btn => {
                    btn.addEventListener('click', () => this._setRowLevel(btn.dataset.level));
                });
                this._updateLevelButtons();

                // Item type switch: swaps the S/M/L dimension table, then
                // re-derives counts and regenerates the current asset.
                document.querySelectorAll('#mode-switch button').forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (btn.dataset.mode === this.params.mode) return;
                        this.params.mode = btn.dataset.mode;
                        document.querySelectorAll('#mode-switch button').forEach(b =>
                            b.classList.toggle('active', b === btn));
                        this._syncChainUI();
                        this._applyLevelChange();
                    });
                });

                // Diamond chain count (rejected if a diamond would drop
                // below DC_MIN_ROWS peyote rows)
                // Diamond chain: TEXT ↔ FILL swap (sits in the old Rows slot)
                document.querySelectorAll('#chain-mode-group button').forEach(b => {
                    b.addEventListener('click', () => {
                        if (this.params.mode !== 'diamond') return;
                        this.chainFillMode = b.dataset.chainMode;
                        if (this.chainFillMode === 'TEXT' && this.assetMode !== 'TEXT') {
                            document.getElementById('tab-text').click();
                        }
                        // FILL paints start from a clean slate; TEXT drives itself
                        this.chain.diamondColors = {};
                        this._syncChainParams();   // engine mode/count first…
                        this._syncChainUI();       // …then the UI reflects it
                        this._updateCalculationsChain();
                    });
                });

                document.getElementById('chain-count').addEventListener('input', e => {
                    if (this.params.mode !== 'diamond') return;
                    const v = Math.max(1, parseInt(e.target.value) || 1);
                    if (this.chain.rowsForCount(v) < DC_MIN_ROWS) {
                        e.target.value = this.chain.params.chainCount;
                        this._toast("Min 6 rows per diamond — lower the chain count.", "error");
                        return;
                    }
                    this.chain.params.chainCount = v;
                    this._renderDiamondSwatches();
                    this._updateCalculationsChain();
                });
                bind('input-diam', 'diam', null, () => this._updateCalculations());
                bind('input-pitch', 'pitch', null, () => this._updateCalculations());

                document.getElementById('input-scale').addEventListener('input', e => {
                    this.params.scale = parseFloat(e.target.value);
                    document.getElementById('val-scale').innerText = this.params.scale.toFixed(2) + 'x';
                    this._updateSliderFill(e.target);
                    this._resetQuantizationState(); this.dirty.img = true; this.checkOverflow();
                });

                document.getElementById('input-saturate').addEventListener('input', e => {
                    this.params.saturate = parseFloat(e.target.value);
                    document.getElementById('val-saturate').innerText = this.params.saturate.toFixed(1) + '×';
                    this._updateSliderFill(e.target);
                    this._resetQuantizationState(); this.dirty.img = true;
                });
                // Note: rotation and translation are controlled via buttons (btn-rot-ccw/cw, dpad)
                // rather than sliders/inputs — those listeners are in the button handlers above.
                document.getElementById('input-ground').addEventListener('input', e => {
                    this.params.groundColor = e.target.value;
                    this.renderDOMGrid(); this.dirty.img = true;
                });

                // Outline bead controls (Asset Source panel, bottom)
                const setOutline = on => {
                    this.params.outlineEnabled = on;
                    document.getElementById('outline-off').classList.toggle('active', !on);
                    document.getElementById('outline-on').classList.toggle('active', on);
                    if (this.params.mode === 'diamond') this.renderDOMGrid();
                    else if (this.appState === 'COMPUTED') this.runQuantization();
                };
                document.getElementById('outline-off').addEventListener('click', () => setOutline(false));
                document.getElementById('outline-on').addEventListener('click', () => setOutline(true));
                document.getElementById('input-outline-color').addEventListener('input', e => {
                    this.params.outlineColor = e.target.value;
                    if (this.params.mode === 'diamond') this.renderDOMGrid();
                    else if (this.appState === 'COMPUTED') this.runQuantization();
                });

                const dropZone = document.getElementById('drop-zone');
                const fileInput = document.getElementById('file-input');
                dropZone.addEventListener('click', () => fileInput.click());
                fileInput.addEventListener('change', e => { if (e.target.files.length) this.handleImageFile(e.target.files[0]); e.target.value = ''; });
                dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; });
                dropZone.addEventListener('dragleave', () => dropZone.style.borderColor = '');
                dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.style.borderColor = ''; if (e.dataTransfer.files.length) this.handleImageFile(e.dataTransfer.files[0]); });

                window.addEventListener('keydown', e => {
                    if (document.activeElement.tagName === 'INPUT') return;
                    let step = e.shiftKey ? 10 : 2;
                    if (e.key === 'ArrowLeft')  { this.params.tx -= step; this._syncTxTy(); }
                    if (e.key === 'ArrowRight') { this.params.tx += step; this._syncTxTy(); }
                    if (e.key === 'ArrowUp')    { this.params.ty -= step; this._syncTxTy(); }
                    if (e.key === 'ArrowDown')  { this.params.ty += step; this._syncTxTy(); }
                    if (e.key === '<' || e.key === ',') { this.params.scale = Math.max(0.1, this.params.scale - 0.02); this._syncScale(); }
                    if (e.key === '>' || e.key === '.') { this.params.scale = Math.min(3.0, this.params.scale + 0.02); this._syncScale(); }
                    if (e.key === '/') { e.preventDefault(); this.autoCenterAsset(); }
                });

                this.gridContainer.addEventListener('click', e => {
                    const bead = e.target.closest('.bead');
                    if (!bead) return;
                    // diamond chain: diamond-local [unit, row, col] indexing
                    if (bead.dataset.unit !== undefined) {
                        if (this.appState !== 'COMPUTED') return;
                        const u = parseInt(bead.dataset.unit), r = parseInt(bead.dataset.row), c = parseInt(bead.dataset.col);
                        const cell = this.chain.quantizedGrid?.[u]?.[r]?.[c];
                        if (cell && cell.tabs) this.openChainPopover(bead, u, r, c, cell, e.clientX, e.clientY);
                        return;
                    }
                    const r = parseInt(bead.dataset.row), c = parseInt(bead.dataset.col);
                    const cell = this.quantizedGrid[r]?.[c];
                    if (cell && cell.tabs) this.openNodePopover(c, r, e.clientX, e.clientY, cell);
                });
                document.addEventListener('click', e => {
                    if (e.target !== this.gridContainer && !this.gridContainer.contains(e.target) && !this.popover.contains(e.target)) {
                        this.closePopover();
                    }
                });

                document.querySelectorAll('input[type="range"]').forEach(sl => this._updateSliderFill(sl));

                this._bindMobileEvents();
            }

            // ── Mobile event bindings ─────────────────────────────────────────
            _bindMobileEvents() {
                const el = id => document.getElementById(id);
                if (!el('mob-compute')) return; // not in DOM — skip

                // Watch the viewport element for size changes so fitToScreen
                // always runs with real pixel dimensions — covers initial load,
                // orientation changes, and any CSS transition settling.
                const ro = new ResizeObserver(() => {
                    const r = this.viewport.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) this.fitToScreen();
                });
                ro.observe(this.viewport);

                // Compute
                el('mob-compute').addEventListener('click', () => {
                    this.transitionToComputed();
                });

                // Theme toggle (mobile)
                el('mob-theme-btn').addEventListener('click', this._toggleTheme);

                // Auto-center
                el('mob-center').addEventListener('click', () => {
                    this.autoCenterAsset();
                    this.fitToScreen();
                });

                // Up / Down nudge
                const DPAD_STEP = 4;
                el('mob-nudge-up').addEventListener('click',   () => { this.params.ty -= DPAD_STEP; this._syncTxTy(); });
                el('mob-nudge-down').addEventListener('click', () => { this.params.ty += DPAD_STEP; this._syncTxTy(); });

                // Level steppers: cycle S -> M -> L with cascade clamping
                const stepLevel = (axis, dir) => {
                    const cur = axis === 'col' ? this.params.colLevel : this.params.rowLevel;
                    const next = SIZE_LEVELS[Math.min(2, Math.max(0, LV_IDX[cur] + dir))];
                    if (next === cur) return;
                    if (axis === 'col') this._setColLevel(next); else this._setRowLevel(next);
                };
                el('mob-cols-minus').addEventListener('click', () => stepLevel('col', -1));
                el('mob-cols-plus').addEventListener('click', () => stepLevel('col', 1));
                el('mob-rows-minus').addEventListener('click', () => stepLevel('row', -1));
                el('mob-rows-plus').addEventListener('click', () => stepLevel('row', 1));

                // Bead resolution: cycle through the sizes of the current bead type
                const cycleBeadSize = (dir) => {
                    const sizeEl = document.getElementById('bead-size-select');
                    const type = document.getElementById('bead-type-select').value;
                    const n = BEAD_SIZES[type].length;
                    const idx = Math.min(n - 1, Math.max(0, (parseInt(sizeEl.value) || 0) + dir));
                    if (idx === (parseInt(sizeEl.value) || 0)) return;
                    sizeEl.value = idx;
                    sizeEl.dispatchEvent(new Event('change'));
                    el('mob-bead-val').textContent = BEAD_SIZES[type][idx].label.split(' ')[0];
                };
                el('mob-bead-minus').addEventListener('click', () => cycleBeadSize(-1));
                el('mob-bead-plus').addEventListener('click', () => cycleBeadSize(1));

                // Asset tabs — switch mobile panels AND sync desktop assetMode
                const mobSwitchTab = (mode) => {
                    el('mob-panel-image').style.display   = mode === 'IMAGE'   ? 'block' : 'none';
                    el('mob-panel-text').style.display    = mode === 'TEXT'    ? 'block' : 'none';
                    el('mob-panel-stripes').style.display = mode === 'STRIPES' ? 'flex' : 'none';
                    el('mob-tab-image').classList.toggle('active',   mode === 'IMAGE');
                    el('mob-tab-text').classList.toggle('active',    mode === 'TEXT');
                    el('mob-tab-stripes').classList.toggle('active', mode === 'STRIPES');
                    this.assetMode = mode;
                    if (mode === 'TEXT') this.generateTextAsset();
                    if (mode === 'STRIPES') this.generateStripesAsset();
                };
                el('mob-tab-image').addEventListener('click',   () => mobSwitchTab('IMAGE'));
                el('mob-tab-text').addEventListener('click',    () => mobSwitchTab('TEXT'));
                el('mob-tab-stripes').addEventListener('click', () => mobSwitchTab('STRIPES'));

                // Add stripe (mobile)
                el('mob-btn-add-stripe').addEventListener('click', () => {
                    this.stripes.push({ color: '#888888', weight: 1 });
                    this._renderStripeList();
                    if (this.assetMode === 'STRIPES') this.generateStripesAsset();
                });

                // Image file input
                const mobDrop  = el('mob-drop-zone');
                const mobFile  = el('mob-file-input');
                mobDrop.addEventListener('click', () => mobFile.click());
                mobFile.addEventListener('change', e => {
                    if (e.target.files.length) this.handleImageFile(e.target.files[0]);
                    e.target.value = '';
                });

                // Text input
                el('mob-text-input').addEventListener('input', e => {
                    document.getElementById('text-input').value = e.target.value;
                    this.generateTextAsset();
                });
                el('mob-font-select').addEventListener('change', e => {
                    document.getElementById('font-select').value = e.target.value;
                    this.generateTextAsset();
                });
                el('mob-text-color').addEventListener('input', e => {
                    this.textColor = e.target.value;
                    document.getElementById('text-color-input').value = e.target.value;
                    this.generateTextAsset();
                });
                el('mob-text-bg').addEventListener('input', e => {
                    this.textBgColor = e.target.value;
                    document.getElementById('text-bg-color-input').value = e.target.value;
                    this.generateTextAsset();
                });
            }

            // Mirror the studio's shared controls onto the chain core: the
            // S/M/L column adjusters drive the chain length, the bead size
            // select drives beadIdx, and asset/outline/ground/algo state
            // is reused as-is.
            _syncChainParams() {
                const p = this.chain.params;
                p.sizeLevel = this.params.colLevel;
                p.beadIdx = parseInt(document.getElementById('bead-size-select').value) || 0;
                p.mode = (this.chainFillMode === 'FILL' || this.assetMode !== 'TEXT') ? 'SOLID' : 'TEXT';
                p.text = document.getElementById('text-input').value || '';
                p.textColor = this.textColor;
                p.font = (document.getElementById('font-select').value || 'Arial')
                    .split(',')[0].replace(/'/g, '').trim();
                p.outlineEnabled = this.params.outlineEnabled;
                p.outlineColor = this.params.outlineColor;
                p.groundColor = this.params.groundColor;
                p.algoMode = this.algoMode;
                p.textBg = this.textBgColor;
                if (p.mode === 'TEXT') {
                    p.chainCount = Math.max(1, Array.from(p.text || '').length || 1);
                    const ccEl = document.getElementById('chain-count');
                    if (ccEl && ccEl.disabled) ccEl.value = p.chainCount;  // live count mirror
                }
            }

            // Show/hide chain-only controls and force a compatible asset tab
            _syncChainUI() {
                const diamond = this.params.mode === 'diamond';
                const chainControls = document.getElementById('chain-controls');
                const rowGroup = document.getElementById('row-level-group');
                if (chainControls) chainControls.style.display = diamond ? 'block' : 'none';
                if (rowGroup) rowGroup.style.display = diamond ? 'none' : '';
                ['tab-image', 'tab-stripes'].forEach(id => {
                    const b = document.getElementById(id);
                    if (b) { b.disabled = diamond; b.style.opacity = diamond ? '0.4' : ''; }
                });
                const modeGroup = document.getElementById('chain-mode-group');
                const rowsLabel = document.getElementById('rows-label');
                const note = document.getElementById('chain-mode-note');
                const cc = document.getElementById('chain-count');
                const ti = document.getElementById('text-input');
                const heart = document.getElementById('heart-btn');
                if (diamond) {
                    // image/stripes don't apply to the chain — land on TEXT
                    if (this.assetMode !== 'TEXT') document.getElementById('tab-text').click();
                    if (ti && !ti.value) ti.value = 'HI';
                    if (cc) cc.value = this.chain.params.chainCount;
                    const fillMode = this.chainFillMode === 'FILL';
                    if (modeGroup) modeGroup.style.display = 'flex';
                    if (rowsLabel) rowsLabel.textContent = 'Chain Mode';
                    if (cc) cc.disabled = !fillMode;
                    if (ti) ti.disabled = fillMode;
                    if (heart) heart.disabled = fillMode;
                    if (note) note.textContent = fillMode
                        ? 'Fill mode: set the diamond count and paint each diamond below. Text entry is parked.'
                        : 'Text mode: one diamond per character — count, letters and backgrounds follow the Text asset.';
                    document.querySelectorAll('#chain-mode-group button').forEach(b =>
                        b.classList.toggle('active', (b.dataset.chainMode === 'FILL') === fillMode));
                } else {
                    if (modeGroup) modeGroup.style.display = 'none';
                    if (rowsLabel) rowsLabel.textContent = 'Rows (H)';
                    if (cc) cc.disabled = false;
                    if (ti) ti.disabled = false;
                    if (heart) heart.disabled = false;
                }
                this._renderDiamondSwatches();
            }

            // Structural pass for the chain: sync params, derive geometry,
            // resize the canvas/grid layers to the chain bbox, update
            // readouts, and rebuild the DOM grid. In LAYOUT state the
            // computed pattern and manual overrides are dropped (same
            // contract as transitionToLayout in the rectangular modes).
            _updateCalculationsChain() {
                this._syncChainParams();
                const chain = this.chain;
                const computed = this.appState === 'COMPUTED';
                chain.quantized = computed;
                if (!computed) { chain._overrides = {}; chain.quantizedGrid = null; }
                const g = chain.derive();
                this._chainGeo = g;

                const ar = chain.assetRes(g);
                const styleW = Math.max(1, Math.ceil(ar.totalW));
                const styleH = Math.max(1, Math.ceil(ar.totalH));
                this.cImage.width = ar.wPx; this.cImage.height = ar.hPx;
                this.cImage.style.width = styleW + 'px';
                this.cImage.style.height = styleH + 'px';
                // on-screen chain size in CSS px — fitToScreen and the zoom
                // math work in CSS px, never in canvas asset pixels
                this._chainStyleW = styleW; this._chainStyleH = styleH;
                this._onScreenW = styleW; this._onScreenH = styleH;
                this.gridContainer.style.width = styleW + 'px';
                this.gridContainer.style.height = styleH + 'px';
                this.gridContainer.style.left = '0px';
                this.gridContainer.style.top = '0px';
                this.gridContainer.style.transform = 'none';

                const extW = ar.totalW / this.MM_TO_PX, extH = ar.totalH / this.MM_TO_PX;
                document.getElementById('readout-dims').innerText =
                    `${extW.toFixed(1)} × ${extH.toFixed(1)} mm  (chain ${chain.lengthMM} mm × ${g.n})`;
                const beadsPer = g.cols * g.rows - 4; // 4 corner beads trimmed per diamond
                document.getElementById('readout-volume').innerText = `${(beadsPer * g.n).toLocaleString()} beads`;
                const lvReadout = document.getElementById('level-count-readout');
                if (lvReadout) lvReadout.textContent = `${g.n} diamonds · ${g.cols} × ${g.rows} lattice`;

                // Every structural change (mode entry, text edit, chain
                // count, bead size, S/M/L level) re-fits and re-centers
                // the chain in the viewport. Synchronous — geometry is
                // already final here and a deferred frame can be starved.
                this.fitToScreen();

                this.renderDOMGrid();
                this.dirty.img = true; this.dirty.vp = true;
            }

            // ── View switching ────────────────────────────────────────────────
            _switchTo3D() {
                if (this.appState !== "COMPUTED") return;
                if (this.params.mode === 'diamond') return this._toast("3D view is not available for the diamond chain.", "error");
                const panel2d = document.getElementById('view-2d');
                const panel3d = document.getElementById('view-3d');
                const hud3d   = document.getElementById('hud-3d');
                const hint3d  = document.getElementById('hud-3d-hint');

                panel2d.style.display = 'none';
                panel3d.style.display = 'block';
                hud3d.style.display   = 'flex';
                hint3d.style.display  = 'block';
                document.body.classList.add('view-3d');

                document.getElementById('btn-view-2d').classList.remove('active');
                document.getElementById('btn-view-3d').classList.add('active');

                if (!this.viewer3d) {
                    this.viewer3d = new Viewer3D(document.getElementById('c3d'));
                    this._bind3DHUD();
                }
                // Always enter 3D in flat mode so camera lands correctly
                this.viewer3d.mode = 'flat';
                document.getElementById('b3-flat').classList.add('active');
                document.getElementById('b3-circ').classList.remove('active');
                this.viewer3d.build(this.quantizedGrid, this.params);
                this.viewer3d.resume();
                this.viewer3d.updateBackground();
                this.activeView = '3d';
            }

            _switchTo2D() {
                const panel2d = document.getElementById('view-2d');
                const panel3d = document.getElementById('view-3d');
                const hud3d   = document.getElementById('hud-3d');
                const hint3d  = document.getElementById('hud-3d-hint');

                panel2d.style.display = 'block';
                panel3d.style.display = 'none';
                hud3d.style.display   = 'none';
                hint3d.style.display  = 'none';
                document.body.classList.remove('view-3d');

                document.getElementById('btn-view-2d').classList.add('active');
                document.getElementById('btn-view-3d').classList.remove('active');

                if (this.viewer3d) this.viewer3d.pause();
                this.activeView = '2d';

                // Auto-center the 2D view — any panning done in 3D mode
                // bleeds into vpX/vpY, so we reset to a clean fit on return.
                this.fitToScreen();
            }

            _bind3DHUD() {
                const v = this.viewer3d;
                document.getElementById('b3-orbit').addEventListener('click', () => v.setMoveMode('orbit'));
                document.getElementById('b3-pan').addEventListener('click',   () => v.setMoveMode('pan'));
                document.getElementById('b3-zin').addEventListener('click',   () => v.zoom(0.85));
                document.getElementById('b3-zout').addEventListener('click',  () => v.zoom(1.15));
                document.getElementById('b3-reset').addEventListener('click', () => v.resetCam());

                document.getElementById('b3-flat').addEventListener('click', () => {
                    document.getElementById('b3-flat').classList.add('active');
                    document.getElementById('b3-circ').classList.remove('active');
                    v.setMode('flat');
                });
                document.getElementById('b3-circ').addEventListener('click', () => {
                    document.getElementById('b3-circ').classList.add('active');
                    document.getElementById('b3-flat').classList.remove('active');
                    v.setMode('circular');
                });

                const glassSlider = document.getElementById('glass-slider');
                glassSlider.addEventListener('input', () => {
                    const pct = Number(glassSlider.value);
                    document.getElementById('glass-val').textContent = pct + '%';
                    v.setGlass(pct / 100);
                });
            }

            _toast(msg, type = "success") {
                const container = document.getElementById('toasts');
                const t = document.createElement('div');
                t.className = `toast ${type === 'error' ? 'toast-error' : ''}`;
                t.innerText = msg;
                container.appendChild(t);
                setTimeout(() => t.classList.add('show'), 50);
                setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
            }
        }





// attach the extracted subsystem mixins
Object.assign(Beadazzle.prototype, viewportMixin, assetsMixin, gridMixin, exportMixin, handoffMixin);


const app = new Beadazzle();

        // devtools parity with the previous single-file build
        window.app = app;
