// ==================== 工业图例模块 ====================

/**
 * 创建物料图例（含尺寸和重量信息）
 * @param {Array} packedItems - 已装炉工件数组
 * @returns {string} HTML字符串
 */
export function createMaterialLegend(packedItems) {
    const legendMap = new Map();
    
    packedItems.forEach(item => {
        if (!legendMap.has(item.name)) {
            legendMap.set(item.name, {
                color: item.color,
                shape: item.shape,
                w: item.w,
                h: item.h,
                d: item.d,
                weight: item.weight,
                count: 0
            });
        }
        legendMap.get(item.name).count++;
    });
    
    let html = `<table style="width:100%; border-collapse:collapse; font-size:11px; margin-top:8px;">
        <thead>
            <tr style="background:#f1f5f9;">
                <th style="border:1px solid #94a3b8; padding:6px 8px; text-align:center;">标识</th>
                <th style="border:1px solid #94a3b8; padding:6px 8px; text-align:left;">物料名称</th>
                <th style="border:1px solid #94a3b8; padding:6px 8px; text-align:center;">形状</th>
                <th style="border:1px solid #94a3b8; padding:6px 8px; text-align:center;">尺寸 (mm)</th>
                <th style="border:1px solid #94a3b8; padding:6px 8px; text-align:center;">单件重(kg)</th>
                <th style="border:1px solid #94a3b8; padding:6px 8px; text-align:center;">数量</th>
            </tr>
        </thead>
        <tbody>`;
    
    legendMap.forEach((info, name) => {
        const dimStr = info.shape === 'cylinder' 
            ? `φ${info.w} × H${info.h}` 
            : `${info.w} × ${info.d} × ${info.h}`;
            
        html += `<tr>
            <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">
                <div style="width:20px; height:20px; background:${info.color}; border:1px solid #000; margin:0 auto; border-radius:${info.shape === 'cylinder' ? '50%' : '2px'};"></div>
            </td>
            <td style="border:1px solid #cbd5e1; padding:4px 6px; font-weight:bold;">${name}</td>
            <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">${info.shape === 'cylinder' ? '圆柱体' : '长方体'}</td>
            <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">${dimStr}</td>
            <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">${info.weight.toFixed(1)}</td>
            <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">${info.count}</td>
        </tr>`;
    });
    
    html += `</tbody></table>`;
    return html;
}

/**
 * 创建放置顺序表（按进炉优先顺序）
 * @param {Array} packedItems - 已装炉工件（按摆放顺序排列）
 * @returns {string} HTML字符串
 */
export function createPlacementSequenceTable(packedItems) {
    // 按Y轴（高度）从低到高排序 = 先放的工件
    const sorted = [...packedItems].sort((a, b) => 
        (a.y - b.y) || (a.z - b.z) || (a.x - b.x)
    );
    
    let html = `<table style="width:100%; border-collapse:collapse; font-size:11px; margin-top:8px;">
        <thead>
            <tr style="background:#fef3c7;">
                <th style="border:1px solid #94a3b8; padding:6px 8px; text-align:center; width:40px;">顺序</th>
                <th style="border:1px solid #94a3b8; padding:6px 8px; text-align:left;">物料名称</th>
                <th style="border:1px solid #94a3b8; padding:6px 8px; text-align:center;">X(mm)</th>
                <th style="border:1px solid #94a3b8; padding:6px 8px; text-align:center;">Y(mm)</th>
                <th style="border:1px solid #94a3b8; padding:6px 8px; text-align:center;">Z(mm)</th>
                <th style="border:1px solid #94a3b8; padding:6px 8px; text-align:center;">重量(kg)</th>
                <th style="border:1px solid #94a3b8; padding:6px 8px; text-align:center;">操作提示</th>
            </tr>
        </thead>
        <tbody>`;
    
    sorted.forEach((item, idx) => {
        const operationTip = idx === 0 
            ? '⏺ 首件定位' 
            : `⚠ 紧靠前件·间距≥5mm`;
        
        html += `<tr style="${idx % 2 === 0 ? 'background:#fafafa;' : ''}">
            <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center; font-weight:bold; font-size:14px; color:#ef4444;">${idx + 1}</td>
            <td style="border:1px solid #cbd5e1; padding:4px 6px; font-weight:bold;">${item.name}</td>
            <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">${Math.round(item.x)}</td>
            <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">${Math.round(item.y)}</td>
            <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">${Math.round(item.z)}</td>
            <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">${item.weight.toFixed(1)}</td>
            <td style="border:1px solid #cbd5e1; padding:4px 6px; font-size:10px;">${operationTip}</td>
        </tr>`;
    });
    
    html += `</tbody></table>`;
    return html;
}

/**
 * 创建签名区
 * @returns {string} HTML字符串
 */
export function createSignatureBlock() {
    return `
        <table style="width:100%; border-collapse:collapse; margin-top:20px; font-size:12px;">
            <tr>
                <td style="border:1px solid #94a3b8; padding:18px 12px; width:25%; text-align:center; background:#fafafa;">
                    <div style="color:#94a3b8; margin-bottom:4px;">编制/工艺工程师</div>
                    <div style="min-height:30px;"></div>
                    <div style="font-size:10px; color:#64748b;">日期: ____/____/____</div>
                </td>
                <td style="border:1px solid #94a3b8; padding:18px 12px; width:25%; text-align:center; background:#fafafa;">
                    <div style="color:#94a3b8; margin-bottom:4px;">审核/总工程师</div>
                    <div style="min-height:30px;"></div>
                    <div style="font-size:10px; color:#64748b;">日期: ____/____/____</div>
                </td>
                <td style="border:1px solid #94a3b8; padding:18px 12px; width:25%; text-align:center; background:#fafafa;">
                    <div style="color:#94a3b8; margin-bottom:4px;">批准/车间主任</div>
                    <div style="min-height:30px;"></div>
                    <div style="font-size:10px; color:#64748b;">日期: ____/____/____</div>
                </td>
                <td style="border:1px solid #94a3b8; padding:18px 12px; width:25%; text-align:center; background:#fafafa;">
                    <div style="color:#94a3b8; margin-bottom:4px;">执行/装炉操作员</div>
                    <div style="min-height:30px;"></div>
                    <div style="font-size:10px; color:#64748b;">日期: ____/____/____</div>
                </td>
            </tr>
        </table>
    `;
}

/**
 * 创建安全操作提示
 * @returns {string} HTML字符串
 */
export function createSafetyNotice() {
    return `
        <div style="margin-top:16px; padding:12px; background:#fef3c7; border:2px solid #f59e0b; border-radius:6px; font-size:12px;">
            <div style="font-weight:bold; color:#92400e; margin-bottom:4px;">⚠️ 安全操作注意事项</div>
            <ul style="margin:4px 0; padding-left:20px; color:#78350f; line-height:1.6;">
                <li>工件间保持 ≥5mm 安全间距，距炉壁 ≥10mm</li>
                <li>严格按放置顺序依次装炉，先将重/大工件放置于炉底</li>
                <li>装炉前确认炉膛内部清洁，无异物残留</li>
                <li>操作人员必须佩戴防护装备，遵守热处理车间安全规程</li>
                <li>装炉完成后复核工件位置坐标，确认与工艺卡一致</li>
                <li>密闭炉门后再次检查密封状态，确认无误后启动加热程序</li>
            </ul>
        </div>
    `;
}