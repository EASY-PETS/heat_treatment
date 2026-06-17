/**
 * pdf-six-page.js - PDF V2.7 简洁细线框现场摆料施工单模板
 *
 * 设计目标：
 * 1. A4 横版专用模板，不再把竖版内容压缩到横版；
 * 2. 每页有统一 Logo / 标题 / 页码，保持网站一致的简洁细线框风格；
 * 3. 步骤页左侧大图、右侧动作卡、底部进度条；
 * 4. 封面页预留签名安全区，避免签名与表格重叠；
 * 5. 图例页支持单一工件的大卡片模式，避免大面积空白；
 * 6. V2.3 新增：高密度装载自动切换区域放大/分区步骤；支持横版施工图与竖版归档单。
 * 7. V2.4 修复：精简现场版真正减少页数；圆柱/圆盘按 X/Z 足迹绘制；局部视图裁切越界灰影。
 * 8. V2.5 修复：按参考效果图重构步骤页空间比例；立放圆盘按侧放足迹绘制为长胶囊/竖向圆盘，不再误画成平放圆。
 * 9. V2.6 修复：步骤页改为“纵向信息栏 + 最大化主图 + 底部统一状态条”，删除主图周围重复信息。
 * 10. V2.7 修复：去除 LEGO 文案，改为网站一致的蓝白细线框；重排封面，避免 KPI 与任务总览/现场确认重叠。
 * 11. 保持旧入口 generateSixPagePDF(selectedIds) 不变。
 *
 * 依赖：html2canvas + jsPDF。furnace.html 需要引入：
 * - https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
 * - https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
 */

import {
    globalFurnacesResult,
    globalUnpackedItems,
    placementRules
} from './state.js';

const PAGE_ROW_LIMIT = 28;
const PORTRAIT_ROW_LIMIT = 34;
const COMPLEX_LAYER_ITEM_THRESHOLD = 32;
const REGION_STEP_ITEM_LIMIT = 18;
const SIMPLE_STEP_ITEM_LIMIT = 20;
const MIN_READABLE_ITEM_PX = 16;
const LANDSCAPE_PAGE_PX_W = 1122;
const LANDSCAPE_PAGE_PX_H = 794;
const LANDSCAPE_PAGE_MM_W = 297;
const LANDSCAPE_PAGE_MM_H = 210;
const PORTRAIT_PAGE_PX_W = 794;
const PORTRAIT_PAGE_PX_H = 1122;
const PORTRAIT_PAGE_MM_W = 210;
const PORTRAIT_PAGE_MM_H = 297;

let currentPdfMetrics = getPageMetrics('landscape');

const SVG_W = 860;
const SVG_H = 620;
// V2.6: SVG 只承担图形绘制，标题/方向/视窗信息移到左侧纵向信息栏。
// 收窄 viewBox 可减少横版卡片中的上下留白，让俯视图更接近参考图的“图优先”比例。
const DRAW_PAD = 20;

const DEFAULT_COLORS = ['#E53935', '#1565C0', '#2E7D32', '#EF6C00', '#6D4C41', '#00838F', '#6A1B9A', '#455A64'];


const PDF_V23_DEFAULT_OPTIONS = {
    orientation: 'auto',       // auto | landscape | portrait
    mode: 'standard',          // standard | field | archive
    includeCover: true,
    includeLegend: true,
    includeSteps: true,
    includeWorklist: true,
    regionZoom: true,
    density: 'auto'            // auto | large | compact
};

function readCheckedValue(name, fallback) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el?.value || fallback;
}

function getPdfV23Options() {
    const options = { ...PDF_V23_DEFAULT_OPTIONS };
    options.orientation = readCheckedValue('pdf-orientation', options.orientation);
    options.mode = readCheckedValue('pdf-output-mode', options.mode);
    options.density = readCheckedValue('pdf-density', options.density);
    options.includeCover = document.getElementById('pdf-opt-cover')?.checked ?? true;
    options.includeLegend = document.getElementById('pdf-opt-legend')?.checked ?? true;
    options.includeSteps = document.getElementById('pdf-opt-steps')?.checked ?? true;
    options.includeWorklist = document.getElementById('pdf-opt-worklist')?.checked ?? true;
    options.regionZoom = document.getElementById('pdf-opt-region-zoom')?.checked ?? true;

    if (options.mode === 'field') {
        // 精简现场版：真正减少页数。
        // 只保留封面 + 步骤图，默认关闭图例/坐标附录/区域放大，避免高密度工件被拆成过多图片页。
        options.includeCover = true;
        options.includeLegend = false;
        options.includeSteps = true;
        options.includeWorklist = false;
        options.regionZoom = false;
        options.density = 'compact';
    }
    if (options.mode === 'archive') {
        options.includeSteps = document.getElementById('pdf-opt-steps')?.checked ?? false;
        options.includeWorklist = true;
        options.orientation = options.orientation === 'auto' ? 'portrait' : options.orientation;
    }
    return options;
}

function getLayerCount(furnace) {
    return getFurnaceStats(furnace).layerCount || 0;
}

function hasComplexFurnace(furnace) {
    const items = Array.isArray(furnace?.packedItems) ? furnace.packedItems : [];
    if (items.length >= 36) return true;
    const layers = new Map();
    items.forEach(item => {
        const layer = getItemLayer(item, furnace);
        layers.set(layer, (layers.get(layer) || 0) + 1);
    });
    return [...layers.values()].some(count => count >= COMPLEX_LAYER_ITEM_THRESHOLD);
}

function resolvePdfOrientation(entries, options) {
    if (options.orientation === 'landscape' || options.orientation === 'portrait') return options.orientation;
    if (!options.includeSteps || options.mode === 'archive') return 'portrait';
    const anyComplex = entries.some(({ furnace }) => hasComplexFurnace(furnace));
    if (anyComplex) return 'landscape';
    const anyMany = entries.some(({ furnace }) => (furnace?.packedItems?.length || 0) > 12 || getLayerCount(furnace) > 1);
    return anyMany ? 'landscape' : 'portrait';
}

function getPageMetrics(orientation) {
    const portrait = orientation === 'portrait';
    return {
        orientation: portrait ? 'portrait' : 'landscape',
        pxW: portrait ? PORTRAIT_PAGE_PX_W : LANDSCAPE_PAGE_PX_W,
        pxH: portrait ? PORTRAIT_PAGE_PX_H : LANDSCAPE_PAGE_PX_H,
        mmW: portrait ? PORTRAIT_PAGE_MM_W : LANDSCAPE_PAGE_MM_W,
        mmH: portrait ? PORTRAIT_PAGE_MM_H : LANDSCAPE_PAGE_MM_H,
    };
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function formatNumber(value, digits = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return n.toFixed(digits);
}

function formatWeight(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return `${n.toFixed(1)} kg`;
}

function formatPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return `${n.toFixed(1)}%`;
}

function getDateStamp() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}`;
}

function getFileDateStamp() {
    const d = new Date();
    return d.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function getStrategyLabel() {
    const key = placementRules?.strategy || 'balanced';
    const map = {
        balanced: '均衡方案',
        spaceUtil: '空间利用率优先',
        thermalBalance: '热场均衡',
        surfaceUniform: '表面均匀'
    };
    return map[key] || key;
}

function getShapeLabel(item) {
    return item?.shape === 'cylinder' ? '圆柱' : '方体';
}

function getItemSizeLabel(item) {
    if (!item) return '-';
    if (item.originalDims) {
        const l = item.originalDims.l ?? item.originalDims.length ?? item.w;
        const w = item.originalDims.w ?? item.originalDims.width ?? item.d;
        const h = item.originalDims.h ?? item.originalDims.height ?? item.h;
        return `${formatNumber(l)}×${formatNumber(w)}×${formatNumber(h)}`;
    }
    if (item.shape === 'cylinder') {
        const dia = Math.max(toNumber(item.w), toNumber(item.d));
        return `Φ${formatNumber(dia)}×H${formatNumber(item.h)}`;
    }
    return `${formatNumber(item.w)}×${formatNumber(item.d)}×${formatNumber(item.h)}`;
}

function getItemLayer(item, furnace) {
    if (typeof item?.layer === 'number' && item.layer >= 1) return Math.round(item.layer);

    const y = toNumber(item?.y, 0);
    const shelves = Array.isArray(furnace?.shelvesUsed)
        ? [...furnace.shelvesUsed].sort((a, b) => toNumber(a.y) - toNumber(b.y))
        : [];

    let layer = 1;
    shelves.forEach(shelf => {
        const shelfY = toNumber(shelf.y, 0);
        const thickness = toNumber(shelf.thickness, placementRules?.shelfThickness || 20);
        if (y >= shelfY + thickness * 0.5) layer += 1;
    });

    return Math.max(1, layer);
}

function getLayerLabel(layer) {
    return layer === 1 ? '第 1 层 / 底层' : `第 ${layer} 层`;
}

function getFurnaceName(furnace, index = 0) {
    return furnace?.instanceId || furnace?.typeName || furnace?.name || `工装 #${index + 1}`;
}

function getFurnaceTypeLabel(furnace) {
    const toolingType = furnace?.toolingType || furnace?.basketType || '';
    const map = {
        'standard-basket': '标准料框',
        'mesh-basket': '网篮',
        'material-tray': '料盘',
        'ring-tooling': '环形工装',
        grid: '标准料框',
        honeycomb: '网篮',
        tray: '料盘',
        ringnode: '环形工装'
    };
    return map[toolingType] || furnace?.typeName || '装载工装';
}

function getFurnaceStats(furnace) {
    const items = furnace?.packedItems || [];
    const totalWeight = toNumber(furnace?.totalWeight, items.reduce((sum, item) => sum + toNumber(item.weight), 0));
    const maxWeight = toNumber(furnace?.max_weight ?? furnace?.maxWeight, 0);
    const totalVolume = Math.max(1, toNumber(furnace?.w, 0) * toNumber(furnace?.h, 0) * toNumber(furnace?.d, 0));
    const packedVolume = items.reduce((sum, item) => sum + Math.max(0, toNumber(item.w) * toNumber(item.h) * toNumber(item.d)), 0);
    const layers = [...new Set(items.map(item => getItemLayer(item, furnace)))].sort((a, b) => a - b);
    return {
        itemCount: items.length,
        totalWeight,
        maxWeight,
        weightRate: maxWeight > 0 ? totalWeight / maxWeight * 100 : NaN,
        spaceRate: packedVolume / totalVolume * 100,
        layerCount: layers.length,
        layers
    };
}

