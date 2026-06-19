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


// ==================== V0.7.34 PDF language helpers ====================
function getPdfLanguage() {
    try { return localStorage.getItem('heat_furnace_ui_language_v0731') === 'en' ? 'en' : 'zh'; }
    catch (_) { return 'zh'; }
}
function isPdfEnglish() { return getPdfLanguage() === 'en'; }
function tPdf(zh, en) { return isPdfEnglish() ? en : zh; }
function translatePdfStaticHtml(html) {
    if (!isPdfEnglish()) return html;
    const pairs = [
        ['AI热处理装炉智能体 / 现场摆料施工单 V1', 'AI Furnace Loading Agent / Field Loading Work Sheet V1'],
        ['现场摆料施工单', 'Field Loading Work Sheet'],
        ['热处理装炉作业指导书', 'Heat Treatment Loading Work Instruction'],
        ['任务总览', 'Task Overview'],
        ['现场执行确认', 'Field Execution Confirmation'],
        ['现场注意事项', 'Field Notes'],
        ['分层俯视图', 'Layer Top View'],
        ['俯视摆放图', 'Top Loading View'],
        ['工件坐标清单', 'Item Coordinate List'],
        ['坐标清单', 'Coordinate List'],
        ['工件清单', 'Item List'],
        ['编号', 'No.'],
        ['层', 'Layer'],
        ['工件', 'Item'],
        ['客户/图号', 'Customer / Drawing'],
        ['材质', 'Material'],
        ['工艺', 'Process'],
        ['尺寸 mm', 'Size mm'],
        ['坐标 mm', 'Coordinates mm'],
        ['单重', 'Unit Weight'],
        ['数量', 'Qty'],
        ['总重量', 'Total Weight'],
        ['装载重量', 'Load Weight'],
        ['空间利用率', 'Space Utilization'],
        ['重量利用率', 'Weight Utilization'],
        ['层数', 'Layers'],
        ['承重上限', 'Max Load'],
        ['工装类型', 'Tooling Type'],
        ['装炉策略', 'Strategy'],
        ['安全间距', 'Clearance'],
        ['坐标为系统计算值，现场以工装实际定位基准、搁板厚度和工件实物外形复核。', 'Coordinates are calculated values. Verify them on site against tooling datums, shelf thickness and real workpiece geometry.'],
        ['注意：当前方案仍有', 'Note: this plan still has'],
        ['件工件未装入，请现场确认是否需要增加工装或拆分炉次。', 'unpacked items. Confirm on site whether to add tooling or split into later heats.'],
        ['坐标 X/Z 以工装左后/左前基准角为参考，按现场约定保持方向一致。', 'X/Z coordinates use the tooling datum corner as reference; keep orientation consistent with site conventions.'],
        ['第 1 层 / 底层', 'Layer 1 / Bottom'],
        ['底层', 'Bottom'],
        ['方体', 'Cuboid'],
        ['圆柱', 'Cylinder'],
        ['标准料框', 'Standard Basket'],
        ['网篮', 'Mesh Basket'],
        ['料盘', 'Tray'],
        ['环形工装', 'Ring Tooling'],
        ['均衡方案', 'Balanced Plan'],
        ['空间优先', 'Space First'],
        ['热场均衡', 'Thermal Balance'],
        ['表面均匀', 'Surface Uniformity'],
        ['清单', 'List'],
        ['工装', 'Tooling'],
        ['炉次', 'Heat'],
        ['件', 'pcs'],
        ['间距', 'Clearance']
    ];
    let out = html;
    for (const [zh,en] of pairs) out = out.split(zh).join(en);
    out = out.replace(/第\s*(\d+)\s*层/g, 'Layer $1');
    out = out.replace(/(\d+)炉/g, '$1 heats');
    out = out.replace(/(\d+)件/g, '$1 pcs');
    return out;
}

const PAGE_ROW_LIMIT = 28;
const SVG_W = 1000;
const SVG_H = 650;
const DRAW_PAD = 58;

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

