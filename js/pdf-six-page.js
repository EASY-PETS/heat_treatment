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
    globalFurnacesResult
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
                <div class="pdf-thumb-box pdf-thumb-box-large" style="height: 320px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                    ${screenshots.explode ? `<img src="${screenshots.explode}" alt="爆炸视图">` : '<span class="no-shot-text">生成中...</span>'}
                </div>
            </div>
        </div>

        <!-- 签字区（紧凑） -->
        <div class="pdf-signature-section pdf-signature-compact" style="margin-top: 6px !important; padding: 4px 0 !important;">
            <div class="pdf-signature-grid">
                <div class="pdf-signature-box">
                    <div class="sig-role">编制人<br>Prepared by</div>
                    <div class="sig-line">签名 / 日期</div>
                </div>
                <div class="pdf-signature-box">
                    <div class="sig-role">审核人<br>Reviewed by</div>
                    <div class="sig-line">签名 / 日期</div>
                </div>
                <div class="pdf-signature-box">
                    <div class="sig-role">批准人<br>Approved by</div>
                    <div class="sig-line">签名 / 日期</div>
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

// ==================== PAGE 2: 装炉步骤图 ====================

function buildPage2_StepByStep(furnace, layeredShots, pdfWrapper, multiLabel) {
    const page = document.createElement('div');
    page.className = 'pdf-page pdf-page-steps';

    let stepsHTML = '';

    if (layeredShots && layeredShots.length > 0) {
        layeredShots.forEach((shot, idx) => {
            const stepNum = idx + 1;
            const layerLabel = shot.layerLabel || ('第 ' + shot.layerIndex + ' 层');

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
                    <span class="pdf-step-layer-label">${layerLabel}</span>
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
        stepsHTML = '<div style="text-align:center;padding:40px;color:#999;">暂无分层截图数据</div>';
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
            <div class="pdf-ai-title">AI 智能评分${multiLabel}</div>
            <div class="pdf-ai-subtitle">装炉方案综合评估 · 炉次：${escapeHtml(furnace.instanceId)}</div>
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

        <div style="position:absolute;bottom:50px;left:40px;font-size:9px;color:#666;">
            联系人: 影在科技.Charles
        </div>

        <div class="pdf-page-footer">第 3 页 · AI 评分</div>
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
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, '&#39;');
}