// ==================== 工业PDF导出入口模块 ====================

import { createSummaryPage } from './createSummaryPage.js';
import { createFurnaceDetailPage, createIsometricOverviewPage } from './createViewPage.js';
import { PDF_CONFIG, VIEW_CONFIGS } from '../js/utils/constants.js';
import { generatePDFFilename } from '../js/utils/helpers.js';

/**
 * 生成工业标准热处理装炉工艺报告PDF
 * @param {Object} options
 * @param {Array} options.furnaces - 已装炉炉膛数组
 * @param {Array} options.unpackedItems - 未装炉工件数组
 */
export async function generateIndustrialPDF({ furnaces, unpackedItems = [] }) {
    if (!furnaces || furnaces.length === 0) {
        console.warn('没有炉膛数据，无法生成PDF');
        return;
    }
    
    const pdfWrapper = document.getElementById('pdf-hidden-template');
    if (!pdfWrapper) {
        console.error('PDF容器未找到');
        return;
    }
    
    // 清空之前的PDF内容
    pdfWrapper.innerHTML = '';
    
    // ========== 第1页: 装炉作业总览 ==========
    console.log('📄 生成汇总页...');
    createSummaryPage({ pdfWrapper, furnaces, unpackedItems });
    
    // ========== 为每个炉次生成详情页 ==========
    let globalSeq = 1;
    
    furnaces.forEach((furnace, furnaceIdx) => {
        console.log(`📄 生成 ${furnace.instanceId} 详情页...`);
        
        // 详情页（三视图 + 图例 + 放置顺序表）
        globalSeq = createFurnaceDetailPage({
            pdfWrapper,
            furnace,
            viewConfigs: VIEW_CONFIGS,
            globalSeqStart: globalSeq,
            furnaceEntryDirection: getFurnaceEntryDirection(furnaceIdx, furnace)
        });
    });
    
    // 显示PDF容器
    pdfWrapper.style.display = 'block';
    
    // 配置html2pdf选项
    const opt = {
        margin: PDF_CONFIG.margin || 0,
        filename: generatePDFFilename(),
        image: { type: 'jpeg', quality: PDF_CONFIG.imageQuality || 0.98 },
        html2canvas: { 
            scale: PDF_CONFIG.scale || 3,
            useCORS: true,
            logging: false,
            letterRendering: true,
            allowTaint: true
        },
        jsPDF: { 
            unit: 'px', 
            format: [PDF_CONFIG.pageWidth, PDF_CONFIG.pageHeight], 
            orientation: PDF_CONFIG.orientation || 'landscape',
            compress: true
        },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };
    
    try {
        console.log('🖨️ 开始生成PDF...');
        await html2pdf().set(opt).from(pdfWrapper).save();
        console.log('✅ PDF生成完成!');
    } catch (error) {
        console.error('PDF生成失败:', error);
    } finally {
        // 隐藏PDF容器
        pdfWrapper.style.display = 'none';
    }
}

/**
 * 根据炉次索引生成进炉方向描述
 * @param {number} furnaceIdx - 炉次索引
 * @param {Object} furnace - 炉膛数据
 * @returns {string}
 */
function getFurnaceEntryDirection(furnaceIdx, furnace) {
    const furnaceName = furnace.instanceId || `炉次#${furnaceIdx + 1}`;
    
    // 台车炉通常从Z轴方向（顶视图下方）进炉
    if (furnaceName.includes('台车')) {
        return '沿台车轨道方向从炉口(顶视图下方)沿Z轴推入炉膛';
    }
    // 井式炉通常从顶部放入
    if (furnaceName.includes('井式')) {
        return '⚠ 井式炉: 工件从炉顶正上方沿Y轴方向吊装入炉';
    }
    // 默认方向
    return '从炉门侧(顶视图下方)沿Z轴方向推入炉膛';
}

/**
 * 导出并保存PDF (浏览器会触发下载)
 * @param {Object} packingResult - 装炉结果
 */
export function exportPDF(packingResult) {
    if (!packingResult || !packingResult.furnaces) {
        console.error('无效的装炉结果数据');
        return;
    }
    
    return generateIndustrialPDF({
        furnaces: packingResult.furnaces,
        unpackedItems: packingResult.unpacked || []
    });
}

export default { generateIndustrialPDF, exportPDF };