function getShapeLabel(item) {
    if (item?.shape === 'cylinder') return '圆柱';
    return '方体';
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
    const x = layout.ox + toNumber(item.x) * layout.scale;
    const y = layout.oy + toNumber(item.z) * layout.scale;
    const w = Math.max(2, toNumber(item.w, 1) * layout.scale);
    const h = Math.max(2, toNumber(item.d, 1) * layout.scale);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const fill = escapeHtml(getColor(item.color, '#2563EB'));
    const no = escapeHtml(item._pdfNo);
    const labelSize = clamp(Math.min(w, h) * 0.38, 10, 26);
    const isCylinder = item.shape === 'cylinder';

    if (isCylinder) {
        const r = Math.max(3, Math.min(w, h) / 2);
        return `
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" class="pdfv1-item" />
            <text x="${cx}" y="${cy + labelSize * 0.35}" font-size="${labelSize}" class="pdfv1-item-label">${no}</text>
        `;
    }

    return `
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" class="pdfv1-item" />
        <text x="${cx}" y="${cy + labelSize * 0.35}" font-size="${labelSize}" class="pdfv1-item-label">${no}</text>
    `;
}


function renderTrayCornerPostsSvg(furnace, layout) {
    const blockers = Array.isArray(furnace?.trayCornerPostBlockers)
        ? furnace.trayCornerPostBlockers
        : [];
    if (!blockers.length) return '';

    return blockers.map((blocker, idx) => {
        const cx = layout.ox + toNumber(blocker.x) * layout.scale;
        const cy = layout.oy + toNumber(blocker.z) * layout.scale;
        const visualRadius = toNumber(blocker.visualRadius, toNumber(blocker.radius, 10));
        const r = Math.max(3.5, visualRadius * layout.scale);
        return `
            <circle cx="${cx}" cy="${cy}" r="${r}" class="pdfv1-tray-post" />
            <text x="${cx}" y="${cy + 3}" class="pdfv1-tray-post-label">P${idx + 1}</text>
        `;
    }).join('');
}

