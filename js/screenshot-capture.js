/**
 * screenshot-capture.js — 3D 场景截图引擎 (V3.3)
 *
 * V3.3 更新：
 *   - 删除 hideBasketMeshes / restoreBasketVisibility（爆炸图保留料框）
 *   - captureOverviewShot 拆分为 captureFrontViewShot + captureSideViewShot
 *   - captureExplodeShot 不再隐藏料框，使用 (1,1,1) 侧45度方向
 *   - 全部截图使用 setTightFitCamera 紧凑包围盒（8% 边距）
 *   - 截图时设纯白底色 + 关闭 Grid/Axes/Ruler
 *
 * 职责：
 *   - 提供 renderer.domElement.toDataURL() 截图
 *   - 异步串行队列确保截图顺序执行
 *   - 临时修改相机/场景状态 → 渲染 → 截图 → 恢复原状态
 *
 * 依赖：
 *   - three-scene.js: renderSingleFurnace, setTightFitCamera, focusLayer,
 *                     setExplodeVertical, resetExplode, forceRender,
 *                     saveAndOverrideDisplay, restoreDisplay
 *   - state.js: renderer, scene, camera, furnaceGroups, currentFurnaceIndex,
 *               setCurrentFurnaceIndex, globalFurnacesResult
 */

import * as THREE from 'three';
import {
    renderer, scene, camera, controls,
    currentFurnaceIndex,
    setCurrentFurnaceIndex,
    globalFurnacesResult,
    furnaceGroups
} from './state.js';

import {
    renderSingleFurnace,
    focusLayer,
    setExplodeVertical,
    resetExplode,
    setTightFitCamera,
    setOrthographicTopView,
    forceRender,
    saveAndOverrideDisplay,
    restoreDisplay
} from './three-scene.js';

// ==================== CONSTANTS ====================

/** 每次截图后等待的稳定延迟 (ms) */
const CAPTURE_DELAY_MS = 150;

/** 截图分辨率缩放因子 */
const SCREENSHOT_SCALE = 2;

/** 截图背景色 — 纯白底色（工业黑白手册风格） */
const SCREENSHOT_BG_COLOR = new THREE.Color(0xffffff);

/** 正常场景背景色 */
const DEFAULT_BG_COLOR = new THREE.Color(0xf5f5f5);

// ==================== SCREENSHOT HELPERS ====================

/**
 * 从当前 WebGL canvas 获取 Base64 截图
 * 截图前双重 forceRender + 延迟，防止黑框和渲染不完整
 *
 * @param {number} scale - 缩放因子（默认 2）
 * @param {THREE.Camera} [customCamera] - 可选自定义相机（如 OrthographicCamera）
 * @returns {string} PNG 格式的 Base64 Data URL
 */
function captureCanvasWithCamera(scale = SCREENSHOT_SCALE, customCamera = null) {
    if (!renderer || !renderer.domElement) {
        console.warn('[截图引擎] renderer 未初始化');
        return '';
    }

    // 双重 forceRender 确保 framebuffer 完全刷新（使用自定义相机）
    forceRender(customCamera);
    forceRender(customCamera);

    const originalPixelRatio = renderer.getPixelRatio();
    if (scale !== originalPixelRatio) {
        renderer.setPixelRatio(scale);
        forceRender(customCamera);
        forceRender(customCamera);
    }

    // 如果用自定义相机，渲染最后一帧后用该相机取图
    if (customCamera) {
        forceRender(customCamera);
    }

    const dataURL = renderer.domElement.toDataURL('image/png');

    if (scale !== originalPixelRatio) {
        renderer.setPixelRatio(originalPixelRatio);
    }

    return dataURL;
}

/**
 * 从当前 WebGL canvas 获取 Base64 截图（使用默认 PerspectiveCamera）
 * @param {number} scale - 缩放因子（默认 2）
 * @returns {string} PNG 格式的 Base64 Data URL
 */
function captureCanvasToDataURL(scale = SCREENSHOT_SCALE) {
    return captureCanvasWithCamera(scale, null);
}

/**
 * 切换当前炉膛显示
 */
