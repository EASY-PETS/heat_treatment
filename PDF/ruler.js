// ==================== 工业标尺与网格模块 ====================

/**
 * 创建工程级网格和标尺覆盖层
 * @param {number} width - 画布宽度(px)
 * @param {number} height - 画布高度(px)
 * @param {number} scaleFactor - 缩放因子 (px/mm)
 * @param {string} axisX - X轴标签
 * @param {string} axisY - Y轴标签
 * @param {number} furnaceW - 炉膛宽度(实际mm)
 * @param {number} furnaceH - 炉膛高度/深度(实际mm)
 */
export function createEngineeringRuler(width, height, scaleFactor, axisX, axisY, furnaceW, furnaceH) {
    let html = '';
    
    // 主刻度间距 100mm，次刻度间距 50mm
    const majorStepMM = 100;
    const minorStepMM = 50;
    const majorStepPX = majorStepMM * scaleFactor;
    const minorStepPX = minorStepMM * scaleFactor;
    
    // 水平方向网格线和刻度
    for (let x = 0; x <= width; x += minorStepPX) {
        const isMajor = Math.round(x / majorStepPX) === x / majorStepPX;
        const mmVal = Math.round(x / scaleFactor);
        
        if (isMajor) {
            // 主刻度线
            html += `<div style="position:absolute; left:${x}px; top:0; width:1px; height:${height}px; background:rgba(0,0,0,0.12); pointer-events:none;"></div>`;
            // 顶部刻度值
            html += `<div style="position:absolute; left:${x}px; top:0; transform:translateX(-50%); font-size:8px; color:#1e293b; font-weight:bold; background:rgba(255,255,255,0.9); padding:1px 3px; border-radius:2px; pointer-events:none; white-space:nowrap;">${mmVal}</div>`;
            // 底部刻度值
            html += `<div style="position:absolute; left:${x}px; bottom:0; transform:translateX(-50%); font-size:8px; color:#1e293b; font-weight:bold; background:rgba(255,255,255,0.9); padding:1px 3px; border-radius:2px; pointer-events:none; white-space:nowrap;">${mmVal}</div>`;
        } else {
            // 次刻度线（更淡）
            html += `<div style="position:absolute; left:${x}px; top:0; width:1px; height:${height}px; background:rgba(0,0,0,0.04); pointer-events:none;"></div>`;
        }
    }
    
    // 垂直方向网格线和刻度
    for (let y = 0; y <= height; y += minorStepPX) {
        const isMajor = Math.round(y / majorStepPX) === y / majorStepPX;
        const mmVal = Math.round(y / scaleFactor);
        
        if (isMajor) {
            html += `<div style="position:absolute; left:0; top:${y}px; width:${width}px; height:1px; background:rgba(0,0,0,0.12); pointer-events:none;"></div>`;
            // 左侧刻度值
            html += `<div style="position:absolute; left:0; top:${y}px; transform:translateY(-50%); font-size:8px; color:#1e293b; font-weight:bold; background:rgba(255,255,255,0.9); padding:1px 3px; border-radius:2px; pointer-events:none; white-space:nowrap;">${mmVal}</div>`;
            // 右侧刻度值
            html += `<div style="position:absolute; right:0; top:${y}px; transform:translateY(-50%); font-size:8px; color:#1e293b; font-weight:bold; background:rgba(255,255,255,0.9); padding:1px 3px; border-radius:2px; pointer-events:none; white-space:nowrap;">${mmVal}</div>`;
        } else {
            html += `<div style="position:absolute; left:0; top:${y}px; width:${width}px; height:1px; background:rgba(0,0,0,0.04); pointer-events:none;"></div>`;
        }
    }
    
    // 坐标轴标识
    html += `<div style="position:absolute; left:8px; bottom:4px; font-size:9px; font-weight:bold; color:#1e293b; background:rgba(255,255,255,0.95); padding:2px 6px; border-radius:3px; border:1px solid #94a3b8; pointer-events:none; z-index:10;">
        ${axisX} → / ${axisY} ↑ / 单位:mm
    </div>`;
    
    // 炉膛边界框
    const fw = furnaceW * scaleFactor;
    const fh = furnaceH * scaleFactor;
    html += `<div style="position:absolute; left:0; top:0; width:${fw}px; height:${fh}px; border:2.5px dashed #2563eb; pointer-events:none; z-index:2;"></div>`;
    
    return html;
}

