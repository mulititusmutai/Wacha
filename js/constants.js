// Beadazzle — shared data tables: color science, palette, bead sizes,
// size levels, diamond-chain targets, and viewport zoom calibration.


        // ╔═════════════════════════════════════════════════════════════════════╗
        // ║  MODULE: color-science                                              ║
        // ║  CIE76 color space conversion + palette matching                   ║
        // ╚═════════════════════════════════════════════════════════════════════╝
export function srgbToLinear(c) {
            c = c / 255;
            return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        }
export function rgbToLab(r, g, b) {
            const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b);
            let x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
            let y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
            let z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
            const Xn = 0.95047, Yn = 1.00000, Zn = 1.08883;
            x /= Xn; y /= Yn; z /= Zn;
            const f = t => t > 0.008856 ? Math.pow(t, 1/3) : (7.787 * t + 16/116);
            const fx = f(x), fy = f(y), fz = f(z);
            const L = (y > 0.008856) ? (116 * fy - 16) : (903.3 * y);
            const A = 500 * (fx - fy);
            const B = 200 * (fy - fz);
            return { L, A, B };
        }
export function labDistance(lab1, lab2) {
            const dL = lab1.L - lab2.L, dA = lab1.A - lab2.A, dB = lab1.B - lab2.B;
            return Math.sqrt(dL * dL + dA * dA + dB * dB);
        }

export const RAW_PALETTE = [
            { name: "Berry Red",     hex: "#a83246" }, { name: "Brick Red",     hex: "#8c3f30" },
            { name: "Apple Red",     hex: "#c0392b" }, { name: "Wine Maroon",   hex: "#5c1f2e" },
            { name: "Sky Blue",      hex: "#8aa6bd" }, { name: "Denim Blue",    hex: "#3b5d76" },
            { name: "Jay Blue",      hex: "#2f6fa8" }, { name: "Navy",          hex: "#22344a" },
            { name: "Sunlit Leaf",   hex: "#8a9c4a" }, { name: "Shade Leaf",    hex: "#3a5c44" },
            { name: "Grass Green",   hex: "#5a7a3a" }, { name: "Olive Sage",    hex: "#6e7458" },
            { name: "Fair Skin",     hex: "#e3b5a0" }, { name: "Tan Skin",      hex: "#c08862" },
            { name: "Deep Skin",     hex: "#7a4a3a" }, { name: "Bark Brown",    hex: "#5c4530" },
            { name: "Golden Blonde", hex: "#d4af6a" }, { name: "Sunlit Gold",   hex: "#c9942f" },
            { name: "Sunset Orange", hex: "#d9622b" }, { name: "Autumn Orange", hex: "#a85a2e" },
            { name: "Lavender Dusk", hex: "#8a7390" }, { name: "Deep Plum",     hex: "#5a3a52" },
            { name: "Warm White",    hex: "#ece3d2" }, { name: "Cool White",    hex: "#dfe6e6" },
            { name: "Warm Grey",     hex: "#8c8475" }, { name: "Cool Grey",     hex: "#76828a" },
            { name: "True Black",    hex: "#1c1813" }, { name: "Soft Black",    hex: "#332c24" },
            { name: "Vivid Teal",    hex: "#2a8a82" }
        ];

export function hexToRgb(hex) {
            const v = hex.replace('#', '');
            return { r: parseInt(v.substr(0,2),16), g: parseInt(v.substr(2,2),16), b: parseInt(v.substr(4,2),16) };
        }
export const SIMPLE_PALETTE = RAW_PALETTE.map(p => {
            const rgb = hexToRgb(p.hex);
            return { name: p.name, hex: p.hex, r: rgb.r, g: rgb.g, b: rgb.b, lab: rgbToLab(rgb.r, rgb.g, rgb.b) };
        });
export const HEX_TO_NAME = RAW_PALETTE.reduce((acc, p) => { acc[p.hex] = p.name; return acc; }, {});

export function getClosestPaletteColors(r, g, b, count = 3) {
            const lab = rgbToLab(r, g, b);
            return SIMPLE_PALETTE.map(p => ({ hex: p.hex, score: labDistance(lab, p.lab) }))
                .sort((a, b) => a.score - b.score).slice(0, count).map(p => p.hex);
        }

        // ╔═════════════════════════════════════════════════════════════════════╗
        // ║  MODULE: bead-data                                                  ║
        // ║  Physical bead size database (diameter + pitch in mm)               ║
        // ║  Czech Rocaille: round, pitch ≈ 0.75× diam                         ║
        // ║  Miyuki Delica:  cylindrical, pitch ≈ 1.3× diam                    ║
        // ╚═════════════════════════════════════════════════════════════════════╝
