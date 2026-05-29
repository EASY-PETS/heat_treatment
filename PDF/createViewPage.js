// ==================== 工业视图页面生成模块 ====================

import { createEngineeringRuler, createEntryDirectionIndicator, createFurnaceDoorMarker, createSequenceBadge } from './ruler.js';
import { createMaterialLegend, createPlacementSequenceTable, createSignatureBlock, createSafetyNotice } from './legend.js';

/**
 * 创建单个炉次的详细视图页面（含2.5D等轴测图 + 三视图 + 图例 + 放置顺序表）
 * 针对A4横向页面优化设计
 * @param {Object} options
 * @param {HTMLElement} options.pdfWrapper - PDF容器
 * @param {Object} options.furnace - 炉膛数据
 * @param {Object} options.viewConfigs - 视图配置
 * @param {number} options.globalSeqStart - 全局序号起始值
 * @param {string} options.furnaceEntryDirection - 进炉方向描述
 * @returns {number} 下一个全局序号
 */
export function createFurnaceDetailPage({ pdfWrapper, furnace, viewConfigs, globalSeqStart = 1, furnaceEntryDirection = '从炉门侧(顶视图下方)沿Z轴推入' }) {
    // --- 第1页: 2.5D等轴测图 + 三视图概览 ---
    createOverviewPage({ pdfWrapper, furnace, viewConfigs, globalSeqStart, furnaceEntryDirection });
    
    // --- 第2页: 三视图详细版 + 图例 + 放置顺序表 ---
    return createDetailPage({ pdfWrapper, furnace, viewConfigs, globalSeqStart, furnaceEntryDirection });
}

/**
 * 第1页: 2.5D等轴测全景图 + 三视图概览
 */
