/**
 * pdf-six-page.js — 三页式标准化 PDF 文档生成器 (V3.3)
 *
 * V3.3 重大更新：
 *   - 第1页重构为"三栏式"紧凑布局：
 *       上方：任务总览文字卡片（统计+物料清单+签字）
 *       左下方：料框总览截图二合一（正面 + 侧面堆叠）
 *       右下方：爆炸视图（垂直展开 + 侧45度 + 料框保留）
 *   - 移除独立第2页（料框总览图）和第3页（爆炸图）
 *   - 页码调整：3 页 = 总览三合一 → 步骤图 → AI评分
 *
 * 依赖：
 *   - screenshot-capture.js: captureFrontViewShot, captureSideViewShot,
 *                            captureExplodeShot, captureLayeredScreenshots
 *   - state.js: globalFurnacesResult
 *
 * 外部依赖（CDN）：
 *   - html2pdf.js (全局变量 html2pdf)
 */

import {
    globalFurnacesResult,
    placementRules      // 从 state.js 导入装炉规则配置，包含当前选择的策略和相关参数
} from './state.js';

import {
    captureFrontViewShot,
    captureSideViewShot,
    captureExplodeShot,
    captureLayeredScreenshots
} from './screenshot-capture.js';

// ==================== PDF GENERATION MAIN ====================

/**
 * 为单个炉膛生成三页内容块
 *
 * @param {Object} furnace - 炉膛数据
 * @param {number} furnaceIndex - 在 globalFurnacesResult 中的索引
 * @param {Object} screenshots - 截图数据 { frontView, sideView, explode, layered[] }
 * @param {HTMLElement} pdfWrapper - PDF 容器元素
 * @param {number} globalPageNumber - 全局页码（多炉膛时的累计页数）
 * @param {number} totalFurnaces - 总炉膛数
 */
function buildThreePagesForFurnace(furnace, furnaceIndex, screenshots, pdfWrapper, globalPageNumber, totalFurnaces) {
    const multiLabel = totalFurnaces > 1 ? ` [${globalPageNumber}/${totalFurnaces}]` : '';

    // ===== 第1页：任务总览三合一 =====
    buildPage1_TaskOverviewWithShots(furnace, screenshots, pdfWrapper, multiLabel);

    // ===== 第2页：装炉步骤图 =====
    buildPage2_StepByStep(furnace, screenshots.layered, pdfWrapper, multiLabel);

    // ===== 第3页：AI 评分页面 =====
    buildPage3_AIScoring(furnace, pdfWrapper, multiLabel);
}

// ==================== PAGE 1: 任务总览三合一 ====================

