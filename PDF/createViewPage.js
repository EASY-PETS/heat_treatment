// ==================== 工业视图页面生成模块 ====================

import { createEngineeringRuler, createEntryDirectionIndicator, createFurnaceDoorMarker, createSequenceBadge } from './ruler.js';
import { createMaterialLegend, createPlacementSequenceTable, createSignatureBlock, createSafetyNotice } from './legend.js';

/**
 * 创建单个炉次的详细视图页面（含顶视图+正视图+侧视图 + 3D等轴测图）
 * @param {Object} options
 * @param {HTMLElement} options.pdfWrapper - PDF容器
 * @param {Object} options.furnace - 炉膛数据
 * @param {Object} options.viewConfigs - 视图配置
 * @param {number} options.globalSeqStart - 全局序号起始值
 * @param {string} options.furnaceEntryDirection - 进炉方向描述
 * @returns {number} 下一个全局序号
 */
export function createFurnaceDetailPage({ pdfWrapper, furnace, viewConfigs, globalSeqStart = 1, furnaceEntryDirection = '从炉门侧(顶视图下方)沿Z轴推入' }) {
    const page = document.createElement('div');
    page.className = 'pdf-page';
    page.style.position = 'relative';
    page.style.width = '1122px';
    page.style.height = '760px';
    page.style.background = '#ffffff';
    page.style.padding = '30px 35px';
    page.style.boxSizing = 'border-box';
    page.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    
    // 计算炉膛关键参数
    const furnaceW = furnace.w;
    const furnaceH = furnace.h;
    const furnaceD = furnace.d;
    const totalWeight = furnace.totalWeight;
    const itemCount = furnace.packedItems.length;
    const maxWeight = furnace.maxWeight;
    const weightUtilization = ((totalWeight / maxWeight) * 100).toFixed(1);
    
    // 计算总体积利用率
    const totalVol = furnaceW * furnaceH * furnaceD;
    let packedVol = 0;
    furnace.packedItems.forEach(item => { packedVol += item.w * item.h * item.d; });
    const volUtilization = ((packedVol / totalVol) * 100).toFixed(1);
    
    // 三个视图的画布尺寸（并排布局）
    const viewWidth = 310;
    const viewHeight = 260;
    const viewGap = 15;
    
    // 各视图缩放因子
    const topScaleXZ = Math.min(
        (viewWidth - 60) / furnaceW,
        (viewHeight - 60) / furnaceD
    );
    const frontScaleXY = Math.min(
        (viewWidth - 60) / furnaceW,
        (viewHeight - 60) / furnaceH
    );
    const sideScaleZY = Math.min(
        (viewWidth - 60) / furnaceD,
        (viewHeight - 60) / furnaceH
    );
    
    // 3D等轴测图尺寸
    const isoWidth = 280;
    const isoHeight = 260;
    
    // 构建页面HTML
    let html = `
        <!-- 页眉 -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #0066cc; padding-bottom:12px; margin-bottom:16px;">
            <div>
                <div style="font-size:22px; font-weight:800; color:#0f172a;">${furnace.instanceId} - 装炉工艺详图</div>
                <div style="font-size:11px; color:#64748b; margin-top:3px;">Furnace Loading Detail Drawing | 工业热处理装炉工艺卡</div>
            </div>
            <div style="text-align:right; font-size:11px; color:#475569; line-height:1.7;">
                <div>工件数量: <b style="color:#0f172a;">${itemCount}</b> 件</div>
                <div>总重量: <b style="color:#0f172a;">${totalWeight.toFixed(1)}</b> / ${maxWeight} kg</div>
                <div>重量利用率: <b style="color:${weightUtilization > 90 ? '#16a34a' : '#e67e22'};">${weightUtilization}%</b></div>
                <div>空间利用率: <b style="color:${volUtilization > 70 ? '#16a34a' : '#e67e22'};">${volUtilization}%</b></div>
            </div>
        </div>
        
        <!-- 进炉方向指示横幅 -->
        <div style="background:#fef3c7; border:1px solid #f59e0b; border-radius:4px; padding:6px 14px; margin-bottom:14px; font-size:13px; display:flex; align-items:center; gap:10px;">
            <span style="font-size:18px;">🔥</span>
            <span style="font-weight:bold; color:#92400e;">进炉方向:</span>
            <span style="color:#78350f;">${furnaceEntryDirection}</span>
            <span style="margin-left:auto; font-size:11px; color:#b45309;">⚠ 装炉前核对炉膛编号: ${furnace.instanceId}</span>
        </div>
        
        <!-- 四视图区域：顶视图 | 正视图 | 侧视图 | 3D等轴测图 -->
        <div style="display:flex; gap:${viewGap}px; margin-bottom:14px; flex-wrap:wrap;">
    `;
    
    // ---- 顶视图 (X-Z) ----
    html += `<div style="border:1px solid #94a3b8; border-radius:4px; padding:6px; background:#f8fafc;">
        <div style="font-size:11px; font-weight:700; color:#0f172a; text-align:center; margin-bottom:4px;">📐 顶视图 (X-Z) 俯视</div>
        <div style="position:relative; width:${viewWidth}px; height:${viewHeight}px; border:1.5px solid #0f172a; background:#fff; overflow:hidden; margin:0 auto;">`;
    
    const topOffsetX = (viewWidth - furnaceW * topScaleXZ) / 2;
    const topOffsetY = (viewHeight - furnaceD * topScaleXZ) / 2;
    
    html += createEngineeringRuler(viewWidth, viewHeight, topScaleXZ, 'X(宽)', 'Z(深)', furnaceW, furnaceD);
    html += createFurnaceDoorMarker(viewWidth, viewHeight, topScaleXZ, furnaceW);
    html += createEntryDirectionIndicator(viewWidth, viewHeight, topScaleXZ, furnaceW, furnaceD, 'bottom');
    
    furnace.packedItems.forEach((item, idx) => {
        const x = topOffsetX + item.x * topScaleXZ;
        const y = topOffsetY + item.z * topScaleXZ;
        const w = item.w * topScaleXZ;
        const h = item.d * topScaleXZ;
        const fontSize = Math.max(8, Math.min(12, w / 5));
        const seqNum = globalSeqStart + idx;
        
        html += `<div style="position:absolute; left:${x + 1}px; top:${y + 1}px; width:${w - 2}px; height:${h - 2}px; background:${item.color}; border:1.5px solid #1e293b; display:flex; align-items:center; justify-content:center; font-size:${fontSize}px; font-weight:900; color:#000; overflow:hidden; text-align:center; text-shadow:0 0 2px #fff; opacity:0.82; box-sizing:border-box; cursor:default;">${item.name}</div>`;
        html += createSequenceBadge(x, y, w, h, seqNum);
    });
    
    html += `</div></div>`;
    
    // ---- 正视图 (X-Y) ----
    html += `<div style="border:1px solid #94a3b8; border-radius:4px; padding:6px; background:#f8fafc;">
        <div style="font-size:11px; font-weight:700; color:#0f172a; text-align:center; margin-bottom:4px;">📐 正视图 (X-Y) 正视</div>
        <div style="position:relative; width:${viewWidth}px; height:${viewHeight}px; border:1.5px solid #0f172a; background:#fff; overflow:hidden; margin:0 auto;">`;
    
    const frontOffsetX = (viewWidth - furnaceW * frontScaleXY) / 2;
    const frontOffsetY = (viewHeight - furnaceH * frontScaleXY) / 2;
    
    html += createEngineeringRuler(viewWidth, viewHeight, frontScaleXY, 'X(宽)', 'Y(高)', furnaceW, furnaceH);
    
    furnace.packedItems.forEach((item, idx) => {
        const x = frontOffsetX + item.x * frontScaleXY;
        const y = frontOffsetY + (furnaceH - item.y - item.h) * frontScaleXY;
        const w = item.w * frontScaleXY;
        const h = item.h * frontScaleXY;
        const fontSize = Math.max(8, Math.min(12, w / 5));
        const seqNum = globalSeqStart + idx;
        
        html += `<div style="position:absolute; left:${x + 1}px; top:${y + 1}px; width:${w - 2}px; height:${h - 2}px; background:${item.color}; border:1.5px solid #1e293b; display:flex; align-items:center; justify-content:center; font-size:${fontSize}px; font-weight:900; color:#000; overflow:hidden; text-align:center; text-shadow:0 0 2px #fff; opacity:0.82; box-sizing:border-box; cursor:default;">${item.name}</div>`;
        html += createSequenceBadge(x, y, w, h, seqNum);
    });
    
    html += `</div></div>`;
    
    // ---- 侧视图 (Z-Y) ----
    html += `<div style="border:1px solid #94a3b8; border-radius:4px; padding:6px; background:#f8fafc;">
        <div style="font-size:11px; font-weight:700; color:#0f172a; text-align:center; margin-bottom:4px;">📐 侧视图 (Z-Y) 侧视</div>
        <div style="position:relative; width:${viewWidth}px; height:${viewHeight}px; border:1.5px solid #0f172a; background:#fff; overflow:hidden; margin:0 auto;">`;
    
    const sideOffsetX = (viewWidth - furnaceD * sideScaleZY) / 2;
    const sideOffsetY = (viewHeight - furnaceH * sideScaleZY) / 2;
    
    html += createEngineeringRuler(viewWidth, viewHeight, sideScaleZY, 'Z(深)', 'Y(高)', furnaceD, furnaceH);
    
    furnace.packedItems.forEach((item, idx) => {
        const x = sideOffsetX + item.z * sideScaleZY;
        const y = sideOffsetY + (furnaceH - item.y - item.h) * sideScaleZY;
        const w = item.d * sideScaleZY;
        const h = item.h * sideScaleZY;
        const fontSize = Math.max(8, Math.min(12, w / 5));
        const seqNum = globalSeqStart + idx;
        
        html += `<div style="position:absolute; left:${x + 1}px; top:${y + 1}px; width:${w - 2}px; height:${h - 2}px; background:${item.color}; border:1.5px solid #1e293b; display:flex; align-items:center; justify-content:center; font-size:${fontSize}px; font-weight:900; color:#000; overflow:hidden; text-align:center; text-shadow:0 0 2px #fff; opacity:0.82; box-sizing:border-box; cursor:default;">${item.name}</div>`;
        html += createSequenceBadge(x, y, w, h, seqNum);
    });
    
    html += `</div></div>`;
    
    html += `</div>`;  // 关闭四视图flex容器
    
    // ---- 下半部分：物料图例 + 放置顺序表 ----
    html += `<div style="display:flex; gap:${viewGap}px;">
        <div style="flex:1; min-width:0;">
            <div style="font-size:12px; font-weight:700; color:#0f172a; border-left:4px solid #0066cc; padding-left:8px; margin-bottom:6px;">📋 物料图例</div>
            ${createMaterialLegend(furnace.packedItems)}
        </div>
        <div style="flex:1.5; min-width:0;">
            <div style="font-size:12px; font-weight:700; color:#0f172a; border-left:4px solid #e67e22; padding-left:8px; margin-bottom:6px;">🔢 装炉放置顺序表（工人操作参考）</div>
            ${createPlacementSequenceTable(furnace.packedItems)}
        </div>
    </div>`;
    
    // 安全提示 + 签名区
    html += createSafetyNotice();
    html += createSignatureBlock();
    
    page.innerHTML = html;
    pdfWrapper.appendChild(page);
    
    return globalSeqStart + furnace.packedItems.length;
}