/**
 * 进炉方向箭头指示器
 * @param {number} width - 画布宽度
 * @param {number} height - 画布高度
 * @param {number} scaleFactor - 缩放因子
 * @param {number} furnaceW - 炉膛宽度
 * @param {number} furnaceD - 炉膛深度
 * @param {string} direction - 进炉方向: 'top' | 'bottom' | 'left' | 'right'
 */
export function createEntryDirectionIndicator(width, height, scaleFactor, furnaceW, furnaceD, direction = 'bottom') {
    const fwPx = furnaceW * scaleFactor;
    const fdPx = furnaceD * scaleFactor;
    const arrowSize = 40;
    
    let arrowHtml = '';
    
    // 默认从底部进炉（Z轴方向）
    const centerX = fwPx / 2;
    let arrowY, arrowStartY, labelY, labelText;
    
    if (direction === 'bottom') {
        arrowStartY = fdPx + 20;
        arrowY = fdPx + arrowSize + 30;
        labelY = fdPx + arrowSize + 50;
        labelText = '进炉方向 (推入) →';
        arrowHtml = `
            <div style="position:absolute; left:${centerX - 1}px; top:${fdPx}px; width:2px; height:${arrowStartY - fdPx}px; background:#ef4444; pointer-events:none; z-index:5;"></div>
            <div style="position:absolute; left:${centerX - arrowSize/2}px; top:${arrowStartY}px; width:0; height:0; border-left:${arrowSize/2}px solid transparent; border-right:${arrowSize/2}px solid transparent; border-top:${arrowSize}px solid #ef4444; pointer-events:none; z-index:5;"></div>
            <div style="position:absolute; left:50%; top:${labelY}px; transform:translateX(-50%); font-size:16px; font-weight:bold; color:#ef4444; background:#fff; padding:4px 12px; border:2px solid #ef4444; border-radius:4px; pointer-events:none; z-index:5; white-space:nowrap;">
                🔥 ${labelText}
            </div>
        `;
    }
    
    return arrowHtml;
}

/**
 * 炉门位置标识
 * @param {number} width - 画布宽度
 * @param {number} height - 画布高度
 * @param {number} scaleFactor - 缩放因子
 * @param {number} furnaceW - 炉膛宽度
 */
export function createFurnaceDoorMarker(width, height, scaleFactor, furnaceW) {
    const fwPx = furnaceW * scaleFactor;
    
    return `
        <div style="position:absolute; left:${fwPx/2 - 50}px; top:-2px; width:100px; height:8px; background:#ef4444; border-radius:0 0 4px 4px; pointer-events:none; z-index:5;">
            <div style="position:absolute; top:8px; left:50%; transform:translateX(-50%); font-size:8px; color:#ef4444; font-weight:bold; white-space:nowrap;">炉门侧</div>
        </div>
    `;
}

/**
 * 创建工件放置序号标记
 * @param {number} x - 位置X(px)
 * @param {number} y - 位置Y(px)
 * @param {number} w - 宽度(px)
 * @param {number} h - 高度(px)
 * @param {number} seqNumber - 放置序号
 */
export function createSequenceBadge(x, y, w, h, seqNumber) {
    // 序号标记放在工件左上角
    const badgeSize = Math.max(16, Math.min(22, Math.min(w, h) / 2.5));
    return `
        <div style="position:absolute; left:${x + 2}px; top:${y + 2}px; width:${badgeSize}px; height:${badgeSize}px; background:#ef4444; color:#fff; font-size:${badgeSize * 0.6}px; font-weight:bold; border-radius:50%; display:flex; align-items:center; justify-content:center; border:1.5px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,0.3); z-index:10; pointer-events:none;">
            ${seqNumber}
        </div>
    `;
}