function buildPage1_TaskOverviewWithShots(furnace, screenshots, pdfWrapper, multiLabel) {
    const page = document.createElement('div');
    page.className = 'pdf-page pdf-page-overview-combo';

    const totalVol = furnace.w * furnace.h * furnace.d;
    const packedVol = furnace.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
    const volUtil = totalVol > 0 ? ((packedVol / totalVol) * 100).toFixed(1) : '0.0';
    const weightUtil = furnace.max_weight > 0 ? ((furnace.totalWeight / furnace.max_weight) * 100).toFixed(1) : '0.0';

    const uniqueNames = new Set();
    furnace.packedItems.forEach(item => uniqueNames.add(item.name));
    const executionConclusion = buildExecutionConclusion(furnace, volUtil, weightUtil);

    page.innerHTML = `
        <!-- 页眉 -->
        <div class="pdf-header">
            <div class="pdf-header-title">热处理装炉作业方案${multiLabel}</div>
            <div class="pdf-header-subtitle">Industrial Heat Treatment Furnace Loading Plan · 炉次：${escapeHtml(furnace.instanceId)}</div>
        </div>

        <!-- 方案标题 -->
        <div class="pdf-plan-title-section">
            <div class="plan-title">📋 ${escapeHtml(furnace.instanceId)} 装炉方案</div>
            <div class="plan-meta">生成日期：${new Date().toLocaleDateString('zh-CN')} · 操作员：热处理预装炉智能体 · 尺寸：${furnace.w}×${furnace.h}×${furnace.d} mm</div>
        </div>

        <!-- 统计卡片 -->
        <div class="pdf-stats-grid">
            <div class="pdf-stat-card">
                <div class="stat-label">工件数量</div>
                <div class="stat-value">${furnace.packedItems.length}</div>
                <div class="stat-sub">件 (${uniqueNames.size} 种)</div>
            </div>
            <div class="pdf-stat-card">
                <div class="stat-label">总重量</div>
                <div class="stat-value">${furnace.totalWeight.toFixed(1)}</div>
                <div class="stat-sub">kg</div>
            </div>
            <div class="pdf-stat-card">
                <div class="stat-label">空间利用率</div>
                <div class="stat-value">${volUtil}%</div>
                <div class="stat-sub">上限 ${furnace.max_weight} kg</div>
            </div>
            <div class="pdf-stat-card">
                <div class="stat-label">承重利用率</div>
                <div class="stat-value">${weightUtil}%</div>
                <div class="stat-sub">${furnace.w}×${furnace.h}×${furnace.d} mm</div>
            </div>
        </div>

        <!-- 物料清单表（紧凑版） -->
        <!-- 执行结论 -->
        <div style="margin:6px 0 8px 0;padding:8px 10px;border-radius:6px;background:${executionConclusion.bg};border:1px solid ${executionConclusion.border};">
            <div style="font-size:12px;font-weight:bold;color:${executionConclusion.color};margin-bottom:4px;">
                ${executionConclusion.title}
            </div>
            <div style="font-size:10px;line-height:1.6;color:#334155;">
                ${executionConclusion.desc}
            </div>
        </div>

        <!-- 炉膛 / 工装确认 -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:6px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:6px;">
                <div style="font-size:9px;color:#64748b;">炉膛尺寸</div>
                <div style="font-size:11px;font-weight:bold;">${furnace.w}×${furnace.h}×${furnace.d} mm</div>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:6px;">
                <div style="font-size:9px;color:#64748b;">最大承重</div>
                <div style="font-size:11px;font-weight:bold;">${furnace.max_weight || '—'} kg</div>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:6px;">
                <div style="font-size:9px;color:#64748b;">工装类型</div>
                <div style="font-size:11px;font-weight:bold;">${escapeHtml(furnace.toolingType || furnace.basketType || '标准工装')}</div>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:6px;">
                <div style="font-size:9px;color:#64748b;">执行状态</div>
                <div style="font-size:11px;font-weight:bold;color:${executionConclusion.color};">${executionConclusion.status}</div>
            </div>
        </div>
        <div class="pdf-section-divider" style="margin: 6px 0 !important;"></div>
                <div style="font-size:12px;font-weight:bold;margin-bottom:4px;">📦 物料清单</div>
                <table class="pdf-material-table pdf-material-table-compact">
                    <thead>
                        <tr>
                            <th style="width:22px;">色标</th>
                            <th style="width:60px;">物料编码</th>
                            <th>工件名称</th>
                            <th>客户</th>
                            <th>尺寸 (mm)</th>
                            <th>单重</th>
                            <th>数量</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${buildMaterialTableRows(furnace)}
                    </tbody>
                </table>

        <div class="pdf-overview-images-row" style="margin-top: 6px !important; gap: 8px !important;">
            <!-- 左侧：料框总览二合一 -->
            <div class="pdf-overview-left-panel">
                <div class="pdf-thumb-label">🔍 料框正面透视图</div>
                <div class="pdf-thumb-box">
                    ${screenshots.frontView ? `<img src="${screenshots.frontView}" alt="正面透视图">` : '<span class="no-shot-text">生成中...</span>'}
                </div>
                <div class="pdf-thumb-label" style="margin-top:6px;">🔍 料框侧面透视图</div>
                <div class="pdf-thumb-box">
                    ${screenshots.sideView ? `<img src="${screenshots.sideView}" alt="侧面透视图">` : '<span class="no-shot-text">生成中...</span>'}
                </div>
            </div>

            <!-- 右侧：爆炸图 -->
            <div class="pdf-overview-right-panel">
                <div class="pdf-thumb-label">💥 爆炸视图（垂直展开 · 侧45°透视）</div>
                <div class="pdf-thumb-box pdf-thumb-box-large" style="height: 360px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                    ${screenshots.explode ? `<img src="${screenshots.explode}" alt="爆炸视图">` : '<span class="no-shot-text">生成中...</span>'}
                </div>
            </div>
        </div>
        <div class="pdf-page-footer">第 1 页 · 任务总览</div>
    `;

    pdfWrapper.appendChild(page);
}