function switchToFurnace(furnaceIndex) {
    if (!globalFurnacesResult || furnaceIndex >= globalFurnacesResult.length) return false;
    if (furnaceIndex === currentFurnaceIndex) return true;

    setCurrentFurnaceIndex(furnaceIndex);
    renderSingleFurnace(furnaceIndex, null);
    return true;
}

/**
 * 截图前设置场景为纯白底色 + 关闭所有辅助元素
 * @returns {Object} 快照，供 restoreScreenshotScene 恢复
 */
function prepareScreenshotScene() {
    // 保存并关闭所有辅助元素（网格、坐标轴、标尺）
    const displaySnapshot = saveAndOverrideDisplay({
        showGrid: false,
        showAxes: false,
        showRulers: false
    });

    // 保存原始背景色
    const originalBg = scene.background ? scene.background.clone() : DEFAULT_BG_COLOR.clone();

    // 设为纯白底色
    scene.background = SCREENSHOT_BG_COLOR;

    return { displaySnapshot, originalBg };
}

/**
 * 恢复截图前的场景设置
 * @param {Object} snapshot - prepareScreenshotScene() 返回的快照
 */
function restoreScreenshotScene(snapshot) {
    if (!snapshot) return;
    restoreDisplay(snapshot.displaySnapshot);
    scene.background = snapshot.originalBg;
}

/**
 * 🔧 重置场景中所有 LayerGroup 的可见性 — 防止状态污染
 *
 * 在每层截图前强制将所有 layerGroup.visible 重置为 true，
 * 确保上一轮循环设置的 visible 不会泄漏到当前层。
 *
 * @param {THREE.Group} group - furnaceGroup
 */
function resetSceneVisibility(group) {
    if (!group || !group.userData || !group.userData.layerGroups) return;
    const layerGroups = group.userData.layerGroups;
    layerGroups.forEach((lg) => {
        if (lg.userData && lg.userData.isLayerGroup) {
            lg.visible = true;
        }
    });
}

// ==================== SCREENSHOT MODES ====================

/**
 * 获取料框正面透视图截图
 * 方向：(0, 0.6, 1.5) — 正面微俯视，展示炉门方向和工件正面排布
 *
 * @param {number} furnaceIndex - 炉膛索引
 * @returns {Promise<string>} Base64 Data URL
 */
export async function captureFrontViewShot(furnaceIndex) {
    const ok = switchToFurnace(furnaceIndex);
    if (!ok) return '';

    // 确保爆炸图已关闭
    await resetExplode();
    focusLayer(null);
    await delay(300);

    // 紧凑透视：正面微俯视，12% 边距（与侧面图/爆炸图视觉对齐）
    setTightFitCamera(new THREE.Vector3(0, 0.6, 1.5), 0.12);

    // 准备截图场景（白底 + 关闭辅助线）
    const sceneSnapshot = prepareScreenshotScene();

    forceRender();
    forceRender();
    await delay(CAPTURE_DELAY_MS);

    const dataURL = captureCanvasToDataURL();

    // 恢复场景
    restoreScreenshotScene(sceneSnapshot);

    return dataURL;
}

/**
 * 获取料框侧面透视图截图
 * 方向：(-1.5, 0.6, 0) — 左侧微俯视，展示纵深方向和搁板层关系
 *
 * @param {number} furnaceIndex - 炉膛索引
 * @returns {Promise<string>} Base64 Data URL
 */
export async function captureSideViewShot(furnaceIndex) {
    const ok = switchToFurnace(furnaceIndex);
    if (!ok) return '';

    // 确保爆炸图已关闭
    await resetExplode();
    focusLayer(null);
    await delay(200);

    // 紧凑透视：侧面微俯视，12% 边距（与正面图/爆炸图视觉对齐）
    setTightFitCamera(new THREE.Vector3(-1.5, 0.6, 0), 0.12);

    // 准备截图场景（白底 + 关闭辅助线）
    const sceneSnapshot = prepareScreenshotScene();

    forceRender();
    forceRender();
    await delay(CAPTURE_DELAY_MS);

    const dataURL = captureCanvasToDataURL();

    // 恢复场景
    restoreScreenshotScene(sceneSnapshot);

    return dataURL;
}