function createOverviewPage({ pdfWrapper, furnace, viewConfigs, globalSeqStart, furnaceEntryDirection }) {
    const page = document.createElement('div');
    page.className = 'pdf-page';
    page.style.position = 'relative';
    page.style.width = '1122px';
    page.style.minHeight = '793px';
    page.style.background = '#ffffff';
    page.style.padding = '25px 30px';
    page.style.boxSizing = 'border-box';
    page.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    page.style.overflow = 'hidden';
    
    const furnaceW = furnace.w;
    const furnaceH = furnace.h;
    const furnaceD = furnace.d;
    const totalWeight = furnace.totalWeight;
    const itemCount = furnace.packedItems.length;
    const maxWeight = furnace.maxWeight;
    const weightUtilization = ((totalWeight / maxWeight) * 100).toFixed(1);
    
    const totalVol = furnaceW * furnaceH * furnaceD;
    let packedVol = 0;
    furnace.packedItems.forEach(item => { packedVol += item.w * item.h * item.d; });
    const volUtilization = ((packedVol / totalVol) * 100).toFixed(1);
    
    // 2.5D等轴测图尺寸（大幅面）
    const isoWidth = 650;
    const isoHeight = 500;
    // 三视图概览尺寸
    const miniViewW = 200;
    const miniViewH = 160;
    
    let html = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #0066cc; padding-bottom:10px; margin-bottom:14px;">
            <div>
                <div style="font-size:22px; font-weight:800; color:#0f172a;">${furnace.instanceId} - 装炉2.5D等轴测全景</div>
                <div style="font-size:11px; color:#64748b;">Isometric Overview & Loading Direction | 炉膛尺寸: ${Math.round(furnaceW)}×${Math.round(furnaceH)}×${Math.round(furnaceD)} mm</div>
            </div>
            <div style="text-align:right; font-size:11px; color:#475569; line-height:1.7;">
                <div>工件数量: <b style="color:#0f172a;">${itemCount}</b> 件</div>
                <div>总重量: <b style="color:#0f172a;">${totalWeight.toFixed(1)}</b> / ${maxWeight} kg (${weightUtilization}%)</div>
                <div>空间利用率: <b style="color:${volUtilization > 70 ? '#16a34a' : '#e67e22'};">${volUtilization}%</b></div>
            </div>
        </div>
        
        <div style="background:#fef3c7; border:1px solid #f59e0b; border-radius:4px; padding:5px 12px; margin-bottom:12px; font-size:12px; display:flex; align-items:center; gap:8px;">
            <span style="font-size:16px;">🔥</span>
            <span style="font-weight:bold; color:#92400e;">进炉方向:</span>
            <span style="color:#78350f;">${furnaceEntryDirection}</span>
        </div>
        
        <div style="display:flex; gap:15px;">
            <!-- 左侧: 2.5D等轴测图 -->
            <div style="border:2px solid #0f172a; border-radius:4px; padding:8px; background:#f8fafc; flex:0 0 ${isoWidth}px;">
                <div style="font-size:13px; font-weight:700; color:#0f172a; text-align:center; margin-bottom:6px;">📐 2.5D 等轴测透视图 (右上前方俯视)</div>
                <div style="position:relative; width:${isoWidth - 20}px; height:${isoHeight - 20}px; border:1px solid #94a3b8; background:#fff; margin:0 auto; overflow:hidden;">
                    ${createIsometricViewSVG(furnace, isoWidth - 20, isoHeight - 20)}
                </div>
                <div style="text-align:center; font-size:10px; color:#64748b; margin-top:4px;">🔴 红色箭头 = 进炉方向 &nbsp;|&nbsp; 等轴测30°投影</div>
            </div>
            
            <!-- 右侧: 三视图概览 + 图例 -->
            <div style="flex:1; display:flex; flex-direction:column; gap:12px;">
                ${createMiniView(furnace, 'top', miniViewW, miniViewH, globalSeqStart)}
                ${createMiniView(furnace, 'front', miniViewW, miniViewH, globalSeqStart)}
                ${createMiniView(furnace, 'side', miniViewW, miniViewH, globalSeqStart)}
                <div style="border:1px solid #94a3b8; border-radius:3px; padding:6px; background:#f8fafc; flex:1;">
                    <div style="font-size:11px; font-weight:700; color:#0f172a; margin-bottom:4px;">📋 物料图例</div>
                    <div style="font-size:9px; max-height:160px; overflow-y:auto;">
                        ${createCompactLegend(furnace.packedItems)}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    page.innerHTML = html;
    pdfWrapper.appendChild(page);
}

/**
 * 第2页: 三视图详细版 + 放置顺序表
 */