function buildMaterialTableRows(furnace) {
    const grouped = new Map();
    furnace.packedItems.forEach(item => {
        /** V3.4: 分组键使用物料编码+纯净名称+客户，精确聚合 */
        const cleanName = item.showName || (item.name ? item.name.split('_')[0] : '未知');
        const customer = item.customer || '';
        const key = (item.itemCode || '') + '|' + cleanName + '|' + customer + '|' + (item.material || '') + '|' + (item.process || '');
        if (!grouped.has(key)) {
            grouped.set(key, {
                name: item.name,
                showName: cleanName,
                customer: customer,
                itemCode: item.itemCode || '',
                shape: item.shape,
                w: item.w,
                h: item.h,
                d: item.d,
                color: item.color,
                singleWeight: item.weight || 0,
                count: 0,
                totalWeight: 0
            });
        }
        const g = grouped.get(key);
        g.count++;
        g.totalWeight += item.weight || 0;
    });

    const rows = [...grouped.values()].sort((a, b) => b.totalWeight - a.totalWeight);
    return rows.map((g, i) => {
        const dimStr = g.shape === 'cylinder'
            ? `⌀${g.w}×H${g.h}`
            : `${g.w}×${g.h}×${g.d}`;
        return `
            <tr style="${i % 2 === 0 ? 'background:#fafafa;' : ''}">
                <td><span class="pdf-color-dot" style="background:${escapeHtml(g.color)};"></span></td>
                <td style="font-size:9px;">${escapeHtml(g.itemCode)}</td>
                <td style="text-align:left;">${escapeHtml(g.showName)}</td>
                <td>${escapeHtml(g.customer)}</td>
                <td>${dimStr}</td>
                <td>${g.singleWeight.toFixed(1)}</td>
                <td>${g.count}</td>
            </tr>`;
    }).join('');
}

function buildExecutionConclusion(furnace, volUtil, weightUtil) {
    const v = parseFloat(volUtil) || 0;
    const w = parseFloat(weightUtil) || 0;

    if (w > 95) {
        return {
            status: '需复核',
            title: '⚠️ 执行结论：承重接近上限，装炉前必须复核',
            desc: `本炉承重利用率为 ${weightUtil}%，已接近设备承重上限。请现场确认料框、搁板和工件实际重量，必要时拆分炉次。`,
            bg: '#fef2f2',
            border: '#fca5a5',
            color: '#dc2626'
        };
    }

    if (v > 85) {
        return {
            status: '紧凑装炉',
            title: '⚠️ 执行结论：空间利用率较高，注意气流通道',
            desc: `本炉空间利用率为 ${volUtil}%，摆放较紧凑。请按分层图执行，避免现场随意改变位置导致遮挡或气流不均。`,
            bg: '#fff7ed',
            border: '#fdba74',
            color: '#c2410c'
        };
    }

    return {
        status: '可执行',
        title: '✅ 执行结论：当前方案可作为现场装炉指导',
        desc: `本炉共装入 ${furnace.packedItems.length} 件工件，总重量 ${furnace.totalWeight.toFixed(1)} kg，空间利用率 ${volUtil}%，承重利用率 ${weightUtil}%。请按照第 2 页分层步骤自下而上装炉。`,
        bg: '#f0fdf4',
        border: '#86efac',
        color: '#166534'
    };
}

// ==================== PAGE 2: 装炉步骤图 ====================