function rgbToHex(raw) {
    const m = String(raw || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return null;
    const r = clamp(parseInt(m[1], 10), 0, 255);
    const g = clamp(parseInt(m[2], 10), 0, 255);
    const b = clamp(parseInt(m[3], 10), 0, 255);
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function getColor(value, fallback = '#2563EB') {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    if (/^#[0-9a-f]{3}$/i.test(raw)) return '#' + raw.slice(1).split('').map(c => c + c).join('');
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
    if (/^rgba?\(/i.test(raw)) return rgbToHex(raw) || fallback;
    return fallback;
}

function shadeColor(color, factor = 0.78) {
    const hex = getColor(color, '#2563EB').replace('#', '');
    const r = Math.round(parseInt(hex.slice(0, 2), 16) * factor);
    const g = Math.round(parseInt(hex.slice(2, 4), 16) * factor);
    const b = Math.round(parseInt(hex.slice(4, 6), 16) * factor);
    return '#' + [r, g, b].map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('');
}

function buildNumberedItems(furnace) {
    const sorted = [...(furnace?.packedItems || [])].sort((a, b) => {
        const la = getItemLayer(a, furnace);
        const lb = getItemLayer(b, furnace);
        if (la !== lb) return la - lb;
        const wa = toNumber(a.w) * toNumber(a.d);
        const wb = toNumber(b.w) * toNumber(b.d);
        if (wb !== wa) return wb - wa;
        if (toNumber(a.z) !== toNumber(b.z)) return toNumber(a.z) - toNumber(b.z);
        return toNumber(a.x) - toNumber(b.x);
    });

    return sorted.map((item, idx) => ({
        ...item,
        color: getColor(item.color, DEFAULT_COLORS[idx % DEFAULT_COLORS.length]),
        _pdfNo: idx + 1,
        _pdfLayer: getItemLayer(item, furnace)
    }));
}

function groupItems(items) {
    const map = new Map();
    items.forEach((item, idx) => {
        const key = [item.name || '未命名工件', item.material || '', item.process || '', getItemSizeLabel(item), getShapeLabel(item)].join('|');
        if (!map.has(key)) {
            map.set(key, {
                name: item.name || '未命名工件',
                material: item.material || '-',
                process: item.process || '-',
                size: getItemSizeLabel(item),
                shape: getShapeLabel(item),
                count: 0,
                totalWeight: 0,
                noList: [],
                color: getColor(item.color, DEFAULT_COLORS[idx % DEFAULT_COLORS.length]),
                sample: item
            });
        }
        const g = map.get(key);
        g.count += 1;
        g.totalWeight += toNumber(item.weight, 0);
        g.noList.push(item._pdfNo);
    });
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

function compactNoList(list) {
    const nums = [...list].filter(n => Number.isFinite(Number(n))).map(Number).sort((a, b) => a - b);
    if (!nums.length) return '-';
    const ranges = [];
    let start = nums[0];
    let prev = nums[0];
    for (let i = 1; i <= nums.length; i++) {
        const n = nums[i];
        if (n === prev + 1) {
            prev = n;
            continue;
        }
        ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
        start = n;
        prev = n;
    }
    return ranges.join(', ');
}

function getSelectedFurnaceEntries(selectedIds) {
    const furnaces = Array.isArray(globalFurnacesResult) ? globalFurnacesResult : [];
    if (!selectedIds || selectedIds.length === 0) return furnaces.map((furnace, index) => ({ furnace, index }));

    const rawIds = selectedIds.map(id => String(id));
    const entries = [];
    const seen = new Set();

    furnaces.forEach((furnace, index) => {
        const candidates = [
            index,
            index + 1,
            furnace?.id,
            furnace?.fid,
            furnace?.furnaceId,
            furnace?.instanceId,
            furnace?.typeName,
            furnace?.name
        ].filter(v => v !== undefined && v !== null).map(v => String(v));

        let matched = rawIds.some(id => candidates.includes(id));
        if (!matched) {
            matched = rawIds.some(id => {
                const m = id.match(/-?\d+/);
                if (!m) return false;
                const n = Number(m[0]);
                return n === index || n === index + 1 || n === Number(furnace?.fid);
            });
        }
        if (matched && !seen.has(index)) {
            entries.push({ furnace, index });
            seen.add(index);
        }
    });

    return entries.length ? entries : furnaces.map((furnace, index) => ({ furnace, index }));
}

function getLayout(furnace, viewport = null) {
    const fullW = Math.max(1, toNumber(furnace?.w, 600));
    const fullD = Math.max(1, toNumber(furnace?.d, 600));
    const x0 = viewport ? clamp(toNumber(viewport.x0, 0), 0, fullW) : 0;
    const z0 = viewport ? clamp(toNumber(viewport.z0, 0), 0, fullD) : 0;
    const fw = viewport ? clamp(toNumber(viewport.w, fullW), 1, fullW - x0 || fullW) : fullW;
    const fd = viewport ? clamp(toNumber(viewport.d, fullD), 1, fullD - z0 || fullD) : fullD;

    // V2.6：标题、视窗、进度、炉门方向都从 SVG 内移出，SVG 内部只保留读图所需的边界、网格、工件和坐标箭头。
    // 因此可把更多纵向空间交给工装本体，减少“图很小、四周文字很多”的问题。
    const axisLeft = 58;
    const axisBottom = 54;
    const topPad = 18;
    const rightPad = 20;
    const availableW = SVG_W - axisLeft - rightPad - DRAW_PAD;
    const availableH = SVG_H - topPad - axisBottom;
    const scale = Math.min(availableW / fw, availableH / fd);
    const drawW = fw * scale;
    const drawH = fd * scale;
    const ox = axisLeft + (availableW - drawW) / 2;
    const oy = topPad + (availableH - drawH) / 2;
    return { fw, fd, fullW, fullD, x0, z0, scale, drawW, drawH, ox, oy, isZoom: !!viewport };
}

function getFullLayoutForInset(furnace) {
    const fw = Math.max(1, toNumber(furnace?.w, 600));
    const fd = Math.max(1, toNumber(furnace?.d, 600));
    const insetW = 156;
    const insetH = 112;
    const scale = Math.min(insetW / fw, insetH / fd);
    const drawW = fw * scale;
    const drawH = fd * scale;
    const ox = SVG_W - drawW - 38;
    const oy = 88;
    return { fw, fd, fullW: fw, fullD: fd, x0: 0, z0: 0, scale, drawW, drawH, ox, oy };
}

function chooseGridStep(maxSize) {
    if (maxSize <= 600) return 100;
    if (maxSize <= 1200) return 150;
    if (maxSize <= 2000) return 250;
    return 500;
}

function getRingRadii(furnace, layout) {
    const params = furnace?.params || {};
    const outer = toNumber(params.outerRadius ?? params.radialRadius, Math.min(layout.fw, layout.fd) / 2);
    const inner = toNumber(params.centerVoidRadius ?? params.innerRadius ?? (params.innerDia ? params.innerDia / 2 : 0), 0);
    return {
        outerRadius: clamp(outer, 1, Math.min(layout.fw, layout.fd) / 2),
        innerRadius: clamp(inner, 0, Math.min(layout.fw, layout.fd) / 2 - 1)
    };
}

function renderGrid(layout) {
    const lines = [];
    const stepMm = chooseGridStep(Math.max(layout.fw, layout.fd));
    for (let x = stepMm; x < layout.fw; x += stepMm) {
        const sx = layout.ox + x * layout.scale;
        lines.push(`<line x1="${sx}" y1="${layout.oy}" x2="${sx}" y2="${layout.oy + layout.drawH}" class="pdfv22-grid" />`);
    }
    for (let z = stepMm; z < layout.fd; z += stepMm) {
        const sy = layout.oy + z * layout.scale;
        lines.push(`<line x1="${layout.ox}" y1="${sy}" x2="${layout.ox + layout.drawW}" y2="${sy}" class="pdfv22-grid" />`);
    }
    return lines.join('');
}

function renderBoundarySvg(furnace, layout) {
    const isRing = furnace?.toolingType === 'ring-tooling' || furnace?.basketType === 'ringnode';
    const corner = Math.min(18, Math.max(8, layout.drawW * 0.02));

    // 局部放大时使用“裁切窗口”边界，避免环形工装在局部视图中被过度缩小。
    if (layout.isZoom) {
        return `
            <rect x="${layout.ox}" y="${layout.oy}" width="${layout.drawW}" height="${layout.drawH}" rx="${corner}" class="pdfv23-zoom-boundary" />
            ${renderGrid(layout)}
            <rect x="${layout.ox + 8}" y="${layout.oy + 8}" width="${Math.max(0, layout.drawW - 16)}" height="${Math.max(0, layout.drawH - 16)}" rx="${corner}" class="pdfv22-inner-frame" />
            <text x="${layout.ox + 14}" y="${layout.oy + 28}" class="pdfv23-crop-label">局部放大区域</text>
        `;
    }

    if (isRing) {
        const { outerRadius, innerRadius } = getRingRadii(furnace, layout);
        const cx = layout.ox + layout.fw / 2 * layout.scale;
        const cy = layout.oy + layout.fd / 2 * layout.scale;
        return `
            <circle cx="${cx}" cy="${cy}" r="${outerRadius * layout.scale}" class="pdfv22-boundary-ring" />
            ${innerRadius > 0 ? `<circle cx="${cx}" cy="${cy}" r="${innerRadius * layout.scale}" class="pdfv22-boundary-inner" />` : ''}
            <line x1="${cx - outerRadius * layout.scale}" y1="${cy}" x2="${cx + outerRadius * layout.scale}" y2="${cy}" class="pdfv22-centerline" />
            <line x1="${cx}" y1="${cy - outerRadius * layout.scale}" x2="${cx}" y2="${cy + outerRadius * layout.scale}" class="pdfv22-centerline" />
        `;
    }
    return `
        <rect x="${layout.ox}" y="${layout.oy}" width="${layout.drawW}" height="${layout.drawH}" rx="${corner}" class="pdfv22-boundary" />
        ${renderGrid(layout)}
        <rect x="${layout.ox + 8}" y="${layout.oy + 8}" width="${Math.max(0, layout.drawW - 16)}" height="${Math.max(0, layout.drawH - 16)}" rx="${corner}" class="pdfv22-inner-frame" />
    `;
}


function isSideStandingCylinder(item) {
    if (item?.shape !== 'cylinder') return false;
    const rotationInfo = String(item?.rotationInfo || item?.posture || item?.orientation || '');
    return item?.needsRotation === true || /侧放|立放|竖放|standing|side/i.test(rotationInfo);
}

function getItemFootprint(item) {
    // PDF 俯视图必须使用装炉算法最终落位后的 X/Z 足迹，不能把圆柱/圆盘强制画成等直径圆。
    // 对“立放/侧放圆盘”，3D 场景中 CylinderGeometry 的半径来自 item.h，轴向厚度来自 item.w。
    // 因此俯视图足迹应为 X = item.w（厚度/轴向），Z = item.h（直径），不能继续使用 item.d。
    if (isSideStandingCylinder(item)) {
        const w = Number(item?.footprintW ?? item?.packedW ?? item?.placedW ?? item?.actualW ?? item?.w);
        const d = Number(item?.footprintD ?? item?.packedD ?? item?.placedD ?? item?.actualD ?? item?.h ?? item?.d);
        return { w: Math.max(1, Number.isFinite(w) ? w : 1), d: Math.max(1, Number.isFinite(d) ? d : 1) };
    }

    const wCandidates = [
        item?.footprintW, item?.packedW, item?.placedW, item?.actualW,
        item?.layoutW, item?.drawW, item?.baseW, item?.orientedW, item?.w
    ];
    const dCandidates = [
        item?.footprintD, item?.packedD, item?.placedD, item?.actualD,
        item?.layoutD, item?.drawD, item?.baseD, item?.orientedD, item?.d
    ];
    let w = wCandidates.map(v => Number(v)).find(v => Number.isFinite(v) && v > 0) || 1;
    let d = dCandidates.map(v => Number(v)).find(v => Number.isFinite(v) && v > 0) || 1;

    const rotation = Number(item?.rotation ?? item?.rotationY ?? item?.angle ?? 0);
    const rotated = item?.rotated === true || item?.isRotated === true || Math.abs(rotation % 180) === 90;
    if (rotated && !item?.footprintW && !item?.packedW && !item?.placedW && !item?.actualW) {
        [w, d] = [d, w];
    }
    return { w: Math.max(1, w), d: Math.max(1, d) };
}

function renderItemSvg(item, layout, state = 'current') {
    const rawX = toNumber(item.x) - toNumber(layout.x0, 0);
    const rawZ = toNumber(item.z) - toNumber(layout.z0, 0);
    const footprint = getItemFootprint(item);
    const rawW = footprint.w;
    const rawD = footprint.d;
    if (layout.isZoom && (rawX + rawW < 0 || rawZ + rawD < 0 || rawX > layout.fw || rawZ > layout.fd)) {
        return '';
    }
    const x = layout.ox + rawX * layout.scale;
    const y = layout.oy + rawZ * layout.scale;
    const w = Math.max(5, rawW * layout.scale);
    const h = Math.max(5, rawD * layout.scale);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const base = state === 'previous' ? '#cfd8dc' : getColor(item.color, '#2563EB');
    const side = state === 'previous' ? '#b0bec5' : shadeColor(base, 0.68);
    const stroke = state === 'previous' ? '#94a3b8' : '#0f172a';
    const opacity = state === 'previous' ? 0.24 : 0.98;
    const no = escapeHtml(item._pdfNo);
    const labelSize = state === 'previous' ? clamp(Math.min(w, h) * 0.28, 8, 18) : clamp(Math.min(w, h) * 0.42, 11, 25);
    const isCylinder = item.shape === 'cylinder';

    if (isCylinder && isSideStandingCylinder(item)) {
        // V2.5: 立放/侧放圆盘在俯视图中不是“倒下的圆”，而是窄厚度 × 大直径的胶囊足迹。
        // 这样与 3D 场景里旋转后的竖立圆盘保持一致。
        const r = Math.min(w, h) / 2;
        const labelVisible = !(state === 'previous' && Math.min(w, h) < 16);
        return `
            <g opacity="${opacity}">
                <rect x="${x + Math.min(4, w * 0.18)}" y="${y + Math.min(4, h * 0.06)}" width="${w}" height="${h}" rx="${r}" fill="${side}" />
                <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${base}" stroke="${stroke}" stroke-width="${state === 'previous' ? 1.1 : 2.4}" />
                ${h > 28 ? `<line x1="${cx}" y1="${y + h * 0.10}" x2="${cx}" y2="${y + h * 0.90}" stroke="rgba(255,255,255,.32)" stroke-width="${Math.max(1.4, Math.min(w, h) * 0.16)}" stroke-linecap="round" />` : ''}
                ${labelVisible ? `<text x="${cx}" y="${cy + labelSize * 0.35}" font-size="${labelSize}" class="pdfv22-item-label ${state === 'previous' ? 'muted' : 'strong'}">${no}</text>` : ''}
            </g>
        `;
    }

    if (isCylinder) {
        // 平放圆柱/圆盘的俯视图才画成圆/椭圆。
        const rx = Math.max(3.5, w / 2);
        const ry = Math.max(3.5, h / 2);
        const innerRx = Math.max(1.8, rx * 0.28);
        const innerRy = Math.max(1.5, ry * 0.28);
        const labelVisible = !(state === 'previous' && Math.min(w, h) < 18);
        return `
            <g opacity="${opacity}">
                <ellipse cx="${cx + Math.min(4, rx * 0.12)}" cy="${cy + Math.min(4, ry * 0.18)}" rx="${rx}" ry="${ry}" fill="${side}" />
                <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${base}" stroke="${stroke}" stroke-width="${state === 'previous' ? 1.2 : 2.2}" />
                ${Math.min(rx, ry) > 8 ? `<ellipse cx="${cx}" cy="${cy}" rx="${innerRx}" ry="${innerRy}" fill="rgba(255,255,255,.22)" stroke="${stroke}" stroke-width="${state === 'previous' ? 0.8 : 1.2}" />` : ''}
                ${labelVisible ? `<text x="${cx}" y="${cy + labelSize * 0.35}" font-size="${labelSize}" class="pdfv22-item-label ${state === 'previous' ? 'muted' : 'strong'}">${no}</text>` : ''}
            </g>
        `;
    }

    const shadowDx = state === 'previous' ? 1.6 : 3.2;
    const shadowDy = state === 'previous' ? 1.8 : 3.4;
    return `
        <g opacity="${opacity}">
            <rect x="${x + shadowDx}" y="${y + shadowDy}" width="${w}" height="${h}" rx="4" fill="${side}" />
            <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${base}" stroke="${stroke}" stroke-width="${state === 'previous' ? 1.1 : 2.2}" />
            ${w > 20 && h > 18 ? `<circle cx="${x + w * 0.24}" cy="${y + h * 0.28}" r="${Math.max(1.5, Math.min(w, h) * 0.08)}" fill="rgba(255,255,255,.28)" stroke="${stroke}" stroke-width=".7" />` : ''}
            ${w > 32 && h > 22 ? `<circle cx="${x + w * 0.74}" cy="${y + h * 0.28}" r="${Math.max(1.5, Math.min(w, h) * 0.08)}" fill="rgba(255,255,255,.28)" stroke="${stroke}" stroke-width=".7" />` : ''}
            ${state === 'previous' && w < 18 ? '' : `<text x="${cx}" y="${cy + labelSize * 0.35}" font-size="${labelSize}" class="pdfv22-item-label ${state === 'previous' ? 'muted' : 'strong'}">${no}</text>`}
        </g>
    `;
}


function getItemsBBox(items) {
    if (!items || !items.length) return null;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    items.forEach(item => {
        const x = toNumber(item.x);
        const z = toNumber(item.z);
        const fp = getItemFootprint(item);
        const w = fp.w;
        const d = fp.d;
        minX = Math.min(minX, x);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x + w);
        maxZ = Math.max(maxZ, z + d);
    });
    if (!Number.isFinite(minX)) return null;
    return { minX, minZ, maxX, maxZ, w: maxX - minX, d: maxZ - minZ };
}

function estimateFullProjectedMinPx(furnace, items) {
    const layout = getLayout(furnace);
    if (!items?.length) return 999;
    return items.reduce((min, item) => {
        const fp = getItemFootprint(item);
        const minDim = Math.min(fp.w, fp.d);
        return Math.min(min, minDim * layout.scale);
    }, 999);
}

function makeViewportAroundItems(furnace, items, region = null) {
    const fullW = Math.max(1, toNumber(furnace?.w, 600));
    const fullD = Math.max(1, toNumber(furnace?.d, 600));
    const bbox = getItemsBBox(items) || { minX: 0, minZ: 0, maxX: fullW, maxZ: fullD, w: fullW, d: fullD };
    const minRegionW = Math.min(fullW, Math.max(fullW * 0.38, 260));
    const minRegionD = Math.min(fullD, Math.max(fullD * 0.38, 260));
    const pad = Math.max(50, Math.min(fullW, fullD) * 0.06);

    let x0 = bbox.minX - pad;
    let z0 = bbox.minZ - pad;
    let w = bbox.w + pad * 2;
    let d = bbox.d + pad * 2;

    if (region) {
        x0 = Math.min(x0, region.x0);
        z0 = Math.min(z0, region.z0);
        w = Math.max(w, region.w * 0.82);
        d = Math.max(d, region.d * 0.82);
    }

    w = Math.min(fullW, Math.max(w, minRegionW));
    d = Math.min(fullD, Math.max(d, minRegionD));
    x0 = clamp(x0, 0, Math.max(0, fullW - w));
    z0 = clamp(z0, 0, Math.max(0, fullD - d));
    return { x0, z0, w, d };
}

function viewportEqualsFull(furnace, viewport) {
    const fullW = Math.max(1, toNumber(furnace?.w, 600));
    const fullD = Math.max(1, toNumber(furnace?.d, 600));
    if (!viewport) return true;
    return viewport.w >= fullW * 0.92 && viewport.d >= fullD * 0.92;
}

function renderGlobalInset(furnace, viewport, currentItems) {
    if (!viewport || viewportEqualsFull(furnace, viewport)) return '';
    const layout = getFullLayoutForInset(furnace);
    const rectX = layout.ox + viewport.x0 * layout.scale;
    const rectY = layout.oy + viewport.z0 * layout.scale;
    const rectW = viewport.w * layout.scale;
    const rectH = viewport.d * layout.scale;
    const dots = (currentItems || []).slice(0, 80).map(item => {
        const fp = getItemFootprint(item);
        const cx = layout.ox + (toNumber(item.x) + fp.w / 2) * layout.scale;
        const cy = layout.oy + (toNumber(item.z) + fp.d / 2) * layout.scale;
        return `<circle cx="${cx}" cy="${cy}" r="2.6" fill="${escapeHtml(getColor(item.color, '#ef4444'))}" opacity=".92" />`;
    }).join('');
    return `
        <g class="pdfv23-inset">
            <rect x="${layout.ox - 10}" y="${layout.oy - 26}" width="${layout.drawW + 20}" height="${layout.drawH + 38}" rx="10" fill="#ffffff" stroke="#bfdbfe" stroke-width="2" />
            <text x="${layout.ox}" y="${layout.oy - 9}" class="pdfv23-inset-title">全局定位</text>
            <rect x="${layout.ox}" y="${layout.oy}" width="${layout.drawW}" height="${layout.drawH}" rx="6" fill="#f8fafc" stroke="#0f172a" stroke-width="2" opacity=".75" />
            ${dots}
            <rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" rx="3" fill="none" stroke="#f59e0b" stroke-width="4" stroke-dasharray="9 5" />
        </g>
    `;
}

function renderAssemblyDiagram({ furnace, previousItems, currentItems, layer, stepIndex, stepCount, placedAfter, layerTotal, viewport = null, regionName = '' }) {
    const layout = getLayout(furnace, viewport);
    const clipId = `clip-${layer}-${stepIndex}-${Math.round(layout.x0)}-${Math.round(layout.z0)}-${Math.round(layout.fw)}-${Math.round(layout.fd)}`;
    const boundary = renderBoundarySvg(furnace, layout);
    const localPrevious = viewport
        ? previousItems.filter(item => {
            const x = toNumber(item.x), z = toNumber(item.z);
            const fp = getItemFootprint(item);
            return x + fp.w >= viewport.x0 && x <= viewport.x0 + viewport.w && z + fp.d >= viewport.z0 && z <= viewport.z0 + viewport.d;
        })
        : previousItems;
    const previousSvg = localPrevious.map(item => renderItemSvg(item, layout, 'previous')).join('');
    const currentSvg = currentItems.map(item => renderItemSvg(item, layout, 'current')).join('');
    const inset = renderGlobalInset(furnace, viewport, currentItems);
    const isZoom = viewport && !viewportEqualsFull(furnace, viewport);

    return `
        <svg class="pdfv22-layout-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(getLayerLabel(layer))} Step ${stepIndex} 俯视摆放图">
            <defs>
                <marker id="arrow-x-${layer}-${stepIndex}-${Math.round(layout.x0)}-${Math.round(layout.z0)}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#0f172a" />
                </marker>
                <clipPath id="${clipId}">
                    <rect x="${layout.ox}" y="${layout.oy}" width="${layout.drawW}" height="${layout.drawH}" rx="${Math.min(18, Math.max(8, layout.drawW * 0.02))}" />
                </clipPath>
            </defs>
            <rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" fill="#ffffff" />
            ${boundary}
            <g clip-path="url(#${clipId})">
                ${previousSvg}
                ${currentSvg}
            </g>
            ${inset}
            <line x1="${layout.ox}" y1="${layout.oy + layout.drawH + 30}" x2="${layout.ox + Math.min(layout.drawW, 156)}" y2="${layout.oy + layout.drawH + 30}" stroke="#0f172a" stroke-width="3" marker-end="url(#arrow-x-${layer}-${stepIndex}-${Math.round(layout.x0)}-${Math.round(layout.z0)})" />
            <text x="${layout.ox + Math.min(layout.drawW, 174)}" y="${layout.oy + layout.drawH + 36}" class="pdfv22-axis-label">X+</text>
            <line x1="${layout.ox - 26}" y1="${layout.oy}" x2="${layout.ox - 26}" y2="${layout.oy + Math.min(layout.drawH, 156)}" stroke="#0f172a" stroke-width="3" marker-end="url(#arrow-x-${layer}-${stepIndex}-${Math.round(layout.x0)}-${Math.round(layout.z0)})" />
            <text x="${layout.ox - 42}" y="${layout.oy + Math.min(layout.drawH, 178)}" class="pdfv22-axis-label">Z+</text>
            ${isZoom ? `<text x="${layout.ox + 12}" y="${layout.oy + 26}" class="pdfv23-crop-label">${escapeHtml(regionName || '局部放大')}</text>` : ''}
        </svg>
    `;
}

function makeLayerRegions(furnace) {
    const fw = Math.max(1, toNumber(furnace?.w, 600));
    const fd = Math.max(1, toNumber(furnace?.d, 600));
    const hw = fw / 2;
    const hd = fd / 2;
    return [
        { key: 'A', name: 'A区 / 左上', x0: 0, z0: 0, w: hw, d: hd },
        { key: 'B', name: 'B区 / 右上', x0: hw, z0: 0, w: fw - hw, d: hd },
        { key: 'C', name: 'C区 / 左下', x0: 0, z0: hd, w: hw, d: fd - hd },
        { key: 'D', name: 'D区 / 右下', x0: hw, z0: hd, w: fw - hw, d: fd - hd }
    ];
}

function getItemCenter(item) {
    const fp = getItemFootprint(item);
    return { x: toNumber(item.x) + fp.w / 2, z: toNumber(item.z) + fp.d / 2 };
}

function getRegionForItem(regions, item) {
    const c = getItemCenter(item);
    return regions.find(r => c.x >= r.x0 && c.x <= r.x0 + r.w && c.z >= r.z0 && c.z <= r.z0 + r.d) || regions[0];
}

function chunkItems(items, limit) {
    const chunks = [];
    for (let start = 0; start < items.length; start += limit) chunks.push(items.slice(start, start + limit));
    return chunks;
}

function splitLayerSteps(furnace, layerItems, options = {}) {
    const count = layerItems.length;
    if (!count) return [];
    const fullMinPx = estimateFullProjectedMinPx(furnace, layerItems);
    const complex = options.regionZoom && (count >= COMPLEX_LAYER_ITEM_THRESHOLD || fullMinPx < MIN_READABLE_ITEM_PX);
    const limit = options.density === 'compact' ? 28 : (options.density === 'large' ? 14 : SIMPLE_STEP_ITEM_LIMIT);

    if (!complex) {
        const target = count <= 24 ? count : limit;
        return chunkItems(layerItems, target).map((items, idx) => ({
            items,
            region: null,
            regionName: '',
            stepMode: 'global',
            localIndex: idx + 1
        }));
    }

    const regions = makeLayerRegions(furnace);
    const byRegion = new Map(regions.map(r => [r.key, []]));
    layerItems.forEach(item => byRegion.get(getRegionForItem(regions, item).key).push(item));

    const steps = [];
    regions.forEach(region => {
        const items = byRegion.get(region.key) || [];
        if (!items.length) return;
        const regionLimit = options.density === 'compact' ? 22 : (options.density === 'large' ? 12 : REGION_STEP_ITEM_LIMIT);
        chunkItems(items, regionLimit).forEach((chunk, idx) => steps.push({
            items: chunk,
            region,
            regionName: `${region.name}${items.length > regionLimit ? `-${idx + 1}` : ''}`,
            stepMode: 'region',
            localIndex: idx + 1
        }));
    });

    return steps.length ? steps : chunkItems(layerItems, limit).map(items => ({ items, region: null, regionName: '', stepMode: 'global' }));
}

function renderLogo() {
    return `
        <div class="pdfv22-logo" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="34" height="34">
                <rect x="8" y="24" width="22" height="22" rx="3" fill="#ffffff" opacity=".95" />
                <rect x="28" y="14" width="26" height="26" rx="3" fill="#bfdbfe" />
                <rect x="18" y="34" width="26" height="22" rx="3" fill="#93c5fd" />
                <circle cx="17" cy="26" r="4" fill="#1d4ed8" />
                <circle cx="38" cy="16" r="4" fill="#1d4ed8" />
                <circle cx="28" cy="36" r="4" fill="#1d4ed8" />
                <path d="M8 24 L19 16 L30 24 M30 24 L43 15 L54 24 M18 34 L31 26 L44 34" fill="none" stroke="#0f172a" stroke-width="2" opacity=".65" />
            </svg>
        </div>
    `;
}

function buildPage({ className = '', title, subtitle, tag, body, footerLeft = 'WI-HT-LOAD-001' }, pageIndex, pageTotal) {
    return `
        <section class="pdfv22-page ${className}">
            <header class="pdfv22-header">
                <div class="pdfv22-brand">
                    ${renderLogo()}
                    <div>
                        <div class="pdfv22-doc-kicker">Loading Work Instruction</div>
                        <div class="pdfv22-doc-title">${escapeHtml(title)}</div>
                        <div class="pdfv22-doc-subtitle">${escapeHtml(subtitle)}</div>
                    </div>
                </div>
                <div class="pdfv22-header-tag">${escapeHtml(tag || getDateStamp())}</div>
            </header>
            <main class="pdfv22-body">${body}</main>
            <footer class="pdfv22-page-footer">
                <span>${escapeHtml(footerLeft)}</span>
                <span>PDF V2.7 · 现场摆料施工单</span>
                <span>第 ${pageIndex} 页 / 共 ${pageTotal} 页</span>
            </footer>
        </section>
    `;
}

function kpiCard(icon, label, value, hint = '') {
    return `
        <div class="pdfv22-kpi">
            <div class="pdfv22-kpi-icon">${icon}</div>
            <div>
                <div class="pdfv22-kpi-label">${escapeHtml(label)}</div>
                <div class="pdfv22-kpi-value">${escapeHtml(value)}</div>
                ${hint ? `<div class="pdfv22-kpi-hint">${escapeHtml(hint)}</div>` : ''}
            </div>
        </div>
    `;
}

function buildCoverPageConfig(furnace, index, numberedItems) {
    const name = getFurnaceName(furnace, index);
    const stats = getFurnaceStats(furnace);
    const dimensions = `${formatNumber(furnace.w)}×${formatNumber(furnace.h)}×${formatNumber(furnace.d)} mm`;
    const groups = groupItems(numberedItems).slice(0, 4);
    const restCount = Math.max(0, groupItems(numberedItems).length - groups.length);
    const hasUnpacked = Array.isArray(globalUnpackedItems) && globalUnpackedItems.length > 0;
    const warning = hasUnpacked
        ? `整批方案仍有 ${globalUnpackedItems.length} 件工件未装入，请确认是否增加工装、拆分炉次或调整规则。`
        : '当前所选工装/炉次无未装入提示，现场仍需核对实物数量与工艺批次。';

    const body = `
        <div class="cover-grid">
            <section class="pdfv22-card cover-task">
                <div class="card-title blue">▣ 任务总览</div>
                <div class="info-grid">
                    <div><span>工装名称</span><strong>${escapeHtml(name)}</strong></div>
                    <div><span>工装类型</span><strong>${escapeHtml(getFurnaceTypeLabel(furnace))}</strong></div>
                    <div><span>工装尺寸</span><strong>${escapeHtml(dimensions)}</strong></div>
                    <div><span>摆放策略</span><strong>${escapeHtml(getStrategyLabel())}</strong></div>
                    <div><span>安全间距</span><strong>${escapeHtml(placementRules?.minSpacing ?? 5)} mm</strong></div>
                    <div><span>搁板厚度</span><strong>${escapeHtml(placementRules?.shelfThickness ?? 20)} mm</strong></div>
                </div>
            </section>
            <section class="pdfv22-card cover-checklist">
                <div class="card-title brown">☑ 现场执行确认</div>
                <div class="check-row"><i></i><span>已核对工装、工艺及炉次信息，与生产计划一致。</span></div>
                <div class="check-row"><i></i><span>已检查工装状态完好，搁板安装牢固，无变形。</span></div>
                <div class="check-row"><i></i><span>已确认摆放策略与安全间距要求，现场条件满足。</span></div>
                <div class="check-row"><i></i><span>已确认未装入工件处理方案。</span></div>
            </section>
        </div>
        <div class="kpi-grid">
            ${kpiCard('▦', '已装工件', `${stats.itemCount} 件`)}
            ${kpiCard('KG', '装载重量', formatWeight(stats.totalWeight), `承重 ${formatWeight(stats.maxWeight)}`)}
            ${kpiCard('◔', '重量利用率', formatPercent(stats.weightRate))}
            ${kpiCard('▩', '空间利用率', formatPercent(stats.spaceRate))}
            ${kpiCard('≡', '层数', `${stats.layerCount} 层`)}
            ${kpiCard('◷', '生成时间', getDateStamp())}
        </div>
        <div class="cover-alert ${hasUnpacked ? 'danger' : 'ok'}">⚠ ${escapeHtml(warning)}</div>
        <section class="pdfv22-card cover-table-card">
            <div class="card-title blue">☷ 本工装批次汇总</div>
            <table class="pdfv22-table cover-table">
                <thead><tr><th>编号范围</th><th>工件</th><th>材质 / 工艺</th><th>尺寸 mm</th><th>数量</th><th>重量</th></tr></thead>
                <tbody>
                    ${groups.map(g => `
                        <tr>
                            <td>${escapeHtml(compactNoList(g.noList))}</td>
                            <td><span class="color-dot" style="background:${escapeHtml(g.color)}"></span>${escapeHtml(g.name)}</td>
                            <td>${escapeHtml(g.material)} / ${escapeHtml(g.process)}</td>
                            <td>${escapeHtml(g.size)}</td>
                            <td>${g.count}</td>
                            <td>${formatWeight(g.totalWeight)}</td>
                        </tr>
                    `).join('')}
                    ${restCount ? `<tr><td colspan="6" class="muted-cell">还有 ${restCount} 类工件，详见下一页“工件图例 / 工件包”。</td></tr>` : ''}
                </tbody>
            </table>
        </section>
        <div class="cover-sign-row">
            <div>摆料人：<span></span></div>
            <div>复核人：<span></span></div>
            <div>完成时间：<span></span></div>
        </div>
    `;

    return {
        className: 'cover-page',
        title: '装炉摆料作业指导书',
        subtitle: `${name} · ${getFurnaceTypeLabel(furnace)} · 现场摆料施工单 V2.7`,
        tag: `炉次 ${index + 1}`,
        body,
        footerLeft: `炉次#${index + 1}`
    };
}

function renderPartIcon(g, large = false) {
    const color = getColor(g.color, '#2563EB');
    const side = shadeColor(color, 0.62);
    const stroke = '#0f172a';
    const width = large ? 170 : 92;
    const height = large ? 112 : 64;
    if (g.shape === '圆柱') {
        return `
            <svg class="part-icon" viewBox="0 0 ${width} ${height}">
                <ellipse cx="${width * 0.5}" cy="${height * 0.42}" rx="${width * 0.26}" ry="${height * 0.22}" fill="${color}" stroke="${stroke}" stroke-width="3" />
                <path d="M ${width * 0.24} ${height * 0.42} L ${width * 0.24} ${height * 0.68} Q ${width * 0.5} ${height * 0.88} ${width * 0.76} ${height * 0.68} L ${width * 0.76} ${height * 0.42}" fill="${side}" stroke="${stroke}" stroke-width="3" />
                <ellipse cx="${width * 0.5}" cy="${height * 0.42}" rx="${width * 0.11}" ry="${height * 0.09}" fill="#fff" opacity=".28" stroke="${stroke}" stroke-width="2" />
            </svg>
        `;
    }
    return `
        <svg class="part-icon" viewBox="0 0 ${width} ${height}">
            <polygon points="${width * 0.18},${height * 0.34} ${width * 0.52},${height * 0.16} ${width * 0.84},${height * 0.34} ${width * 0.50},${height * 0.52}" fill="${color}" stroke="${stroke}" stroke-width="3" />
            <polygon points="${width * 0.18},${height * 0.34} ${width * 0.50},${height * 0.52} ${width * 0.50},${height * 0.84} ${width * 0.18},${height * 0.64}" fill="${shadeColor(color, 0.78)}" stroke="${stroke}" stroke-width="3" />
            <polygon points="${width * 0.50},${height * 0.52} ${width * 0.84},${height * 0.34} ${width * 0.84},${height * 0.64} ${width * 0.50},${height * 0.84}" fill="${side}" stroke="${stroke}" stroke-width="3" />
            <circle cx="${width * 0.44}" cy="${height * 0.31}" r="${height * 0.055}" fill="rgba(255,255,255,.35)" stroke="${stroke}" stroke-width="1.5" />
            <circle cx="${width * 0.62}" cy="${height * 0.31}" r="${height * 0.055}" fill="rgba(255,255,255,.35)" stroke="${stroke}" stroke-width="1.5" />
        </svg>
    `;
}

function buildPartsLegendPageConfig(furnace, index, numberedItems) {
    const name = getFurnaceName(furnace, index);
    const groups = groupItems(numberedItems);
    const largeMode = groups.length <= 2;
    const body = `
        <div class="parts-layout ${largeMode ? 'large-mode' : ''}">
            <section class="pdfv22-card parts-main">
                <div class="card-title blue">▦ 本炉工件包</div>
                <div class="parts-grid ${largeMode ? 'large-cards' : ''}">
                    ${groups.map((g, idx) => `
                        <div class="part-card ${largeMode ? 'large' : ''}">
                            <div class="part-head" style="background:${escapeHtml(g.color)}"><b>${String.fromCharCode(65 + (idx % 26))}</b><span>${escapeHtml(g.name)}</span></div>
                            <div class="part-body">
                                ${renderPartIcon(g, largeMode)}
                                <div class="part-meta">
                                    <strong>${escapeHtml(g.size)}</strong>
                                    <em>${escapeHtml(g.material)} / ${escapeHtml(g.process)}</em>
                                    <small>编号 ${escapeHtml(compactNoList(g.noList))}</small>
                                </div>
                                <div class="part-count">× ${g.count}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </section>
            <aside class="parts-side">
                <section class="pdfv22-card legend-card">
                    <div class="card-title navy">📖 阅读说明</div>
                    <div class="legend-row"><i class="legend-color" style="background:#ef4444"></i><b>彩色件</b><span>本步骤新增工件</span></div>
                    <div class="legend-row"><i class="legend-color gray"></i><b>灰色件</b><span>已完成步骤工件</span></div>
                    <div class="legend-row"><i class="legend-border"></i><b>黑色边框</b><span>工装边界 / 摆放范围</span></div>
                    <div class="legend-row"><i class="legend-axis">X</i><b>坐标</b><span>用于复核与回写</span></div>
                </section>
                <section class="pdfv22-card direction-card">
                    <div class="card-title navy">◎ 方向说明</div>
                    <div class="direction-grid">
                        <div><strong>X+</strong><span class="arrow red">→</span></div>
                        <div><strong>Z+</strong><span class="arrow blue">↓</span></div>
                        <div><strong>炉门方向</strong><span class="arrow gray">→</span></div>
                    </div>
                </section>
                <section class="pdfv22-card yellow-note">请按本页先核对工件、数量、尺寸，有疑问先暂停摆料。</section>
            </aside>
        </div>
    `;
    return {
        className: 'parts-page',
        title: '工件图例 / 工件包',
        subtitle: `${name} · 总计 ${numberedItems.length} 件工件 · 颜色用于区分类型`,
        tag: '图例页',
        body,
        footerLeft: `炉次#${index + 1}`
    };
}

function buildStepMetaRail({ furnace, layer, stepIndex, stepCount, placedAfter, layerTotal, viewport, regionName, stepMode }) {
    const safeSpacing = placementRules?.minSpacing ?? 5;
    const isZoom = viewport && !viewportEqualsFull(furnace, viewport);
    const viewW = isZoom ? viewport.w : Math.max(1, toNumber(furnace?.w, 600));
    const viewD = isZoom ? viewport.d : Math.max(1, toNumber(furnace?.d, 600));
    const progressPct = layerTotal ? Math.round(placedAfter / layerTotal * 100) : 100;
    const viewName = isZoom ? (regionName || '局部放大') : '全局视图';
    return `
        <div class="diagram-meta-rail">
            <div class="rail-block rail-main">
                <em>俯视图</em>
                <strong>${escapeHtml(getLayerLabel(layer))}</strong>
                <span>STEP ${stepIndex}/${stepCount}</span>
            </div>
            <div class="rail-block">
                <em>视窗</em>
                <strong>${escapeHtml(viewName)}</strong>
                <span>X=${formatNumber(viewW)}mm</span>
                <span>Z=${formatNumber(viewD)}mm</span>
                <span>间距=${escapeHtml(safeSpacing)}mm</span>
            </div>
            <div class="rail-block rail-axis">
                <em>方向</em>
                <div><b>Z+</b><i>↓</i></div>
                <div><b>X+</b><i>→</i></div>
                <div><b>炉门</b><i>→</i></div>
            </div>
            <div class="rail-block rail-progress-mini">
                <em>本层进度</em>
                <strong>${placedAfter}/${layerTotal}</strong>
                <span>${progressPct}%</span>
            </div>
        </div>
    `;
}

function buildProgressBar(placedAfter, layerTotal) {
    const pct = layerTotal ? clamp(placedAfter / layerTotal * 100, 0, 100) : 100;
    return `
        <div class="step-progress-card">
            <div class="progress-main">
                <div><b>本层进度</b><strong>${placedAfter} / ${layerTotal}</strong></div>
                <div class="progress-track"><span style="width:${pct}%"></span></div>
                <em>${Math.round(pct)}%</em>
            </div>
            <div class="progress-legend">
                <span><i class="legend-chip previous"></i>已放置</span>
                <span><i class="legend-chip current"></i>本步骤新增</span>
                <span><i class="legend-chip next"></i>下一步继续</span>
            </div>
        </div>
    `;
}

function buildLayerStepPageConfigs(furnace, index, numberedItems, layer, options = {}) {
    const layerItems = numberedItems.filter(item => item._pdfLayer === layer);
    const steps = splitLayerSteps(furnace, layerItems, options);
    const pages = [];
    const layerLabel = getLayerLabel(layer);
    const accumulated = [];

    steps.forEach((step, stepArrayIndex) => {
        const currentItems = step.items;
        const previousItems = [...accumulated];
        const stepIndex = stepArrayIndex + 1;
        const stepCount = steps.length;
        const placedAfter = previousItems.length + currentItems.length;
        const groups = groupItems(currentItems).slice(0, 6);
        const layerWeight = currentItems.reduce((sum, item) => sum + toNumber(item.weight), 0);
        const noRange = compactNoList(currentItems.map(item => item._pdfNo));
        const needsZoom = options.regionZoom && step.stepMode === 'region';
        const viewport = needsZoom ? makeViewportAroundItems(furnace, currentItems, step.region) : null;
        const diagram = renderAssemblyDiagram({
            furnace,
            previousItems,
            currentItems,
            layer,
            stepIndex,
            stepCount,
            placedAfter,
            layerTotal: layerItems.length,
            viewport,
            regionName: step.regionName
        });
        const metaRail = buildStepMetaRail({
            furnace,
            layer,
            stepIndex,
            stepCount,
            placedAfter,
            layerTotal: layerItems.length,
            viewport,
            regionName: step.regionName,
            stepMode: step.stepMode
        });

        const modeBadge = step.stepMode === 'region'
            ? `<span class="pdfv23-mode-badge">${escapeHtml(step.regionName)} · 局部放大</span>`
            : `<span class="pdfv23-mode-badge muted">全局视图</span>`;

        const body = `
            <div class="step-layout ${step.stepMode === 'region' ? 'region-step-layout' : ''}">
                <section class="pdfv22-card diagram-card">
                    <div class="diagram-split">
                        ${metaRail}
                        <div class="diagram-main-frame">${diagram}</div>
                    </div>
                </section>
                <aside class="step-side">
                    <section class="step-number-card">
                        <div class="big-step-num">${stepIndex}</div>
                        <div><b>摆放本步骤新增件</b><span>编号 ${escapeHtml(noRange)} · ${currentItems.length} 件 · ${formatWeight(layerWeight)}</span>${modeBadge}</div>
                    </section>
                    <section class="pdfv22-card step-parts-card">
                        <div class="card-title blue">▣ 本步骤零件</div>
                        <table class="pdfv22-table step-table">
                            <thead><tr><th>编号</th><th>工件</th><th>数量</th></tr></thead>
                            <tbody>
                                ${groups.map(g => `
                                    <tr>
                                        <td>${escapeHtml(compactNoList(g.noList))}</td>
                                        <td><span class="color-dot" style="background:${escapeHtml(g.color)}"></span>${escapeHtml(g.name)}<br><small>${escapeHtml(g.size)}</small></td>
                                        <td>${g.count}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </section>
                    <section class="pdfv22-card requirement-card">
                        <div class="card-title navy">☑ 摆放要求</div>
                        <ul>
                            <li>${step.stepMode === 'region' ? '先看右上全局定位，再按局部放大图摆放。' : '只摆放图中彩色编号件，灰色件不要移动。'}</li>
                            <li>按编号顺序摆放，优先靠边/靠定位基准。</li>
                            <li>保持 ${escapeHtml(placementRules?.minSpacing ?? 5)}mm 安全间距。</li>
                            <li>放置后核对方向、层号和搁板位置。</li>
                        </ul>
                    </section>
                </aside>
            </div>
            ${buildProgressBar(placedAfter, layerItems.length)}
        `;

        pages.push({
            className: `step-page ${step.stepMode === 'region' ? 'region-step-page' : ''}`,
            title: `${layerLabel} · STEP ${stepIndex}`,
            subtitle: `${getFurnaceName(furnace, index)} · 本步骤新增 ${currentItems.length} 件 · 累计 ${placedAfter} / ${layerItems.length} 件${step.stepMode === 'region' ? ` · ${step.regionName}` : ''}`,
            tag: `第 ${layer} 层 / Step ${stepIndex}`,
            body,
            footerLeft: `炉次#${index + 1}`
        });
        accumulated.push(...currentItems);
    });
    return pages;
}

function buildWorklistRows(items) {
    return items.map(item => `
        <tr>
            <td class="center">${item._pdfNo}</td>
            <td class="center">${item._pdfLayer}</td>
            <td>${escapeHtml(item.name || '-')}</td>
            <td>${escapeHtml(item.customer || item.itemCode || '-')}</td>
            <td>${escapeHtml(item.material || '-')}</td>
            <td>${escapeHtml(item.process || '-')}</td>
            <td>${escapeHtml(getItemSizeLabel(item))}</td>
            <td>X ${formatNumber(item.x)} / Y ${formatNumber(item.y)} / Z ${formatNumber(item.z)}</td>
            <td>${formatWeight(item.weight)}</td>
        </tr>
    `).join('');
}

function buildWorklistPageConfigs(furnace, index, numberedItems, options = {}) {
    const pages = [];
    const stats = getFurnaceStats(furnace);
    const rowLimit = options.resolvedOrientation === 'portrait' ? PORTRAIT_ROW_LIMIT : PAGE_ROW_LIMIT;
    for (let start = 0; start < numberedItems.length; start += rowLimit) {
        const chunk = numberedItems.slice(start, start + rowLimit);
        const pageIndex = Math.floor(start / rowLimit) + 1;
        const pageCount = Math.ceil(numberedItems.length / rowLimit);
        const body = `
            <div class="worklist-summary">
                <div>▦ 总件数 <b>${numberedItems.length}</b></div>
                <div>▤ 当前页 <b>${start + 1}-${Math.min(start + rowLimit, numberedItems.length)}</b></div>
                <div>≡ 层数 <b>${stats.layerCount}</b></div>
                <div>↔ 安全间距 <b>${escapeHtml(placementRules?.minSpacing ?? 5)}mm</b></div>
            </div>
            <section class="pdfv22-card worklist-card">
                <table class="pdfv22-table worklist-table">
                    <thead><tr><th>编号</th><th>层</th><th>工件</th><th>客户/图号</th><th>材质</th><th>工艺</th><th>尺寸 mm</th><th>坐标 mm (X/Y/Z)</th><th>单重</th></tr></thead>
                    <tbody>${buildWorklistRows(chunk)}</tbody>
                </table>
            </section>
            <div class="worklist-note">ⓘ 坐标由系统自动生成。现场若有人工微调，请在纸面备注并回写系统。</div>
        `;
        pages.push({
            className: 'worklist-page',
            title: '附录：工件坐标清单',
            subtitle: `${getFurnaceName(furnace, index)} · ${start + 1}-${Math.min(start + rowLimit, numberedItems.length)} / ${numberedItems.length}`,
            tag: `附录 ${pageIndex}/${pageCount}`,
            body,
            footerLeft: `炉次#${index + 1}`
        });
    }
    return pages;
}

function buildPageConfigs(entries, options = {}) {
    const pages = [];
    entries.forEach(({ furnace, index }) => {
        const numberedItems = buildNumberedItems(furnace);
        const stats = getFurnaceStats(furnace);
        if (options.includeCover !== false) pages.push(buildCoverPageConfig(furnace, index, numberedItems));
        if (options.includeLegend !== false) pages.push(buildPartsLegendPageConfig(furnace, index, numberedItems));
        if (options.includeSteps !== false) {
            stats.layers.forEach(layer => pages.push(...buildLayerStepPageConfigs(furnace, index, numberedItems, layer, options)));
        }
        if (options.includeWorklist !== false) pages.push(...buildWorklistPageConfigs(furnace, index, numberedItems, options));
    });
    return pages;
}

function buildPdfDocument(entries, options = {}) {
    const pages = buildPageConfigs(entries, options);
    const orientation = options.resolvedOrientation || 'landscape';
    return `
        <div class="pdfv22-root pdfv23-root ${orientation === 'portrait' ? 'portrait' : 'landscape'}">
            <style>${getPdfV22Css()}</style>
            ${pages.map((page, idx) => buildPage(page, idx + 1, pages.length)).join('')}
        </div>
    `;
}

function getPdfV22Css() {
    return `
        .pdfv22-root { width: 1122px; background:#ffffff; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",Arial,sans-serif; color:#0f172a; }
        .pdfv22-page { width:1122px; height:794px; box-sizing:border-box; padding:26px 34px 48px; background:#ffffff; position:relative; overflow:hidden; page-break-after:always; }
        .pdfv22-page:last-child { page-break-after:auto; }
        .pdfv22-header { height:70px; display:flex; align-items:flex-start; justify-content:space-between; border-top:3px solid #2563eb; border-bottom:1px solid #dbeafe; padding-top:9px; margin-bottom:12px; box-sizing:border-box; }
        .pdfv22-brand { display:flex; align-items:flex-start; gap:14px; }
        .pdfv22-logo { width:42px; height:42px; border-radius:10px; background:#2563eb; display:flex; align-items:center; justify-content:center; box-shadow:none; flex:0 0 auto; }
        .pdfv22-doc-kicker { font-size:11px; color:#2563eb; font-weight:800; letter-spacing:.2px; line-height:1; }
        .pdfv22-doc-title { font-size:29px; line-height:1; font-weight:900; letter-spacing:-.6px; color:#0f172a; margin-top:5px; }
        .pdfv22-doc-subtitle { font-size:12px; line-height:1.2; color:#64748b; font-weight:700; margin-top:5px; }
        .pdfv22-header-tag { padding:7px 16px; background:#2563eb; color:#fff; border-radius:999px; font-size:15px; font-weight:850; box-shadow:none; }
        .pdfv22-body { height:616px; min-height:0; }
        .pdfv22-page-footer { position:absolute; left:34px; right:34px; bottom:16px; display:grid; grid-template-columns:1fr 1fr 1fr; color:#64748b; font-size:11px; font-weight:700; }
        .pdfv22-page-footer span:nth-child(2) { text-align:center; }
        .pdfv22-page-footer span:nth-child(3) { text-align:right; color:#0f56b3; }
        .pdfv22-card { background:#fff; border:1px solid #dbe3ef; border-radius:12px; box-shadow:none; padding:12px; box-sizing:border-box; }
        .card-title { font-size:15px; font-weight:850; margin-bottom:9px; }
        .card-title.blue { color:#2563eb; }
        .card-title.navy { color:#0b1220; }
        .card-title.brown { color:#2563eb; }
        .cover-grid { display:grid; grid-template-columns:1.28fr .96fr; gap:14px; height:238px; }
        .cover-task { background:#ffffff; border-color:#dbeafe; }
        .info-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
        .info-grid div { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:6px 8px; min-height:43px; box-sizing:border-box; }
        .info-grid span { display:block; color:#64748b; font-size:9.5px; font-weight:700; margin-bottom:4px; }
        .info-grid strong { display:block; color:#0f172a; font-size:13px; font-weight:850; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cover-checklist { background:#ffffff; border-color:#dbeafe; }
        .check-row { display:grid; grid-template-columns:20px 1fr; gap:9px; align-items:start; padding:6px 0; border-bottom:1px solid #e2e8f0; font-size:12px; color:#334155; line-height:1.35; font-weight:650; }
        .check-row:last-child { border-bottom:0; }
        .check-row i { width:16px; height:16px; border:1.5px solid #94a3b8; border-radius:4px; display:block; background:#fff; }
        .kpi-grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:8px; margin-top:8px; height:62px; position:relative; z-index:1; }
        .pdfv22-kpi { display:grid; grid-template-columns:26px 1fr; gap:6px; align-items:center; background:#fff; border:1px solid #dbeafe; border-radius:10px; padding:7px 8px; box-shadow:none; box-sizing:border-box; }
        .pdfv22-kpi-icon { color:#2563eb; font-size:16px; font-weight:850; display:flex; align-items:center; justify-content:center; }
        .pdfv22-kpi-label { font-size:9.5px; color:#64748b; font-weight:700; }
        .pdfv22-kpi-value { margin-top:2px; font-size:17px; line-height:1; color:#2563eb; font-weight:850; }
        .pdfv22-kpi-hint { margin-top:2px; font-size:8.5px; color:#94a3b8; }
        .cover-alert { margin-top:8px; height:30px; border-radius:8px; display:flex; align-items:center; padding:0 12px; font-size:12px; font-weight:750; box-sizing:border-box; }
        .cover-alert.danger { background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; }
        .cover-alert.ok { background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; }
        .cover-table-card { margin-top:8px; height:156px; padding:10px 12px; border-color:#dbeafe; overflow:hidden; }
        .pdfv22-table { width:100%; border-collapse:collapse; background:#fff; font-size:11.5px; }
        .pdfv22-table th { background:#2563eb; color:#fff; border:1px solid #bfdbfe; padding:5px 6px; text-align:left; font-weight:750; }
        .pdfv22-table td { border:1px solid #dbeafe; padding:4px 6px; vertical-align:middle; color:#1e293b; }
        .pdfv22-table tr:nth-child(even) td { background:#f8fbff; }
        .cover-table { font-size:10.5px; }
        .muted-cell { color:#64748b !important; font-weight:700; text-align:center; background:#f8fafc !important; }
        .color-dot { display:inline-block; width:10px; height:10px; border-radius:3px; border:1px solid rgba(15,23,42,.25); margin-right:6px; vertical-align:-1px; }
        .cover-sign-row { height:31px; margin-top:7px; border-top:1px dashed #cbd5e1; display:grid; grid-template-columns:repeat(3,1fr); gap:22px; align-items:end; color:#334155; font-size:12px; font-weight:700; }
        .cover-sign-row span { display:inline-block; width:118px; border-bottom:1px solid #334155; }
        .parts-layout { height:612px; display:grid; grid-template-columns:1.65fr .75fr; gap:16px; }
        .parts-main { overflow:hidden; border-color:#bfdbfe; }
        .parts-side { display:flex; flex-direction:column; gap:12px; }
        .parts-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; max-height:546px; overflow:hidden; }
        .parts-grid.large-cards { grid-template-columns:repeat(2,minmax(0,1fr)); align-items:stretch; }
        .part-card { border:1.5px solid #e2e8f0; border-radius:14px; overflow:hidden; background:#fff; min-height:116px; }
        .part-card.large { min-height:420px; }
        .part-head { display:flex; align-items:center; gap:9px; color:#fff; padding:7px 10px; font-size:14px; font-weight:950; text-shadow:0 1px 2px rgba(0,0,0,.28); }
        .part-head b { width:24px; height:24px; border-radius:50%; background:rgba(255,255,255,.22); display:flex; align-items:center; justify-content:center; border:1.5px solid rgba(255,255,255,.6); }
        .part-head span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .part-body { display:grid; grid-template-columns:96px 1fr 58px; gap:6px; align-items:center; padding:9px; }
        .part-card.large .part-body { grid-template-columns:1fr; grid-template-rows:180px auto 56px; text-align:center; }
        .part-icon { width:92px; height:64px; display:block; margin:auto; }
        .part-card.large .part-icon { width:170px; height:112px; }
        .part-meta strong { display:block; color:#0f172a; font-size:14px; font-weight:950; }
        .part-card.large .part-meta strong { font-size:22px; }
        .part-meta em, .part-meta small { display:block; color:#64748b; font-style:normal; font-size:10px; font-weight:750; margin-top:3px; }
        .part-card.large .part-meta em, .part-card.large .part-meta small { font-size:13px; }
        .part-count { text-align:right; color:#0f56b3; font-size:20px; font-weight:950; }
        .part-card.large .part-count { text-align:center; font-size:34px; border:2px solid #bfdbfe; border-radius:12px; padding:6px; margin:0 auto; min-width:120px; }
        .legend-card { flex:1; }
        .legend-row { display:grid; grid-template-columns:32px 66px 1fr; gap:8px; align-items:center; padding:7px 0; border-bottom:1px dashed #cbd5e1; }
        .legend-row:last-child { border-bottom:0; }
        .legend-row b { font-size:13px; color:#0f172a; }
        .legend-row span { font-size:11px; color:#64748b; font-weight:700; }
        .legend-color { width:24px; height:24px; border-radius:6px; border:2px solid #0f172a; display:block; }
        .legend-color.gray { background:#cbd5e1; opacity:.58; }
        .legend-border { width:24px; height:24px; border-radius:6px; border:3px solid #0f172a; display:block; background:#fff; }
        .legend-axis { width:24px; height:24px; border-radius:50%; background:#eff6ff; color:#0f56b3; display:flex; align-items:center; justify-content:center; font-style:normal; font-weight:950; border:1.5px solid #bfdbfe; }
        .direction-card { height:130px; }
        .direction-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; align-items:center; text-align:center; }
        .direction-grid strong { display:block; font-size:13px; margin-bottom:4px; }
        .arrow { font-size:34px; font-weight:950; line-height:1; }
        .arrow.red { color:#ef4444; } .arrow.blue { color:#0f56b3; } .arrow.gray { color:#64748b; }
        .yellow-note { background:#fff7ed; border-color:#f7c873; color:#92400e; font-size:13px; line-height:1.55; font-weight:850; }
        .step-layout { height:520px; display:grid; grid-template-columns:2.38fr .74fr; gap:14px; }
        .diagram-card { padding:10px; border-color:#bfdbfe; overflow:hidden; }
        .diagram-split { height:100%; display:grid; grid-template-columns:118px 1fr; gap:10px; min-width:0; }
        .diagram-meta-rail { height:100%; border:1.5px solid #dbeafe; border-radius:14px; background:linear-gradient(180deg,#f8fbff,#ffffff); padding:10px 9px; display:flex; flex-direction:column; gap:9px; overflow:hidden; }
        .rail-block { border-bottom:1px dashed #cbd5e1; padding-bottom:8px; }
        .rail-block:last-child { border-bottom:0; padding-bottom:0; }
        .rail-block em { display:block; color:#0f56b3; font-style:normal; font-size:10.5px; font-weight:950; text-transform:uppercase; margin-bottom:4px; }
        .rail-block strong { display:block; color:#0f172a; font-size:15px; line-height:1.15; font-weight:950; }
        .rail-main strong { font-size:18px; }
        .rail-block span { display:block; color:#475569; font-size:11px; line-height:1.35; font-weight:850; margin-top:2px; }
        .rail-axis div { display:flex; align-items:center; justify-content:space-between; height:23px; color:#0f172a; font-weight:950; }
        .rail-axis b { font-size:12px; }
        .rail-axis i { font-style:normal; font-size:22px; color:#0f56b3; line-height:1; }
        .rail-progress-mini strong { font-size:20px; color:#0f56b3; }
        .rail-progress-mini span { color:#0f56b3; font-size:13px; }
        .diagram-main-frame { min-width:0; height:100%; display:flex; align-items:center; justify-content:center; overflow:hidden; }
        .pdfv22-layout-svg { width:100%; height:100%; display:block; }
        .pdfv22-svg-kicker { fill:#0f56b3; font-size:17px; font-weight:950; }
        .pdfv22-svg-title { fill:#0f172a; font-size:28px; font-weight:950; }
        .pdfv22-svg-note { fill:#475569; font-size:14px; font-weight:850; }
        .pdfv22-boundary { fill:#f8fafc; stroke:#0f172a; stroke-width:5; }
        .pdfv22-inner-frame { fill:none; stroke:#94a3b8; stroke-width:2; stroke-dasharray:12 8; opacity:.65; }
        .pdfv22-boundary-ring { fill:#f8fafc; stroke:#0f172a; stroke-width:5; }
        .pdfv22-boundary-inner { fill:#ffffff; stroke:#94a3b8; stroke-width:3; stroke-dasharray:10 8; }
        .pdfv22-grid { stroke:#cbd5e1; stroke-width:1; }
        .pdfv22-centerline { stroke:#94a3b8; stroke-width:2; stroke-dasharray:8 8; }
        .pdfv22-item-label { text-anchor:middle; font-family:Arial,sans-serif; font-weight:950; paint-order:stroke; }
        .pdfv22-item-label.strong { fill:#fff; stroke:rgba(15,23,42,.56); stroke-width:2.4px; }
        .pdfv22-item-label.muted { fill:#64748b; stroke:#fff; stroke-width:2px; }
        .pdfv22-axis-label { fill:#0f172a; font-size:18px; font-weight:950; }
        .pdfv22-door-label { fill:#0f172a; font-size:17px; font-weight:850; }
        .step-side { display:flex; flex-direction:column; gap:9px; min-width:0; }
        .step-number-card { height:70px; display:flex; align-items:center; gap:12px; padding:12px; background:#fff7d6; border:2px solid #0f172a; border-radius:16px; box-shadow:0 5px 0 #f59e0b; }
        .big-step-num { width:44px; height:44px; border-radius:50%; background:#ef4444; color:#fff; border:3px solid #0f172a; display:flex; align-items:center; justify-content:center; font-size:26px; font-weight:950; flex:0 0 auto; }
        .step-number-card b { display:block; color:#0f172a; font-size:14px; font-weight:950; }
        .step-number-card span { display:block; color:#475569; font-size:11px; font-weight:800; margin-top:4px; }
        .step-parts-card { flex:1; min-height:0; padding:10px; overflow:hidden; }
        .step-table { font-size:10px; }
        .step-table th, .step-table td { padding:4px 4px; }
        .step-table small { color:#64748b; font-size:9px; }
        .requirement-card { height:134px; background:#fff7ed; border-color:#f7c873; padding:12px; }
        .requirement-card ul { margin:0; padding-left:17px; color:#334155; font-size:11px; line-height:1.55; font-weight:800; }
        .step-progress-card { height:76px; margin-top:10px; display:grid; grid-template-columns:1.15fr 1fr; gap:20px; align-items:center; border:1.5px solid #dbeafe; border-radius:16px; background:#fff; padding:14px 20px; box-shadow:0 4px 16px rgba(15,23,42,.06); }
        .progress-main div:first-child { display:flex; align-items:baseline; gap:10px; font-size:15px; font-weight:900; }
        .progress-main strong { font-size:27px; color:#0f56b3; }
        .progress-main em { display:block; text-align:center; margin-top:4px; font-size:12px; color:#0f56b3; font-style:normal; font-weight:950; }
        .progress-track { margin-top:6px; height:12px; background:#e2e8f0; border-radius:999px; overflow:hidden; }
        .progress-track span { display:block; height:100%; background:#0f56b3; border-radius:999px; }
        .progress-legend { display:flex; align-items:center; justify-content:center; gap:18px; color:#475569; font-size:12px; font-weight:850; }
        .progress-legend span { display:flex; align-items:center; gap:7px; white-space:nowrap; }
        .legend-chip { display:inline-block; width:24px; height:18px; border-radius:4px; border:1.5px solid #0f172a; }
        .legend-chip.previous { background:#cbd5e1; opacity:.55; }
        .legend-chip.current { background:linear-gradient(90deg,#ef4444,#0f56b3,#f97316); }
        .legend-chip.next { background:#fff; border:2px dashed #0f56b3; }
        .worklist-summary { height:54px; display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:12px; }
        .worklist-summary div { border:1.5px solid #dbeafe; border-radius:12px; background:#fff; display:flex; align-items:center; justify-content:center; gap:10px; font-size:13px; font-weight:850; color:#475569; }
        .worklist-summary b { color:#0f56b3; font-size:20px; }
        .worklist-card { height:486px; padding:10px; overflow:hidden; }
        .worklist-table { font-size:10px; }
        .worklist-table th { padding:6px 5px; }
        .worklist-table td { padding:4px 5px; }
        .worklist-table .center { text-align:center; color:#0f56b3; font-weight:950; }
        .worklist-note { height:32px; margin-top:10px; display:flex; align-items:center; color:#475569; font-size:12px; font-weight:800; }

        /* ==================== PDF V2.7: 横竖版/区域放大增强 ==================== */
        .pdfv23-root.portrait { width:794px; }
        .pdfv23-root.portrait .pdfv22-page { width:794px; height:1122px; padding:28px 30px 54px; }
        .pdfv23-root.portrait .pdfv22-header { height:74px; margin-bottom:14px; }
        .pdfv23-root.portrait .pdfv22-title { font-size:31px; }
        .pdfv23-root.portrait .pdfv22-subtitle { font-size:12px; }
        .pdfv23-root.portrait .pdfv22-tag { font-size:13px; padding:7px 12px; }
        .pdfv23-root.portrait .cover-main { height:auto; grid-template-columns:1fr; gap:10px; }
        .pdfv23-root.portrait .kpi-row { grid-template-columns:repeat(3,1fr); height:auto; gap:10px; }
        .pdfv23-root.portrait .kpi-card { min-height:76px; }
        .pdfv23-root.portrait .cover-table-card { height:260px; }
        .pdfv23-root.portrait .sign-row { bottom:24px; }
        .pdfv23-root.portrait .legend-layout { height:780px; grid-template-columns:1fr; }
        .pdfv23-root.portrait .parts-grid { grid-template-columns:repeat(2,1fr); }
        .pdfv23-root.portrait .legend-side { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .pdfv23-root.portrait .step-layout { height:760px; display:block; }
        .pdfv23-root.portrait .diagram-card { height:520px; margin-bottom:12px; }
        .pdfv23-root.portrait .step-side { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .pdfv23-root.portrait .step-number-card { grid-column:1 / -1; height:74px; }
        .pdfv23-root.portrait .requirement-card { height:170px; }
        .pdfv23-root.portrait .step-progress-card { height:88px; margin-top:10px; }
        .pdfv23-root.portrait .worklist-summary { grid-template-columns:repeat(2,1fr); height:106px; }
        .pdfv23-root.portrait .worklist-card { height:780px; }
        .pdfv23-zoom-boundary { fill:#fffdf4; stroke:#0f172a; stroke-width:5; }
        .pdfv23-crop-label { fill:#b45309; font-size:17px; font-weight:950; }
        .pdfv23-inset-title { fill:#0f56b3; font-size:13px; font-weight:950; }
        .pdfv23-mode-badge { display:inline-block; margin-top:5px; padding:2px 7px; border-radius:999px; background:#fff7ed; border:1px solid #f59e0b; color:#92400e; font-size:10px; font-weight:950; }
        .pdfv23-mode-badge.muted { background:#eff6ff; border-color:#bfdbfe; color:#0f56b3; }
        .region-step-page .diagram-card { border-color:#f59e0b; background:linear-gradient(180deg,#ffffff,#fffdf4); }
        .region-step-page .step-number-card { box-shadow:0 5px 0 #f97316; }
    `;
}

function mountPdfHtml(html) {
    const oldHost = document.getElementById('pdf-v22-render-host');
    if (oldHost) oldHost.remove();
    const oldV2Host = document.getElementById('pdf-v2-render-host');
    if (oldV2Host) oldV2Host.remove();
    const oldV1Host = document.getElementById('pdf-v1-render-host');
    if (oldV1Host) oldV1Host.remove();

    const host = document.createElement('div');
    host.id = 'pdf-v22-render-host';
    host.setAttribute('aria-hidden', 'true');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = `${currentPdfMetrics.pxW}px`;
    host.style.minHeight = `${currentPdfMetrics.pxH}px`;
    host.style.background = '#ffffff';
    host.style.zIndex = '99990';
    host.style.pointerEvents = 'none';
    host.style.overflow = 'visible';
    host.style.opacity = '1';
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
}

function ensurePdfProgressOverlay() {
    let overlay = document.getElementById('pdf-export-progress-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'pdf-export-progress-overlay';
    overlay.style.cssText = `
        position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center;
        background:rgba(15,23,42,.55); backdrop-filter:blur(8px); color:#0f172a; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",Arial,sans-serif;
    `;
    overlay.innerHTML = `
        <div style="width:420px;max-width:90vw;background:#fff;border-radius:18px;padding:22px 24px;box-shadow:0 24px 80px rgba(15,23,42,.28);border:1px solid #dbeafe;">
            <div style="font-size:18px;font-weight:900;margin-bottom:8px;">正在生成 PDF</div>
            <div id="pdf-export-progress-text" style="font-size:13px;color:#64748b;line-height:1.6;margin-bottom:14px;">正在准备页面...</div>
            <div style="height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden;">
                <div id="pdf-export-progress-bar" style="height:100%;width:3%;background:#2563eb;border-radius:999px;transition:width .18s ease;"></div>
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-top:12px;line-height:1.5;">PDF V2.7 使用逐页截图方式生成。页数较多时请等待，不要关闭页面。</div>
        </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function updatePdfProgress(text, current = 0, total = 1) {
    const overlay = ensurePdfProgressOverlay();
    const textEl = overlay.querySelector('#pdf-export-progress-text');
    const barEl = overlay.querySelector('#pdf-export-progress-bar');
    const pct = total > 0 ? Math.max(3, Math.min(100, Math.round(current / total * 100))) : 3;
    if (textEl) textEl.textContent = text;
    if (barEl) barEl.style.width = pct + '%';
}

function hidePdfProgressOverlay() {
    const overlay = document.getElementById('pdf-export-progress-overlay');
    if (overlay) overlay.remove();
}

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
}

async function waitForPdfRenderReady(host) {
    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
        try { await document.fonts.ready; } catch (_) {}
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return host?.querySelector('.pdfv22-root') || host;
}

async function renderPageToCanvas(pageEl) {
    if (typeof window.html2canvas === 'undefined') {
        throw new Error('html2canvas 未加载。请检查 furnace.html 是否已引入 html2canvas。');
    }
    pageEl.scrollTop = 0;
    return window.html2canvas(pageEl, {
        scale: 1.18,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        removeContainer: true,
        scrollX: 0,
        scrollY: 0,
        width: currentPdfMetrics.pxW,
        height: currentPdfMetrics.pxH,
        windowWidth: currentPdfMetrics.pxW,
        windowHeight: currentPdfMetrics.pxH,
        x: 0,
        y: 0
    });
}

function getJsPdfCtor() {
    return window.jspdf?.jsPDF || window.jsPDF || null;
}

function makeFileName(entries, options = {}) {
    const first = entries[0]?.furnace;
    const safeName = String(getFurnaceName(first, entries[0]?.index || 0))
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 32);
    let prefix = options.resolvedOrientation === 'portrait' ? '竖版归档施工单' : '横版区域放大施工单';
    if (options.mode === 'field') prefix = '精简现场施工单';
    if (entries.length === 1) return `${prefix}_${safeName}_${getFileDateStamp()}.pdf`;
    return `${prefix}_${entries.length}炉_${getFileDateStamp()}.pdf`;
}

export async function generateSixPagePDF(selectedIds = []) {
    let host = null;
    try {
        const JsPDF = getJsPdfCtor();
        if (!JsPDF || typeof window.html2canvas === 'undefined') {
            alert('PDF 导出组件未加载，请检查 html2canvas / jsPDF 是否正常引入。');
            return;
        }

        const entries = getSelectedFurnaceEntries(selectedIds);
        if (!entries.length) {
            alert('当前没有可导出的装炉方案，请先生成方案。');
            return;
        }

        const options = getPdfV23Options();
        options.resolvedOrientation = resolvePdfOrientation(entries, options);
        currentPdfMetrics = getPageMetrics(options.resolvedOrientation);

        updatePdfProgress(`正在构建 PDF V2.7 ${options.resolvedOrientation === 'portrait' ? '竖版归档单' : '横版施工图'}...`, 1, 10);
        await nextFrame();

        const html = buildPdfDocument(entries, options);
        host = mountPdfHtml(html);
        await waitForPdfRenderReady(host);

        const pages = [...host.querySelectorAll('.pdfv22-page')];
        if (!pages.length) throw new Error('未生成 PDF 页面内容。');

        const filename = makeFileName(entries, options);
        const pdf = new JsPDF({ orientation: currentPdfMetrics.orientation, unit: 'mm', format: 'a4', compress: true });

        for (let i = 0; i < pages.length; i++) {
            updatePdfProgress(`正在渲染第 ${i + 1} / ${pages.length} 页...`, i, pages.length + 1);
            await nextFrame();
            const canvas = await renderPageToCanvas(pages[i]);
            const imgData = canvas.toDataURL('image/jpeg', 0.90);
            if (i > 0) pdf.addPage('a4', currentPdfMetrics.orientation);
            pdf.addImage(imgData, 'JPEG', 0, 0, currentPdfMetrics.mmW, currentPdfMetrics.mmH, undefined, 'FAST');
            canvas.width = 1;
            canvas.height = 1;
            await nextFrame();
        }

        updatePdfProgress('正在保存 PDF 文件...', pages.length, pages.length + 1);
        await nextFrame();
        pdf.save(filename);
    } catch (err) {
        console.error('[PDF V2.7] 导出失败:', err);
        alert('PDF 导出失败：' + (err?.message || err));
    } finally {
        hidePdfProgressOverlay();
        if (host) host.remove();
        const fallbackHost = document.getElementById('pdf-v22-render-host');
        if (fallbackHost) fallbackHost.remove();
    }
}

export default generateSixPagePDF;