/**
 * 获取爆炸图截图（垂直爆炸 + 侧45度透视 + 保留料框）
 * 方向：(1, 1, 1) — 侧45度查看，料框、搁板、工件齐全
 *
 * @param {number} furnaceIndex - 炉膛索引
 * @returns {Promise<string>} Base64 Data URL
 */
export async function captureExplodeShot(furnaceIndex) {
    const ok = switchToFurnace(furnaceIndex);
    if (!ok) return '';

    // 先重置，再进入垂直爆炸模式
    await resetExplode();
    await delay(200);
    await setExplodeVertical();

    // 爆炸动画完成后额外延迟
    await delay(400);

    // 🔧 动态 Box3 定位：基于爆炸后 furnaceGroup 的实际包围盒计算相机位置
    const group = furnaceGroups.get(furnaceIndex);
    if (group) {
        const box = new THREE.Box3().setFromObject(group);
        const center = new THREE.Vector3();
        box.getCenter(center);
        const size = new THREE.Vector3();
        box.getSize(size);

        // 侧45度方向向量
        const dir = new THREE.Vector3(1, 1, 1).normalize();
        const maxDim = Math.max(size.x, size.y, size.z);
        const fovRad = (camera.fov * Math.PI) / 180;
        const distance = (maxDim * 1.20) / (2 * Math.tan(fovRad / 2));

        camera.position.copy(center.clone().add(dir.clone().multiplyScalar(distance)));
        camera.lookAt(center);
        controls.target.copy(center);
        controls.update();
    }

    // 准备截图场景（白底 + 关闭辅助线）
    const sceneSnapshot = prepareScreenshotScene();

    // 双重渲染 + 延迟
    forceRender();
    forceRender();
    await delay(CAPTURE_DELAY_MS);

    // 截图
    const dataURL = captureCanvasToDataURL();

    // 恢复场景
    restoreScreenshotScene(sceneSnapshot);

    // 关闭爆炸图
    await resetExplode();
    focusLayer(null);

    return dataURL;
}

/**
 * 获取分层步骤截图 — OrthographicCamera 正上方俯视图
 *
 * V3.4: 改用正交俯视相机替代透视侧45度，确保每层工件在平面上清晰可见，
 *       所有物料、搁板完整在画面内，无透视变形。
 *
 * @param {number} furnaceIndex - 炉膛索引
 * @returns {Promise<LayerShotResult[]>}
 */
