// ==================== 模块2：模具与产品管理 ====================

import { BATCH_COLORS } from '../utils/constants.js';
import { parseExcelFile, generateExcelTemplate } from '../utils/excel.js';

/**
 * 模具与产品管理模块
 * 负责工件的创建、编辑、删除、Excel导入、物料速览
 */
export class ProductManagement {
    constructor(formManager, sceneManager) {
        this.formManager = formManager;
        this.sceneManager = sceneManager;
        this.batchColorIndex = 0;
        this.highlightedBatchName = null;
        this._onHighlightCallback = null;
    }

    /**
     * 初始化产品管理 UI 事件
     */
    init() {
        // 绑定"增加工件批次"按钮
        const btnAddItem = document.getElementById('btn-add-item');
        if (btnAddItem) {
            btnAddItem.addEventListener('click', () => {
                this.batchColorIndex++;
                const color = BATCH_COLORS[this.batchColorIndex % BATCH_COLORS.length];
                const batchName = '工件批次_' + this.batchColorIndex;
                this.formManager.addItemRow(batchName, 'cuboid', 10, 50, 50, 60, 1500, color);
                this.refreshItemQuickSummary();
            });
        }

        // 绑定 Excel 导入按钮
        const btnImportExcel = document.getElementById('btn-import-excel');
        const excelFileInput = document.getElementById('excel-file-input');

        if (btnImportExcel && excelFileInput) {
            btnImportExcel.addEventListener('click', () => {
                excelFileInput.click();
            });

            excelFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this._handleExcelImport(file);
                }
                excelFileInput.value = '';
            });
        }

        // 监听工件变更事件
        window.addEventListener('item-changed', () => {
            this.refreshItemQuickSummary();
        });
    }

    /**
     * 处理 Excel 文件导入
     */
    _handleExcelImport(file) {
        if (!file) return;

        const validTypes = ['.xlsx', '.xls', '.csv'];
        const fileName = file.name.toLowerCase();
        const isValid = validTypes.some(ext => fileName.endsWith(ext));

        if (!isValid) {
            alert('请选择 Excel (.xlsx/.xls) 或 CSV 文件');
            return;
        }

        parseExcelFile(file).then(result => {
            if (result.errors && result.errors.length > 0) {
                console.warn('Excel 解析警告:', result.errors);
            }
            this._showExcelPreviewModal(result);
        }).catch(err => {
            alert('Excel 导入失败: ' + err.message);
            console.error(err);
        });
    }

    /**
     * 显示 Excel 预览弹窗
     */
    _showExcelPreviewModal(parseResult) {
        const overlay = document.getElementById('excel-preview-overlay');
        const modal = document.getElementById('excel-preview-modal');
        if (!overlay || !modal) return;

        const { items, errors, sheetName, headers } = parseResult;

        let itemsHtml = '';
        items.forEach((item, idx) => {
            const shapeLabel = item.shape === 'cylinder' ? '圆柱体' : '立方体';
            const dimLabel = item.shape === 'cylinder'
                ? 'Φ' + item.dim1 + ' x H' + item.dim3
                : item.dim1 + ' x ' + item.dim2 + ' x ' + item.dim3;

            itemsHtml += '<tr>';
            itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:12px;">' + (idx + 1) + '</td>';
            itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:12px; color:#fff;">' + item.name + '</td>';
            itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:11px;">' + shapeLabel + '</td>';
            itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:11px;">' + dimLabel + '</td>';
            itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:11px;">' + item.count + ' 件</td>';
            itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:11px;">' + item.weight.toFixed(1) + ' kg</td>';
            itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:11px; color:#f39c12;">' + (item.materialType || '-') + '</td>';
            itemsHtml += '<td style="padding:6px 8px; border-bottom:1px solid #333344; font-size:10px; color:#888;">' + (item.hardness || '-') + '</td>';
            itemsHtml += '</tr>';
        });

        let errorsHtml = '';
        if (errors && errors.length > 0) {
            errorsHtml = '<div style="background: rgba(179,36,36,0.2); border: 1px solid #b32424; border-radius: 6px; padding: 10px; margin-bottom: 15px;">';
            errorsHtml += '<strong style="color: #ff6666;">解析警告 (' + errors.length + '条):</strong>';
            errorsHtml += '<ul style="margin: 5px 0 0 16px; padding: 0; font-size: 11px; color: #ff9999;">';
            errors.forEach(e => { errorsHtml += '<li>' + e + '</li>'; });
            errorsHtml += '</ul></div>';
        }

        modal.innerHTML = (
            '<h3 style="margin: 0 0 4px 0; color: #fff; font-size: 18px;">Excel 数据预览</h3>' +
            '<p style="font-size: 11px; color: #666; margin: 0 0 16px 0;">' +
            '工作表: <span style="color: #2ecc71;">' + sheetName + '</span> . ' +
            '识别到 <span style="color: #f39c12;">' + items.length + '</span> 个工件批次 . ' +
            '表头列: ' + headers.join(', ') +
            '</p>' +
            errorsHtml +
            '<div style="max-height: 350px; overflow-y: auto; margin-bottom: 16px; border: 1px solid #333344; border-radius: 6px;">' +
            '<table style="width: 100%; border-collapse: collapse; color: #d1d1de;">' +
            '<thead><tr style="background: #222230; position: sticky; top: 0;">' +
            '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">#</th>' +
            '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">名称</th>' +
            '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">几何形态</th>' +
            '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">尺寸</th>' +
            '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">数量</th>' +
            '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">总重</th>' +
            '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">材质</th>' +
            '<th style="padding:8px; font-size:11px; text-align:left; border-bottom:2px solid #0066cc;">硬度</th>' +
            '</tr></thead>' +
            '<tbody>' + itemsHtml + '</tbody>' +
            '</table></div>' +
            '<div style="display: flex; gap: 10px;">' +
            '<button id="excel-preview-cancel" style="flex: 1; padding: 10px; background: #3e3e52; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold;">取消</button>' +
            '<button id="excel-preview-append" style="flex: 1; padding: 10px; background: #217346; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold;">追加到待处理列表</button>' +
            '<button id="excel-preview-replace" style="flex: 1; padding: 10px; background: #0066cc; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold;">替换当前列表</button>' +
            '</div>' +
            '<div style="margin-top: 10px;">' +
            '<button id="excel-preview-download-template" style="width: 100%; padding: 8px; background: transparent; color: #666; border: 1px dashed #444; border-radius: 6px; cursor: pointer; font-size: 11px;">下载 Excel 导入模板</button>' +
            '</div>'
        );

        overlay.style.display = 'flex';

        document.getElementById('excel-preview-cancel').addEventListener('click', () => {
            overlay.style.display = 'none';
        });

        document.getElementById('excel-preview-append').addEventListener('click', () => {
            this._applyExcelItems(items, false);
            overlay.style.display = 'none';
        });

        document.getElementById('excel-preview-replace').addEventListener('click', () => {
            this._applyExcelItems(items, true);
            overlay.style.display = 'none';
        });

        document.getElementById('excel-preview-download-template').addEventListener('click', () => {
            const blob = generateExcelTemplate();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = '热处理工件导入模板.xlsx';
            a.click();
            URL.revokeObjectURL(url);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.style.display = 'none';
            }
        });
    }

    /**
     * 应用 Excel 导入的数据
     */
    _applyExcelItems(items, replace) {
        if (replace) {
            const container = document.getElementById('items-container');
            if (container) container.innerHTML = '';
            this.formManager.itemCounter = 0;
            this.batchColorIndex = 0;
        }

        items.forEach(item => {
            this.batchColorIndex++;
            const color = item.color || BATCH_COLORS[this.batchColorIndex % BATCH_COLORS.length];
            this.formManager.addItemRow(
                item.name,
                item.shape,
                item.count,
                item.dim1,
                item.dim2,
                item.dim3,
                item.weight,
                color,
                item.materialType || '',
                !!item.isDedicated
            );
        });

        this.refreshItemQuickSummary();
    }

    /**
     * 生成批次颜色
     */
    getBatchColor(batchName) {
        if (!batchName) return BATCH_COLORS[0];
        let hash = 0;
        for (let i = 0; i < batchName.length; i++) {
            hash = ((hash << 5) - hash) + batchName.charCodeAt(i);
            hash |= 0;
        }
        const idx = Math.abs(hash) % BATCH_COLORS.length;
        return BATCH_COLORS[idx];
    }

    /**
     * 刷新物料汇总速览
     */
    refreshItemQuickSummary() {
        const container = document.getElementById('item-quick-summary-container');
        if (!container) return;

        const itemsData = this.formManager.getItemsData();

        if (itemsData.length === 0) {
            container.innerHTML = '<div class="quick-summary-empty">暂无物料，添加后可在此速览并点击高亮</div>';
            return;
        }

        let html = '<div class="quick-summary-header"><span>⚡ 物料速览</span><span class="quick-summary-hint">点击高亮定位</span></div>';
        html += '<div class="quick-summary-list">';

        itemsData.forEach((item, idx) => {
            const colorHex = item.color || this.getBatchColor(item.name);
            const isHighlighted = this.highlightedBatchName === item.name;
            const highlightClass = isHighlighted ? ' qs-item-highlighted' : '';

            html += '<div class="quick-summary-item' + highlightClass + '" data-batch-name="' + item.name + '" data-item-idx="' + idx + '">';
            html += '<span class="qs-color-dot" style="background:' + colorHex + '; box-shadow: 0 0 6px ' + colorHex + ';"></span>';
            html += '<span class="qs-name" title="' + item.name + '">' + item.name + '</span>';
            html += '<span class="qs-count">×' + item.count + '</span>';
            if (item.isDedicated) {
                html += '<span class="qs-dedicated" title="专机包炉">🔒</span>';
            }
            html += '</div>';
        });

        html += '</div>';
        container.innerHTML = html;

        // 绑定点击事件（通过回调）
        container.querySelectorAll('.quick-summary-item').forEach(el => {
            el.addEventListener('click', () => {
                const batchName = el.getAttribute('data-batch-name');
                if (this._onHighlightCallback) {
                    this._onHighlightCallback(batchName);
                }
            });
        });
    }

    /**
     * 设置高亮回调
     */
    onHighlight(callback) {
        this._onHighlightCallback = callback;
    }

    /**
     * 设置高亮批次名（外部更新）
     */
    setHighlightedBatch(name) {
        this.highlightedBatchName = name;
        this.refreshItemQuickSummary();
    }
}