function buildPage2_StepByStep(furnace, layeredShots, pdfWrapper, multiLabel) {
    const page = document.createElement('div');
    page.className = 'pdf-page pdf-page-steps';

    let stepsHTML = '';

    if (layeredShots && layeredShots.length > 0) {
        layeredShots.forEach((shot, idx) => {
            const stepNum = idx + 1;
            const layerLabel = shot.layerLabel || ('第 ' + shot.layerIndex + ' 层');

            const operationTitle = shot.hasShelf
                ? `Step ${stepNum}：安装搁板并放置 ${layerLabel} 工件`
                : `Step ${stepNum}：放置 ${layerLabel} 工件`;

            let itemsHTML = '';
            if (shot.items && shot.items.length > 0) {
                itemsHTML = shot.items.map(item => {
                    const avgWeight = item.count > 0 ? (item.totalWeight / item.count).toFixed(1) : '0.0';
                    /** V3.4: 工件名称净化 — 只展示干净的产品名称(客户) */
                    const cleanName = item.showName || (item.name ? item.name.split('_')[0] : '未知');
                    const customer = item.customer || '';
                    const customerStr = customer ? ` (${escapeHtml(customer)})` : '';
                    return `
                        <div class="item-entry">
                            <span>
                                <span class="pdf-color-dot" style="background:${escapeHtml(item.color || '#888')};"></span>
                                ${escapeHtml(cleanName)}${customerStr} × ${item.count} 件
                            </span>
                            <span>${escapeHtml(item.dimensions || '')} · ${avgWeight}kg/件 · ${escapeHtml(item.material || '—')} · ${escapeHtml(item.process || '—')}</span>
                        </div>`;
                }).join('');
            }

            let shelfLine = '';
            if (shot.hasShelf && shot.shelfInfo) {
                shelfLine = `<div class="info-row">
                    <span class="info-label">搁板</span>
                    <span class="info-value">${shot.shelfInfo.dimensions} (厚${shot.shelfInfo.thickness}mm) × 1</span>
                </div>`;
            }

        stepsHTML += `
            <div class="pdf-step-block" style="margin-bottom: 8px !important; padding: 8px !important; border-radius: 4px !important;">
                <div class="pdf-step-block-header" style="padding-bottom: 3px !important; margin-bottom: 6px !important;">
                    <span class="pdf-step-number">${stepNum}</span>
                    <span class="pdf-step-layer-label">${operationTitle}</span>
                    <span class="pdf-step-layer-meta">${shot.itemCount || 0} 件 · ${(shot.totalWeight || 0).toFixed(1)} kg</span>
                </div>
                <div class="pdf-step-block-body" style="flex-direction:column;">
                    <div style="display:flex;gap:6px;margin-bottom:6px;">
                        <div class="pdf-step-image-area" style="flex: 2.5; background: #fff; border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                            ${shot.isolateDataURL ? `<img src="${shot.isolateDataURL}" alt="Layer ${stepNum} 正交俯视" style="width: 100%; height: auto; object-fit: contain; border-bottom: 1px dashed #e2e8f0; padding-bottom: 2px;">` : '<span style="color:#ccc;">俯视图未生成</span>'}
                            <div style="font-size:9px; color:#ef4444; margin-top:2px; font-weight:bold; text-align:center;">⬇ 正交俯视图</div>
                        </div>
                        
                        <div class="pdf-step-image-area" style="flex: 1; background: #fafafa; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                            ${shot.dataURL ? `<img src="${shot.dataURL}" alt="Step ${stepNum}" style="width: 100%; height: auto; object-fit: contain;">` : '<span style="color:#ccc;">透视图未生成</span>'}
                            <div style="font-size:9px; color:#64748b; margin-top:2px; font-weight:bold; text-align:center;">↖ 装配透视图</div>
                        </div>
                    </div>
                    <div class="pdf-step-info-area" style="flex:none; width:100%; padding-top: 2px !important;">
                        <div class="info-row" style="margin-bottom: 2px !important; font-size: 11px !important;">
                            <span class="info-label">层编号</span>
                            <span class="info-value">${shot.layerIndex || stepNum}</span>
                        </div>
                        <div class="info-row" style="margin-bottom: 2px !important; font-size: 11px !important;">
                            <span class="info-label">工件数量</span>
                            <span class="info-value">${shot.itemCount || 0} 件</span>
                        </div>
                        <div class="info-row" style="margin-bottom: 2px !important; font-size: 11px !important;">
                            <span class="info-label">本层总重</span>
                            <span class="info-value">${(shot.totalWeight || 0).toFixed(1)} kg</span>
                        </div>
                        <div class="info-row" style="margin-bottom: 2px !important; font-size: 11px !important;">
                            <span class="info-label">现场动作</span>
                            <span class="info-value">${shot.hasShelf ? '先确认搁板放置到位，再摆放本层工件' : '按俯视图位置摆放本层工件'}</span>
                        </div>
                        ${shelfLine ? shelfLine.replace(/class="info-row"/g, 'class="info-row" style="margin-bottom: 2px !important; font-size: 11px !important;"') : ''}
                        <div class="info-items-list" style="margin-top: 4px !important; padding-top: 4px !important;">
                            <div style="font-weight:bold;margin-bottom:2px;font-size:10px;">📦 本层工件明细：</div>
                            ${itemsHTML || '<div style="color:#999;">暂无工件</div>'}
                        </div>
                    </div>
                </div>
            </div>`;
        });
    } else {
        // 🔧 降级展示：无截图数据时，直接展示工件清单
        const uniqueNames = new Set();
        furnace.packedItems.forEach(item => uniqueNames.add(item.name));

        let fallbackItemsHTML = '';
        const grouped = new Map();
        furnace.packedItems.forEach(item => {
            const key = item.name;
            if (!grouped.has(key)) {
                grouped.set(key, { name: item.name, shape: item.shape, dims: `${item.w}×${item.h}×${item.d}`, color: item.color, count: 0, totalWeight: 0 });
            }
            const g = grouped.get(key);
            g.count++;
            g.totalWeight += item.weight || 0;
        });

        [...grouped.values()].sort((a, b) => b.totalWeight - a.totalWeight).forEach(g => {
            fallbackItemsHTML += `<tr>
                <td style="padding:4px 8px;border:1px solid #ddd;font-size:10px;">
                    <span style="display:inline-block;width:10px;height:10px;background:${escapeHtml(g.color)};border-radius:2px;margin-right:4px;vertical-align:middle;"></span>${escapeHtml(g.name)}
                </td>
                <td style="padding:4px 8px;border:1px solid #ddd;font-size:10px;text-align:center;">${g.shape === 'cylinder' ? '圆柱' : '立方'}</td>
                <td style="padding:4px 8px;border:1px solid #ddd;font-size:10px;text-align:center;">${g.dims} mm</td>
                <td style="padding:4px 8px;border:1px solid #ddd;font-size:10px;text-align:center;">${g.count} 件</td>
                <td style="padding:4px 8px;border:1px solid #ddd;font-size:10px;text-align:center;">${g.totalWeight.toFixed(1)} kg</td>
            </tr>`;
        });

        stepsHTML = `
            <div style="text-align:center;padding:20px;margin-bottom:12px;background:#fff8e1;border:1px solid #ffe082;border-radius:6px;font-size:12px;color:#f57f17;">
                ⚠️ 3D分层截图未能生成，以下为工件完整清单。请确保3D场景已正确渲染后重新导出。
            </div>
            <div style="font-size:14px;font-weight:bold;margin-bottom:10px;">📦 全部工件清单（${furnace.packedItems.length} 件）</div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                <thead>
                    <tr style="background:#f1f5f9;">
                        <th style="border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:10px;">工件名称</th>
                        <th style="border:1px solid #ccc;padding:6px 8px;text-align:center;font-size:10px;">形态</th>
                        <th style="border:1px solid #ccc;padding:6px 8px;text-align:center;font-size:10px;">尺寸</th>
                        <th style="border:1px solid #ccc;padding:6px 8px;text-align:center;font-size:10px;">数量</th>
                        <th style="border:1px solid #ccc;padding:6px 8px;text-align:center;font-size:10px;">总重</th>
                    </tr>
                </thead>
                <tbody>${fallbackItemsHTML}</tbody>
            </table>`;
    }

    page.innerHTML = `
        <div class="pdf-steps-header">
            <div class="pdf-steps-title">🛠️ 装炉步骤图${multiLabel}</div>
            <div class="pdf-steps-subtitle">
                炉次：${escapeHtml(furnace.instanceId)} · Step 1 ~ N 逐层装炉顺序
            </div>
        </div>
        ${stepsHTML}
        <div class="pdf-page-footer">第 2 页 · 装炉步骤</div>
    `;

    pdfWrapper.appendChild(page);
}