function createDetailPage({ pdfWrapper, furnace, viewConfigs, globalSeqStart, furnaceEntryDirection }) {
    const page = document.createElement('div');
    page.className = 'pdf-page';
    page.style.position = 'relative';
    page.style.width = '1122px';
    page.style.minHeight = '793px';
    page.style.background = '#ffffff';
    page.style.padding = '25px 30px';
    page.style.boxSizing = 'border-box';
    page.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    page.style.overflow = 'hidden';
    
    const furnaceW = furnace.w;
    const furnaceH = furnace.h;
    const furnaceD = furnace.d;
    const totalWeight = furnace.totalWeight;
    const itemCount = furnace.packedItems.length;
    const maxWeight = furnace.maxWeight;
    const weightUtilization = ((totalWeight / maxWeight) * 100).toFixed(1);
    
    const totalVol = furnaceW * furnaceH * furnaceD;
    let packedVol = 0;
    furnace.packedItems.forEach(item => { packedVol += item.w * item.h * item.d; });
    const volUtilization = ((packedVol / totalVol) * 100).toFixed(1);
    
    // 三视图尺寸（大幅面，最大化利用A4横向空间）
    // A4横向可用约1062x733 (减padding后约1062x683)
    // 布局: 顶视图和正视图并排占上半部分, 侧视图占下半部分
    const bigViewW = 500;
    const bigViewH = 280;
    const sideViewW = 500;
    const sideViewH = 280;
    
    // 缩放因子
    const topScale = Math.min((bigViewW - 60) / furnaceW, (bigViewH - 60) / furnaceD);
    const frontScale = Math.min((bigViewW - 60) / furnaceW, (bigViewH - 60) / furnaceH);
    const sideScale = Math.min((sideViewW - 60) / furnaceD, (sideViewH - 60) / furnaceH);
    
    let html = `
        <div style="border-bottom:2px solid #0066cc; padding-bottom:8px; margin-bottom:12px;">
            <div style="font-size:20px; font-weight:800; color:#0f172a;">${furnace.instanceId} - 三视图详细工艺卡</div>
            <div style="font-size:10px; color:#64748b;">Three-View Engineering Drawing | ${Math.round(furnaceW)}×${Math.round(furnaceH)}×${Math.round(furnaceD)} mm | 工件${itemCount}件 | ${totalWeight.toFixed(1)}/${maxWeight}kg (${weightUtilization}%)</div>
        </div>
        
        <div style="display:flex; gap:14px; margin-bottom:12px;">
    `;
    
    // ---- 顶视图 (X-Z) ----
    html += `
        <div style="border:1px solid #94a3b8; border-radius:4px; padding:6px; background:#f8fafc;">
            <div style="font-size:12px; font-weight:700; color:#0f172a; text-align:center; margin-bottom:4px;">📐 顶视图 (X-Z) 俯视 - 炉门方向 ↓</div>
            <div style="position:relative; width:${bigViewW}px; height:${bigViewH}px; border:2px solid #0f172a; background:#fff; overflow:hidden; margin:0 auto;">
    `;
    
    const topOffsetX = (bigViewW - furnaceW * topScale) / 2;
    const topOffsetY = (bigViewH - furnaceD * topScale) / 2;
    
    html += createEngineeringRuler(bigViewW, bigViewH, topScale, 'X(宽)', 'Z(深)', furnaceW, furnaceD);
    html += createFurnaceDoorMarker(bigViewW, bigViewH, topScale, furnaceW);
    html += createEntryDirectionIndicator(bigViewW, bigViewH, topScale, furnaceW, furnaceD, 'bottom');
    
    furnace.packedItems.forEach((item, idx) => {
        const x = topOffsetX + item.x * topScale;
        const y = topOffsetY + item.z * topScale;
        const w = item.w * topScale;
        const h = item.d * topScale;
        const fontSize = Math.max(9, Math.min(14, w / 4));
        const seqNum = globalSeqStart + idx;
        
        html += `<div style="position:absolute; left:${x + 1}px; top:${y + 1}px; width:${w - 2}px; height:${h - 2}px; background:${item.color}; border:1.5px solid #1e293b; display:flex; align-items:center; justify-content:center; font-size:${fontSize}px; font-weight:900; color:#000; overflow:hidden; text-align:center; text-shadow:0 0 2px #fff; opacity:0.82; box-sizing:border-box;">${item.name}</div>`;
        html += createSequenceBadge(x, y, w, h, seqNum);
    });
    html += `</div></div>`;
    
    // ---- 正视图 (X-Y) ----
    html += `
        <div style="border:1px solid #94a3b8; border-radius:4px; padding:6px; background:#f8fafc;">
            <div style="font-size:12px; font-weight:700; color:#0f172a; text-align:center; margin-bottom:4px;">📐 正视图 (X-Y) 正视 - 炉门方向 →</div>
            <div style="position:relative; width:${bigViewW}px; height:${bigViewH}px; border:2px solid #0f172a; background:#fff; overflow:hidden; margin:0 auto;">
    `;
    
    const frontOffsetX = (bigViewW - furnaceW * frontScale) / 2;
    const frontOffsetY = (bigViewH - furnaceH * frontScale) / 2;
    
    html += createEngineeringRuler(bigViewW, bigViewH, frontScale, 'X(宽)', 'Y(高)', furnaceW, furnaceH);
    
    furnace.packedItems.forEach((item, idx) => {
        const x = frontOffsetX + item.x * frontScale;
        const y = frontOffsetY + (furnaceH - item.y - item.h) * frontScale;
        const w = item.w * frontScale;
        const h = item.h * frontScale;
        const fontSize = Math.max(9, Math.min(14, w / 4));
        const seqNum = globalSeqStart + idx;
        
        html += `<div style="position:absolute; left:${x + 1}px; top:${y + 1}px; width:${w - 2}px; height:${h - 2}px; background:${item.color}; border:1.5px solid #1e293b; display:flex; align-items:center; justify-content:center; font-size:${fontSize}px; font-weight:900; color:#000; overflow:hidden; text-align:center; text-shadow:0 0 2px #fff; opacity:0.82; box-sizing:border-box;">${item.name}</div>`;
        html += createSequenceBadge(x, y, w, h, seqNum);
    });
    html += `</div></div>`;
    
    html += `</div>`;  // 关闭flex容器
    
    // 第二行: 侧视图 + 放置顺序表
    html += `<div style="display:flex; gap:14px;">
        <div style="flex:0 0 ${sideViewW}px; border:1px solid #94a3b8; border-radius:4px; padding:6px; background:#f8fafc;">
            <div style="font-size:12px; font-weight:700; color:#0f172a; text-align:center; margin-bottom:4px;">📐 侧视图 (Z-Y) 侧视</div>
            <div style="position:relative; width:${sideViewW}px; height:${sideViewH}px; border:2px solid #0f172a; background:#fff; overflow:hidden; margin:0 auto;">
    `;
    
    const sideOffsetX = (sideViewW - furnaceD * sideScale) / 2;
    const sideOffsetY = (sideViewH - furnaceH * sideScale) / 2;
    
    html += createEngineeringRuler(sideViewW, sideViewH, sideScale, 'Z(深)', 'Y(高)', furnaceD, furnaceH);
    
    furnace.packedItems.forEach((item, idx) => {
        const x = sideOffsetX + item.z * sideScale;
        const y = sideOffsetY + (furnaceH - item.y - item.h) * sideScale;
        const w = item.d * sideScale;
        const h = item.h * sideScale;
        const fontSize = Math.max(9, Math.min(14, w / 4));
        const seqNum = globalSeqStart + idx;
        
        html += `<div style="position:absolute; left:${x + 1}px; top:${y + 1}px; width:${w - 2}px; height:${h - 2}px; background:${item.color}; border:1.5px solid #1e293b; display:flex; align-items:center; justify-content:center; font-size:${fontSize}px; font-weight:900; color:#000; overflow:hidden; text-align:center; text-shadow:0 0 2px #fff; opacity:0.82; box-sizing:border-box;">${item.name}</div>`;
        html += createSequenceBadge(x, y, w, h, seqNum);
    });
    html += `</div></div>`;
    
    // 放置顺序表
    html += `<div style="flex:1; min-width:0;">
        <div style="font-size:12px; font-weight:700; color:#0f172a; border-left:4px solid #e67e22; padding-left:8px; margin-bottom:6px;">🔢 装炉放置顺序表（按高度从低到高排列）</div>
        ${createPlacementSequenceTable(furnace.packedItems)}
    </div></div>`;
    
    // 图例
    html += `<div style="margin-top:10px;">
        <div style="font-size:12px; font-weight:700; color:#0f172a; border-left:4px solid #0066cc; padding-left:8px; margin-bottom:6px;">📋 物料详细图例</div>
        ${createMaterialLegend(furnace.packedItems)}
    </div>`;
    
    // 安全提示 + 签名
    html += createSafetyNotice();
    html += createSignatureBlock();
    
    page.innerHTML = html;
    pdfWrapper.appendChild(page);
    
    return globalSeqStart + furnace.packedItems.length;
}

