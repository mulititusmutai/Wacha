/* ====================================================================
   BEADAZZLE — design persistence (build page)
   Saves the full design (asset + parameters + computed state) to
   sessionStorage after every successful compute and on page exit, and
   replays it on return — so navigating to checkout and back keeps the
   design on the bench. Storage is per-tab, so it dies with the tab:
   the right lifetime for "don't lose my work because I peeked at
   checkout".
   ==================================================================== */
(() => {
    const KEY = 'beadazzle_state';
    const $ = id => document.getElementById(id);
    const fire = (el, type = 'input') => { if (el) el.dispatchEvent(new Event(type, { bubbles: true })); };
    const click = el => { if (el) el.click(); };

    function captureImage(app) {
        if (app.assetMode !== 'IMAGE' || !app.loadedImage) return null;
        try {
            const img = app.loadedImage;
            const scale = Math.min(1, 800 / Math.max(img.width, img.height));
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(img.width * scale));
            cv.height = Math.max(1, Math.round(img.height * scale));
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            return cv.toDataURL('image/jpeg', 0.85);
        } catch (e) { return null; }
    }

    function save(app) {
        if (!app || app.appState !== 'COMPUTED') return;
        try {
            const state = {
                mode: app.params.mode,
                colLevel: app.params.colLevel,
                rowLevel: app.params.rowLevel,
                diam: app.params.diam,
                pitch: app.params.pitch,
                beadDirect: $('bead-direct-panel').style.display !== 'none',
                beadSizeIdx: $('bead-size-select').value,
                assetMode: app.assetMode,
                text: {
                    text: $('text-input').value,
                    color: $('text-color-input').value,
                    bg: $('text-bg-color-input').value,
                    font: $('font-select').value
                },
                stripes: JSON.parse(JSON.stringify(app.stripes)),
                telemetry: {
                    scale: app.params.scale,
                    saturate: app.params.saturate,
                    rot: app.params.rot,
                    patAngle: app.params.patternAngle
                },
                outline: { on: app.params.outlineEnabled, color: app.params.outlineColor },
                ground: app.params.groundColor,
                algo: app.algoMode,
                chain: app.params.mode === 'diamond' ? JSON.parse(JSON.stringify(app.chain.params)) : null,
                imageDataURL: captureImage(app)
            };
            sessionStorage.setItem(KEY, JSON.stringify(state));
        } catch (e) { /* quota or privacy mode — persistence is best-effort */ }
    }

    function waitAsset(app, ms = 2500) {
        return new Promise(res => {
            const t0 = Date.now();
            const poll = () => {
                if (app.loadedImage) return res(true);
                if (Date.now() - t0 > ms) return res(false);
                setTimeout(poll, 60);
            };
            poll();
        });
    }

    function restore(app) {
        let st = null;
        try { st = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { /* ignore */ }
        if (!st || !st.mode) return Promise.resolve(false);

        /* structure: mode, levels, bead size */
        click(document.querySelector(`#mode-switch button[data-mode="${st.mode}"]`));
        click(document.querySelector(`#col-level-group button[data-level="${st.colLevel}"]`));
        click(document.querySelector(`#row-level-group button[data-level="${st.rowLevel}"]`));
        if (st.beadDirect) {
            click($('bead-mode-direct'));
            $('input-diam').value = st.diam; fire($('input-diam'));
            $('input-pitch').value = st.pitch; fire($('input-pitch'));
        } else {
            $('bead-size-select').value = st.beadSizeIdx; fire($('bead-size-select'), 'change');
        }

        /* finish */
        click($(st.outline && st.outline.on ? 'outline-on' : 'outline-off'));
        if (st.outline) { $('input-outline-color').value = st.outline.color; fire($('input-outline-color')); }
        if (st.ground) { $('input-ground').value = st.ground; fire($('input-ground')); }
        click($(st.algo === 'Dominant' ? 'mode-dominant' : 'mode-blended'));

        /* diamond chain parameters (best effort) */
        if (st.mode === 'diamond' && st.chain) {
            Object.assign(app.chain.params, st.chain);
            if (st.chain.chainCount != null) { $('chain-count').value = st.chain.chainCount; fire($('chain-count')); }
            if (typeof app._renderDiamondSwatches === 'function') app._renderDiamondSwatches();
        }

        /* asset */
        let assetReady;
        if (st.assetMode === 'TEXT') {
            click($('tab-text'));
            $('text-input').value = st.text.text; fire($('text-input'));
            $('text-color-input').value = st.text.color; fire($('text-color-input'));
            $('text-bg-color-input').value = st.text.bg; fire($('text-bg-color-input'));
            $('font-select').value = st.text.font; fire($('font-select'), 'change');
            assetReady = waitAsset(app);
        } else if (st.assetMode === 'STRIPES') {
            click($('tab-stripes'));
            app.stripes = st.stripes && st.stripes.length ? st.stripes : app.stripes;
            app._renderStripeList();
            app.generateStripesAsset();
            assetReady = waitAsset(app);
        } else if (st.assetMode === 'IMAGE' && st.imageDataURL) {
            click($('tab-image'));
            assetReady = new Promise(res => {
                const img = new Image();
                img.onload = () => {
                    app.loadedImage = img;
                    app.clearManualOverrides();
                    app._resetQuantizationState();
                    app.autoCenterAsset();
                    app.dirty.img = true;
                    app.checkOverflow();
                    res(true);
                };
                img.onerror = () => res(false);
                img.src = st.imageDataURL;
            });
        } else {
            assetReady = Promise.resolve(false);
        }

        /* telemetry after the asset — text/stripes renders reset transforms */
        return assetReady.then(ok => {
            const t = st.telemetry || {};
            const setRange = (id, v) => {
                const s = $(id);
                if (s && v != null) { s.value = v; fire(s); }
            };
            setRange('input-scale', t.scale);
            setRange('input-saturate', t.saturate);
            setRange('input-rot', t.rot);
            setRange('input-pat-angle', t.patAngle);
            if (!ok) return false;
            app.transitionToComputed();
            app._toast('Welcome back — your design is on the bench.');
            return true;
        });
    }

    function init(app) {
        /* save after every successful compute (state is set synchronously) */
        const orig = app.transitionToComputed.bind(app);
        app.transitionToComputed = (...args) => {
            const r = orig(...args);
            setTimeout(() => save(app), 150);
            return r;
        };
        /* save when leaving the page (checkout, home, refresh, close) */
        window.addEventListener('pagehide', () => save(app));
        window.addEventListener('beforeunload', () => save(app));
        /* bring back whatever was on the bench */
        return restore(app);
    }

    window.BeadazzlePersist = { init };
})();
