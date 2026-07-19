/**
 * pdf-six-page.js - 现场摆料施工单 PDF V1
 *
 * 设计目标：
 * 1. 面向现场摆料人员，而不是管理汇报；
 * 2. 一炉一组页面：任务总览 -> 分层俯视图 -> 工件坐标清单；
 * 3. 不依赖 Three.js 截图，直接用 packedItems 数据生成 SVG 俯视图；
 * 4. 保持旧入口 generateSixPagePDF(selectedIds) 不变，避免 app.js 改动。
 */

import {
    globalFurnacesResult,
    globalUnpackedItems,
    placementRules
} from './state.js';

const PAGE_ROW_LIMIT = 28;
const SVG_W = 1000;
const SVG_H = 650;
const DRAW_PAD = 58;
const A4_LANDSCAPE_MM = Object.freeze({ width: 297, height: 210 });
// field-large uses a square 160 mm stage. The tooling boundary's longer side is
// fixed at 150 mm, leaving 5 mm on each side for dimensions and direction marks.
const FIELD_DIAGRAM_MM = Object.freeze({ width: 160, height: 160, maxBoundary: 150 });
const FIELD_SVG_UNITS_PER_MM = 10;


function normalizePdfExportOptionsV154(options = {}) {
    const globalOptions = (typeof window !== 'undefined' && window.__HT_PDF_EXPORT_OPTIONS__) ? window.__HT_PDF_EXPORT_OPTIONS__ : {};
    const merged = { ...globalOptions, ...(options || {}) };

    // 默认保持旧行为：包含坐标清单。只有显式 false 才关闭。
    const includeCoordinateList = !(
        merged.includeCoordinateList === false ||
        merged.includeCoordinates === false ||
        merged.coordinateList === false ||
        merged.worklist === false ||
        merged.includeWorklist === false
    );

    const includeHighDensityZoom = !!(
        merged.includeHighDensityZoom ||
        merged.highDensityZoom ||
        merged.densityZoom ||
        merged.regionZoom ||
        merged.zoomDenseArea
    );

    return {
        ...merged,
        includeCoordinateList,
        includeWorklist: includeCoordinateList,
        worklist: includeCoordinateList,
        includeHighDensityZoom,
        highDensityZoom: includeHighDensityZoom,
        densityZoom: includeHighDensityZoom,
        regionZoom: includeHighDensityZoom
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
        spaceUtil: '空间优先',
        thermalBalance: '热场均衡',
        surfaceUniform: '表面均匀'
    };
    return map[key] || key;
}

function getTemplateLabel(template) {
    const labels = {
        'field-large': '现场大图版',
        standard: '标准版',
        archive: '完整归档版'
    };
    return labels[template] || labels.standard;
}

function getShapeLabel(item) {
    if (item?.shape === 'cylinder') {
        return isCylinderSideStanding(item) ? '圆柱(立放)' : '圆柱';
    }
    return '方体';
}

function getOriginalDimValues(item) {
    const raw = item?.originalDims || {};
    const l = toNumber(raw.l ?? raw.length ?? raw.dim1 ?? item?.w, 0);
    const w = toNumber(raw.w ?? raw.width ?? raw.dim2 ?? item?.d, 0);
    const h = toNumber(raw.h ?? raw.height ?? raw.dim3 ?? item?.h, 0);
    const values = [l, w, h].filter(v => Number.isFinite(v) && v > 0);
    return {
        l,
        w,
        h,
        max: values.length ? Math.max(...values) : 0,
        min: values.length ? Math.min(...values) : 0
    };
}

function isCylinderSideStanding(item) {
    if (!item || item.shape !== 'cylinder') return false;
    if (item.pdfPosture === 'side-standing' || item.pdfRotationAxis) return true;
    if (Number(item.verticalRotation || item.rotationInfo?.manualPitchDeg || 0) % 180 !== 0) return true;

    const dims = getOriginalDimValues(item);
    const currentW = toNumber(item.w, 0);
    const currentD = toNumber(item.d, 0);
    const currentH = toNumber(item.h, 0);

    // 圆盘立放后：高度接近原始直径，X/Z 占地出现“厚度 × 直径”的窄长 footprint。
    if (dims.max > 0 && dims.min > 0) {
        const footprintMin = Math.min(currentW, currentD);
        const footprintMax = Math.max(currentW, currentD);
        return currentH >= dims.max * 0.75 &&
            footprintMin <= dims.min * 1.35 &&
            footprintMax >= dims.max * 0.75;
    }

    return currentH > Math.min(currentW, currentD) * 1.5 && Math.max(currentW, currentD) > Math.min(currentW, currentD) * 1.5;
}

function getPdfFootprint(item) {
    const w = toNumber(item?.pdfFootprintW ?? item?.w, 1);
    const d = toNumber(item?.pdfFootprintD ?? item?.d, 1);
    return { w: Math.max(1, w), d: Math.max(1, d) };
}

function getItemSizeLabel(item) {
    if (!item) return '-';
    const currentW = toNumber(item.w, 0);
    const currentD = toNumber(item.d, 0);
    const currentH = toNumber(item.h, 0);

    if (item.shape === 'cylinder') {
        if (isCylinderSideStanding(item)) {
            const fp = getPdfFootprint(item);
            const dims = getOriginalDimValues(item);
            const original = dims.max > 0 && dims.min > 0 ? ` / 原Φ${formatNumber(dims.max)}×${formatNumber(dims.min)}` : '';
            return `立放 ${formatNumber(fp.w)}×${formatNumber(fp.d)}×H${formatNumber(currentH)}${original}`;
        }
        const dia = Math.max(currentW, currentD, getOriginalDimValues(item).max || 0);
        return `Φ${formatNumber(dia)}×H${formatNumber(currentH)}`;
    }

    return `${formatNumber(currentW)}×${formatNumber(currentD)}×${formatNumber(currentH)}`;
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
    const packedVolume = items.reduce((sum, item) => {
        return sum + Math.max(0, toNumber(item.w) * toNumber(item.h) * toNumber(item.d));
    }, 0);
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
        _pdfNo: idx + 1,
        _pdfLayer: getItemLayer(item, furnace)
    }));
}

