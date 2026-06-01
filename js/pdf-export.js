/**
 * pdf-export.js - PDF Export Logic
 *
 * Purpose:
 *   Contains all PDF report generation and export logic.
 *   Includes: report generation, PDF export, JSON export for master plans.
 *
 * Dependencies:
 *   - state.js
 *   - ui.js (getFurnaceDataFromCard, getMaterialDataFromCard, rgbToHex)
 *   - html2pdf.js (global: html2pdf)
 *
 * Future Extension:
 *   - Real-time PDF preview page
 *   - Batch export for all furnaces
 *   - Custom report templates
 *   - Cloud storage integration
 */

import {
    globalFurnacesResult, globalUnpackedItems,
    currentFurnaceIndex,
    placementRules
} from './state.js';
import {
    getFurnaceDataFromCard,
    getMaterialDataFromCard,
    rgbToHex
} from './ui.js';

// ==================== RULER OVERLAY ====================

/**
 * Create a ruler grid overlay for PDF view pages.
 *
 * @param {number} width - Canvas width in px
 * @param {number} height - Canvas height in px
 * @param {number} scaleFactor - px per mm
 * @param {string} axisX - X axis label
 * @param {string} axisY - Y axis label
 * @returns {string} HTML string
 */
export function createRulerOverlay(width, height, scaleFactor, axisX, axisY) {
    let html = '';
    const stepMM = 50, stepPX = stepMM * scaleFactor;
    for (let x = 0; x <= width; x += stepPX) {
        html += `<div class="pdf-grid-line-x" style="left:${x}px;height:${height}px;"></div>`;
        html += `<div class="pdf-ruler-text" style="left:${x+2}px;top:2px;">${Math.round(x/scaleFactor)}</div>`;
    }
    for (let y = 0; y <= height; y += stepPX) {
        html += `<div class="pdf-grid-line-y" style="top:${y}px;width:${width}px;"></div>`;
    }
    html += `<div style="position:absolute;left:6px;bottom:6px;font-size:9px;font-weight:bold;color:#000;background:rgba(255,255,255,0.8);padding:2px 5px;border-radius:4px;">${axisX} → / ${axisY} ↑ / 单位:mm</div>`;
    return html;
}

// ==================== VIEW PAGE (3D TOP-DOWN) ====================

/**
 * Create a top-down view page showing furnace layout with rulers.
 *
 * @param {Object} params
 * @param {HTMLElement} params.pdfWrapper - Container element
 * @param {Object} params.furnace - Furnace result data
 * @param {string} params.title - Page title
 * @param {string} params.axisX - X axis label
 * @param {string} params.axisY - Y axis label
 * @param {number} params.canvasWidth - Width in px
 * @param {number} params.canvasHeight - Height in px
 * @param {Function} params.drawItems - Callback(item, idx, scaleFactor, offsetX, offsetY) => html string
 */