export const BEAD_SIZES = {
            rocaille: [
                { label: "5/0  (4.55mm)", diam: 4.55, pitch: 3.19 },
                { label: "6/0  (4.00mm)", diam: 4.00, pitch: 2.80 },
                { label: "8/0  (3.00mm)", diam: 3.00, pitch: 2.10 },
                { label: "10/0 (2.30mm)", diam: 2.30, pitch: 1.61 },
                { label: "11/0 (2.10mm)", diam: 2.10, pitch: 1.47 },
                { label: "12/0 (1.90mm)", diam: 1.90, pitch: 1.33 },
                { label: "13/0 (1.70mm)", diam: 1.70, pitch: 1.19 },
                { label: "15/0 (1.45mm)", diam: 1.45, pitch: 1.02 },
            ]
        };

        // ╔═════════════════════════════════════════════════════════════════════╗
        // ║  MODULE: size-levels                                                ║
        // ║  S/M/L grid sizing: desired physical dimensions (mm) converted to  ║
        // ║  bead counts from the current bead diameter/pitch.                 ║
        // ╚═════════════════════════════════════════════════════════════════════╝
export const SIZE_LEVELS = ['S', 'M', 'L'];
export const LV_IDX = { S: 0, M: 1, L: 2 };
        // Physical dimension targets (mm) per item type. Columns stay the
        // long axis in every mode; the S/M/L cascade (col level >= row
        // level) still applies within each table.
export const MODE_LEVELS = {
            bracelet: { cols: { S: 90, M: 120, L: 150 }, rows: { S: 30, M: 45, L: 60 } },
            earring:  { cols: { S: 20, M: 30,  L: 45 },  rows: { S: 10, M: 20, L: 30 } },
            keychain: { cols: { S: 30, M: 60,  L: 90 },  rows: { S: 20, M: 40, L: 60 } }
        };

        // ╔═════════════════════════════════════════════════════════════════════╗
        // ║  MODULE: diamond-chain constants                                    ║
        // ║  The diamond chain enforces the chain LENGTH (mm) — same long-axis ║
        // ║  targets as MODE_LEVELS.bracelet.cols, so the S/M/L adjusters      ║
        // ║  drive this matrix with no new numbers. MIN rows per diamond is    ║
        // ║  the only cap on chain count.                                      ║
        // ╚═════════════════════════════════════════════════════════════════════╝
export const DC_SIZES = { S: 90, M: 120, L: 150 };
export const DC_MIN_ROWS = 6;
export const MM_TO_PX_C = 96 / 25.4;

        // ╔═════════════════════════════════════════════════════════════════════╗
        // ║  MODULE: zoom-constants                                             ║
        // ║  Viewport zoom calibration: 1x label = ZOOM_TRUE_SCALE internally  ║
        // ║  ZOOM_STOPS maps user-facing labels to actual CSS scale values      ║
        // ╚═════════════════════════════════════════════════════════════════════╝
export const ZOOM_TRUE_SCALE = 1.4583; // calibrated: 96dpi / 25.4 * physical correction
export const ZOOM_STOPS = [
            { label: '¼x', stop: 0.25, zoom: 0.25 * ZOOM_TRUE_SCALE },
            { label: '½x', stop: 0.5,  zoom: 0.5  * ZOOM_TRUE_SCALE },
            { label: '¾x', stop: 0.75, zoom: 0.75 * ZOOM_TRUE_SCALE },
            { label: '1x',  stop: 1,   zoom: 1.0  * ZOOM_TRUE_SCALE },
            { label: '2x',  stop: 2,   zoom: 2.0  * ZOOM_TRUE_SCALE },
            { label: '3x',  stop: 3,   zoom: 3.0  * ZOOM_TRUE_SCALE },
            { label: '4x',  stop: 4,   zoom: 4.0  * ZOOM_TRUE_SCALE },
        ];

export function stopToViewportZoom(stop) {
            return stop * ZOOM_TRUE_SCALE;
        }