function renderLayerDiagram(furnace, layerItems, layer) {
    const layout = getLayout(furnace);
    const boundary = renderBoundarySvg(furnace, layout);
    const postsSvg = renderTrayCornerPostsSvg(furnace, layout);
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
            ${postsSvg}
            ${itemsSvg}
            <line x1="${layout.ox}" y1="${layout.oy + layout.drawH + 34}" x2="${layout.ox + Math.min(layout.drawW, 160)}" y2="${layout.oy + layout.drawH + 34}" stroke="#334155" stroke-width="2" marker-end="url(#arrow-x-${layer})" />
            <text x="${layout.ox + Math.min(layout.drawW, 174)}" y="${layout.oy + layout.drawH + 39}" class="pdfv1-axis-label">X+</text>
            <line x1="${layout.ox - 28}" y1="${layout.oy}" x2="${layout.ox - 28}" y2="${layout.oy + Math.min(layout.drawH, 160)}" stroke="#334155" stroke-width="2" marker-end="url(#arrow-x-${layer})" />
            <text x="${layout.ox - 42}" y="${layout.oy + Math.min(layout.drawH, 180)}" class="pdfv1-axis-label">Z+</text>
        </svg>
    `;
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

function buildCoverPage(furnace, index, numberedItems) {
    const name = getFurnaceName(furnace, index);
    const stats = getFurnaceStats(furnace);
    const dimensions = `${formatNumber(furnace.w)}×${formatNumber(furnace.h)}×${formatNumber(furnace.d)} mm`;
    const groups = groupItems(numberedItems);
    const hasUnpacked = Array.isArray(globalUnpackedItems) && globalUnpackedItems.length > 0;

    return `
        <section class="pdfv1-page cover">
            ${buildHeader('装炉摆料作业指导书', `${name} · ${getFurnaceTypeLabel(furnace)}`, `炉次 ${index + 1}`)}

            <div class="pdfv1-cover-grid">
                <div class="pdfv1-panel primary-panel">
                    <div class="pdfv1-panel-title">任务信息</div>
                    <div class="pdfv1-info-grid">
                        <div><span>工装名称</span><strong>${escapeHtml(name)}</strong></div>
                        <div><span>工装类型</span><strong>${escapeHtml(getFurnaceTypeLabel(furnace))}</strong></div>
                        <div><span>工装尺寸</span><strong>${escapeHtml(dimensions)}</strong></div>
                        <div><span>摆放策略</span><strong>${escapeHtml(getStrategyLabel())}</strong></div>
                        <div><span>安全间距</span><strong>${escapeHtml(placementRules?.minSpacing ?? 5)} mm</strong></div>
                        <div><span>搁板厚度</span><strong>${escapeHtml(placementRules?.shelfThickness ?? 20)} mm</strong></div>
                    </div>
                </div>
                <div class="pdfv1-panel warning-panel">
                    <div class="pdfv1-panel-title">现场执行确认</div>
                    <ol class="pdfv1-check-list">
                        <li>核对工装编号、工艺、工件批次。</li>
                        <li>按 PDF 中的层号和编号从底层开始摆放。</li>
                        <li>同编号表示单件位置，颜色仅辅助识别。</li>
                        <li>摆放完成后复核间距、超边、搁板位置。</li>
                    </ol>
                </div>
            </div>

            <div class="pdfv1-kpi-grid">
                ${buildKpi('已装工件', `${stats.itemCount} 件`)}
                ${buildKpi('装载重量', formatWeight(stats.totalWeight), `承重 ${formatWeight(stats.maxWeight)}`)}
                ${buildKpi('重量利用率', formatPercent(stats.weightRate))}
                ${buildKpi('空间利用率', formatPercent(stats.spaceRate))}
                ${buildKpi('层数', `${stats.layerCount} 层`)}
                ${buildKpi('生成时间', getDateStamp())}
            </div>

            ${hasUnpacked ? `<div class="pdfv1-alert">注意：当前方案仍有 ${globalUnpackedItems.length} 件工件未装入，请现场确认是否需要增加工装或拆分炉次。</div>` : ''}

            <div class="pdfv1-panel">
                <div class="pdfv1-panel-title">本炉工件批次汇总</div>
                <table class="pdfv1-table compact">
                    <thead><tr><th>编号范围</th><th>工件</th><th>材质</th><th>工艺</th><th>尺寸 mm</th><th>数量</th><th>重量</th></tr></thead>
                    <tbody>
                        ${groups.map(g => `
                            <tr>
                                <td>${escapeHtml(compactNoList(g.noList))}</td>
                                <td>${escapeHtml(g.name)}</td>
                                <td>${escapeHtml(g.material)}</td>
                                <td>${escapeHtml(g.process)}</td>
                                <td>${escapeHtml(g.size)}</td>
                                <td>${g.count}</td>
                                <td>${formatWeight(g.totalWeight)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div class="pdfv1-sign-row">
                <div>摆料人员：____________</div>
                <div>复核人员：____________</div>
                <div>完成时间：____________</div>
            </div>
        </section>
    `;
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

function buildWorklistPages(furnace, index, numberedItems) {
    const pages = [];
    for (let start = 0; start < numberedItems.length; start += PAGE_ROW_LIMIT) {
        const chunk = numberedItems.slice(start, start + PAGE_ROW_LIMIT);
        const pageIndex = Math.floor(start / PAGE_ROW_LIMIT) + 1;
        const pageCount = Math.ceil(numberedItems.length / PAGE_ROW_LIMIT);
        pages.push(`
            <section class="pdfv1-page worklist-page">
                ${buildHeader('工件坐标清单', `${getFurnaceName(furnace, index)} · ${start + 1}-${Math.min(start + PAGE_ROW_LIMIT, numberedItems.length)} / ${numberedItems.length}`, `清单 ${pageIndex}/${pageCount}`)}
                <div class="pdfv1-panel full-height">
                    <table class="pdfv1-table worklist-table">
                        <thead>
                            <tr>
                                <th>编号</th><th>层</th><th>工件</th><th>客户/图号</th><th>材质</th><th>工艺</th><th>尺寸 mm</th><th>坐标 mm</th><th>单重</th>
                            </tr>
                        </thead>
                        <tbody>${buildWorklistRows(chunk)}</tbody>
                    </table>
                </div>
                <div class="pdfv1-footnote">坐标为系统计算值，现场以工装实际定位基准、搁板厚度和工件实物外形复核。</div>
            </section>
        `);
    }
    return pages.join('');
}

function buildPdfDocument(entries) {
    const sections = [];
    entries.forEach(({ furnace, index }) => {
        const numberedItems = buildNumberedItems(furnace);
        const stats = getFurnaceStats(furnace);
        sections.push(buildCoverPage(furnace, index, numberedItems));
        stats.layers.forEach(layer => sections.push(buildLayerPage(furnace, index, numberedItems, layer)));
        sections.push(buildWorklistPages(furnace, index, numberedItems));
    });

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
        .pdfv1-tray-post { fill: #334155; stroke: #0f172a; stroke-width: 1.4; opacity: .92; }
        .pdfv1-tray-post-label { fill: #fff; stroke: rgba(15,23,42,.55); stroke-width: 1; paint-order: stroke; font-size: 7pt; font-weight: 900; text-anchor: middle; font-family: Arial, sans-serif; }
        .pdfv1-item { stroke: #0f172a; stroke-width: 1.4; opacity: .94; }
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
    `;
}

function mountPdfHtml(html) {
    const host = document.createElement('div');
    host.id = 'pdf-v1-render-host';
    host.style.position = 'fixed';
    host.style.left = '-10000px';
    host.style.top = '0';
    host.style.width = '297mm';
    host.style.background = '#ffffff';
    host.innerHTML = translatePdfStaticHtml(html);
    document.body.appendChild(host);
    return host;
}

function makeFileName(entries) {
    const first = entries[0]?.furnace;
    const safeName = String(getFurnaceName(first, entries[0]?.index || 0))
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 32);
    if (entries.length === 1) return `${tPdf('现场摆料施工单', 'field_loading_sheet')}_${safeName}_${getFileDateStamp()}.pdf`;
    return `${tPdf('现场摆料施工单', 'field_loading_sheet')}_${entries.length}${tPdf('炉', 'heats')}_${getFileDateStamp()}.pdf`;
}

export async function generateSixPagePDF(selectedIds = []) {
    try {
        if (typeof window.html2pdf === 'undefined') {
            alert(tPdf('PDF 导出组件未加载，请检查 html2pdf.js 是否正常引入。', 'PDF export component is not loaded. Check html2pdf.js.'));
            return;
        }

        const entries = getSelectedFurnaceEntries(selectedIds);
        if (!entries.length) {
            alert(tPdf('当前没有可导出的装炉方案，请先生成方案。', 'No loading plan can be exported. Generate a plan first.'));
            return;
        }

        const html = buildPdfDocument(entries);
        const host = mountPdfHtml(html);
        const filename = makeFileName(entries);

        await window.html2pdf()
            .set({
                margin: 0,
                filename,
                image: { type: 'jpeg', quality: 0.96 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    backgroundColor: '#ffffff',
                    logging: false,
                    windowWidth: 1400
                },
                jsPDF: {
                    unit: 'mm',
                    format: 'a4',
                    orientation: 'landscape',
                    compress: true
                },
                pagebreak: { mode: ['css', 'legacy'] }
            })
            .from(host)
            .save();

        host.remove();
    } catch (err) {
        console.error('[PDF V1] 导出失败:', err);
        alert(tPdf('PDF 导出失败：', 'PDF export failed: ') + (err?.message || err));
        const host = document.getElementById('pdf-v1-render-host');
        if (host) host.remove();
    }
}

// 保持旧模块可能存在的默认调用习惯。
export default generateSixPagePDF;