export async function captureLayeredScreenshots(furnaceIndex) {
    const ok = switchToFurnace(furnaceIndex);
    if (!ok) return [];

    // 确保爆炸图关闭
    await resetExplode();

    const furnace = globalFurnacesResult[furnaceIndex];
    if (!furnace) return [];

    const group = furnaceGroups.get(furnaceIndex);
    if (!group || !group.userData || !group.userData.layerGroups) return [];

    const layerGroups = group.userData.layerGroups;

    // 获取排序后的 layer 索引
    const sortedLayerIndices = [];
    layerGroups.forEach((lg, idx) => {
        if (lg.userData && lg.userData.isLayerGroup) {
            sortedLayerIndices.push(idx);
        }
    });
    sortedLayerIndices.sort((a, b) => a - b);

    // 预计算每层的工件信息
    const layerDataMap = new Map();
    furnace.packedItems.forEach(item => {
        const itemLayer = getItemLayerFromMesh(item, furnace);
        if (!layerDataMap.has(itemLayer)) {
            layerDataMap.set(itemLayer, { items: new Map(), totalWeight: 0, itemCount: 0, shelfInfo: null });
        }
        const ld = layerDataMap.get(itemLayer);

        const mat = item.material || '';
        const proc = item.process || '';
        const key = item.name + '|' + mat + '|' + proc;
        if (!ld.items.has(key)) {
            ld.items.set(key, {
                name: item.name,
                material: mat,
                process: proc,
                dimensions: item.originalDims
                    ? `${item.originalDims.l}×${item.originalDims.w}×${item.originalDims.h}mm`
                    : `${item.w}×${item.d}×${item.h}mm`,
                singleWeight: item.weight || 0,
                count: 0,
                totalWeight: 0,
                color: item.color
            });
        }
        const entry = ld.items.get(key);
        entry.count++;
        entry.totalWeight += item.weight || 0;
        ld.totalWeight += item.weight || 0;
        ld.itemCount++;
    });

    // 搁板信息
    if (furnace.shelvesUsed && furnace.shelvesUsed.length > 0) {
        const sortedShelves = [...furnace.shelvesUsed].sort((a, b) => a.y - b.y);
        sortedShelves.forEach((s, idx) => {
            const layer = idx + 2;
            if (layerDataMap.has(layer)) {
                layerDataMap.get(layer).shelfInfo = {
                    dimensions: `${furnace.w}×${furnace.d}mm`,
                    thickness: s.thickness || 20
                };
            }
        });
    }

    // 截图前准备场景（白底 + 关闭辅助线）
    const sceneSnapshot = prepareScreenshotScene();

    const results = [];

    // 🔧 async/await 串行队列：逐层截图，每层严格等待上一帧渲染完毕
    for (const layerIndex of sortedLayerIndices) {
        // 🔧 重置所有 LayerGroup visible 为 true，防止上一轮状态污染
        resetSceneVisibility(group);

        // 1️⃣ 累积图：显示 <= layerIndex 的所有层
        layerGroups.forEach((lg, idx) => {
            if (!lg.userData || !lg.userData.isLayerGroup) return;
            lg.visible = (idx <= layerIndex);
        });

        // 使用正交俯视相机
        // const orthoCamera = setOrthographicTopView(0.08);
        // // 等待场景稳定
        // await delay(200);

        // // 双重渲染确保 framebuffer 刷新
        // forceRender(orthoCamera);
        // forceRender(orthoCamera);
        // await delay(CAPTURE_DELAY_MS);

        // // 截图（使用正交相机）
        // const dataURL = captureCanvasWithCamera(SCREENSHOT_SCALE, orthoCamera);
        // 🔧 修改：改用透视相机（立体侧45度俯视视角，12%边距），展示累积装配效果
        setTightFitCamera(new THREE.Vector3(1, 0.8, 1), 0.12);
        // 等待场景稳定
        await delay(200);

        // 双重渲染确保 framebuffer 刷新（传空指使用默认透视相机）
        forceRender();
        forceRender();
        await delay(CAPTURE_DELAY_MS);

        // 截图（使用默认透视相机获取立体图）
        const dataURL = captureCanvasToDataURL();


        // 🔧 再次重置 visible，确保独立图从干净状态开始
        resetSceneVisibility(group);

        // 2️⃣ 独立图：仅显示当前层
        layerGroups.forEach((lg, idx) => {
            if (!lg.userData || !lg.userData.isLayerGroup) return;
            lg.visible = (idx === layerIndex);
        });

        await delay(200);

        const isolateOrthoCamera = setOrthographicTopView(0.08);
        forceRender(isolateOrthoCamera);
        forceRender(isolateOrthoCamera);
        await delay(100);

        const isolateDataURL = captureCanvasWithCamera(SCREENSHOT_SCALE, isolateOrthoCamera);

        // 收集本层信息
        const ld = layerDataMap.get(layerIndex) || { items: new Map(), totalWeight: 0, itemCount: 0, shelfInfo: null };
        const layerLabel = layerIndex === 1 ? '底层（炉底）' : '第 ' + layerIndex + ' 层';

        results.push({
            dataURL,
            isolateDataURL,
            layerIndex,
            layerLabel,
            itemCount: ld.itemCount,
            totalWeight: ld.totalWeight,
            items: [...ld.items.values()].sort((a, b) => b.count - a.count),
            shelfInfo: ld.shelfInfo || null,
            hasShelf: !!ld.shelfInfo
        });

        await delay(CAPTURE_DELAY_MS);
    }

    // 恢复全部层可见 + 恢复 PerspectiveCamera
    focusLayer(null);
    restoreScreenshotScene(sceneSnapshot);
    // forceRender 一次用默认 camera 恢复 framebuffer
    forceRender();
    await resetExplode();

    return results;
}