// ==================== PAGE 3: AI 评分页面 ====================

function buildPage3_AIScoring(furnace, pdfWrapper, multiLabel) {
    const page = document.createElement('div');
    page.className = 'pdf-page pdf-page-ai';

    const totalVol = furnace.w * furnace.h * furnace.d;
    const packedVol = furnace.packedItems.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
    const volUtil = totalVol > 0 ? ((packedVol / totalVol) * 100).toFixed(1) : '0.0';
    const weightUtil = furnace.max_weight > 0 ? ((furnace.totalWeight / furnace.max_weight) * 100).toFixed(1) : '0.0';

    const processSet = new Set();
    const materialSet = new Set();
    furnace.packedItems.forEach(item => {
        if (item.process) processSet.add(item.process);
        if (item.material) materialSet.add(item.material);
    });

    page.innerHTML = `
        <div class="pdf-ai-header">
            <div class="pdf-ai-title">AI 评分与现场注意事项${multiLabel}</div>
            <div class="pdf-ai-subtitle">装炉方案综合评估 · 现场执行确认 · 炉次：${escapeHtml(furnace.instanceId)}</div>
        </div>

        <!-- 装炉策略信息 -->
        <div class="pdf-strategy-info" style="margin: 6px 0 8px 0; padding: 4px 8px; background: #f0f9ff; border-left: 4px solid #0891b2; border-radius: 4px; font-size: 10px; color: #0c4a6e;">
            <strong>📐 装炉策略：</strong>${getStrategyDisplay().name} &nbsp;|&nbsp; ${getStrategyDisplay().desc}
        </div>

        <div style="margin-bottom:24px;">
            <div style="font-size:15px;font-weight:bold;color:#1a1a1a;margin-bottom:14px;">装炉方案评估表</div>
            <table class="pdf-material-table">
                <thead>
                    <tr>
                        <th style="width:120px;">评分维度</th>
                        <th style="width:80px;">得分</th>
                        <th style="width:60px;">权重</th>
                        <th>评估说明</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="font-weight:bold;">空间利用率</td>
                        <td>${volUtil}%</td>
                        <td>35%</td>
                        <td style="text-align:left;font-size:10px;">炉膛体积 ${totalVol.toLocaleString()} mm³ · 已用 ${packedVol.toLocaleString()} mm³</td>
                    </tr>
                    <tr style="background:#fafafa;">
                        <td style="font-weight:bold;">承重利用率</td>
                        <td>${weightUtil}%</td>
                        <td>30%</td>
                        <td style="text-align:left;font-size:10px;">最大承重 ${furnace.max_weight} kg · 实际装炉 ${furnace.totalWeight.toFixed(1)} kg</td>
                    </tr>
                    <tr>
                        <td style="font-weight:bold;">工艺兼容性</td>
                        <td>—</td>
                        <td>20%</td>
                        <td style="text-align:left;font-size:10px;">共 ${processSet.size} 种工艺类型 · 兼容性待 AI 深度评估</td>
                    </tr>
                    <tr style="background:#fafafa;">
                        <td style="font-weight:bold;">材质近似度</td>
                        <td>—</td>
                        <td>15%</td>
                        <td style="text-align:left;font-size:10px;">共 ${materialSet.size} 种材质 · 同质归集度待 AI 评估</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div style="margin-bottom:20px;padding:16px;border:1px solid #ddd;border-radius:6px;">
            <div style="font-size:13px;font-weight:bold;color:#1a1a1a;margin-bottom:12px;">利用率对比</div>
            <div class="pdf-ai-score-item" style="margin-bottom:8px;">
                <span class="score-item-label">空间</span>
                <div class="score-item-bar" style="flex:1;height:14px;background:#eee;border-radius:4px;overflow:hidden;">
                    <div class="score-item-fill" style="width:${Math.min(parseFloat(volUtil), 100)}%;height:100%;background:#555;"></div>
                </div>
                <span class="score-item-value" style="width:50px;">${volUtil}%</span>
            </div>
            <div class="pdf-ai-score-item">
                <span class="score-item-label">承重</span>
                <div class="score-item-bar" style="flex:1;height:14px;background:#eee;border-radius:4px;overflow:hidden;">
                    <div class="score-item-fill" style="width:${Math.min(parseFloat(weightUtil), 100)}%;height:100%;background:#555;"></div>
                </div>
                <span class="score-item-value" style="width:50px;">${weightUtil}%</span>
            </div>
        </div>
                <div style="margin-top:18px;padding:14px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;">
            <div style="font-size:13px;font-weight:bold;color:#0f172a;margin-bottom:10px;">📌 现场装炉注意事项</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;line-height:1.6;color:#334155;">
                <div>□ 装炉前确认炉膛 / 工装方向与第 1 页视图一致</div>
                <div>□ 按第 2 页步骤自下而上装炉</div>
                <div>□ 每层工件摆放完成后再安装下一层搁板</div>
                <div>□ 同色物料对应同一批次，禁止混料</div>
                <div>□ 若现场尺寸、数量、重量与清单不一致，停止装炉并反馈工艺员</div>
                <div>□ 若承重或间距存在疑问，优先选择拆分炉次</div>
            </div>
        </div>

        <div style="margin-top:14px;border-top:1px solid #e2e8f0;padding-top:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
            <div style="border:1px solid #cbd5e1;border-radius:6px;padding:12px;text-align:center;">
                <div style="font-size:10px;color:#64748b;margin-bottom:30px;">装炉执行人</div>
                <div style="border-top:1px solid #94a3b8;padding-top:5px;font-size:9px;color:#94a3b8;">签名 / 日期</div>
            </div>
            <div style="border:1px solid #cbd5e1;border-radius:6px;padding:12px;text-align:center;">
                <div style="font-size:10px;color:#64748b;margin-bottom:30px;">工艺复核人</div>
                <div style="border-top:1px solid #94a3b8;padding-top:5px;font-size:9px;color:#94a3b8;">签名 / 日期</div>
            </div>
            <div style="border:1px solid #cbd5e1;border-radius:6px;padding:12px;text-align:center;">
                <div style="font-size:10px;color:#64748b;margin-bottom:30px;">现场确认人</div>
                <div style="border-top:1px solid #94a3b8;padding-top:5px;font-size:9px;color:#94a3b8;">签名 / 日期</div>
            </div>
        </div>
        <div class="pdf-page-footer">第 3 页· AI评分与现场注意事项</div>
    `;

    pdfWrapper.appendChild(page);
}

