        // ╔═════════════════════════════════════════════════════════════════════╗
        // ║  MODULE: Viewer3D                                                   ║
        // ║  Three.js 3D bead renderer — flat and circular modes               ║
        // ║  Reads live quantizedGrid + RAW_PALETTE directly; no JSON needed   ║
        // ╚═════════════════════════════════════════════════════════════════════╝
        export class Viewer3D {
            constructor(canvas) {
                this.canvas   = canvas;
                this.mode     = 'flat';       // 'flat' | 'circular'
                this.circMm   = 180;          // circumference mm for circular mode
                this._meshes  = [];
                this._geo     = null;
                this._matCache = {};
                this._rafId   = null;
                this._drag    = false;
                this._px = 0; this._py = 0;
                this._moveMode = 'orbit';

                // ── renderer ──────────────────────────────────────────────────
                this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
                this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
                this.renderer.shadowMap.enabled = true;
                this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
                // Warm filmic exposure matching the standalone viewer
                this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
                this.renderer.toneMappingExposure = 1.05;

                // ── scene ─────────────────────────────────────────────────────
                this.scene = new THREE.Scene();
                const isDark = document.documentElement.dataset.theme !== 'light';
                this.scene.background = new THREE.Color(isDark ? 0x0a0a12 : 0xb8a898);

                // Wide FOV for many-bead patterns — matches standalone viewer feel
                this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 800);

                // ── lights ────────────────────────────────────────────────────
                // HemisphereLight simulates skylight — warm sky above, cool bounce below.
                // This gives uniform ambient energy from all directions, like outdoor light.
                this.hemiLight = new THREE.HemisphereLight(0xfff2e0, 0x907060, 0.823);
                this.scene.add(this.hemiLight);

                // Key light: sun — distant directional, parallel rays, no falloff
                this.keyLight = new THREE.DirectionalLight(0xfffaf4, 1.198);
                this.keyLight.position.set(-4, 8, -6);
                this.keyLight.castShadow = true;
                this.scene.add(this.keyLight);

                // Fill light: soft sky-side directional — lifts shadow side without hotspot
                this.fillLight = new THREE.DirectionalLight(0xfff5e8, 0.460);
                this.fillLight.position.set(6, 3, 4);
                this.scene.add(this.fillLight);

                // Rim light: low-angle directional for subtle edge definition
                this.rimLight = new THREE.DirectionalLight(0xfff8f0, 0.278);
                this.rimLight.position.set(0, -5, 8);
                this.scene.add(this.rimLight);

                // ── camera state ──────────────────────────────────────────────
                this.camTarget = new THREE.Vector3();
                // elevation ~36° — high enough to read the pattern, low
                // enough to keep the bead relief
                this.sph = { r: 20, theta: 0.3, phi: Math.PI / 3.4 };

                this._resizeBound = () => this._resize();
                window.addEventListener('resize', this._resizeBound);
                this._bindControls();
                this._loop();
            }

            // ── geometry builders (low-poly, matches standalone) ──────────────
            _makeProfile(w, h, r, segsPerCorner) {
                const pts = [], hw = w/2, hh = h/2;
                const corners = [
                    { cx:  hw-r, cy:  hh-r, startA: 0 },
                    { cx: -hw+r, cy:  hh-r, startA: Math.PI * 0.5 },
                    { cx: -hw+r, cy: -hh+r, startA: Math.PI },
                    { cx:  hw-r, cy: -hh+r, startA: Math.PI * 1.5 },
                ];
                for (const { cx, cy, startA } of corners) {
                    for (let i = 0; i < segsPerCorner; i++) {
                        const a = startA + (Math.PI * 0.5) * (i / segsPerCorner);
                        pts.push({ x: cx + Math.cos(a)*r, y: cy + Math.sin(a)*r, nx: Math.cos(a), ny: Math.sin(a) });
                    }
                }
                return pts;
            }

            _buildBeadGeo(pathR, tubeW, tubeH, cornerR) {
                class CirclePath extends THREE.Curve {
                    constructor(R) { super(); this.R = R; }
                    getPoint(t) {
                        const a = t * Math.PI * 2;
                        return new THREE.Vector3(Math.cos(a) * this.R, 0, Math.sin(a) * this.R);
                    }
                }
                const profile = this._makeProfile(tubeH, tubeW, cornerR, 3);
                const N = profile.length;
                const pathSegs = 48;
                const path = new CirclePath(pathR);
                const frames = path.computeFrenetFrames(pathSegs, true);
                const positions = [], normals = [], uvs = [], indices = [];
                for (let i = 0; i <= pathSegs; i++) {
                    const idx = i % pathSegs;
                    const pt = path.getPoint(i / pathSegs);
                    const fn = frames.normals[idx], fb = frames.binormals[idx];
                    for (let j = 0; j < N; j++) {
                        const { x: lx, y: ly, nx: lnx, ny: lny } = profile[j];
                        positions.push(
                            pt.x + lx*fn.x + ly*fb.x,
                            pt.y + lx*fn.y + ly*fb.y,
                            pt.z + lx*fn.z + ly*fb.z
                        );
                        normals.push(lnx*fn.x + lny*fb.x, lnx*fn.y + lny*fb.y, lnx*fn.z + lny*fb.z);
                        uvs.push(i / pathSegs, j / N);
                    }
                }
                for (let i = 0; i < pathSegs; i++) {
                    for (let j = 0; j < N; j++) {
                        const a = i*N+j, b = i*N+(j+1)%N, c = (i+1)*N+j, d = (i+1)*N+(j+1)%N;
                        indices.push(a, b, c, b, d, c);
                    }
                }
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
                geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2));
                geo.setIndex(indices);
                return geo;
            }

            // ── palette: read directly from RAW_PALETTE (no duplicate table) ──
            _hexToInt(hex) {
                return parseInt(hex.replace('#', ''), 16);
            }

            _getMat(hex) {
                if (!this._matCache[hex]) {
                    this._matCache[hex] = new THREE.MeshStandardMaterial({
                        color: this._hexToInt(hex),
                        emissive: new THREE.Color(this._hexToInt(hex)),
                        emissiveIntensity: 0.08,
                        metalness: 0.18,
                        roughness: 0.28,
                        side: THREE.FrontSide
                    });
                }
                return this._matCache[hex];
            }

            // ── build scene from live quantizedGrid ───────────────────────────
            build(quantizedGrid, params) {
                this._clearMeshes();
                this._quantizedGrid = quantizedGrid;
                this._params = params;
                this._firstBuild = true;
                this._rebuildMeshes();
            }

            _clearMeshes() {
                for (const m of this._meshes) {
                    this.scene.remove(m);
                    // materials are cached and shared — don't dispose them here
                }
                this._meshes = [];
                if (this._geo) { this._geo.dispose(); this._geo = null; }
            }

            _rebuildMeshes() {
                this._clearMeshes();
                const grid = this._quantizedGrid;
                const params = this._params;
                if (!grid || !grid.length) return;

                const ROWS = grid.length;
                const COLS = params.cols;

                const tubeW = 1.0, tubeH = 1.6, pathR = 1.0;
                const cornerR = Math.min(tubeW, tubeH) * 0.45;
                this._geo = this._buildBeadGeo(pathR, tubeW, tubeH, cornerR);

                const outerR    = pathR + tubeW / 2;
                const step      = outerR * 2;
                const rowHeight = tubeH;

                if (this.mode === 'flat') {
                    this._buildFlat(grid, ROWS, COLS, step, rowHeight);
                } else {
                    this._buildCircular(grid, ROWS, COLS, step, rowHeight);
                }
            }

            _buildFlat(grid, ROWS, COLS, step, rowHeight) {
                const rowWidth = step * COLS;
                const offsetX  = -rowWidth / 2 + step / 2;
                const offsetY  = -(rowHeight * ROWS) / 2 + rowHeight / 2;

                for (let r = 0; r < ROWS; r++) {
                    const shifted = (r % 2 === 1) ? step / 2 : 0;
                    for (let c = 0; c < COLS; c++) {
                        const cell = grid[r]?.[c];
                        if (!cell) continue;
                        const mesh = new THREE.Mesh(this._geo, this._getMat(cell.finalColor));
                        mesh.position.set(
                            offsetX + c * step + shifted,
                            offsetY + (ROWS - 1 - r) * rowHeight,
                            0
                        );
                        mesh.castShadow = true;
                        this.scene.add(mesh);
                        this._meshes.push(mesh);
                    }
                }

                const maxDim  = Math.max(step * COLS, rowHeight * ROWS);
                const camDist = maxDim * 1.6;
                this.camera.far = camDist * 4;
                this.camera.updateProjectionMatrix();
                this.camTarget.set(0, 0, 0);
                if (this._firstBuild) this.sph = { r: camDist, theta: 0.3, phi: Math.PI / 3.4 };
                else { this.sph.theta = 0.3; this.sph.phi = Math.PI / 3.4; }
                this._firstBuild = false;
                this._applySpherical();
                this._resize();
            }

            _buildCircular(grid, ROWS, COLS, step, rowHeight) {
                const ARC        = (300 / 180) * Math.PI;
                const arcRadius  = (step * (COLS - 1)) / ARC;
                const startAngle = -ARC / 2;
                const angStep    = ARC / (COLS - 1);
                const offsetY    = -(rowHeight * ROWS) / 2 + rowHeight / 2;

                for (let r = 0; r < ROWS; r++) {
                    const angShift = (r % 2 === 1) ? angStep / 2 : 0;
                    for (let c = 0; c < COLS; c++) {
                        const cell = grid[r]?.[c];
                        if (!cell) continue;
                        const angle = startAngle + c * angStep + angShift;
                        const mesh  = new THREE.Mesh(this._geo, this._getMat(cell.finalColor));
                        mesh.position.set(
                            Math.sin(angle) * arcRadius,
                            offsetY + (ROWS - 1 - r) * rowHeight,
                            Math.cos(angle) * arcRadius - arcRadius
                        );
                        mesh.rotation.y = -angle;
                        mesh.castShadow = true;
                        this.scene.add(mesh);
                        this._meshes.push(mesh);
                    }
                }

                const maxDim  = Math.max(arcRadius * 2, rowHeight * ROWS);
                const camDist = maxDim * 1.2;
                this.camera.far = camDist * 4;
                this.camera.updateProjectionMatrix();
                this.camTarget.set(0, 0, -arcRadius);
                if (this._firstBuild) this.sph = { r: camDist, theta: 0.0, phi: Math.PI / 3.4 };
                else { this.sph.theta = 0.0; this.sph.phi = Math.PI / 3.4; }
                this._firstBuild = false;
                this._applySpherical();
                this._resize();
            }

            setMode(mode, circMm) {
                this.mode = mode;
                if (circMm !== undefined) this.circMm = circMm;
                this._rebuildMeshes();
            }

            setCircumference(mm) {
                this.circMm = mm;
                if (this.mode === 'circular') this._rebuildMeshes();
            }

            // ── camera ────────────────────────────────────────────────────────
            _applySpherical() {
                this.camera.position.set(
                    this.camTarget.x + this.sph.r * Math.sin(this.sph.phi) * Math.sin(this.sph.theta),
                    this.camTarget.y + this.sph.r * Math.cos(this.sph.phi),
                    this.camTarget.z + this.sph.r * Math.sin(this.sph.phi) * Math.cos(this.sph.theta)
                );
                this.camera.lookAt(this.camTarget);
            }

            zoom(factor) {
                this.sph.r = Math.max(1.5, Math.min(this.camera.far / 2, this.sph.r * factor));
                this._applySpherical();
            }

            resetCam() {
                this.sph.theta = 0.3;
                this.sph.phi   = Math.PI / 3.4;
                this._applySpherical();
            }

            updateBackground() {
                const isDark = document.documentElement.dataset.theme !== 'light';
                this.scene.background = new THREE.Color(isDark ? 0x0a0a12 : 0xb8a898);
            }

            setMoveMode(m) {
                this._moveMode = m;
                document.getElementById('b3-orbit').classList.toggle('active', m === 'orbit');
                document.getElementById('b3-pan').classList.toggle('active', m === 'pan');
                const hint = document.getElementById('hud-3d-hint');
                hint.textContent = m === 'orbit'
                    ? 'drag to orbit · scroll to zoom'
                    : 'drag to pan · scroll to zoom';
            }

            // ── render loop ───────────────────────────────────────────────────
            _loop() {
                this._rafId = requestAnimationFrame(() => this._loop());
                this.renderer.render(this.scene, this.camera);
            }

            pause() {
                if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
            }

            resume() {
                if (!this._rafId) this._loop();
            }

            _resize() {
                const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
                if (w === 0 || h === 0) return;
                this.renderer.setSize(w, h, false);
                this.camera.aspect = w / h;
                this.camera.updateProjectionMatrix();
            }

            // ── input controls ────────────────────────────────────────────────
            _bindControls() {
                const c = this.canvas;

                const onDragStart = (x, y) => { this._drag = true; this._px = x; this._py = y; };
                const onDragEnd   = ()      => { this._drag = false; };
                const onDragMove  = (x, y)  => {
                    if (!this._drag) return;
                    const dx = x - this._px, dy = y - this._py;
                    this._px = x; this._py = y;
                    if (this._moveMode === 'orbit') {
                        this.sph.theta -= dx * 0.007;
                        this.sph.phi = Math.max(0.08, Math.min(Math.PI - 0.08, this.sph.phi + dy * 0.007));
                    } else {
                        const dir = this.camera.getWorldDirection(new THREE.Vector3());
                        const right = new THREE.Vector3().crossVectors(dir, this.camera.up).normalize();
                        this.camTarget.addScaledVector(right, -dx * 0.001 * this.sph.r);
                        this.camTarget.addScaledVector(this.camera.up, dy * 0.001 * this.sph.r);
                    }
                    this._applySpherical();
                };

                c.addEventListener('mousedown',  e => onDragStart(e.clientX, e.clientY));
                window.addEventListener('mouseup',   () => onDragEnd());
                window.addEventListener('mousemove', e => onDragMove(e.clientX, e.clientY));

                c.addEventListener('touchstart', e => onDragStart(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
                c.addEventListener('touchend',   () => onDragEnd());
                c.addEventListener('touchmove',  e => {
                    onDragMove(e.touches[0].clientX, e.touches[0].clientY);
                    e.preventDefault();
                }, { passive: false });

                c.addEventListener('wheel', e => {
                    this.zoom(e.deltaY > 0 ? 1.08 : 0.93);
                    e.preventDefault();
                }, { passive: false });
            }

            destroy() {
                this.pause();
                window.removeEventListener('resize', this._resizeBound);
                this._clearMeshes();
                for (const hex in this._matCache) { this._matCache[hex].dispose(); }
                this._matCache = {};
                this.renderer.dispose();
            }
        }