/**
 * 为单层渲染步骤截图 — OrthographicCamera 正俯视图 + 逐层显示
 *
 * V3.4: 改用正交俯视相机，与 captureLayeredScreenshots 保持一致。
 *
 * @param {number} layerIndex - 目标层编号
 * @param {Object} options - 可选参数
 * @param {boolean} options.hideAbove - 是否隐藏高于 layerIndex 的层（默认 true）
 * @param {boolean} options.isolateOnly - 是否仅截取该层独立图（默认 false 截取累积图）
 * @returns {Promise<{ mainShot: string, isolateShot: string }>}
 */
export async function renderStepScreenshot(layerIndex, options = {}) {
    const { hideAbove = true, isolateOnly = false } = options;

    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !group.userData || !group.userData.layerGroups) {
        return { mainShot: '', isolateShot: '' };
    }

    const layerGroups = group.userData.layerGroups;

    // 🔧 强制重置所有 LayerGroup visible 为 true，防止外部状态污染
    resetSceneVisibility(group);

    // 保存当前可见状态（此时全部为 true，即干净基准）
    const visibilityBackup = new Map();
    layerGroups.forEach((lg, idx) => {
        visibilityBackup.set(idx, lg.visible);
    });

    // 准备截图场景（白底 + 关闭辅助线）
    const sceneSnapshot = prepareScreenshotScene();

    let mainShot = '';
    let isolateShot = '';

    // 累积图：显示 <= layerIndex 的所有层
    layerGroups.forEach((lg, idx) => {
        if (!lg.userData || !lg.userData.isLayerGroup) return;
        lg.visible = (idx <= layerIndex);
    });

    // 🔧 V3.4: 使用正交俯视相机
    const orthoCamera = setOrthographicTopView(0.08);
    await delay(100);
    forceRender(orthoCamera);
    forceRender(orthoCamera);
    await delay(CAPTURE_DELAY_MS);

    if (!isolateOnly) {
        mainShot = captureCanvasWithCamera(SCREENSHOT_SCALE, orthoCamera);
    }

    // 独立图：仅显示当前层
    layerGroups.forEach((lg, idx) => {
        if (!lg.userData || !lg.userData.isLayerGroup) return;
        lg.visible = (idx === layerIndex);
    });

    const isolateOrtho = setOrthographicTopView(0.08);
    forceRender(isolateOrtho);
    forceRender(isolateOrtho);
    await delay(100);

    isolateShot = captureCanvasWithCamera(SCREENSHOT_SCALE, isolateOrtho);

    if (isolateOnly) {
        mainShot = isolateShot;
    }

    // 恢复可见状态
    layerGroups.forEach((lg, idx) => {
        if (visibilityBackup.has(idx)) {
            lg.visible = visibilityBackup.get(idx);
        }
    });
    restoreScreenshotScene(sceneSnapshot);

    return { mainShot, isolateShot };
}

/**
 * 从模型数据推算工件所属 layer
 */
function getItemLayerFromMesh(item, furnace) {
    if (typeof item.layer === 'number' && item.layer >= 1) return item.layer;
    if (furnace.shelvesUsed && furnace.shelvesUsed.length > 0) {
        const sortedShelves = [...furnace.shelvesUsed].sort((a, b) => a.y - b.y);
        for (let i = sortedShelves.length - 1; i >= 0; i--) {
            if (item.y >= sortedShelves[i].y) return i + 2;
        }
    }
    return 1;
}

// ==================== ASYNC SCREENSHOT QUEUE ====================

/**
 * 截图队列调度器 — 顺序执行截图步骤
 *
 * @param {Array<{ label: string, fn: () => Promise<string> }>} steps
 * @param {Function} onProgress - 进度回调 (current, total, label)
 * @returns {Promise<Array<{ label: string, dataURL: string }>>}
 */
export async function captureScreenshotQueue(steps, onProgress) {
    const results = [];
    const total = steps.length;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        if (onProgress) {
            onProgress(i + 1, total, step.label);
        }

        try {
            const dataURL = await step.fn();
            results.push({
                label: step.label,
                dataURL: dataURL
            });
        } catch (err) {
            console.error('[截图队列] 步骤 "' + step.label + '" 失败:', err);
            results.push({
                label: step.label,
                dataURL: '',
                error: err.message
            });
        }

        await delay(CAPTURE_DELAY_MS);
    }

    return results;
}

// ==================== UTILITY ====================

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}