/**
 * 创建缩略三视图（用于概览页右侧）
 */
function createMiniView(furnace, viewType, viewW, viewH, globalSeqStart) {
    const furnaceW = furnace.w;
    const furnaceH = furnace.h;
    const furnaceD = furnace.d;
    
    let drawW, drawD, scale;
    const titleMap = { top: '顶视图 (X-Z)', front: '正视图 (X-Y)', side: '侧视图 (Z-Y)' };
    
    if (viewType === 'top') {
        drawW = furnaceW; drawD = furnaceD;
    } else if (viewType === 'front') {
        drawW = furnaceW; drawD = furnaceH;
    } else {
        drawW = furnaceD; drawD = furnaceH;
    }
    
    scale = Math.min((viewW - 30) / drawW, (viewH - 30) / drawD);
    
    const offsetX = (viewW - drawW * scale) / 2;
    const offsetY = (viewH - drawD * scale) / 2;
    
    let contentHtml = '';
    
    furnace.packedItems.forEach((item, idx) => {
        let x, y, w, h;
        if (viewType === 'top') {
            x = offsetX + item.x * scale;
            y = offsetY + item.z * scale;
            w = item.w * scale;
            h = item.d * scale;
        } else if (viewType === 'front') {
            x = offsetX + item.x * scale;
            y = offsetY + (furnaceH - item.y - item.h) * scale;
            w = item.w * scale;
            h = item.h * scale;
        } else {
            x = offsetX + item.z * scale;
            y = offsetY + (furnaceH - item.y - item.h) * scale;
            w = item.d * scale;
            h = item.h * scale;
        }
        
        const fontSize = Math.max(7, Math.min(10, w / 4));
        
        contentHtml += `<div style="position:absolute; left:${Math.max(1, x + 1)}px; top:${Math.max(1, y + 1)}px; width:${Math.max(1, w - 2)}px; height:${Math.max(1, h - 2)}px; background:${item.color}; border:1px solid #1e293b; display:flex; align-items:center; justify-content:center; font-size:${fontSize}px; font-weight:900; color:#000; overflow:hidden; text-align:center; text-shadow:0 0 2px #fff; opacity:0.82; box-sizing:border-box;">${idx + 1}</div>`;
    });
    
    return `
        <div style="border:1px solid #94a3b8; border-radius:3px; padding:4px; background:#f8fafc;">
            <div style="font-size:10px; font-weight:700; color:#0f172a; text-align:center; margin-bottom:2px;">${titleMap[viewType]}</div>
            <div style="position:relative; width:${viewW}px; height:${viewH}px; border:1px solid #0f172a; background:#fff; overflow:hidden; margin:0 auto;">
                ${contentHtml}
            </div>
        </div>
    `;
}