// ==================== PUBLIC API ====================

/**
 * 为指定的炉膛索引数组生成三页式 PDF
 *
 * @param {number[]} selectedFurnaceIds - 选中的炉膛索引数组
 * @returns {Promise<void>}
 */
export async function generateSixPagePDF(selectedFurnaceIds) {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) {
        alert('请先生成装炉方案');
        return;
    }

    if (!selectedFurnaceIds || selectedFurnaceIds.length === 0) {
        alert('请至少选择一个炉膛');
        return;
    }

    const validIds = selectedFurnaceIds.filter(
        idx => idx >= 0 && idx < globalFurnacesResult.length
    );
    if (validIds.length === 0) {
        alert('未找到有效的炉膛方案');
        return;
    }

    const pdfWrapper = document.getElementById('pdf-hidden-template');
    if (!pdfWrapper) {
        alert('PDF 模板容器未找到');
        return;
    }

    pdfWrapper.innerHTML = '';

    const totalPages = validIds.length * 3;
    console.log(`[三页式PDF] 开始生成，共 ${validIds.length} 个炉膛，${totalPages} 页`);

    for (let fi = 0; fi < validIds.length; fi++) {
        const furnaceIndex = validIds[fi];
        const furnace = globalFurnacesResult[furnaceIndex];
        const globalPageLabel = fi + 1;

        console.log(`[三页式PDF] 正在处理炉膛 ${globalPageLabel}/${validIds.length}: ${furnace.instanceId}`);

        // ===== 截图阶段（串行执行）=====

        // 第1页左栏：料框正面透视图
        console.log('  → 截图：料框正面透视图');
        const frontViewShot = await captureFrontViewShot(furnaceIndex);

        // 第1页左栏：料框侧面透视图
        console.log('  → 截图：料框侧面透视图');
        const sideViewShot = await captureSideViewShot(furnaceIndex);

        // 第1页右栏：爆炸图（垂直展开 + 侧45度 + 保留料框）
        console.log('  → 截图：爆炸视图');
        const explodeShot = await captureExplodeShot(furnaceIndex);

        // 第2页：分层步骤截图
        console.log('  → 截图：分层步骤（Step 1~N）');
        const layeredShots = await captureLayeredScreenshots(furnaceIndex);

        // ===== 构建页面 =====
        console.log('  → 构建三页 HTML');
        const screenshots = {
            frontView: frontViewShot,
            sideView: sideViewShot,
            explode: explodeShot,
            layered: layeredShots
        };

        buildThreePagesForFurnace(
            furnace,
            furnaceIndex,
            screenshots,
            pdfWrapper,
            globalPageLabel,
            validIds.length
        );
    }

    // ===== 导出 PDF =====
    console.log('[三页式PDF] 正在渲染 PDF...');

    pdfWrapper.style.display = 'block';

    let filename;
    if (validIds.length === 1) {
        const furnace = globalFurnacesResult[validIds[0]];
        filename = `装炉方案_${furnace.instanceId.replace(/[^\w\u4e00-\u9fa5]/g, '_')}_${Date.now()}.pdf`;
    } else {
        filename = `装炉方案_多炉膛汇总_${validIds.length}炉_${Date.now()}.pdf`;
    }

    const opt = {
        margin: 0,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            allowTaint: true
        },
        jsPDF: {
            unit: 'px',
            format: [794, 1123],
            orientation: 'portrait'
        },
        pagebreak: { mode: ['css', 'legacy'] }
    };

    try {
        await html2pdf().set(opt).from(pdfWrapper).save();
        console.log('[三页式PDF] ✅ PDF 导出成功');
    } catch (err) {
        console.error('[三页式PDF] ❌ PDF 导出失败:', err);
        alert('PDF 导出失败：' + err.message);
    } finally {
        pdfWrapper.style.display = 'none';
        pdfWrapper.innerHTML = '';
    }
}

// ==================== UTILITY ====================

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/**
 * 根据当前策略键返回显示名称和简短描述
 */
function getStrategyDisplay() {
    const strategyKey = placementRules.strategy || 'balanced';
    const strategyMap = {
        balanced: {
            name: '重心稳定',
            desc: '由外向内逐层填充，对称分布，重心居中'
        },
        spaceUtil: {
            name: '空间利用率优先',
            desc: '塞满炉子，强力贴边紧凑，忽略重心'
        },
        thermalBalance: {
            name: '热场均衡装载',
            desc: '避免中心聚集，控制局部密度，温度均匀'
        },
        surfaceUniform: {
            name: '表面均匀性优先',
            desc: '最大暴露面积，避免遮挡，气流路径一致'
        }
    };
    return strategyMap[strategyKey] || strategyMap.balanced;
}