function groupItems(items) {
    const map = new Map();
    items.forEach(item => {
        const key = [item.name || '未命名工件', item.material || '', item.process || '', getItemSizeLabel(item)].join('|');
        if (!map.has(key)) {
            map.set(key, {
                name: item.name || '未命名工件',
                material: item.material || '-',
                process: item.process || '-',
                size: getItemSizeLabel(item),
                shape: getShapeLabel(item),
                count: 0,
                totalWeight: 0,
                noList: []
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
    const nums = [...list].sort((a, b) => a - b);
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
    if (!selectedIds || selectedIds.length === 0) {
        return furnaces.map((furnace, index) => ({ furnace, index }));
    }

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

function getColor(value, fallback = '#2563EB') {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
    if (/^rgba?\(/i.test(raw)) return raw;
    return fallback;
}

function getLayout(furnace) {
    const fw = Math.max(1, toNumber(furnace?.w, 600));
    const fd = Math.max(1, toNumber(furnace?.d, 600));
    const availableW = SVG_W - DRAW_PAD * 2;
    const availableH = SVG_H - DRAW_PAD * 2 - 40;
    const scale = Math.min(availableW / fw, availableH / fd);
    const drawW = fw * scale;
    const drawH = fd * scale;
    const ox = (SVG_W - drawW) / 2;
    const oy = DRAW_PAD + (availableH - drawH) / 2;
    return { fw, fd, scale, drawW, drawH, ox, oy };
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

function renderBoundarySvg(furnace, layout) {
    const isRing = furnace?.toolingType === 'ring-tooling' || furnace?.basketType === 'ringnode';
    if (isRing) {
        const { outerRadius, innerRadius } = getRingRadii(furnace, layout);
        const cx = layout.ox + layout.fw / 2 * layout.scale;
        const cy = layout.oy + layout.fd / 2 * layout.scale;
        return `
            <circle cx="${cx}" cy="${cy}" r="${outerRadius * layout.scale}" class="pdfv1-boundary-ring" />
            ${innerRadius > 0 ? `<circle cx="${cx}" cy="${cy}" r="${innerRadius * layout.scale}" class="pdfv1-boundary-inner" />` : ''}
            <line x1="${cx - outerRadius * layout.scale}" y1="${cy}" x2="${cx + outerRadius * layout.scale}" y2="${cy}" class="pdfv1-centerline" />
            <line x1="${cx}" y1="${cy - outerRadius * layout.scale}" x2="${cx}" y2="${cy + outerRadius * layout.scale}" class="pdfv1-centerline" />
        `;
    }

    return `
        <rect x="${layout.ox}" y="${layout.oy}" width="${layout.drawW}" height="${layout.drawH}" rx="8" class="pdfv1-boundary" />
        ${renderGrid(layout)}
    `;
}

function renderGrid(layout) {
    const lines = [];
    const stepMm = chooseGridStep(Math.max(layout.fw, layout.fd));
    for (let x = stepMm; x < layout.fw; x += stepMm) {
        const sx = layout.ox + x * layout.scale;
        lines.push(`<line x1="${sx}" y1="${layout.oy}" x2="${sx}" y2="${layout.oy + layout.drawH}" class="pdfv1-grid" />`);
    }
    for (let z = stepMm; z < layout.fd; z += stepMm) {
        const sy = layout.oy + z * layout.scale;
        lines.push(`<line x1="${layout.ox}" y1="${sy}" x2="${layout.ox + layout.drawW}" y2="${sy}" class="pdfv1-grid" />`);
    }
    return lines.join('');
}

function chooseGridStep(maxSize) {
    if (maxSize <= 600) return 100;
    if (maxSize <= 1200) return 150;
    if (maxSize <= 2000) return 250;
    return 500;
}

function renderItemSvg(item, layout) {
    const footprint = getPdfFootprint(item);
    const x = layout.ox + toNumber(item.x) * layout.scale;
    const y = layout.oy + toNumber(item.z) * layout.scale;
    const w = Math.max(2, footprint.w * layout.scale);
    const h = Math.max(2, footprint.d * layout.scale);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const fill = escapeHtml(getColor(item.color, '#2563EB'));
    const no = escapeHtml(item._pdfNo);
    const labelSize = clamp(Math.min(w, h) * 0.38, 10, 26);
    const isCylinder = item.shape === 'cylinder';

    if (isCylinder && !isCylinderSideStanding(item)) {
        const r = Math.max(3, Math.min(w, h) / 2);
        return `
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" class="pdfv1-item" />
            <text x="${cx}" y="${cy + labelSize * 0.35}" font-size="${labelSize}" class="pdfv1-item-label">${no}</text>
        `;
    }

    if (isCylinder && isCylinderSideStanding(item)) {
        const radius = Math.max(3, Math.min(w, h) / 2);
        const label = labelSize < 12 ? '' : `<text x="${cx}" y="${cy + labelSize * 0.35}" font-size="${labelSize}" class="pdfv1-item-label">${no}</text>`;
        return `
            <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="${fill}" class="pdfv1-item pdfv1-item-standing" />
            <line x1="${cx}" y1="${y + 2}" x2="${cx}" y2="${y + h - 2}" class="pdfv1-standing-axis" />
            ${label || `<text x="${cx}" y="${cy + 4}" font-size="10" class="pdfv1-item-label">${no}</text>`}
        `;
    }

    return `
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" class="pdfv1-item" />
        <text x="${cx}" y="${cy + labelSize * 0.35}" font-size="${labelSize}" class="pdfv1-item-label">${no}</text>
    `;
}

function renderLayerDiagram(furnace, layerItems, layer) {
    const layout = getLayout(furnace);
    const boundary = renderBoundarySvg(furnace, layout);
    const itemsSvg = layerItems.map(item => renderItemSvg(item, layout)).join('');
    const dimX = `${formatNumber(layout.fw)} mm`;
    const dimZ = `${formatNumber(layout.fd)} mm`;
    const safeSpacing = placementRules?.minSpacing ?? 5;

    return `
        <svg class="pdfv1-layout-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="${escapeHtml(getLayerLabel(layer))}俯视摆放图">
            <defs>
                <marker id="arrow-x-${layer}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#334155" />
                </marker>
            </defs>
            <rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" fill="#ffffff" />
            <text x="${DRAW_PAD}" y="32" class="pdfv1-svg-title">${escapeHtml(getLayerLabel(layer))} 俯视摆放图</text>
            <text x="${SVG_W - DRAW_PAD}" y="32" class="pdfv1-svg-note" text-anchor="end">X=${dimX} / Z=${dimZ} / 间距=${escapeHtml(safeSpacing)}mm</text>
            ${boundary}
            ${itemsSvg}
            <line x1="${layout.ox}" y1="${layout.oy + layout.drawH + 34}" x2="${layout.ox + Math.min(layout.drawW, 160)}" y2="${layout.oy + layout.drawH + 34}" stroke="#334155" stroke-width="2" marker-end="url(#arrow-x-${layer})" />
            <text x="${layout.ox + Math.min(layout.drawW, 174)}" y="${layout.oy + layout.drawH + 39}" class="pdfv1-axis-label">X+</text>
            <line x1="${layout.ox - 28}" y1="${layout.oy}" x2="${layout.ox - 28}" y2="${layout.oy + Math.min(layout.drawH, 160)}" stroke="#334155" stroke-width="2" marker-end="url(#arrow-x-${layer})" />
            <text x="${layout.ox - 42}" y="${layout.oy + Math.min(layout.drawH, 180)}" class="pdfv1-axis-label">Z+</text>
        </svg>
    `;
}

function getFieldLayout(furnace) {
    const fw = Math.max(1, toNumber(furnace?.w, 600));
    const fd = Math.max(1, toNumber(furnace?.d, 600));
    const svgW = FIELD_DIAGRAM_MM.width * FIELD_SVG_UNITS_PER_MM;
    const svgH = FIELD_DIAGRAM_MM.height * FIELD_SVG_UNITS_PER_MM;
    const targetLongSideUnits = FIELD_DIAGRAM_MM.maxBoundary * FIELD_SVG_UNITS_PER_MM;
    const scale = targetLongSideUnits / Math.max(fw, fd);
    const drawW = fw * scale;
    const drawH = fd * scale;
    return {
        fw, fd, scale, drawW, drawH, svgW, svgH,
        ox: (svgW - drawW) / 2,
        oy: (svgH - drawH) / 2
    };
}

function renderFieldItemSvg(item, layout) {
    const footprint = getPdfFootprint(item);
    const x = layout.ox + toNumber(item.x) * layout.scale;
    const y = layout.oy + toNumber(item.z) * layout.scale;
    const w = Math.max(2, footprint.w * layout.scale);
    const h = Math.max(2, footprint.d * layout.scale);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const fill = escapeHtml(getColor(item.color, '#2563EB'));
    const labelSize = clamp(Math.min(w, h) * 0.38, 32, 52);
    const badgeRadius = Math.max(25, labelSize * 0.58);
    const geometry = item.shape === 'cylinder' && !isCylinderSideStanding(item)
        ? `<circle cx="${cx}" cy="${cy}" r="${Math.max(3, Math.min(w, h) / 2)}" fill="${fill}" class="pdfv1-item field-item" />`
        : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" class="pdfv1-item field-item" />`;

    return `${geometry}
        <circle cx="${cx}" cy="${cy}" r="${badgeRadius}" class="pdfv1-field-number-badge" />
        <text x="${cx}" y="${cy + labelSize * 0.35}" font-size="${labelSize}" class="pdfv1-item-label pdfv1-field-item-label">${escapeHtml(item._pdfNo)}</text>`;
}

function renderFieldLayerDiagram(furnace, layerItems, layer, markerId) {
    const layout = getFieldLayout(furnace);
    const boundary = renderBoundarySvg(furnace, layout);
    const itemsSvg = layerItems.map(item => renderFieldItemSvg(item, layout)).join('');
    return `
        <svg class="pdfv1-field-layout-svg" width="${FIELD_DIAGRAM_MM.width}mm" height="${FIELD_DIAGRAM_MM.height}mm"
             viewBox="0 0 ${layout.svgW} ${layout.svgH}" preserveAspectRatio="xMidYMid meet"
             role="img" aria-label="${escapeHtml(getLayerLabel(layer))}现场俯视摆放图">
            <defs><marker id="field-arrow-${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#334155" /></marker></defs>
            <rect x="0" y="0" width="${layout.svgW}" height="${layout.svgH}" fill="#ffffff" />
            ${boundary}${itemsSvg}
            <text x="${layout.ox}" y="${Math.max(34, layout.oy - 20)}" class="pdfv1-field-svg-note">X ${formatNumber(layout.fw)} mm × Z ${formatNumber(layout.fd)} mm · 间距 ${escapeHtml(placementRules?.minSpacing ?? 5)} mm</text>
            <line x1="${layout.ox}" y1="${layout.oy + layout.drawH + 30}" x2="${layout.ox + Math.min(layout.drawW, 180)}" y2="${layout.oy + layout.drawH + 30}" class="pdfv1-field-axis" marker-end="url(#field-arrow-${markerId})" />
            <text x="${layout.ox + Math.min(layout.drawW, 205)}" y="${layout.oy + layout.drawH + 38}" class="pdfv1-field-axis-label">X+</text>
        </svg>`;
}

function buildKpi(label, value, hint = '') {
    return `
        <div class="pdfv1-kpi">
            <div class="pdfv1-kpi-label">${escapeHtml(label)}</div>
            <div class="pdfv1-kpi-value">${escapeHtml(value)}</div>
            ${hint ? `<div class="pdfv1-kpi-hint">${escapeHtml(hint)}</div>` : ''}
        </div>
    `;
}

function buildHeader(title, subtitle, tag = '') {
    return `
        <div class="pdfv1-header">
            <div>
                <div class="pdfv1-doc-kicker">AI热处理装炉智能体 / 现场摆料施工单 V1</div>
                <div class="pdfv1-doc-title">${escapeHtml(title)}</div>
                <div class="pdfv1-doc-subtitle">${escapeHtml(subtitle)}</div>
            </div>
            <div class="pdfv1-header-tag">${escapeHtml(tag || getDateStamp())}</div>
        </div>
    `;
}

function buildPlanCoverPage(manifest) {
    const allItems = manifest.entries.flatMap(entry => entry.numberedItems);
    const totalWeight = allItems.reduce((sum, item) => sum + toNumber(item.weight), 0);
    const toolingTypes = [...new Set(manifest.entries.map(entry => getFurnaceTypeLabel(entry.furnace)))];
    const planName = manifest.options.planName || `现场装炉方案（${manifest.entries.length} 炉）`;
    const hasUnpacked = Array.isArray(globalUnpackedItems) && globalUnpackedItems.length > 0;
    return `
        <section class="pdfv1-page cover plan-cover">
            ${buildHeader('装炉摆料作业指导书', planName, '方案总封面')}
            <div class="pdfv1-plan-cover-hero">
                <div class="pdfv1-plan-cover-kicker">PLAN SUMMARY / 方案级摘要</div>
                <div class="pdfv1-plan-cover-name">${escapeHtml(planName)}</div>
                <div class="pdfv1-plan-cover-meta">本页为本次导出的唯一总封面；炉次明细请见对应装炉图页面。</div>
            </div>
            <div class="pdfv1-kpi-grid plan-kpi-grid">
                ${buildKpi('炉次数量', `${manifest.entries.length} 炉`)}
                ${buildKpi('工件总数', `${allItems.length} 件`)}
                ${buildKpi('总重量', formatWeight(totalWeight))}
                ${buildKpi('模板类型', getTemplateLabel(manifest.options.template))}
                ${buildKpi('PDF 页数', `${manifest.pages.length} 页`)}
                ${buildKpi('导出时间', manifest.generatedAt)}
            </div>
            <div class="pdfv1-panel">
                <div class="pdfv1-panel-title">本次导出范围</div>
                <div class="pdfv1-cover-furnace-list">
                    ${manifest.entries.map((entry, order) => `<div><strong>${order + 1}. ${escapeHtml(getFurnaceName(entry.furnace, entry.index))}</strong><span>${entry.stats.itemCount} 件 · ${formatWeight(entry.stats.totalWeight)} · ${entry.stats.layerCount} 层</span></div>`).join('')}
                </div>
                <div class="pdfv1-cover-tooling">工装类型：${escapeHtml(toolingTypes.join('、') || '-')} · 摆放策略：${escapeHtml(getStrategyLabel())}</div>
            </div>
            ${hasUnpacked ? `<div class="pdfv1-alert">注意：当前方案仍有 ${globalUnpackedItems.length} 件工件未装入。</div>` : ''}
        </section>`;
}

function buildLayerPage(furnace, index, numberedItems, layer) {
    const layerItems = numberedItems.filter(item => item._pdfLayer === layer);
    const groups = groupItems(layerItems);
    const layerWeight = layerItems.reduce((sum, item) => sum + toNumber(item.weight), 0);
    const layerLabel = getLayerLabel(layer);

    return `
        <section class="pdfv1-page layer-page">
            ${buildHeader(layerLabel, `${getFurnaceName(furnace, index)} · 共 ${layerItems.length} 件 · ${formatWeight(layerWeight)}`, `第 ${layer} 层`)}
            <div class="pdfv1-layer-layout">
                <div class="pdfv1-diagram-panel">
                    ${renderLayerDiagram(furnace, layerItems, layer)}
                </div>
                <div class="pdfv1-layer-side">
                    <div class="pdfv1-panel">
                        <div class="pdfv1-panel-title">摆放要求</div>
                        <ul class="pdfv1-bullets">
                            <li>从图中编号小的工件开始摆放。</li>
                            <li>同层摆放完成后，再安装搁板或进入下一层。</li>
                            <li>坐标 X/Z 以工装左后/左前基准角为参考，按现场约定保持方向一致。</li>
                        </ul>
                    </div>
                    <div class="pdfv1-panel grow-panel">
                        <div class="pdfv1-panel-title">本层工件</div>
                        <table class="pdfv1-table layer-table">
                            <thead><tr><th>编号</th><th>工件</th><th>数量</th><th>材质/工艺</th></tr></thead>
                            <tbody>
                                ${groups.map(g => `
                                    <tr>
                                        <td>${escapeHtml(compactNoList(g.noList))}</td>
                                        <td>${escapeHtml(g.name)}<br><span>${escapeHtml(g.size)}</span></td>
                                        <td>${g.count}</td>
                                        <td>${escapeHtml(g.material)}<br><span>${escapeHtml(g.process)}</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function buildFieldLayerPage(page) {
    const { furnace, index, numberedItems, layer, furnaceOrder } = page;
    const layerItems = numberedItems.filter(item => item._pdfLayer === layer);
    const groups = groupItems(layerItems);
    const layerWeight = layerItems.reduce((sum, item) => sum + toNumber(item.weight), 0);
    const density = getLayerDensityForZoomV156(furnace, layerItems);
    const groupSummary = groups.slice(0, 4).map(group => `${group.name} × ${group.count}`).join('；');
    const remainingGroupCount = Math.max(0, groups.length - 4);
    const groupSummaryText = `${groupSummary || '-'}${remainingGroupCount ? `；另 ${remainingGroupCount} 类` : ''}`;
    const warnings = [];
    if (density >= 18 || layerItems.length >= 36) warnings.push('高密度：按编号与间距逐件复核');
    if (Array.isArray(globalUnpackedItems) && globalUnpackedItems.length) warnings.push(`方案有 ${globalUnpackedItems.length} 件未装入`);
    if (!warnings.length) warnings.push('无关键警告，仍须复核边界与安全间距');
    return `
        <section class="pdfv1-page field-large-page">
            <div class="pdfv1-field-header"><div><strong>${escapeHtml(getFurnaceName(furnace, index))}</strong><span>${escapeHtml(getLayerLabel(layer))} · ${escapeHtml(getFurnaceTypeLabel(furnace))}</span></div><div>炉次 ${furnaceOrder + 1} / 层 ${layer}</div></div>
            <div class="pdfv1-field-diagram-stage">${renderFieldLayerDiagram(furnace, layerItems, layer, `${furnaceOrder}-${layer}`)}</div>
            <div class="pdfv1-field-summary">
                <div class="pdfv1-field-facts"><span><b>炉次/层号</b>${furnaceOrder + 1} / ${layer}</span><span><b>件数</b>${layerItems.length} 件</span><span><b>重量</b>${formatWeight(layerWeight)}</span><span class="categories"><b>类别/数量（共 ${groups.length} 类）</b>${escapeHtml(groupSummaryText)}</span><span class="warning"><b>关键警告</b>${escapeHtml(warnings.join('；'))}</span></div>
                <div class="pdfv1-field-signatures"><span>操作员：____________</span><span>复核：____________</span></div>
            </div>
        </section>`;
}


function getLayerDensityForZoomV156(furnace, layerItems) {
    const fw = Math.max(1, toNumber(furnace?.w, 0));
    const fd = Math.max(1, toNumber(furnace?.d, 0));
    const area = fw * fd;
    const usedArea = (layerItems || []).reduce((sum, item) => {
        const fp = getPdfFootprint(item);
        return sum + Math.max(1, fp.w * fp.d);
    }, 0);
    return area > 0 ? usedArea / area * 100 : 0;
}

function shouldBuildDensityZoomPageV156(furnace, layerItems) {
    const count = (layerItems || []).length;
    const density = getLayerDensityForZoomV156(furnace, layerItems);
    return count >= 36 || density >= 18;
}

function getZoomRegionForItemV156(furnace, item) {
    const fw = Math.max(1, toNumber(furnace?.w, 0));
    const fd = Math.max(1, toNumber(furnace?.d, 0));
    const fp = getPdfFootprint(item);
    const cx = toNumber(item?.x, 0) + fp.w / 2;
    const cz = toNumber(item?.z, 0) + fp.d / 2;
    const col = cx < fw / 2 ? 0 : 1;
    const row = cz < fd / 2 ? 0 : 1;
    const names = ['A 左前区', 'B 右前区', 'C 左后区', 'D 右后区'];
    return names[row * 2 + col];
}

function getZoomRegionBoxV156(furnace, regionName) {
    const fw = Math.max(1, toNumber(furnace?.w, 0));
    const fd = Math.max(1, toNumber(furnace?.d, 0));
    const isRight = /^B|^D/.test(regionName);
    const isBack = /^C|^D/.test(regionName);
    return {
        x0: isRight ? fw / 2 : 0,
        z0: isBack ? fd / 2 : 0,
        w: fw / 2,
        d: fd / 2
    };
}

function getZoomLayoutV156(furnace, regionBox) {
    const scale = Math.min((SVG_W - DRAW_PAD * 2) / regionBox.w, (SVG_H - DRAW_PAD * 2 - 30) / regionBox.d);
    const drawW = regionBox.w * scale;
    const drawH = regionBox.d * scale;
    const ox = (SVG_W - drawW) / 2;
    const oy = DRAW_PAD + 20;
    return { ...regionBox, scale, drawW, drawH, ox, oy };
}

function renderZoomItemSvgV156(item, layout) {
    const fp = getPdfFootprint(item);
    const x = layout.ox + (toNumber(item.x, 0) - layout.x0) * layout.scale;
    const y = layout.oy + (toNumber(item.z, 0) - layout.z0) * layout.scale;
    const w = Math.max(3, fp.w * layout.scale);
    const h = Math.max(3, fp.d * layout.scale);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const no = item._pdfNo || '';
    const fill = item.color || item.batchColor || item.displayColor || '#2563eb';
    const labelSize = clamp(Math.min(w, h) * 0.42, 10, 24);
    const isCylinder = item.shape === 'cylinder';

    if (isCylinder && !isCylinderSideStanding(item)) {
        const r = Math.max(4, Math.min(w, h) / 2);
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" class="pdfv1-item zoom-item" /><text x="${cx}" y="${cy + labelSize * .35}" font-size="${labelSize}" class="pdfv1-item-label">${no}</text>`;
    }

    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" class="pdfv1-item zoom-item" /><text x="${cx}" y="${cy + labelSize * .35}" font-size="${labelSize}" class="pdfv1-item-label">${no}</text>`;
}

function renderZoomRegionDiagramV156(furnace, regionItems, regionName, layer) {
    const box = getZoomRegionBoxV156(furnace, regionName);
    const layout = getZoomLayoutV156(furnace, box);
    const itemsSvg = regionItems.map(item => renderZoomItemSvgV156(item, layout)).join('');
    return `
        <svg class="pdfv1-layout-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="${escapeHtml(regionName)}局部放大图">
            <rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" fill="#ffffff" />
            <text x="${DRAW_PAD}" y="32" class="pdfv1-svg-title">${escapeHtml(getLayerLabel(layer))} · ${escapeHtml(regionName)}局部放大</text>
            <text x="${SVG_W - DRAW_PAD}" y="32" class="pdfv1-svg-note" text-anchor="end">局部范围 X=${formatNumber(box.x0)}-${formatNumber(box.x0 + box.w)} / Z=${formatNumber(box.z0)}-${formatNumber(box.z0 + box.d)} mm</text>
            <rect x="${layout.ox}" y="${layout.oy}" width="${layout.drawW}" height="${layout.drawH}" fill="#f8fafc" stroke="#0f172a" stroke-width="4" />
            ${itemsSvg}
        </svg>
    `;
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

export function buildPdfPageManifest(selectedIds = [], options = {}) {
    const pdfOptions = normalizePdfExportOptionsV154(options);
    const entries = getSelectedFurnaceEntries(selectedIds).map(({ furnace, index }) => ({ furnace, index, numberedItems: buildNumberedItems(furnace), stats: getFurnaceStats(furnace) }));
    const manifest = { pageSizeMm: A4_LANDSCAPE_MM, orientation: 'landscape', generatedAt: getDateStamp(), options: pdfOptions, entries, pages: [] };
    if (!entries.length) return manifest;
    manifest.pages.push({ type: 'plan-cover' });
    entries.forEach((entry, furnaceOrder) => {
        const { furnace, index, numberedItems, stats } = entry;
        stats.layers.forEach(layer => {
            const layerItems = numberedItems.filter(item => item._pdfLayer === layer);
            manifest.pages.push({ type: 'layer', furnace, index, numberedItems, layerItems, layer, furnaceOrder });
            if (pdfOptions.includeHighDensityZoom && shouldBuildDensityZoomPageV156(furnace, layerItems)) {
                const regionMap = new Map();
                layerItems.forEach(item => {
                    const region = getZoomRegionForItemV156(furnace, item);
                    if (!regionMap.has(region)) regionMap.set(region, []);
                    regionMap.get(region).push(item);
                });
                const regions = [...regionMap.entries()].filter(([, items]) => items.length >= 8).sort((a, b) => b[1].length - a[1].length).slice(0, 4);
                regions.forEach(([regionName, regionItems], regionIndex) => manifest.pages.push({ type: 'density-zoom', furnace, index, layer, layerItems, regionName, regionItems, regionIndex, regionCount: regions.length }));
            }
        });
        if (pdfOptions.includeCoordinateList) {
            const chunkCount = Math.ceil(numberedItems.length / PAGE_ROW_LIMIT);
            for (let start = 0; start < numberedItems.length; start += PAGE_ROW_LIMIT) {
                manifest.pages.push({ type: 'coordinate-list', furnace, index, start, chunk: numberedItems.slice(start, start + PAGE_ROW_LIMIT), totalItems: numberedItems.length, chunkIndex: Math.floor(start / PAGE_ROW_LIMIT), chunkCount });
            }
        }
    });
    return manifest;
}

export function estimatePdfPageCountFromManifest(selectedIds = [], options = {}) {
    return buildPdfPageManifest(selectedIds, options).pages.length;
}

function renderManifestPage(manifest, page) {
    if (page.type === 'plan-cover') return buildPlanCoverPage(manifest);
    if (page.type === 'layer') return manifest.options.template === 'field-large' ? buildFieldLayerPage(page) : buildLayerPage(page.furnace, page.index, page.numberedItems, page.layer);
    if (page.type === 'density-zoom') {
        const density = getLayerDensityForZoomV156(page.furnace, page.layerItems);
        return `<section class="pdfv1-page layer-page zoom-page">${buildHeader('高密度区域放大', `${getFurnaceName(page.furnace, page.index)} · ${getLayerLabel(page.layer)} · ${page.regionName} · ${page.regionItems.length} 件`, `放大 ${page.regionIndex + 1}/${page.regionCount}`)}<div class="pdfv1-layer-layout"><div class="pdfv1-diagram-panel zoom-panel">${renderZoomRegionDiagramV156(page.furnace, page.regionItems, page.regionName, page.layer)}</div><div class="pdfv1-layer-side"><div class="pdfv1-panel warning-panel"><div class="pdfv1-panel-title">局部放大说明</div><ul class="pdfv1-bullets"><li>本页仅放大高密度区域，完整位置以本层俯视图为准。</li><li>本层 ${page.layerItems.length} 件，估算平面密度 ${formatPercent(density)}。</li></ul></div><div class="pdfv1-panel grow-panel"><div class="pdfv1-panel-title">本区工件</div><table class="pdfv1-table layer-table"><thead><tr><th>编号</th><th>工件</th><th>尺寸</th><th>坐标</th></tr></thead><tbody>${page.regionItems.slice(0, 32).map(item => `<tr><td class="center">${item._pdfNo}</td><td>${escapeHtml(item.name || '-')}</td><td>${escapeHtml(getItemSizeLabel(item))}</td><td>X ${formatNumber(item.x)} / Z ${formatNumber(item.z)}</td></tr>`).join('')}</tbody></table></div></div></div></section>`;
    }
    if (page.type === 'coordinate-list') {
        return `<section class="pdfv1-page worklist-page">${buildHeader('工件坐标清单', `${getFurnaceName(page.furnace, page.index)} · ${page.start + 1}-${Math.min(page.start + PAGE_ROW_LIMIT, page.totalItems)} / ${page.totalItems}`, `清单 ${page.chunkIndex + 1}/${page.chunkCount}`)}<div class="pdfv1-panel full-height"><table class="pdfv1-table worklist-table"><thead><tr><th>编号</th><th>层</th><th>工件</th><th>客户/图号</th><th>材质</th><th>工艺</th><th>尺寸 mm</th><th>坐标 mm</th><th>单重</th></tr></thead><tbody>${buildWorklistRows(page.chunk)}</tbody></table></div><div class="pdfv1-footnote">坐标为系统计算值，现场以工装实际定位基准、搁板厚度和工件实物外形复核。</div></section>`;
    }
    throw new Error(`未知 PDF 页面类型：${page.type}`);
}

function buildPdfDocument(manifest) {
    const sections = manifest.pages.map(page => renderManifestPage(manifest, page));

    return `
        <div class="pdfv1-root">
            <style>${getPdfV1Css()}</style>
            ${sections.join('')}
        </div>
    `;
}

function getPdfV1Css() {
    return `
        .pdfv1-root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", Arial, sans-serif; color: #0f172a; background: #fff; }
        .pdfv1-page { width: 297mm; min-height: 210mm; box-sizing: border-box; padding: 10mm; background: #fff; page-break-after: always; position: relative; overflow: hidden; }
        .pdfv1-page:last-child { page-break-after: auto; }
        .pdfv1-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1d4ed8; padding-bottom: 5mm; margin-bottom: 5mm; }
        .pdfv1-doc-kicker { font-size: 8.5pt; color: #64748b; font-weight: 700; letter-spacing: .4px; }
        .pdfv1-doc-title { margin-top: 2mm; font-size: 21pt; line-height: 1.1; color: #0f172a; font-weight: 900; }
        .pdfv1-doc-subtitle { margin-top: 2mm; font-size: 10pt; color: #475569; font-weight: 700; }
        .pdfv1-header-tag { padding: 2.2mm 4mm; border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; border-radius: 999px; font-size: 9pt; font-weight: 800; white-space: nowrap; }
        .pdfv1-cover-grid { display: grid; grid-template-columns: 1.35fr .9fr; gap: 4mm; margin-bottom: 4mm; }
        .pdfv1-panel { border: 1px solid #dbeafe; background: #f8fafc; border-radius: 4mm; padding: 4mm; box-sizing: border-box; }
        .primary-panel { background: linear-gradient(180deg, #ffffff, #eff6ff); }
        .warning-panel { background: #fff7ed; border-color: #fed7aa; }
        .pdfv1-panel-title { color: #1d4ed8; font-size: 11pt; font-weight: 900; margin-bottom: 3mm; }
        .pdfv1-info-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3mm; }
        .pdfv1-info-grid div { background: rgba(255,255,255,.82); border-radius: 3mm; padding: 2.5mm 3mm; border: 1px solid #e2e8f0; }
        .pdfv1-info-grid span { display: block; font-size: 8pt; color: #64748b; margin-bottom: 1mm; }
        .pdfv1-info-grid strong { display: block; font-size: 10pt; color: #0f172a; }
        .pdfv1-check-list { margin: 0; padding-left: 5mm; font-size: 9.5pt; line-height: 1.75; color: #334155; }
        .pdfv1-kpi-grid { display: grid; grid-template-columns: repeat(6, minmax(0,1fr)); gap: 3mm; margin-bottom: 4mm; }
        .pdfv1-kpi { border: 1px solid #e2e8f0; border-radius: 4mm; padding: 3mm; background: #fff; min-height: 18mm; }
        .pdfv1-kpi-label { font-size: 7.5pt; color: #64748b; font-weight: 700; }
        .pdfv1-kpi-value { margin-top: 1.5mm; font-size: 14pt; color: #0f172a; font-weight: 900; }
        .pdfv1-kpi-hint { margin-top: 1mm; font-size: 7.5pt; color: #64748b; }
        .pdfv1-alert { margin: 0 0 4mm 0; padding: 3mm 4mm; border: 1px solid #fecaca; background: #fef2f2; color: #991b1b; border-radius: 3mm; font-size: 10pt; font-weight: 800; }
        .pdfv1-sign-row { position: absolute; left: 10mm; right: 10mm; bottom: 8mm; display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; padding-top: 4mm; border-top: 1px dashed #94a3b8; font-size: 10pt; color: #334155; }
        .pdfv1-layer-layout { display: grid; grid-template-columns: 1.6fr .9fr; gap: 4mm; height: 172mm; }
        .pdfv1-diagram-panel { border: 1px solid #dbeafe; border-radius: 4mm; background: #fff; padding: 2mm; min-width: 0; }
        .pdfv1-layer-side { display: flex; flex-direction: column; gap: 3mm; min-width: 0; }
        .grow-panel { flex: 1; overflow: hidden; }
        .pdfv1-layout-svg { width: 100%; height: 100%; display: block; }
        .pdfv1-svg-title { font-size: 26px; font-weight: 900; fill: #0f172a; }
        .pdfv1-svg-note { font-size: 18px; font-weight: 700; fill: #64748b; }
        .pdfv1-boundary { fill: #f8fafc; stroke: #0f172a; stroke-width: 4; }
        .pdfv1-boundary-ring { fill: #f8fafc; stroke: #0f172a; stroke-width: 4; }
        .pdfv1-boundary-inner { fill: #ffffff; stroke: #94a3b8; stroke-width: 3; stroke-dasharray: 10 8; }
        .pdfv1-grid { stroke: #cbd5e1; stroke-width: 1; }
        .pdfv1-centerline { stroke: #94a3b8; stroke-width: 2; stroke-dasharray: 8 8; }
        .pdfv1-item { stroke: #0f172a; stroke-width: 1.4; opacity: .94; }
        .zoom-item { stroke-width: 2.2; opacity: .96; }
        .zoom-page .pdfv1-diagram-panel { background: #ffffff; }
        .zoom-panel { border-color: #fed7aa; }
        .pdfv1-item-standing { stroke-width: 1.8; }
        .pdfv1-standing-axis { stroke: rgba(15,23,42,.42); stroke-width: 1.2; stroke-dasharray: 5 4; }
        .pdfv1-item-label { fill: #fff; stroke: rgba(15,23,42,.34); stroke-width: 1; paint-order: stroke; font-weight: 900; text-anchor: middle; font-family: Arial, sans-serif; }
        .pdfv1-axis-label { fill: #334155; font-size: 18px; font-weight: 800; }
        .pdfv1-bullets { margin: 0; padding-left: 5mm; font-size: 9pt; line-height: 1.7; color: #334155; }
        .pdfv1-table { width: 100%; border-collapse: collapse; font-size: 8.4pt; background: #fff; }
        .pdfv1-table th { background: #eff6ff; color: #1d4ed8; font-weight: 900; border: 1px solid #bfdbfe; padding: 2mm 1.6mm; text-align: left; }
        .pdfv1-table td { border: 1px solid #e2e8f0; padding: 1.8mm 1.6mm; vertical-align: top; }
        .pdfv1-table.compact { font-size: 8.2pt; }
        .pdfv1-table.layer-table { font-size: 8.1pt; }
        .pdfv1-table span { color: #64748b; font-size: 7.3pt; }
        .pdfv1-table .center { text-align: center; font-weight: 900; color: #1d4ed8; }
        .full-height { min-height: 171mm; }
        .worklist-table { font-size: 7.2pt; }
        .worklist-table th, .worklist-table td { padding: 1.55mm 1.2mm; }
        .pdfv1-footnote { position: absolute; left: 10mm; right: 10mm; bottom: 6mm; color: #64748b; font-size: 8.5pt; }
        .pdfv1-plan-cover-hero { padding: 10mm 8mm; margin-bottom: 5mm; border-radius: 5mm; background: linear-gradient(135deg, #eff6ff, #ffffff); border: 1px solid #bfdbfe; }
        .pdfv1-plan-cover-kicker { font-size: 9pt; color: #2563eb; font-weight: 900; letter-spacing: .8px; }
        .pdfv1-plan-cover-name { margin-top: 3mm; font-size: 25pt; font-weight: 900; }
        .pdfv1-plan-cover-meta { margin-top: 3mm; font-size: 10pt; color: #64748b; }
        .pdfv1-cover-furnace-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3mm; }
        .pdfv1-cover-furnace-list div { padding: 3mm; background: #fff; border: 1px solid #e2e8f0; border-radius: 2mm; }
        .pdfv1-cover-furnace-list strong, .pdfv1-cover-furnace-list span { display: block; }
        .pdfv1-cover-furnace-list span { margin-top: 1mm; color: #64748b; font-size: 8.5pt; }
        .pdfv1-cover-tooling { margin-top: 4mm; color: #334155; font-size: 9pt; font-weight: 700; }
        .field-large-page { width: 297mm; min-height: 210mm; height: 210mm; padding: 5mm 8mm; display: grid; grid-template-rows: 12mm 160mm 28mm; }
        .pdfv1-field-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #93c5fd; font-size: 11pt; }
        .pdfv1-field-header strong, .pdfv1-field-header span { display: block; }
        .pdfv1-field-header strong { font-size: 14pt; line-height: 1; }
        .pdfv1-field-header span { margin-top: .6mm; color: #475569; font-size: 8pt; }
        .pdfv1-field-diagram-stage { display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 0; }
        .pdfv1-field-layout-svg { width: 160mm; height: 160mm; max-width: 160mm; max-height: 160mm; display: block; overflow: visible; }
        .pdfv1-field-svg-note { font-size: 28px; font-weight: 800; fill: #475569; }
        .pdfv1-field-axis { stroke: #334155; stroke-width: 5; }
        .pdfv1-field-axis-label { fill: #334155; font-size: 30px; font-weight: 900; }
        .field-item { stroke-width: 4; opacity: .96; }
        .pdfv1-field-number-badge { fill: rgba(15,23,42,.78); stroke: #fff; stroke-width: 3; }
        .pdfv1-field-item-label { stroke-width: 2; }
        .pdfv1-field-summary { display: grid; grid-template-columns: minmax(0, 1fr) 55mm; gap: 3mm; align-items: stretch; border-top: 1px solid #cbd5e1; padding-top: 2mm; }
        .pdfv1-field-facts { display: grid; grid-template-columns: 22mm 18mm 27mm 55mm minmax(0, 1fr); gap: 2mm; min-width: 0; }
        .pdfv1-field-facts span { min-width: 0; padding: 1.5mm 2mm; border-radius: 2mm; background: #f8fafc; font-size: 8pt; font-weight: 800; line-height: 1.25; }
        .pdfv1-field-facts b { display: block; margin-bottom: .7mm; color: #64748b; font-size: 7pt; }
        .pdfv1-field-facts .categories { overflow: hidden; }
        .pdfv1-field-facts .warning { background: #fff7ed; color: #9a3412; }
        .pdfv1-field-signatures { display: grid; grid-template-rows: 1fr 1fr; align-items: center; padding-left: 2mm; border-left: 1px dashed #94a3b8; font-size: 9pt; }
    `;
}

function mountPdfHtml(html) {
    // V0.8.2.1.6: render pages in the viewport but underneath the existing modal.
    // We capture each .pdfv1-page directly with html2canvas + jsPDF, so the host
    // no longer needs to sit above the UI. It stays visible/measurable to avoid
    // blank canvas capture, but no longer covers the PDF selection dialog.
    const oldHost = document.getElementById('pdf-v1-render-host');
    if (oldHost) oldHost.remove();

    const host = document.createElement('div');
    host.id = 'pdf-v1-render-host';
    host.setAttribute('aria-hidden', 'true');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '297mm';
    host.style.minHeight = '210mm';
    host.style.background = '#ffffff';
    host.style.zIndex = '1';
    host.style.pointerEvents = 'none';
    host.style.overflow = 'visible';
    host.style.opacity = '1';
    host.style.transform = 'none';
    host.style.contain = 'layout style';
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
}

async function waitForPdfRenderHostReady(host) {
    if (!host) throw new Error('PDF 渲染容器创建失败');

    try {
        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
        }
    } catch (_) {}

    // Give SVG, tables and layout enough time to paint before rasterizing.
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    await new Promise(resolve => setTimeout(resolve, 80));

    const pages = [...host.querySelectorAll('.pdfv1-page')];
    const width = host.getBoundingClientRect().width;
    const height = host.scrollHeight || host.getBoundingClientRect().height;

    if (!pages.length) {
        throw new Error('PDF 页面内容为空：未生成 pdfv1-page');
    }
    if (!width || !height) {
        throw new Error(`PDF 页面尺寸异常：${Math.round(width)}×${Math.round(height)}`);
    }

    pages.forEach((page, idx) => {
        const rect = page.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            throw new Error(`PDF 第 ${idx + 1} 页尺寸异常：${Math.round(rect.width)}×${Math.round(rect.height)}`);
        }
    });

    return { pageCount: pages.length, width, height };
}

function makeFileName(entries) {
    const first = entries[0]?.furnace;
    const safeName = String(getFurnaceName(first, entries[0]?.index || 0))
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 32);
    if (entries.length === 1) return `现场摆料施工单_${safeName}_${getFileDateStamp()}.pdf`;
    return `现场摆料施工单_${entries.length}炉_${getFileDateStamp()}.pdf`;
}

function getHtml2Canvas() {
    return window.html2canvas || window.html2pdf?.Worker?.prototype?.html2canvas || null;
}

function getJsPdfCtor() {
    return window.jspdf?.jsPDF || window.jsPDF || window.html2pdf?.Worker?.prototype?.jsPDF || null;
}

function isCanvasMostlyBlank(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return true;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;

    const sampleW = Math.min(canvas.width, 320);
    const sampleH = Math.min(canvas.height, 220);
    const stepX = Math.max(1, Math.floor(canvas.width / sampleW));
    const stepY = Math.max(1, Math.floor(canvas.height / sampleH));
    let checked = 0;
    let nonWhite = 0;

    for (let y = 0; y < canvas.height; y += stepY) {
        const row = ctx.getImageData(0, y, canvas.width, 1).data;
        for (let x = 0; x < canvas.width; x += stepX) {
            const i = x * 4;
            const r = row[i], g = row[i + 1], b = row[i + 2], a = row[i + 3];
            checked++;
            // Count blue text, borders, grid, black text, etc. as real content.
            if (a > 8 && (r < 245 || g < 245 || b < 245)) nonWhite++;
            if (nonWhite > 80) return false;
        }
    }
    return nonWhite < Math.max(18, checked * 0.0008);
}

async function renderPagesToPdf(host, filename) {
    const html2canvas = getHtml2Canvas();
    const JsPDF = getJsPdfCtor();

    if (!html2canvas || !JsPDF) {
        throw new Error('PDF 截图组件未加载：缺少 html2canvas 或 jsPDF。请检查 html2pdf.bundle 是否正常引入。');
    }

    const pages = [...host.querySelectorAll('.pdfv1-page')];
    if (!pages.length) throw new Error('没有可渲染的 PDF 页面');

    const pdf = new JsPDF({
        unit: 'mm',
        format: 'a4',
        orientation: 'landscape',
        compress: true
    });

    const pdfW = 297;
    const pdfH = 210;

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        page.scrollIntoView({ block: 'start', inline: 'nearest' });
        await new Promise(resolve => requestAnimationFrame(() => resolve()));
        await new Promise(resolve => requestAnimationFrame(() => resolve()));

        const rect = page.getBoundingClientRect();
        const canvas = await html2canvas(page, {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            logging: false,
            windowWidth: Math.max(1400, Math.ceil(rect.width || host.getBoundingClientRect().width || 1400)),
            windowHeight: Math.max(900, Math.ceil(rect.height || 900)),
            scrollX: 0,
            scrollY: -window.scrollY
        });

        console.info('[PDF V1] page canvas:', i + 1, canvas.width, canvas.height);

        if (isCanvasMostlyBlank(canvas)) {
            throw new Error(`PDF 第 ${i + 1} 页渲染为空白，请稍后重试或检查浏览器截图权限。`);
        }

        if (i > 0) pdf.addPage('a4', 'landscape');
        const imgData = canvas.toDataURL('image/jpeg', 0.96);
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH, undefined, 'FAST');
    }

    pdf.save(filename);
}

export async function generateSixPagePDF(selectedIds = [], options = {}) {
    let host = null;
    const previousScrollX = window.scrollX || 0;
    const previousScrollY = window.scrollY || 0;
    try {
        const entries = getSelectedFurnaceEntries(selectedIds);
        if (!entries.length) {
            alert('当前没有可导出的装炉方案，请先生成方案。');
            return;
        }

        const pdfOptions = normalizePdfExportOptionsV154(options);
        const manifest = buildPdfPageManifest(selectedIds, pdfOptions);
        const html = buildPdfDocument(manifest);
        host = mountPdfHtml(html);
        const filename = makeFileName(entries);
        console.info('[PDF V1] export options:', pdfOptions);
        const layoutInfo = await waitForPdfRenderHostReady(host);
        console.info('[PDF V1] render host ready:', layoutInfo);
        if (layoutInfo.pageCount !== manifest.pages.length) {
            throw new Error(`PDF 页数不一致：manifest=${manifest.pages.length}，DOM=${layoutInfo.pageCount}`);
        }

        await renderPagesToPdf(host, filename);

        host.remove();
        window.scrollTo(previousScrollX, previousScrollY);
    } catch (err) {
        console.error('[PDF V1] 导出失败:', err);
        alert('PDF 导出失败：' + (err?.message || err));
        if (host) host.remove();
        window.scrollTo(previousScrollX, previousScrollY);
    }
}

// 保持旧模块可能存在的默认调用习惯。
export default generateSixPagePDF;