/**
 * 创建紧凑版物料图例
 */
function createCompactLegend(packedItems) {
    const legendMap = new Map();
    packedItems.forEach(item => {
        if (!legendMap.has(item.name)) {
            legendMap.set(item.name, { color: item.color, count: 0, shape: item.shape, w: item.w, h: item.h, d: item.d });
        }
        legendMap.get(item.name).count++;
    });
    
    let html = '';
    legendMap.forEach((info, name) => {
        html += `<div style="display:flex; align-items:center; gap:6px; padding:2px 0; font-size:10px;">
            <div style="width:14px; height:14px; background:${info.color}; border:1px solid #000; border-radius:${info.shape === 'cylinder' ? '50%' : '2px'}; flex-shrink:0;"></div>
            <span style="font-weight:bold;">${name}</span> <span style="color:#94a3b8;">×${info.count}</span>
        </div>`;
    });
    return html;
}

/**
 * 创建2.5D等轴测SVG视图
 */
function createIsometricViewSVG(furnace, canvasW, canvasH) {
    const isoScale = 0.65;
    const angle = Math.PI / 6;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    
    const originX = canvasW / 2 - 50;
    const originY = canvasH / 2 + 50;
    
    function toIso(x3d, y3d, z3d) {
        const px = originX + (x3d - z3d) * cosA * isoScale;
        const py = originY - y3d * isoScale + (x3d + z3d) * sinA * isoScale;
        return { x: px, y: py };
    }
    
    // 炉膛8个顶点
    const p000 = toIso(0, 0, 0);
    const pw00 = toIso(furnace.w, 0, 0);
    const p0d0 = toIso(0, 0, furnace.d);
    const pwd0 = toIso(furnace.w, 0, furnace.d);
    const p00h = toIso(0, furnace.h, 0);
    const pw0h = toIso(furnace.w, furnace.h, 0);
    const p0dh = toIso(0, furnace.h, furnace.d);
    const pwdh = toIso(furnace.w, furnace.h, furnace.d);
    
    let svgHtml = `
        <svg style="position:absolute; left:0; top:0; width:${canvasW}px; height:${canvasH}px; pointer-events:none; z-index:1;" xmlns="http://www.w3.org/2000/svg">
            <!-- 底面虚线 -->
            <polygon points="${p000.x},${p000.y} ${pw00.x},${pw00.y} ${pwd0.x},${pwd0.y} ${p0d0.x},${p0d0.y}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6,3"/>
            <!-- 立柱 -->
            <line x1="${p000.x}" y1="${p000.y}" x2="${p00h.x}" y2="${p00h.y}" stroke="#94a3b8" stroke-width="1"/>
            <line x1="${pw00.x}" y1="${pw00.y}" x2="${pw0h.x}" y2="${pw0h.y}" stroke="#94a3b8" stroke-width="1"/>
            <line x1="${p0d0.x}" y1="${p0d0.y}" x2="${p0dh.x}" y2="${p0dh.y}" stroke="#94a3b8" stroke-width="1"/>
            <line x1="${pwd0.x}" y1="${pwd0.y}" x2="${pwdh.x}" y2="${pwdh.y}" stroke="#94a3b8" stroke-width="1"/>
            <!-- 顶面 -->
            <polygon points="${p00h.x},${p00h.y} ${pw0h.x},${pw0h.y} ${pwdh.x},${pwdh.y} ${p0dh.x},${p0dh.y}" fill="none" stroke="#2563eb" stroke-width="2.5"/>
    `;
    
    // 进炉方向箭头（Z轴正方向，从炉门侧进入）
    const arrowBase = toIso(furnace.w / 2, furnace.h * 0.2, furnace.d);
    const arrowTip = toIso(furnace.w / 2, furnace.h * 0.2, furnace.d + 120);
    const arrowLeft = toIso(furnace.w / 2 - 20, furnace.h * 0.2, furnace.d + 80);
    const arrowRight = toIso(furnace.w / 2 + 20, furnace.h * 0.2, furnace.d + 80);
    
    svgHtml += `
        <line x1="${arrowBase.x}" y1="${arrowBase.y}" x2="${arrowTip.x}" y2="${arrowTip.y}" stroke="#ef4444" stroke-width="3" marker-end="url(#arrowHead)"/>
        <polygon points="${arrowTip.x},${arrowTip.y} ${arrowLeft.x},${arrowLeft.y} ${arrowRight.x},${arrowRight.y}" fill="#ef4444" opacity="0.8"/>
        <text x="${arrowBase.x}" y="${arrowBase.y - 15}" text-anchor="middle" font-size="14" font-weight="bold" fill="#ef4444">🔥 进炉方向</text>
        
        <!-- 炉膛尺寸标注 -->
        <text x="${(p00h.x + pw0h.x) / 2}" y="${(p00h.y + pw0h.y) / 2 - 12}" text-anchor="middle" font-size="11" font-weight="bold" fill="#2563eb">W=${Math.round(furnace.w)}</text>
        <text x="${(p00h.x + p0dh.x) / 2 - 20}" y="${(p00h.y + p0dh.y) / 2}" text-anchor="middle" font-size="11" font-weight="bold" fill="#2563eb">D=${Math.round(furnace.d)}</text>
        <text x="${(p00h.x + p000.x) / 2 - 25}" y="${(p00h.y + p000.y) / 2}" text-anchor="middle" font-size="11" font-weight="bold" fill="#2563eb">H=${Math.round(furnace.h)}</text>
        
        <defs>
            <marker id="arrowHead" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
                <polygon points="0,0 10,5 0,10" fill="#ef4444"/>
            </marker>
        </defs>
    </svg>`;
    
    // 工件等轴测投影（按Y从低到高）
    const sortedItems = [...furnace.packedItems].sort((a, b) => a.y - b.y);
    
    sortedItems.forEach((item, idx) => {
        const boxPts = [
            toIso(item.x, item.y, item.z),
            toIso(item.x + item.w, item.y, item.z),
            toIso(item.x, item.y, item.z + item.d),
            toIso(item.x + item.w, item.y, item.z + item.d),
            toIso(item.x, item.y + item.h, item.z),
            toIso(item.x + item.w, item.y + item.h, item.z),
            toIso(item.x, item.y + item.h, item.z + item.d),
            toIso(item.x + item.w, item.y + item.h, item.z + item.d)
        ];
        
        svgHtml += `<svg style="position:absolute; left:0; top:0; width:${canvasW}px; height:${canvasH}px; pointer-events:none; z-index:${idx + 2};" xmlns="http://www.w3.org/2000/svg">
            <polygon points="${boxPts[4].x},${boxPts[4].y} ${boxPts[5].x},${boxPts[5].y} ${boxPts[7].x},${boxPts[7].y} ${boxPts[6].x},${boxPts[6].y}" fill="${item.color}" fill-opacity="0.85" stroke="#1e293b" stroke-width="1.2"/>
        </svg>`;
        
        // 标签
        const cx = (boxPts[4].x + boxPts[5].x + boxPts[7].x + boxPts[6].x) / 4;
        const cy = (boxPts[4].y + boxPts[5].y + boxPts[7].y + boxPts[6].y) / 4;
        svgHtml += `<div style="position:absolute; left:${cx}px; top:${cy}px; transform:translate(-50%,-50%); font-size:10px; font-weight:900; color:#000; text-shadow:0 0 3px #fff, 0 0 3px #fff; z-index:${idx + 3}; pointer-events:none; white-space:nowrap;">${idx + 1}. ${item.name}</div>`;
    });
    
    return svgHtml;
}