/**
 * 创建炉次3D等轴测概览图页面（可选额外页）
 * @param {Object} options
 */
export function createIsometricOverviewPage({ pdfWrapper, furnace }) {
    const page = document.createElement('div');
    page.className = 'pdf-page';
    page.style.position = 'relative';
    page.style.width = '1122px';
    page.style.height = '760px';
    page.style.background = '#ffffff';
    page.style.padding = '30px 35px';
    page.style.boxSizing = 'border-box';
    
    const isoScale = 0.8;
    const canvasW = 800;
    const canvasH = 500;
    
    let html = `
        <div style="border-bottom:3px solid #0066cc; padding-bottom:12px; margin-bottom:16px;">
            <div style="font-size:22px; font-weight:800; color:#0f172a;">${furnace.instanceId} - 3D等轴测装炉透视图</div>
            <div style="font-size:11px; color:#64748b;">Isometric View | 帮助工人理解空间摆放关系</div>
        </div>
        <div style="position:relative; width:${canvasW}px; height:${canvasH}px; border:2px solid #0f172a; margin:0 auto; background:#fafafa; overflow:hidden;">
    `;
    
    // 3D等轴测投影 (从右上角俯视)
    // 等轴测角度: 30度
    const angle = Math.PI / 6; // 30 degrees
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    
    // 炉膛线框
    const originX = canvasW / 2;
    const originY = canvasH / 2 + 50;
    
    function toIso(x3d, y3d, z3d) {
        // X向右, Z向左下, Y向上
        const px = originX + (x3d - z3d) * cosA * isoScale;
        const py = originY - y3d * isoScale + (x3d + z3d) * sinA * isoScale;
        return { x: px, y: py };
    }
    
    // 绘制炉膛底面
    const p000 = toIso(0, 0, 0);
    const pw00 = toIso(furnace.w, 0, 0);
    const p0d0 = toIso(0, 0, furnace.d);
    const pwd0 = toIso(furnace.w, 0, furnace.d);
    const p00h = toIso(0, furnace.h, 0);
    const pw0h = toIso(furnace.w, furnace.h, 0);
    const p0dh = toIso(0, furnace.h, furnace.d);
    const pwdh = toIso(furnace.w, furnace.h, furnace.d);
    
    // 底面
    html += `<svg style="position:absolute; left:0; top:0; width:${canvasW}px; height:${canvasH}px; pointer-events:none; z-index:1;">
        <polygon points="${p000.x},${p000.y} ${pw00.x},${pw00.y} ${pwd0.x},${pwd0.y} ${p0d0.x},${p0d0.y}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6,3"/>
        <line x1="${p000.x}" y1="${p000.y}" x2="${p00h.x}" y2="${p00h.y}" stroke="#94a3b8" stroke-width="1"/>
        <line x1="${pw00.x}" y1="${pw00.y}" x2="${pw0h.x}" y2="${pw0h.y}" stroke="#94a3b8" stroke-width="1"/>
        <line x1="${p0d0.x}" y1="${p0d0.y}" x2="${p0dh.x}" y2="${p0dh.y}" stroke="#94a3b8" stroke-width="1"/>
        <line x1="${pwd0.x}" y1="${pwd0.y}" x2="${pwdh.x}" y2="${pwdh.y}" stroke="#94a3b8" stroke-width="1"/>
        <polygon points="${p00h.x},${p00h.y} ${pw0h.x},${pw0h.y} ${pwdh.x},${pwdh.y} ${p0dh.x},${p0dh.y}" fill="none" stroke="#2563eb" stroke-width="2"/>
    </svg>`;
    
    // 工件等轴测投影（按Y排序从低到高渲染）
    const sortedItems = [...furnace.packedItems].sort((a, b) => a.y - b.y);
    
    sortedItems.forEach((item, idx) => {
        const boxPts = [
            toIso(item.x, item.y, item.z),                         // 000
            toIso(item.x + item.w, item.y, item.z),                // w00
            toIso(item.x, item.y, item.z + item.d),                // 0d0
            toIso(item.x + item.w, item.y, item.z + item.d),       // wd0
            toIso(item.x, item.y + item.h, item.z),                // 00h
            toIso(item.x + item.w, item.y + item.h, item.z),       // w0h
            toIso(item.x, item.y + item.h, item.z + item.d),       // 0dh
            toIso(item.x + item.w, item.y + item.h, item.z + item.d) // wdh
        ];
        
        // 顶面
        html += `<svg style="position:absolute; left:0; top:0; width:${canvasW}px; height:${canvasH}px; pointer-events:none; z-index:${idx + 2};">
            <polygon points="${boxPts[4].x},${boxPts[4].y} ${boxPts[5].x},${boxPts[5].y} ${boxPts[7].x},${boxPts[7].y} ${boxPts[6].x},${boxPts[6].y}" fill="${item.color}" fill-opacity="0.85" stroke="#1e293b" stroke-width="1.2"/>
        </svg>`;
        
        // 标签
        const cx = (boxPts[4].x + boxPts[5].x + boxPts[7].x + boxPts[6].x) / 4;
        const cy = (boxPts[4].y + boxPts[5].y + boxPts[7].y + boxPts[6].y) / 4;
        html += `<div style="position:absolute; left:${cx}px; top:${cy}px; transform:translate(-50%,-50%); font-size:9px; font-weight:900; color:#000; text-shadow:0 0 3px #fff, 0 0 3px #fff; z-index:${idx + 3}; pointer-events:none; white-space:nowrap;">${idx + 1}. ${item.name}</div>`;
    });
    
    html += `</div>`;
    html += `<div style="text-align:center; font-size:10px; color:#94a3b8; margin-top:8px;">注: 等轴测图仅作空间参考，精确坐标请参阅三视图和放置顺序表</div>`;
    
    page.innerHTML = html;
    pdfWrapper.appendChild(page);
}

export default { createFurnaceDetailPage, createIsometricOverviewPage };