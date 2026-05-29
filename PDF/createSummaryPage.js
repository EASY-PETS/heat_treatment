// ==================== 工业汇总页面生成模块 ====================

import { createSignatureBlock } from './legend.js';
import { formatDateTime } from '../js/utils/helpers.js';

/**
 * 创建装炉作业总览页面
 * @param {Object} options
 * @param {HTMLElement} options.pdfWrapper - PDF容器
 * @param {Array} options.furnaces - 所有已装炉炉膛
 * @param {Array} options.unpackedItems - 未装炉工件
 */
export function createSummaryPage({ pdfWrapper, furnaces, unpackedItems = [], sopData = null }) {
    const page = document.createElement('div');
    page.className = 'pdf-page';
    page.style.position = 'relative';
    page.style.width = '1122px';
    page.style.minHeight = '793px';
    page.style.background = '#ffffff';
    page.style.padding = '30px 35px';
    page.style.boxSizing = 'border-box';
    page.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    page.style.overflow = 'hidden';
    
    let totalWeight = 0;
    let totalCount = 0;
    let totalMaxWeight = 0;
    let totalVolume = 0;
    let packedVolume = 0;
    
    const furnaceStats = furnaces.map(f => {
        totalWeight += f.totalWeight;
        totalCount += f.packedItems.length;
        totalMaxWeight += f.maxWeight;
        const vol = f.w * f.h * f.d;
        totalVolume += vol;
        let pVol = 0;
        f.packedItems.forEach(item => { pVol += item.w * item.h * item.d; });
        packedVolume += pVol;
        
        return {
            instanceId: f.instanceId,
            itemCount: f.packedItems.length,
            totalWeight: f.totalWeight,
            maxWeight: f.maxWeight,
            weightUtilization: ((f.totalWeight / f.maxWeight) * 100).toFixed(1),
            volUtilization: ((pVol / vol) * 100).toFixed(1),
            size: `${Math.round(f.w)}×${Math.round(f.h)}×${Math.round(f.d)}`,
            items: f.packedItems,
            mainMaterials: [...new Set(f.packedItems.map(i => i.name))].slice(0, 5).join(' / ')
        };
    });
    
    const overallWeightUtil = totalMaxWeight > 0 ? ((totalWeight / totalMaxWeight) * 100).toFixed(1) : '0';
    const overallVolUtil = totalVolume > 0 ? ((packedVolume / totalVolume) * 100).toFixed(1) : '0';
    
    let html = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #1e293b; padding-bottom:14px; margin-bottom:24px;">
            <div>
                <div style="font-size:30px; font-weight:900; color:#0f172a;">热处理装炉作业总览</div>
                <div style="font-size:12px; color:#64748b; margin-top:4px; letter-spacing:0.5px;">Industrial Heat Treatment Furnace Loading Summary Report</div>
            </div>
            <div style="text-align:right; font-size:11px; color:#475569; line-height:1.8;">
                <div>报告生成时间: ${formatDateTime()}</div>
                <div>启用炉台数: <b style="color:#0f172a;">${furnaces.length}</b> 台</div>
                <div>文档编号: HT-${Date.now().toString(36).toUpperCase()}</div>
            </div>
        </div>
        
        <div style="display:grid; grid-template-columns:repeat(6,1fr); gap:14px; margin-bottom:28px;">
            <div style="background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:14px; text-align:center;">
                <div style="font-size:10px; color:#64748b; margin-bottom:6px;">总炉次</div>
                <div style="font-size:26px; font-weight:900; color:#0f172a;">${furnaces.length}</div>
            </div>
            <div style="background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:14px; text-align:center;">
                <div style="font-size:10px; color:#64748b; margin-bottom:6px;">总工件数</div>
                <div style="font-size:26px; font-weight:900; color:#0f172a;">${totalCount}</div>
            </div>
            <div style="background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:14px; text-align:center;">
                <div style="font-size:10px; color:#64748b; margin-bottom:6px;">总重量(kg)</div>
                <div style="font-size:22px; font-weight:900; color:#0f172a;">${totalWeight.toFixed(0)}</div>
            </div>
            <div style="background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:14px; text-align:center;">
                <div style="font-size:10px; color:#64748b; margin-bottom:6px;">重量利用率</div>
                <div style="font-size:22px; font-weight:900; color:${parseFloat(overallWeightUtil) > 80 ? '#16a34a' : '#e67e22'};">${overallWeightUtil}%</div>
            </div>
            <div style="background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:14px; text-align:center;">
                <div style="font-size:10px; color:#64748b; margin-bottom:6px;">空间利用率</div>
                <div style="font-size:22px; font-weight:900; color:${parseFloat(overallVolUtil) > 60 ? '#16a34a' : '#e67e22'};">${overallVolUtil}%</div>
            </div>
            <div style="background:${unpackedItems.length > 0 ? '#fef2f2' : '#f1f5f9'}; border:1px solid ${unpackedItems.length > 0 ? '#fecaca' : '#e2e8f0'}; border-radius:8px; padding:14px; text-align:center;">
                <div style="font-size:10px; color:#64748b; margin-bottom:6px;">未装炉件</div>
                <div style="font-size:26px; font-weight:900; color:${unpackedItems.length > 0 ? '#dc2626' : '#0f172a'};">${unpackedItems.length}</div>
            </div>
        </div>
        
        <div style="font-size:16px; font-weight:800; color:#0f172a; border-left:5px solid #0066cc; padding-left:10px; margin-bottom:12px;">📊 炉次清单总览</div>
        <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:20px;">
            <thead>
                <tr style="background:#e2e8f0;">
                    <th style="border:1.5px solid #94a3b8; padding:8px 10px; text-align:center;">序号</th>
                    <th style="border:1.5px solid #94a3b8; padding:8px 10px; text-align:left;">炉号 / 炉膛名称</th>
                    <th style="border:1.5px solid #94a3b8; padding:8px 10px; text-align:center;">炉膛尺寸(mm)</th>
                    <th style="border:1.5px solid #94a3b8; padding:8px 10px; text-align:center;">工件数量</th>
                    <th style="border:1.5px solid #94a3b8; padding:8px 10px; text-align:center;">总重量(kg)</th>
                    <th style="border:1.5px solid #94a3b8; padding:8px 10px; text-align:center;">承重上限(kg)</th>
                    <th style="border:1.5px solid #94a3b8; padding:8px 10px; text-align:center;">重量利用率</th>
                    <th style="border:1.5px solid #94a3b8; padding:8px 10px; text-align:center;">空间利用率</th>
                    <th style="border:1.5px solid #94a3b8; padding:8px 10px; text-align:left;">主要物料</th>
                </tr>
            </thead>
            <tbody>`;
    
    furnaceStats.forEach((fs, idx) => {
        const wUtil = parseFloat(fs.weightUtilization);
        const vUtil = parseFloat(fs.volUtilization);
        
        html += `<tr style="${idx % 2 === 0 ? 'background:#fafafa;' : ''}">
            <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:center; font-weight:bold;">${idx + 1}</td>
            <td style="border:1px solid #cbd5e1; padding:6px 8px; font-weight:bold;">${fs.instanceId}</td>
            <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:center;">${fs.size}</td>
            <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:center;">${fs.itemCount}</td>
            <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:center;">${fs.totalWeight.toFixed(1)}</td>
            <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:center;">${fs.maxWeight}</td>
            <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:center; font-weight:bold;">
                <span style="color:${wUtil > 90 ? '#16a34a' : wUtil > 70 ? '#e67e22' : '#dc2626'};">${fs.weightUtilization}%</span>
            </td>
            <td style="border:1px solid #cbd5e1; padding:6px 8px; text-align:center; font-weight:bold;">
                <span style="color:${vUtil > 70 ? '#16a34a' : vUtil > 50 ? '#e67e22' : '#dc2626'};">${fs.volUtilization}%</span>
            </td>
            <td style="border:1px solid #cbd5e1; padding:6px 8px; font-size:11px;">${fs.mainMaterials}</td>
        </tr>`;
    });
    
    html += `</tbody></table>`;
    
    if (unpackedItems.length > 0) {
        const summary = {};
        unpackedItems.forEach(u => { summary[u.name] = (summary[u.name] || 0) + 1; });
        
        html += `<div style="background:#fef2f2; border:2px solid #fecaca; border-radius:6px; padding:12px 16px; margin-bottom:18px;">
            <div style="font-weight:bold; color:#dc2626; font-size:13px;">⚠️ 异常：以下 ${unpackedItems.length} 件工件未能装入现有炉膛</div>
            <div style="font-size:11px; color:#991b1b; margin-top:4px;">`;
        
        for (const [name, count] of Object.entries(summary)) {
            html += `• ${name} × ${count} 件 &nbsp;&nbsp;`;
        }
        
        html += `</div><div style="font-size:10px; color:#b91c1c; margin-top:4px;">建议: 增加炉膛数量或拆分批次后重新计算</div></div>`;
    }
    
    html += `<div style="font-size:16px; font-weight:800; color:#0f172a; border-left:5px solid #0066cc; padding-left:10px; margin-bottom:12px;">📋 全局物料图例</div><div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:20px;">`;
    
    const legendMap = new Map();
    furnaces.forEach(f => {
        f.packedItems.forEach(item => {
            if (!legendMap.has(item.name)) {
                legendMap.set(item.name, {
                    color: item.color,
                    shape: item.shape,
                    w: item.w,
                    h: item.h,
                    d: item.d,
                    weight: item.weight
                });
            }
        });
    });
    
    legendMap.forEach((info, name) => {
        const dimStr = info.shape === 'cylinder' ? `φ${info.w}×H${info.h}` : `${info.w}×${info.d}×${info.h}`;
        html += `<div style="display:flex; align-items:center; gap:8px; border:1px solid #cbd5e1; padding:6px 12px; border-radius:6px; background:#fafafa; font-size:11px;">
            <div style="width:20px; height:20px; background:${info.color}; border:1.5px solid #1e293b; border-radius:${info.shape === 'cylinder' ? '50%' : '2px'}; flex-shrink:0;"></div>
            <div><b>${name}</b> <span style="color:#64748b;">${dimStr} | ${info.weight.toFixed(1)}kg</span></div>
        </div>`;
    });
    
    html += `</div>`;
    
    // 规则5: 工艺校准单宏观决策看板 - 在签名区之前插入
    if (sopData) {
        html += `
            <div style="font-size:16px; font-weight:800; color:#0f172a; border-left:5px solid #dc2626; padding-left:10px; margin:20px 0 12px 0;">📋 工艺校准单 — 宏观决策看板 (SOP Verification)</div>
            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:18px;">
                <div style="background:#fef2f2; border:2px solid #fecaca; border-radius:8px; padding:12px; text-align:center;">
                    <div style="font-size:9px; color:#991b1b; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">目标真空度</div>
                    <div style="font-size:20px; font-weight:900; color:#dc2626;">${sopData.vacuumLevel === '1e-2' ? '10⁻²' : sopData.vacuumLevel === '1e-3' ? '10⁻³' : '10⁻⁴'} Pa</div>
                </div>
                <div style="background:#fef2f2; border:2px solid #fecaca; border-radius:8px; padding:12px; text-align:center;">
                    <div style="font-size:9px; color:#991b1b; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">加热曲线程序</div>
                    <div style="font-size:16px; font-weight:900; color:#dc2626;">${sopData.heatingProgram}</div>
                </div>
                <div style="background:#fef2f2; border:2px solid #fecaca; border-radius:8px; padding:12px; text-align:center;">
                    <div style="font-size:9px; color:#991b1b; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">校准确认时间</div>
                    <div style="font-size:12px; font-weight:bold; color:#991b1b;">${sopData.verifiedAt || '—'}</div>
                </div>
                <div style="background:#fef2f2; border:2px solid #fecaca; border-radius:8px; padding:12px; text-align:center;">
                    <div style="font-size:9px; color:#991b1b; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">主操手</div>
                    <div style="font-size:14px; font-weight:bold; color:#dc2626;">${sopData.operator || '—'}</div>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px;">
                <div style="border:2px solid #cbd5e1; border-radius:6px; padding:14px; background:#fafafa;">
                    <div style="font-size:10px; color:#64748b; margin-bottom:8px; text-transform:uppercase;">📝 主操手签字区 (Operator Signature)</div>
                    <div style="min-height:60px; border-bottom:1px dashed #94a3b8;"></div>
                    <div style="font-size:10px; color:#94a3b8; margin-top:4px;">签字: _____________ &nbsp;&nbsp; 日期: ____/____/____</div>
                </div>
                <div style="border:2px solid #cbd5e1; border-radius:6px; padding:14px; background:#fafafa;">
                    <div style="font-size:10px; color:#64748b; margin-bottom:8px; text-transform:uppercase;">🔬 工艺工程师确认区 (Engineer Verification)</div>
                    <div style="min-height:60px; border-bottom:1px dashed #94a3b8;"></div>
                    <div style="font-size:10px; color:#94a3b8; margin-top:4px;">签字: _____________ &nbsp;&nbsp; 日期: ____/____/____</div>
                </div>
            </div>
        `;
    }
    
    html += createSignatureBlock();
    
    page.innerHTML = html;
    pdfWrapper.appendChild(page);
}

export default { createSummaryPage };