/**
 * 创建炉次3D等轴测独立概览页（保留作为公共API）
 */
export function createIsometricOverviewPage({ pdfWrapper, furnace }) {
    const page = document.createElement('div');
    page.className = 'pdf-page';
    page.style.position = 'relative';
    page.style.width = '1122px';
    page.style.minHeight = '793px';
    page.style.background = '#ffffff';
    page.style.padding = '30px 35px';
    page.style.boxSizing = 'border-box';
    
    const canvasW = 900;
    const canvasH = 600;
    
    let html = `
        <div style="border-bottom:3px solid #0066cc; padding-bottom:12px; margin-bottom:16px;">
            <div style="font-size:24px; font-weight:800; color:#0f172a;">${furnace.instanceId} - 3D等轴测装炉透视图</div>
            <div style="font-size:11px; color:#64748b;">Isometric View | 帮助工人理解空间摆放关系</div>
        </div>
        <div style="position:relative; width:${canvasW}px; height:${canvasH}px; border:2px solid #0f172a; margin:0 auto; background:#fafafa; overflow:hidden;">
            ${createIsometricViewSVG(furnace, canvasW, canvasH)}
        </div>
        <div style="text-align:center; font-size:11px; color:#94a3b8; margin-top:8px;">注: 等轴测图仅作空间参考，精确坐标请参阅三视图和放置顺序表</div>
    `;
    
    page.innerHTML = html;
    pdfWrapper.appendChild(page);
}

export default { createFurnaceDetailPage, createIsometricOverviewPage };