export function createViewPage({ pdfWrapper, furnace, title, axisX, axisY, canvasWidth, canvasHeight, drawItems }) {
    const page = document.createElement('div');
    page.className = 'pdf-page';
    page.style.cssText = 'position:relative;width:1122px;height:760px;background:#fff;padding:30px;box-sizing:border-box;';
    const scaleFactor = Math.min((canvasWidth - 120) / furnace.w, (canvasHeight - 160) / furnace.d);
    const offsetX = (canvasWidth - furnace.w * scaleFactor) / 2;
    const offsetY = (canvasHeight - furnace.d * scaleFactor) / 2;
    let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:20px;">
        <div><div style="font-size:24px;font-weight:bold;">${title}</div><div style="font-size:12px;margin-top:4px;color:#666;">炉次：${furnace.instanceId}</div></div>
        <div style="text-align:right;font-size:12px;line-height:1.8;">工件数：${furnace.packedItems.length}<br>总重量：${furnace.totalWeight.toFixed(1)} kg</div>
    </div>
    <div style="position:relative;width:${canvasWidth}px;height:${canvasHeight}px;border:2px solid #000;margin:0;overflow:hidden;background:#fff;">
    `;
    html += createRulerOverlay(canvasWidth, canvasHeight, scaleFactor, axisX, axisY);
    furnace.packedItems.forEach((item, idx) => { html += drawItems(item, idx, scaleFactor, offsetX, offsetY); });
    html += `</div>`;
    html += `<div style="margin-top:16px;border:1px solid #ccc;padding:10px;"><div style="font-weight:bold;margin-bottom:8px;">图例 Legend</div><div style="display:flex;flex-wrap:wrap;gap:12px;">`;
    const added = new Set();
    furnace.packedItems.forEach(item => {
        if (added.has(item.name)) return;
        added.add(item.name);
        html += `<div style="display:flex;align-items:center;gap:6px;font-size:11px;"><div style="width:16px;height:16px;background:${item.color};border:1px solid #000;"></div><div>${item.name}</div></div>`;
    });
    html += `</div></div>`;
    page.innerHTML = html;
    pdfWrapper.appendChild(page);
}

// ==================== SIGNATURE PAGE ====================

/**
 * Create a summary/signature page for the PDF report.
 *
 * @param {Object} params
 * @param {HTMLElement} params.pdfWrapper
 * @param {Object} params.furnace
 * @param {boolean} params.includeWorklist
 */
export function createSignaturePage({ pdfWrapper, furnace, includeWorklist }) {
    const page = document.createElement('div');
    page.className = 'pdf-page';
    page.style.cssText = 'position:relative;width:1122px;height:760px;background:#fff;padding:40px;box-sizing:border-box;';
    const totalVol = furnace.w * furnace.h * furnace.d;
    const packedVol = furnace.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
    let html = `
    <div style="border-bottom:3px solid #0066cc;padding-bottom:16px;margin-bottom:24px;">
        <div style="font-size:28px;font-weight:bold;">热处理装炉作业方案</div>
        <div style="font-size:13px;color:#666;margin-top:6px;">Industrial Heat Treatment Furnace Loading Plan</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px;">
        <div style="background:#f1f5f9;padding:16px;border-radius:8px;text-align:center;"><div style="font-size:11px;color:#666;">炉次编号</div><div style="font-size:18px;font-weight:bold;">${furnace.instanceId}</div></div>
        <div style="background:#f1f5f9;padding:16px;border-radius:8px;text-align:center;"><div style="font-size:11px;color:#666;">工件数量</div><div style="font-size:18px;font-weight:bold;">${furnace.packedItems.length} 件</div></div>
        <div style="background:#f1f5f9;padding:16px;border-radius:8px;text-align:center;"><div style="font-size:11px;color:#666;">总重量</div><div style="font-size:18px;font-weight:bold;">${furnace.totalWeight.toFixed(1)} kg</div></div>
        <div style="background:#f1f5f9;padding:16px;border-radius:8px;text-align:center;"><div style="font-size:11px;color:#666;">空间利用率</div><div style="font-size:18px;font-weight:bold;">${((packedVol/totalVol)*100).toFixed(1)}%</div></div>
    </div>
    `;

    if (includeWorklist) {
        html += `
        <div style="font-size:15px;font-weight:bold;margin-bottom:12px;">工件清单</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:24px;">
            <thead><tr style="background:#f1f5f9;">
                <th style="border:1px solid #000;padding:8px;">工件名称</th>
                <th style="border:1px solid #000;padding:8px;">形态</th>
                <th style="border:1px solid #000;padding:8px;">尺寸(mm)</th>
                <th style="border:1px solid #000;padding:8px;">重量(kg)</th>
                <th style="border:1px solid #000;padding:8px;">位置坐标</th>
            </tr></thead><tbody>
        `;
        furnace.packedItems.forEach(item => {
            const dimStr = item.shape === 'cylinder' ? `⌀${item.w}×H${item.h}` : `${item.w}×${item.h}×${item.d}`;
            html += `<tr><td style="border:1px solid #000;padding:8px;">${item.name}</td><td style="border:1px solid #000;padding:8px;text-align:center;">${item.shape==='cylinder'?'圆柱':'立方'}</td><td style="border:1px solid #000;padding:8px;text-align:center;">${dimStr}</td><td style="border:1px solid #000;padding:8px;text-align:center;">${item.weight.toFixed(1)}</td><td style="border:1px solid #000;padding:8px;text-align:center;">(${Math.round(item.x)},${Math.round(item.y)},${Math.round(item.z)})</td></tr>`;
        });
        html += `</tbody></table>`;
    }

    html += `
    <div class="pdf-signature-area">
        <div style="font-size:15px;font-weight:bold;margin-bottom:4px;">领导认可方案签字区</div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:16px;">Leadership Approval Signature Area</div>
        <div class="pdf-signature-grid">
            <div class="pdf-signature-box">
                <div class="sig-title">编制人<br>Prepared by</div>
                <div class="sig-line">签名 / 日期</div>
            </div>
            <div class="pdf-signature-box">
                <div class="sig-title">审核人<br>Reviewed by</div>
                <div class="sig-line">签名 / 日期</div>
            </div>
            <div class="pdf-signature-box">
                <div class="sig-title">批准人<br>Approved by</div>
                <div class="sig-line">签名 / 日期</div>
            </div>
        </div>
        <div style="margin-top:20px;padding:12px;border:1px dashed #cbd5e1;border-radius:6px;font-size:11px;color:#94a3b8;">
            备注 / Remarks：_______________________________________________________________________________________________________________
        </div>
    </div>
    `;
    page.innerHTML = html;
    pdfWrapper.appendChild(page);
}

// ==================== MATERIAL LEGEND PAGE ====================

/**
 * Create a global material legend page.
 */
export function createMaterialLegendPage({ pdfWrapper, furnace }) {
    const materialMap = new Map();
    document.querySelectorAll('.material-card').forEach(card => {
        const d = getMaterialDataFromCard(card);
        if (!materialMap.has(d.name)) materialMap.set(d.name, d);
    });
    furnace.packedItems.forEach(item => {
        if (!materialMap.has(item.name)) {
            materialMap.set(item.name, {
                name: item.name, shape: item.shape,
                dim1: item.w, dim2: item.d, dim3: item.h,
                color: item.color, material: '', hardness: '', process: '', cadImage: ''
            });
        }
    });

    const page = document.createElement('div');
    page.className = 'pdf-page';
    page.style.cssText = 'position:relative;width:1122px;min-height:760px;background:#fff;padding:40px;box-sizing:border-box;';

    let html = `
    <div style="border-bottom:3px solid #0066cc;padding-bottom:12px;margin-bottom:24px;">
        <div style="font-size:22px;font-weight:bold;">全局物料图例</div>
        <div style="font-size:12px;color:#666;margin-top:4px;">Global Material Legend · 炉次：${furnace.instanceId}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
            <tr style="background:#f1f5f9;">
                <th style="border:1px solid #ccc;padding:10px 8px;text-align:left;width:30px;">色标</th>
                <th style="border:1px solid #ccc;padding:10px 8px;text-align:left;">物料名称</th>
                <th style="border:1px solid #ccc;padding:10px 8px;text-align:center;">形状</th>
                <th style="border:1px solid #ccc;padding:10px 8px;text-align:center;">尺寸 (mm)</th>
                <th style="border:1px solid #ccc;padding:10px 8px;text-align:center;">材质</th>
                <th style="border:1px solid #ccc;padding:10px 8px;text-align:center;">硬度要求</th>
                <th style="border:1px solid #ccc;padding:10px 8px;text-align:center;">工艺</th>
                <th style="border:1px solid #ccc;padding:10px 8px;text-align:center;width:120px;">CAD图纸</th>
            </tr>
        </thead>
        <tbody>
    `;

    materialMap.forEach((d, name) => {
        const shapeLabel = d.shape === 'cylinder' ? '圆柱体' : '立方体';
        const dimLabel = d.shape === 'cylinder' ? `⌀${d.dim1} × H${d.dim3}` : `${d.dim1} × ${d.dim2} × ${d.dim3}`;
        const colorHex = rgbToHex(d.color) || d.color || '#888888';
        const cadCell = d.cadImage
            ? `<img src="${d.cadImage}" style="max-width:110px;max-height:70px;border:1px solid #ccc;border-radius:3px;" alt="CAD">`
            : `<span style="color:#ccc;font-size:10px;">暂无图纸</span>`;
        html += `
        <tr>
            <td style="border:1px solid #ccc;padding:8px;text-align:center;">
                <div style="width:24px;height:24px;background:${colorHex};border:1px solid #999;border-radius:3px;margin:0 auto;"></div>
            </td>
            <td style="border:1px solid #ccc;padding:8px;font-weight:bold;">${name}</td>
            <td style="border:1px solid #ccc;padding:8px;text-align:center;">${shapeLabel}</td>
            <td style="border:1px solid #ccc;padding:8px;text-align:center;">${dimLabel}</td>
            <td style="border:1px solid #ccc;padding:8px;text-align:center;">${d.material || '—'}</td>
            <td style="border:1px solid #ccc;padding:8px;text-align:center;">${d.hardness || '—'}</td>
            <td style="border:1px solid #ccc;padding:8px;text-align:center;">${d.process || '—'}</td>
            <td style="border:1px solid #ccc;padding:8px;text-align:center;">${cadCell}</td>
        </tr>`;
    });

    html += `</tbody></table>`;
    page.innerHTML = html;
    pdfWrapper.appendChild(page);
}

// ==================== FURNACE INFO + RULES PAGE ====================

/**
 * Create furnace info + placement rules + entry direction + signature page.
 */
export function createFurnaceInfoPage({ pdfWrapper, furnace }) {
    const materialMap = new Map();
    document.querySelectorAll('.material-card').forEach(card => {
        const d = getMaterialDataFromCard(card);
        if (!materialMap.has(d.name)) materialMap.set(d.name, d);
    });
    furnace.packedItems.forEach(item => {
        if (!materialMap.has(item.name)) {
            materialMap.set(item.name, { name: item.name, shape: item.shape, dim1: item.w, dim2: item.d, dim3: item.h, color: item.color, material: '', hardness: '', process: '' });
        }
    });

    const rulesList = [];
    if (placementRules.gravity) rulesList.push('重力优先（重件置底）');
    if (placementRules.dense) rulesList.push('密集排布（最小化空隙）');
    if (placementRules.sameMaterial) rulesList.push('同材质聚集');
    if (placementRules.sameProcess) rulesList.push('同工艺聚集');
    if (placementRules.rotate) rulesList.push('允许工件旋转90°');
    if (placementRules.balance) rulesList.push('重心平衡检查');
    rulesList.push(`最小安全间距 ${placementRules.minSpacing}mm`);
    rulesList.push(`炉壁间距 ${placementRules.wallSpacing}mm`);
    rulesList.push(`承重安全余量 ${placementRules.weightMargin}%`);
    const strategyMap = { 'volume-desc': '体积从大到小', 'weight-desc': '重量从大到小', 'height-desc': '高度从大到小', 'delivery-asc': '交付日期优先' };
    rulesList.push(`排布策略：${strategyMap[placementRules.sortStrategy] || placementRules.sortStrategy}`);

    const totalVol = furnace.w * furnace.h * furnace.d;
    const packedVol = furnace.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);

    const page = document.createElement('div');
    page.className = 'pdf-page';
    page.style.cssText = 'position:relative;width:794px;min-height:1123px;background:#fff;padding:40px;box-sizing:border-box;font-family:Arial,sans-serif;';

    let html = `
    <div style="border-bottom:3px solid #0066cc;padding-bottom:14px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end;">
        <div>
            <div style="font-size:24px;font-weight:bold;color:#0f172a;">热处理装炉作业方案</div>
            <div style="font-size:12px;color:#64748b;margin-top:4px;">Industrial Heat Treatment Furnace Loading Plan</div>
        </div>
        <div style="text-align:right;font-size:11px;color:#64748b;line-height:1.6;">
            生成日期：${new Date().toLocaleDateString('zh-CN')}<br>
            炉次编号：${furnace.instanceId}
        </div>
    </div>

    <div style="margin-bottom:20px;">
        <div style="font-size:14px;font-weight:bold;color:#0f172a;border-left:4px solid #0066cc;padding-left:8px;margin-bottom:12px;">🏭 炉膛信息</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px;">
            <div style="background:#f1f5f9;padding:12px;border-radius:6px;text-align:center;">
                <div style="font-size:10px;color:#64748b;margin-bottom:4px;">炉膛名称</div>
                <div style="font-size:14px;font-weight:bold;">${furnace.typeName || furnace.instanceId.split('(')[0].trim()}</div>
            </div>
            <div style="background:#f1f5f9;padding:12px;border-radius:6px;text-align:center;">
                <div style="font-size:10px;color:#64748b;margin-bottom:4px;">炉膛尺寸 (mm)</div>
                <div style="font-size:14px;font-weight:bold;">${furnace.w} × ${furnace.h} × ${furnace.d}</div>
            </div>
            <div style="background:#f1f5f9;padding:12px;border-radius:6px;text-align:center;">
                <div style="font-size:10px;color:#64748b;margin-bottom:4px;">承重上限</div>
                <div style="font-size:14px;font-weight:bold;">${furnace.max_weight} kg</div>
            </div>
            <div style="background:#f1f5f9;padding:12px;border-radius:6px;text-align:center;">
                <div style="font-size:10px;color:#64748b;margin-bottom:4px;">装载工件数</div>
                <div style="font-size:14px;font-weight:bold;">${furnace.packedItems.length} 件</div>
            </div>
            <div style="background:#f1f5f9;padding:12px;border-radius:6px;text-align:center;">
                <div style="font-size:10px;color:#64748b;margin-bottom:4px;">装载总重量</div>
                <div style="font-size:14px;font-weight:bold;">${furnace.totalWeight.toFixed(1)} kg</div>
            </div>
            <div style="background:#f1f5f9;padding:12px;border-radius:6px;text-align:center;">
                <div style="font-size:10px;color:#64748b;margin-bottom:4px;">空间利用率</div>
                <div style="font-size:14px;font-weight:bold;">${((packedVol/totalVol)*100).toFixed(1)}%</div>
            </div>
        </div>
    </div>

    <div style="margin-bottom:20px;">
        <div style="font-size:14px;font-weight:bold;color:#0f172a;border-left:4px solid #e67e22;padding-left:8px;margin-bottom:12px;">⚗️ 工艺材质信息</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px;">
            <thead>
                <tr style="background:#fff7ed;">
                    <th style="border:1px solid #fed7aa;padding:8px;text-align:left;width:25%;">工件名称</th>
                    <th style="border:1px solid #fed7aa;padding:8px;text-align:center;width:20%;">材质</th>
                    <th style="border:1px solid #fed7aa;padding:8px;text-align:center;width:25%;">热处理工艺</th>
                    <th style="border:1px solid #fed7aa;padding:8px;text-align:center;width:15%;">硬度要求</th>
                    <th style="border:1px solid #fed7aa;padding:8px;text-align:center;width:15%;">数量</th>
                </tr>
            </thead>
            <tbody>
    `;

    const itemCounts = {};
    furnace.packedItems.forEach(item => { itemCounts[item.name] = (itemCounts[item.name] || 0) + 1; });
    const addedNames = new Set();
    furnace.packedItems.forEach(item => {
        if (addedNames.has(item.name)) return;
        addedNames.add(item.name);
        const d = materialMap.get(item.name) || {};
        html += `<tr>
            <td style="border:1px solid #fed7aa;padding:8px;font-weight:bold;">${item.name}</td>
            <td style="border:1px solid #fed7aa;padding:8px;text-align:center;">${d.material || '—'}</td>
            <td style="border:1px solid #fed7aa;padding:8px;text-align:center;">${d.process || '—'}</td>
            <td style="border:1px solid #fed7aa;padding:8px;text-align:center;">${d.hardness || '—'}</td>
            <td style="border:1px solid #fed7aa;padding:8px;text-align:center;">${itemCounts[item.name]}</td>
        </tr>`;
    });
    html += `</tbody></table></div>`;

    html += `
    <div style="margin-bottom:20px;">
        <div style="font-size:14px;font-weight:bold;color:#0f172a;border-left:4px solid #10b981;padding-left:8px;margin-bottom:12px;">📐 摆放规则</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${rulesList.map(r => `<span style="background:#f0fdf4;border:1px solid #86efac;border-radius:4px;padding:4px 10px;font-size:11px;color:#166534;">${r}</span>`).join('')}
        </div>
    </div>`;

    html += `
    <div style="margin-bottom:20px;">
        <div style="font-size:14px;font-weight:bold;color:#0f172a;border-left:4px solid #ef4444;padding-left:8px;margin-bottom:12px;">🚪 进炉方向确认</div>
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;">
            <div style="font-size:11px;color:#dc2626;margin-bottom:12px;font-weight:bold;">⚠️ 请工艺负责人和装炉方案负责人在打印后勾选确认进炉方向，并签字</div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px;">
                <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#fff;border:1px solid #fca5a5;border-radius:6px;">
                    <div style="width:20px;height:20px;border:2px solid #dc2626;border-radius:3px;flex-shrink:0;"></div>
                    <span style="font-size:12px;">从炉门正面进炉（X轴正方向）</span>
                </div>
                <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#fff;border:1px solid #fca5a5;border-radius:6px;">
                    <div style="width:20px;height:20px;border:2px solid #dc2626;border-radius:3px;flex-shrink:0;"></div>
                    <span style="font-size:12px;">从炉门侧面进炉（Z轴正方向）</span>
                </div>
                <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#fff;border:1px solid #fca5a5;border-radius:6px;">
                    <div style="width:20px;height:20px;border:2px solid #dc2626;border-radius:3px;flex-shrink:0;"></div>
                    <span style="font-size:12px;">从炉顶吊装进炉（Y轴方向）</span>
                </div>
                <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#fff;border:1px solid #fca5a5;border-radius:6px;">
                    <div style="width:20px;height:20px;border:2px solid #dc2626;border-radius:3px;flex-shrink:0;"></div>
                    <span style="font-size:12px;">其他方向（见备注）</span>
                </div>
            </div>
            <div style="font-size:11px;color:#64748b;">备注 / Remarks：_______________________________________________________________________</div>
        </div>
    </div>`;

    html += `
    <div style="border-top:2px solid #e2e8f0;padding-top:20px;margin-top:10px;">
        <div style="font-size:13px;font-weight:bold;margin-bottom:14px;">审批签字区</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;">
            <div style="border:1px solid #cbd5e1;border-radius:6px;padding:14px;text-align:center;">
                <div style="font-size:11px;color:#64748b;margin-bottom:36px;">工艺负责人<br>Process Engineer</div>
                <div style="border-top:1px solid #94a3b8;padding-top:6px;font-size:10px;color:#94a3b8;">签名 / 日期</div>
            </div>
            <div style="border:1px solid #cbd5e1;border-radius:6px;padding:14px;text-align:center;">
                <div style="font-size:11px;color:#64748b;margin-bottom:36px;">装炉方案负责人<br>Loading Plan Manager</div>
                <div style="border-top:1px solid #94a3b8;padding-top:6px;font-size:10px;color:#94a3b8;">签名 / 日期</div>
            </div>
            <div style="border:1px solid #cbd5e1;border-radius:6px;padding:14px;text-align:center;">
                <div style="font-size:11px;color:#64748b;margin-bottom:36px;">批准人<br>Approved by</div>
                <div style="border-top:1px solid #94a3b8;padding-top:6px;font-size:10px;color:#94a3b8;">签名 / 日期</div>
            </div>
        </div>
    </div>`;

    page.innerHTML = html;
    pdfWrapper.appendChild(page);
}

// ==================== WORKLIST PAGE ====================

/**
 * Create a detailed workpiece list page with 3D coordinates.
 */
export function createWorklistPage({ pdfWrapper, furnace }) {
    const page = document.createElement('div');
    page.className = 'pdf-page';
    page.style.cssText = 'position:relative;width:794px;min-height:1123px;background:#fff;padding:40px;box-sizing:border-box;font-family:Arial,sans-serif;';

    let html = `
    <div style="border-bottom:3px solid #0066cc;padding-bottom:12px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-end;">
        <div>
            <div style="font-size:20px;font-weight:bold;color:#0f172a;">工件清单（基于料框三维坐标）</div>
            <div style="font-size:11px;color:#64748b;margin-top:4px;">Workpiece List with 3D Frame Coordinates · 炉次：${furnace.instanceId}</div>
        </div>
        <div style="text-align:right;font-size:11px;color:#64748b;">共 ${furnace.packedItems.length} 件</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
            <tr style="background:#eff6ff;">
                <th style="border:1px solid #bfdbfe;padding:7px 6px;text-align:center;width:30px;">#</th>
                <th style="border:1px solid #bfdbfe;padding:7px 6px;text-align:left;">工件名称</th>
                <th style="border:1px solid #bfdbfe;padding:7px 6px;text-align:center;">形态</th>
                <th style="border:1px solid #bfdbfe;padding:7px 6px;text-align:center;">尺寸 (mm)</th>
                <th style="border:1px solid #bfdbfe;padding:7px 6px;text-align:center;">重量 (kg)</th>
                <th style="border:1px solid #bfdbfe;padding:7px 6px;text-align:center;">X 坐标</th>
                <th style="border:1px solid #bfdbfe;padding:7px 6px;text-align:center;">Y 坐标</th>
                <th style="border:1px solid #bfdbfe;padding:7px 6px;text-align:center;">Z 坐标</th>
            </tr>
        </thead>
        <tbody>
    `;
    furnace.packedItems.forEach((item, i) => {
        const dimStr = item.shape === 'cylinder' ? `⌀${item.w}×H${item.h}` : `${item.w}×${item.h}×${item.d}`;
        const bg = i % 2 === 0 ? '#fff' : '#f8fafc';
        html += `<tr style="background:${bg};">
            <td style="border:1px solid #bfdbfe;padding:6px;text-align:center;color:#64748b;">${i+1}</td>
            <td style="border:1px solid #bfdbfe;padding:6px;font-weight:bold;">
                <span style="display:inline-block;width:10px;height:10px;background:${item.color};border-radius:2px;margin-right:5px;vertical-align:middle;"></span>${item.name}
            </td>
            <td style="border:1px solid #bfdbfe;padding:6px;text-align:center;">${item.shape==='cylinder'?'圆柱':'立方'}</td>
            <td style="border:1px solid #bfdbfe;padding:6px;text-align:center;">${dimStr}</td>
            <td style="border:1px solid #bfdbfe;padding:6px;text-align:center;">${item.weight.toFixed(1)}</td>
            <td style="border:1px solid #bfdbfe;padding:6px;text-align:center;font-family:monospace;">${Math.round(item.x)}</td>
            <td style="border:1px solid #bfdbfe;padding:6px;text-align:center;font-family:monospace;">${Math.round(item.y)}</td>
            <td style="border:1px solid #bfdbfe;padding:6px;text-align:center;font-family:monospace;">${Math.round(item.z)}</td>
        </tr>`;
    });
    html += `</tbody></table>
    <div style="margin-top:14px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:10px;color:#64748b;">
        <strong>坐标说明：</strong>X/Y/Z 坐标为工件在炉膛料框内的起始角坐标（mm），原点为炉膛左下前角。Y轴为垂直方向（高度），X轴为宽度方向，Z轴为纵深方向。此坐标数据供机械臂摆料系统使用。
    </div>`;

    page.innerHTML = html;
    pdfWrapper.appendChild(page);
}

// ==================== UNPACKED ITEMS PAGE ====================

/**
 * Create a page listing unpacked items.
 */
export function createUnpackedItemsPage({ pdfWrapper, unpackedItems }) {
    const page = document.createElement('div');
    page.className = 'pdf-page';
    page.style.cssText = 'position:relative;width:794px;min-height:1123px;background:#fff;padding:40px;box-sizing:border-box;font-family:Arial,sans-serif;';

    const summary = {};
    const materialMap = new Map();
    document.querySelectorAll('.material-card').forEach(card => {
        const d = getMaterialDataFromCard(card);
        if (!materialMap.has(d.name)) materialMap.set(d.name, d);
    });
    unpackedItems.forEach(item => {
        if (!summary[item.name]) summary[item.name] = { count: 0, item };
        summary[item.name].count++;
    });

    let html = `
    <div style="border-bottom:3px solid #dc2626;padding-bottom:12px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-end;">
        <div>
            <div style="font-size:20px;font-weight:bold;color:#dc2626;">⚠️ 未装炉工件清单</div>
            <div style="font-size:11px;color:#64748b;margin-top:4px;">Unloaded Workpiece List · 因炉膛容量不足，以下工件未能纳入本次装炉方案</div>
        </div>
        <div style="text-align:right;font-size:11px;color:#dc2626;font-weight:bold;">共 ${unpackedItems.length} 件未装炉</div>
    </div>
    <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px;margin-bottom:16px;font-size:11px;color:#dc2626;">
        <strong>注意：</strong>以下工件因炉膛空间或承重限制无法纳入当前装炉方案，请安排后续炉次或调整装炉策略。
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
            <tr style="background:#fef2f2;">
                <th style="border:1px solid #fca5a5;padding:8px;text-align:left;">工件名称</th>
                <th style="border:1px solid #fca5a5;padding:8px;text-align:center;">形态</th>
                <th style="border:1px solid #fca5a5;padding:8px;text-align:center;">尺寸 (mm)</th>
                <th style="border:1px solid #fca5a5;padding:8px;text-align:center;">材质</th>
                <th style="border:1px solid #fca5a5;padding:8px;text-align:center;">工艺</th>
                <th style="border:1px solid #fca5a5;padding:8px;text-align:center;">未装数量</th>
                <th style="border:1px solid #fca5a5;padding:8px;text-align:center;">单件重量 (kg)</th>
            </tr>
        </thead>
        <tbody>
    `;

    Object.entries(summary).forEach(([name, { count, item }], i) => {
        const d = materialMap.get(name) || {};
        const dimStr = item.shape === 'cylinder' ? `⌀${item.w}×H${item.h}` : `${item.w}×${item.h}×${item.d}`;
        const bg = i % 2 === 0 ? '#fff' : '#fff5f5';
        html += `<tr style="background:${bg};">
            <td style="border:1px solid #fca5a5;padding:8px;font-weight:bold;">
                <span style="display:inline-block;width:10px;height:10px;background:${item.color};border-radius:2px;margin-right:5px;vertical-align:middle;"></span>${name}
            </td>
            <td style="border:1px solid #fca5a5;padding:8px;text-align:center;">${item.shape==='cylinder'?'圆柱':'立方'}</td>
            <td style="border:1px solid #fca5a5;padding:8px;text-align:center;">${dimStr}</td>
            <td style="border:1px solid #fca5a5;padding:8px;text-align:center;">${d.material || '—'}</td>
            <td style="border:1px solid #fca5a5;padding:8px;text-align:center;">${d.process || '—'}</td>
            <td style="border:1px solid #fca5a5;padding:8px;text-align:center;font-weight:bold;color:#dc2626;">${count}</td>
            <td style="border:1px solid #fca5a5;padding:8px;text-align:center;">${item.weight.toFixed(1)}</td>
        </tr>`;
    });

    html += `</tbody></table>
    <div style="margin-top:20px;padding:14px;border:1px dashed #fca5a5;border-radius:6px;">
        <div style="font-size:12px;font-weight:bold;margin-bottom:8px;color:#dc2626;">处理建议</div>
        <div style="font-size:11px;color:#64748b;line-height:1.8;">
            □ 安排下一炉次处理上述工件<br>
            □ 调整炉膛配置（增加炉膛台数或更换更大炉膛）<br>
            □ 拆分工件批次，分多炉处理<br>
            □ 其他处理方案：_______________________________________________
        </div>
    </div>
    <div style="margin-top:20px;border-top:1px solid #e2e8f0;padding-top:16px;display:grid;grid-template-columns:repeat(2,1fr);gap:20px;">
        <div style="border:1px solid #cbd5e1;border-radius:6px;padding:14px;text-align:center;">
            <div style="font-size:11px;color:#64748b;margin-bottom:36px;">工艺负责人确认<br>Process Engineer</div>
            <div style="border-top:1px solid #94a3b8;padding-top:6px;font-size:10px;color:#94a3b8;">签名 / 日期</div>
        </div>
        <div style="border:1px solid #cbd5e1;border-radius:6px;padding:14px;text-align:center;">
            <div style="font-size:11px;color:#64748b;margin-bottom:36px;">生产调度确认<br>Production Scheduler</div>
            <div style="border-top:1px solid #94a3b8;padding-top:6px;font-size:10px;color:#94a3b8;">签名 / 日期</div>
        </div>
    </div>`;

    page.innerHTML = html;
    pdfWrapper.appendChild(page);
}

// ==================== JSON EXPORT ====================

/**
 * Export furnace data as a JSON file (master plan format).
 */
export function exportFurnaceJSON(furnaceIndex) {
    const furnace = globalFurnacesResult[furnaceIndex];
    const materialMap = new Map();
    document.querySelectorAll('.material-card').forEach(card => {
        const d = getMaterialDataFromCard(card);
        if (!materialMap.has(d.name)) materialMap.set(d.name, d);
    });

    const addedNames = new Set();
    const materialsArr = [];
    furnace.packedItems.forEach(item => {
        if (addedNames.has(item.name)) return;
        addedNames.add(item.name);
        const d = materialMap.get(item.name) || {};
        const count = furnace.packedItems.filter(p => p.name === item.name).length;
        materialsArr.push({
            name: item.name,
            shape: item.shape,
            dim1: item.w,
            dim2: item.shape === 'cylinder' ? item.w : item.d,
            dim3: item.h,
            count,
            weight: item.weight * count,
            color: item.color,
            material: d.material || '',
            process: d.process || '',
            hardness: d.hardness || '',
            remark: d.remark || ''
        });
    });

    const totalItemVolume = furnace.packedItems.reduce((acc, c) => acc + c.w * c.h * c.d, 0);
    const furnaceVolume = furnace.w * furnace.h * furnace.d;
    const spaceUtilizationPercent = furnaceVolume > 0 ? ((totalItemVolume / furnaceVolume) * 100).toFixed(1) : '0.0';

    let placementRuleName = '默认异构空间填充算法';
    if (placementRules.useShelfLayered) placementRuleName = '搁板分层平铺算法';
    else if (placementRules.centerOfGravity) placementRuleName = '重心居中算法';

    const items = furnace.packedItems.map((item, i) => ({
        id: item.id || `${item.name}_${i}`,
        name: item.name,
        shape: item.shape,
        position: {
            x: Math.round(item.x),
            y: Math.round(item.y),
            z: Math.round(item.z)
        },
        dimensions: {
            l: item.w,
            w: item.d,
            h: item.h
        },
        weight: item.weight,
        rotation: 0,
        color: item.color,
        seq: i + 1
    }));

    const metadata = {
        planName: `${furnace.instanceId} 装炉方案`,
        placementRule: placementRuleName,
        totalWeight: parseFloat(furnace.totalWeight.toFixed(2)),
        spaceUtilization: spaceUtilizationPercent + '%',
        totalItems: furnace.packedItems.length,
        maxWeight: furnace.max_weight,
        furnaceDimensions: {
            width: furnace.w,
            height: furnace.h,
            depth: furnace.d
        },
        date: new Date().toISOString().slice(0, 10),
        operator: '热处理预装炉智能体'
    };

    const jsonData = {
        metadata,
        items,
        title: metadata.planName,
        tag: 'best',
        tagLabel: '智能生成方案',
        date: metadata.date,
        operator: metadata.operator,
        approver: '',
        furnace: {
            name: furnace.typeName || furnace.instanceId.split('(')[0].trim(),
            width: furnace.w,
            height: furnace.h,
            depth: furnace.d,
            maxWeight: furnace.max_weight
        },
        placementRules: {
            gravity: placementRules.gravity,
            dense: placementRules.dense,
            sameMaterial: placementRules.sameMaterial,
            sameProcess: placementRules.sameProcess,
            minSpacing: placementRules.minSpacing,
            wallSpacing: placementRules.wallSpacing,
            rotate: placementRules.rotate,
            weightMargin: placementRules.weightMargin,
            balance: placementRules.balance,
            sortStrategy: placementRules.sortStrategy,
            useShelfLayered: !!placementRules.useShelfLayered,
            centerOfGravity: !!placementRules.centerOfGravity
        },
        materials: materialsArr,
        packedPositions: items,
        stats: {
            totalItems: furnace.packedItems.length,
            totalWeight: furnace.totalWeight,
            spaceUtilization: spaceUtilizationPercent + '%'
        }
    };

    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `装炉方案_${furnace.instanceId.replace(/[^\w\u4e00-\u9fa5]/g,'_')}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// ==================== PDF SELECT MODAL ====================

/**
 * Show the PDF furnace selection modal.
 */
export function showPdfSelectModal() {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return;
    const list = document.getElementById('pdf-furnace-list');
    list.innerHTML = '';

    const unpackedWarning = document.getElementById('pdf-unpacked-warning');
    if (globalUnpackedItems.length > 0) {
        const summary = {};
        globalUnpackedItems.forEach(u => { summary[u.name] = (summary[u.name] || 0) + 1; });
        unpackedWarning.style.display = 'block';
        unpackedWarning.innerHTML = `<strong>⚠️ 有 ${globalUnpackedItems.length} 件工件无法装入当前炉膛：</strong><br>
            ${Object.entries(summary).map(([k,v]) => `${k}×${v}`).join(' · ')}<br>
            <span style="color:#ffaaaa;font-size:10px;margin-top:4px;display:block;">导出PDF时将自动附加「未装炉工件清单」页面</span>`;
    } else {
        unpackedWarning.style.display = 'none';
    }

    globalFurnacesResult.forEach((f, idx) => {
        const totalVol = f.w * f.h * f.d;
        const packedVol = f.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
        const div = document.createElement('div');
        div.className = 'pdf-furnace-option' + (idx === currentFurnaceIndex ? ' selected' : '');
        div.innerHTML = `
            <input type="radio" name="pdf-furnace" value="${idx}" ${idx===currentFurnaceIndex?'checked':''}>
            <div>
                <div class="pfo-name">${f.instanceId}</div>
                <div class="pfo-meta">${f.packedItems.length}件 · ${f.totalWeight.toFixed(1)}kg · 利用率${((packedVol/totalVol)*100).toFixed(1)}%</div>
            </div>
        `;
        div.addEventListener('click', () => {
            document.querySelectorAll('.pdf-furnace-option').forEach(o => o.classList.remove('selected'));
            div.classList.add('selected');
            div.querySelector('input[type="radio"]').checked = true;
        });
        list.appendChild(div);
    });
    document.getElementById('pdf-select-overlay').style.display = 'flex';
}

/**
 * Export a single furnace's PDF report.
 */
export function exportSingleFurnacePDF(furnaceIndex, options) {
    const furnace = globalFurnacesResult[furnaceIndex];
    const pdfWrapper = document.getElementById('pdf-hidden-template');
    pdfWrapper.innerHTML = '';

    if (options.exportJson) {
        exportFurnaceJSON(furnaceIndex);
    }

    createFurnaceInfoPage({ pdfWrapper, furnace });

    if (options.worklist) {
        createWorklistPage({ pdfWrapper, furnace });
    }

    if (globalUnpackedItems.length > 0) {
        createUnpackedItemsPage({ pdfWrapper, unpackedItems: globalUnpackedItems });
    }

    pdfWrapper.style.display = 'block';
    const opt = {
        margin: 0,
        filename: `装炉方案_${furnace.instanceId.replace(/[^\w\u4e00-\u9fa5]/g,'_')}_${Date.now()}.pdf`,
        image: { type: 'jpeg', quality: 1 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'px', format: [794, 1123], orientation: 'portrait' }
    };
    html2pdf().set(opt).from(pdfWrapper).save().then(() => { pdfWrapper.style.display = 'none'; });
}