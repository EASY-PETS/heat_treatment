// ==================== 模块5：PDF文档管理 ====================

import { VACUUM_LEVEL_OPTIONS, HEATING_PROGRAM_OPTIONS } from '../utils/constants.js';
import { formatDateTime } from '../utils/helpers.js';
import { exportPDF } from '../../PDF/exportPDF.js';

/**
 * PDF文档管理模块
 * 负责PDF导出、工艺校准单确认（SOP Verification）
 */
export class PDFManagement {
    constructor() {
        this.globalFurnacesResult = null;
        this.globalUnpackedItems = [];
    }

    /**
     * 初始化PDF管理 UI 事件
     */
    init() {
        const btnExportPDF = document.getElementById('btn-export-pdf');
        if (btnExportPDF) {
            btnExportPDF.addEventListener('click', () => {
                if (!this.globalFurnacesResult) return;
                this._showSOPVerificationModal();
            });
        }
    }

    /**
     * 更新方案结果引用
     */
    updateResult(furnaces, unpacked) {
        this.globalFurnacesResult = furnaces;
        this.globalUnpackedItems = unpacked;
    }

    /**
     * 显示工艺校准单确认弹窗（SOP Verification）
     */
    _showSOPVerificationModal() {
        const oldOverlay = document.getElementById('sop-modal-overlay');
        if (oldOverlay) oldOverlay.remove();

        const overlay = document.createElement('div');
        overlay.id = 'sop-modal-overlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 9999; display: flex; align-items: center; justify-content: center;';

        let vacuumOptions = '';
        VACUUM_LEVEL_OPTIONS.forEach(opt => {
            vacuumOptions += '<option value="' + opt.value + '">' + opt.label + '</option>';
        });
        let heatingOptions = '';
        HEATING_PROGRAM_OPTIONS.forEach(opt => {
            heatingOptions += '<option value="' + opt.value + '">' + opt.label + '</option>';
        });

        overlay.innerHTML = (
            '<div style="background: #1a1a24; border: 2px solid #0066cc; border-radius: 12px; padding: 28px 32px; width: 480px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.6); color: #d1d1de;">' +
            '<h2 style="margin: 0 0 6px 0; color: #fff; font-size: 20px; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">工艺校准单确认 (SOP Verification)</h2>' +
            '<p style="font-size: 12px; color: #9999aa; margin: 0 0 20px 0;">在导出 PDF 报告前，请确认以下工艺参数（必填项）</p>' +
            '<div style="margin-bottom: 18px;">' +
            '<label style="display: block; font-size: 13px; color: #9999aa; margin-bottom: 6px;">目标真空度 (Vacuum Level) <span style="color: #ef4444;">*</span></label>' +
            '<select id="sop-vacuum-level" style="width: 100%; padding: 10px 12px; background: #161620; border: 1px solid #333344; color: #fff; border-radius: 6px; font-size: 14px;">' + vacuumOptions + '</select>' +
            '</div>' +
            '<div style="margin-bottom: 18px;">' +
            '<label style="display: block; font-size: 13px; color: #9999aa; margin-bottom: 6px;">执行加热曲线程序号 (Heating Program) <span style="color: #ef4444;">*</span></label>' +
            '<select id="sop-heating-program" style="width: 100%; padding: 10px 12px; background: #161620; border: 1px solid #333344; color: #fff; border-radius: 6px; font-size: 14px;">' + heatingOptions + '</select>' +
            '</div>' +
            '<div style="margin-bottom: 18px;">' +
            '<label style="display: block; font-size: 13px; color: #9999aa; margin-bottom: 6px;">操作员姓名 (Operator)</label>' +
            '<input type="text" id="sop-operator" placeholder="输入主操手姓名" style="width: 100%; padding: 10px 12px; background: #161620; border: 1px solid #333344; color: #fff; border-radius: 6px; font-size: 14px; box-sizing: border-box;">' +
            '</div>' +
            '<div style="display: flex; gap: 12px; margin-top: 24px;">' +
            '<button id="sop-btn-cancel" style="flex: 1; padding: 12px; background: #3e3e52; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">取 消</button>' +
            '<button id="sop-btn-confirm" style="flex: 2; padding: 12px; background: #0066cc; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">确认校准并导出 PDF</button>' +
            '</div></div>'
        );

        document.body.appendChild(overlay);

        document.getElementById('sop-btn-cancel').addEventListener('click', () => {
            overlay.remove();
        });

        document.getElementById('sop-btn-confirm').addEventListener('click', () => {
            const vacuumLevel = document.getElementById('sop-vacuum-level').value;
            const heatingProgram = document.getElementById('sop-heating-program').value;
            const operator = document.getElementById('sop-operator').value || '未填写';

            if (!vacuumLevel || !heatingProgram) {
                alert('请填写必填项：目标真空度和加热曲线程序号');
                return;
            }

            overlay.remove();

            const sopData = {
                vacuumLevel: vacuumLevel,
                heatingProgram: heatingProgram,
                operator: operator,
                verifiedAt: formatDateTime()
            };

            this._exportToPDF(sopData);
        });

        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') overlay.remove();
        });
    }

    /**
     * 执行PDF导出
     */
    _exportToPDF(sopData) {
        exportPDF({
            furnaces: this.globalFurnacesResult,
            unpacked: this.globalUnpackedItems,
            sopData: sopData
        });
    }
}