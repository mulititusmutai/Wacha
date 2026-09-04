// Beadazzle — viewport engine — zoom, pan, fit-to-screen, and the dirty-flag render loop.
// Mixin: merged onto Beadazzle.prototype by studio.js
import {
    ZOOM_STOPS,
    ZOOM_TRUE_SCALE
} from './constants.js';

export const viewportMixin = {
        // ── Render Loop ──────────────────────────────────────────────────
        _loop() {
            if (this.dirty.vp) { this._renderVp(); this.dirty.vp = false; }
            if (this.dirty.img) { this._renderImage(); this.dirty.img = false; }
            this._rafId = requestAnimationFrame(() => this._loop());
        },

        _scheduleFrame() {
            // Mark both dirty and kick off a new RAF if one isn't already queued
            if (!this._rafId) this._rafId = requestAnimationFrame(() => this._loop());
        },

        _renderVp() {
            this.wrapper.style.transform = `translate(${this.vpX}px, ${this.vpY}px) scale(${this.params.zoom})`;
            this._updateZoomHUD();
        },

        _updateZoomHUD() {
            const realMultiplier = this.params.zoom / ZOOM_TRUE_SCALE;
            let label, bestDist = Infinity, nearest = ZOOM_STOPS[0].stop;
            for (const s of ZOOM_STOPS) {
                const d = Math.abs(realMultiplier - s.stop);
                if (d < bestDist) { bestDist = d; nearest = s.stop; }
            }
            label = bestDist < 0.05 ? `${nearest}x` : `${realMultiplier.toFixed(2)}x`;
            document.getElementById('val-zoom').innerText = label;

            // Highlight active stop button
            document.querySelectorAll('.zoom-stop-btn').forEach(btn => {
                const bStop = parseFloat(btn.dataset.stop);
                btn.classList.toggle('active', Math.abs(realMultiplier - bStop) < 0.05);
            });
        },

        // ── Zoom ─────────────────────────────────────────────────────────
        _zoomAtPoint(newZoom, px, py) {
            // Clamp to stop range: min=0.25×ZOOM_TRUE_SCALE, max=4×ZOOM_TRUE_SCALE
            newZoom = Math.max(ZOOM_STOPS[0].zoom, Math.min(ZOOM_STOPS[ZOOM_STOPS.length-1].zoom, newZoom));
            const scaleRatio = newZoom / this.params.zoom;
            this.vpX = px - (px - this.vpX) * scaleRatio;
            this.vpY = py - (py - this.vpY) * scaleRatio;
            this.params.zoom = newZoom;
            this.dirty.vp = true;
        },

        _snapZoomToNearest(rawZoom) {
            // Snap wheel zoom to nearest defined stop
            const realScale = rawZoom / ZOOM_TRUE_SCALE;
            let nearest = ZOOM_STOPS[0];
            let bestDist = Infinity;
            for (const s of ZOOM_STOPS) {
                const d = Math.abs(realScale - s.stop);
                if (d < bestDist) { bestDist = d; nearest = s; }
            }
            return nearest.zoom;
        },

        _onWheel(e) {
            if (e.target.closest('#node-popover') || e.target.closest('#hud')) return;
            e.preventDefault();
            const rect = this.viewport.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            // Determine direction and step to next stop
            const delta = e.deltaY < 0 ? 1 : -1;
            const currentReal = this.params.zoom / ZOOM_TRUE_SCALE;
            const sortedStops = [...ZOOM_STOPS].sort((a,b) => a.stop - b.stop);
            let nextStop;
            if (delta > 0) {
                nextStop = sortedStops.find(s => s.stop > currentReal + 0.01);
            } else {
                nextStop = [...sortedStops].reverse().find(s => s.stop < currentReal - 0.01);
            }
            if (nextStop) this._zoomAtPoint(nextStop.zoom, mx, my);
        },

        _onMouseDown(e) {
            if (e.target.closest('.sidebar') || e.target.closest('footer') || e.target.closest('#node-popover') || e.target.closest('#hud') || e.target.closest('.modal-overlay')) return;
            if (e.button !== 0) return;
            this._isDragging = true;
            this._dragStartX = e.clientX; this._dragStartY = e.clientY;
            this._vpStartX = this.vpX; this._vpStartY = this.vpY;
            this.viewport.classList.add('grabbing');
        },

        _onMouseMove(e) {
            if (!this._isDragging) return;
            e.preventDefault();
            this.vpX = this._vpStartX + (e.clientX - this._dragStartX);
            this.vpY = this._vpStartY + (e.clientY - this._dragStartY);
            this.dirty.vp = true;
        },

        _onMouseUp() {
            if (this._isDragging) { this._isDragging = false; this.viewport.classList.remove('grabbing'); }
        },

        fitToScreen() {
            const rect = this.viewport.getBoundingClientRect();
            const vw = rect.width, vh = rect.height;
            // diamond chain: the canvas is an asset-resolution buffer —
            // its on-screen size is _chainStyleW/H, not width/height
            const diamond = this.params.mode === 'diamond';
            const cw = diamond ? (this._chainStyleW || this.cImage.width) : this.cImage.width;
            const ch = diamond ? (this._chainStyleH || this.cImage.height) : this.cImage.height;
            if (!vw || !vh || !cw || !ch) return; // nothing to fit yet
            const padding = 40;
            // Continuous zoom — fit exactly, no stop snapping
            const rawFit = Math.min((vw - padding) / cw, (vh - padding) / ch);
            // Try to snap to a nearby stop for clean rendering, but
            // fall back to the raw ratio if no stop fits (small screens)
            const fittingStop = [...ZOOM_STOPS].reverse().find(s => s.zoom <= rawFit);
            this.params.zoom = fittingStop ? fittingStop.zoom : rawFit;
            // Center the canvas in the viewport
            this.vpX = (vw - cw * this.params.zoom) / 2;
            this.vpY = (vh - ch * this.params.zoom) / 2;
            this.dirty.vp = true;
        },
};
