/**
 * three-scene.js - All Three.js Related Code (V2.7)
 *
 * V2.7 Updates:
 *   - Task 1: 多炉膛原点居中 — 所有炉膛 Group 在原点 (0,0,0) 创建，visible 切换
 *   - Task 2: 爆炸图模式 — 按 layer 在 Y 轴展开 + 分层施工清单 BOM
 *   - Task 3: 性能优化 — 关闭工件透明度、动画阴影降级
 *
 * V3.0 Updates:
 *   - 默认隐藏坐标轴和标尺，仅显示浅灰色网格
 *   - 工装材质改为金属质感
 *   - 工件按材质(Cr12/H13/MOV)固定颜色
 *
 * Dependencies:
 *   - THREE.js (imported via importmap)
 *   - OrbitControls (from three/addons)
 *   - state.js
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
    scene, camera, renderer, controls,
    masterScene, masterCamera, masterRenderer, masterControls,
    itemsGroup, furnaceGroups, mainDirectionalLight,
    globalFurnacesResult, shelfMeshes, globalUnpackedItems,
    isAnimating, animPaused, animStopped,
    currentFurnaceIndex, selectedFurnaceCardId, selectedMaterialCardId,
    placementRules,
    currentBasketType, displaySettings,
    explodedView, explodeMode, focusedLayer,
    EXPLODE_GAP, EXPLODE_ANIM_DURATION,
    screenshotInProgress,
    setScene, setCamera, setRenderer, setControls,
    setMasterScene, setMasterCamera, setMasterRenderer, setMasterControls,
    setItemsGroup, setShelfMeshes,
    setIsAnimating, setAnimPaused, setAnimStopped,
    setCurrentFurnaceIndex, setSelectedFurnaceCardId,
    setExplodedView, setExplodeMode, setFocusedLayer,
    setMainDirectionalLight,
    clearFurnaceGroups, setFurnaceGroup
} from './state.js';
import { createBasketFrame, createShelfMesh, createEmptyTooling, TOOLING_TO_BASKET } from './basket-model.js';
import { createItemMesh, createAnimItemMesh } from './item-models.js';

const COLOR_PALETTE = [
    '#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6',
    '#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a',
    '#ff5722','#607d8b','#673ab7','#009688','#ff9800',
    '#795548','#f44336','#2196f3','#4caf50','#ffeb3b',
    '#ff6b6b','#4ecdc4','#45b7d1','#96ceb4','#ffeaa7',
    '#dda0dd','#98d8c8','#f7dc6f','#bb8fce','#85c1e9'
];

// ==================== 物料材质固定颜色映射 ====================
const MATERIAL_COLOR_MAP = {
    'Cr12': 0x1E3A8A,   // 深蓝
    'H13': 0x4B4B4B,    // 深灰
    'MOV': 0xFFBF00      // 琥珀色
};

/**
 * 根据物料材质获取固定颜色
 * @param {string} material - 材质名称
 * @returns {number|null} 颜色值，若不匹配则返回 null
 */
function getFixedColorByMaterial(material) {
    if (!material) return null;
    // 精确匹配或忽略大小写匹配
    const matchedKey = Object.keys(MATERIAL_COLOR_MAP).find(key => 
        key.toLowerCase() === material.toLowerCase()
    );
    return matchedKey ? MATERIAL_COLOR_MAP[matchedKey] : null;
}

// ==================== 工装金属材质处理 ====================
/**
 * 递归将 Group 内所有 MeshStandardMaterial 改为金属质感
 * @param {THREE.Object3D} obj - 要处理的物体
 */
function applyMetallicMaterial(obj) {
    if (!obj) return;
    obj.traverse(child => {
        if (child.isMesh && child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
                if (mat instanceof THREE.MeshStandardMaterial) {
                    mat.metalness = 0.85;
                    mat.roughness = 0.25;
                    // 保留原色但略微提亮为银灰基调（如果颜色接近原始灰色系则统一，否则保持原色增加金属感）
                    if (mat.color.getHex() === 0xcccccc || mat.color.getHex() === 0xaaaaaa) {
                        mat.color.setHex(0xc0c0c0);
                    }
                    mat.needsUpdate = true;
                }
            });
        }
    });
}

// ==================== COLOR GENERATOR ====================

export function generateUniqueColor(usedColors) {
    for (let c of COLOR_PALETTE) {
        if (!usedColors.has(c)) { usedColors.add(c); return c; }
    }
    let color;
    do {
        color = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    } while (usedColors.has(color));
    usedColors.add(color);
    return color;
}

// ==================== SHELF MESH MANAGEMENT ====================

export function disposeShelfMeshes() {
    shelfMeshes.forEach(mesh => {
        if (mesh.parent) mesh.parent.remove(mesh);
        mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    });
    setShelfMeshes([]);
}

/**
 * 创建环形工装的圆环搁板。
 *
 * 使用 RingGeometry 表示真实可装载圆盘区域：
 * - 外圈以内可放料
 * - 内圈以内不可放料
 * - 不再使用矩形 createShelfMesh
 */
function createRingShelfMesh(outerRadius, innerRadius) {
    const geo = new THREE.RingGeometry(innerRadius, outerRadius, 96);

    const mat = new THREE.MeshStandardMaterial({
        color: 0x667788,
        metalness: 0.75,
        roughness: 0.35,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    const mesh = new THREE.Mesh(geo, mat);

    // RingGeometry 默认在 XY 平面，需要旋转到 XZ 平面
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;

    return mesh;
}

/**
 * V2.8: 搁板渲染函数（原点居中版本 — 修复坐标回归）
 *
 * 搁板 Mesh 作为 furnaceGroup 的子对象，严格继承炉膛局部坐标系。
 * 炉膛 Group 原点在 (0,0,0)，料框在 furnaceGroup 中从 (-fw/2, baseY, -fd/2) 到 (fw/2, baseY+fh, fd/2)。
 * 搁板的 XZ 中心必须对齐炉膛/料框的几何中心，即 furnaceGroup 原点 (0, *, 0)。
 *
 * @param {Object} furnace - 炉膛配置 { w, h, d, packedItems, shelvesUsed }
 * @param {THREE.Group} furnaceGroup - 炉膛根 Group
 * @param {number} baseY - 炉膛基础 Y 偏移（料框底部在场景中的 Y 坐标，如 -120）
 */
/**
 * 🔧 重构：renderShelvesForFurnace — 现在接收 layerGroups Map 参数
 * 搁板 Mesh 将被添加到对应的 layerGroup 中，而不是直接挂载到 furnaceGroup。
 *
 * @param {Object} furnace - 炉膛配置
 * @param {THREE.Group} furnaceGroup - 炉膛根 Group（保留用于向后兼容）
 * @param {number} baseY - 炉膛基础 Y 偏移
 * @param {Map<number, THREE.Group>} layerGroups - layer编号 → LayerGroup 的映射
 */
export function renderShelvesForFurnace(furnace, furnaceGroup, baseY, layerGroups) {
    if (furnace.toolingType === 'ring-tooling') {
        return;
    }
    
    if (baseY === undefined) baseY = -120;
    const shelfThickness = placementRules.shelfThickness || 20;

    const hasExplicitShelves =
        Array.isArray(furnace.shelvesUsed) &&
        furnace.shelvesUsed.length > 0;

    const shelfYs = new Set();

    if (hasExplicitShelves) {
        furnace.shelvesUsed.forEach(s => {
            if (typeof s.y === 'number') {
                shelfYs.add(s.y);
            }
        });
    } else {
        furnace.packedItems.forEach(item => {
            if (typeof item.y === 'number' && !isNaN(item.y) && item.y > 0) {
                shelfYs.add(item.y);
            }
        });
    }

    if (shelfYs.size === 0) return;

    const fw = furnace.w;
    const fd = furnace.d;
    const fh = furnace.h;

    // 构建搁板 layer 映射：按 shelvesUsed.y 排序后映射 layer 编号
    const sortedShelves = furnace.shelvesUsed && furnace.shelvesUsed.length > 0
        ? [...furnace.shelvesUsed].sort((a, b) => a.y - b.y)
        : [];

    shelfYs.forEach(shelfY => {
        if (shelfY + shelfThickness > fh) {
            console.warn('[搁板渲染] 搁板高度 ' + shelfY + 'mm 超出炉膛总高度 ' + fh + 'mm，已跳过');
            return;
        }

        // 🔧 计算搁板所属 layer，并检查上方是否有工件
        let shelfLayer = 1;
        for (let li = 0; li < sortedShelves.length; li++) {
            if (Math.abs(sortedShelves[li].y - shelfY) < 0.5) {
                shelfLayer = li + 2; // 底层=layer1, 第一块搁板上方=layer2, ...
                break;
            }
        }
        // 🔧 跳过上方无工件的空搁板
        // 如果 shelvesUsed 是算法明确输出 / JSON 明确恢复的实体搁板，直接渲染。
        // 不再依赖 item.layer，因为导出的 item.layer 可能没有正确同步。
        if (!hasExplicitShelves) {
            const layerHasItems = furnace.packedItems.some(
                item => getItemLayer(item, furnace) === shelfLayer
            );

            if (!layerHasItems) {
                return;
            }
        }

        let shelfMesh;

        if (furnace.toolingType === 'ring-tooling') {
            const params = furnace.params || {};

            const outerRadius =
                params.outerRadius ||
                params.radialRadius ||
                Math.min(fw, fd) / 2 - 30;

            const innerRadius =
                params.centerVoidRadius ||
                params.innerRadius ||
                ((params.innerDia || 200) / 2);

            shelfMesh = createRingShelfMesh(outerRadius, innerRadius);
        } else {
            shelfMesh = createShelfMesh(fw, fd, shelfThickness);
        }

        // 🔧 搁板 XZ 必须对齐料框几何中心（furnaceGroup 原点）
        // 【修复】：直接贴合起始面，让 ExtrudeGeometry 自身向上自然拉伸出厚度
        const shelfYSpace = baseY + shelfY;
        shelfMesh.position.set(0, shelfYSpace, 0);

        shelfMesh.userData = {
            isShelfMesh: true,
            shelfY: shelfY,
            thickness: shelfThickness,
            layer: shelfLayer,
            _originalY: shelfYSpace
        };

        // 🔧 重构：将搁板加入对应的 layerGroup（如果提供了 layerGroups）
        if (layerGroups && layerGroups.has(shelfLayer)) {
            layerGroups.get(shelfLayer).add(shelfMesh);
        } else {
            // 回退：直接加入 furnaceGroup（用于动画等不创建 layerGroups 的场景）
            furnaceGroup.add(shelfMesh);
        }
        shelfMeshes.push(shelfMesh);
    });
}

// ==================== RULER / AXES SYSTEM (V2.3) ====================

let mainSceneGridHelper = null;
let mainSceneAxesHelper = null;
let mainSceneRulerGroup = null;

function updateMainSceneDisplayVisibility() {
    if (mainSceneGridHelper) mainSceneGridHelper.visible = displaySettings.showGrid;
    if (mainSceneAxesHelper) mainSceneAxesHelper.visible = displaySettings.showAxes;
    if (mainSceneRulerGroup) mainSceneRulerGroup.visible = displaySettings.showRulers;
}

function createRulerGroup(maxRange) {
    const group = new THREE.Group();
    const step = 100;
    const range = maxRange || 4000;
    const originY = -120;

    for (let x = 0; x <= range; x += step) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(x + 'mm', 32, 18);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(x, originY + 5, 20);
        sprite.scale.set(80, 40, 1);
        group.add(sprite);
    }

    for (let z = 0; z <= range; z += step) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(z + 'mm', 32, 18);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(-20, originY + 5, z);
        sprite.scale.set(80, 40, 1);
        group.add(sprite);
    }

    for (let y = 100; y <= 3000; y += step) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(y + 'mm', 32, 18);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(-20, originY + y, 20);
        sprite.scale.set(80, 40, 1);
        group.add(sprite);
    }

    group.userData = { isRulerGroup: true };
    return group;
}

function setMainSceneDisplayRefs(gridHelper, axesHelper, rulerGroup) {
    mainSceneGridHelper = gridHelper;
    mainSceneAxesHelper = axesHelper;
    mainSceneRulerGroup = rulerGroup;
    updateMainSceneDisplayVisibility();
}

// ==================== THREE.JS INITIALIZATION (V2.7) ====================

export function initThree() {
    const container = document.getElementById('canvas-container');
    const newScene = new THREE.Scene();
    newScene.background = new THREE.Color(0xf5f5f5);
    setScene(newScene);

    const newCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 10000);
    setCamera(newCamera);

    const newRenderer = new THREE.WebGLRenderer({ antialias: true });
    newRenderer.setSize(container.clientWidth, container.clientHeight);
    newRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // V2.7: 限制像素比以优化性能
    newRenderer.shadowMap.enabled = true;
    newRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(newRenderer.domElement);
    setRenderer(newRenderer);

    const newControls = new OrbitControls(newCamera, newRenderer.domElement);
    newControls.enableDamping = true;
    newControls.dampingFactor = 0.05;
    setControls(newControls);

    /* 光照 */
    newScene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.7);
    mainLight.position.set(400, 800, 500);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    newScene.add(mainLight);
    setMainDirectionalLight(mainLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-400, -200, -300);
    newScene.add(fillLight);

    /* 地面网格 - 浅灰色 */
    const gridHelper = new THREE.GridHelper(4000, 80, 0xbbbbbb, 0xdddddd);
    gridHelper.position.y = -120;
    newScene.add(gridHelper);

    /* 坐标轴 (默认隐藏) */
    const customAxesGroup = new THREE.Group();
    const axesLen = 2000;
    const originY = -120;

    const xLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, originY, 0), new THREE.Vector3(axesLen, originY, 0)
    ]);
    customAxesGroup.add(new THREE.Line(xLineGeo, new THREE.LineBasicMaterial({ color: 0xcc0000, linewidth: 1 })));

    const yLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, originY, 0), new THREE.Vector3(0, axesLen + originY, 0)
    ]);
    customAxesGroup.add(new THREE.Line(yLineGeo, new THREE.LineBasicMaterial({ color: 0x006600, linewidth: 1 })));

    const zLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, originY, 0), new THREE.Vector3(0, originY, axesLen)
    ]);
    customAxesGroup.add(new THREE.Line(zLineGeo, new THREE.LineBasicMaterial({ color: 0x0000cc, linewidth: 1 })));

    newScene.add(customAxesGroup);

    /* 标尺刻度组 (默认隐藏) */
    const rulerGroup = createRulerGroup(4000);
    newScene.add(rulerGroup);

    setMainSceneDisplayRefs(gridHelper, customAxesGroup, rulerGroup);

    // 【V3.0】设置默认显示：只显示网格，隐藏坐标轴和标尺
    displaySettings.showGrid = true;
    displaySettings.showAxes = false;
    displaySettings.showRulers = false;
    updateMainSceneDisplayVisibility();

    const group = new THREE.Group();
    setItemsGroup(group);
    newScene.add(group);

    window.addEventListener('resize', () => {
        if (!document.getElementById('master-view').classList.contains('active')) {
            newCamera.aspect = container.clientWidth / container.clientHeight;
            newCamera.updateProjectionMatrix();
            newRenderer.setSize(container.clientWidth, container.clientHeight);
        }
    });

    function animate() {
        requestAnimationFrame(animate);
        newControls.update();
        // 🔧 截图期间跳过动画循环渲染，防止覆盖截图 framebuffer
        if (!screenshotInProgress) {
            newRenderer.render(newScene, newCamera);
        }
    }
    animate();
}

// ==================== MASTER SCENE DISPLAY REFS ====================
let masterSceneGridHelper = null;
let masterSceneAxesGroup = null;
let masterSceneRulerGroup = null;

function updateMasterSceneDisplayVisibility() {
    if (masterSceneGridHelper) masterSceneGridHelper.visible = displaySettings.showGrid;
    if (masterSceneAxesGroup) masterSceneAxesGroup.visible = displaySettings.showAxes;
    if (masterSceneRulerGroup) masterSceneRulerGroup.visible = displaySettings.showRulers;
}

export function refreshAllDisplayVisibility() {
    updateMainSceneDisplayVisibility();
    updateMasterSceneDisplayVisibility();
}

export function initMasterThree() {
    const container = document.getElementById('master-canvas-container');
    const msScene = new THREE.Scene();
    msScene.background = new THREE.Color(0xf5f5f5);
    setMasterScene(msScene);

    const msCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 10000);
    setMasterCamera(msCamera);

    const msRenderer = new THREE.WebGLRenderer({ antialias: true });
    msRenderer.setSize(container.clientWidth, container.clientHeight);
    msRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(msRenderer.domElement);
    setMasterRenderer(msRenderer);

    const msControls = new OrbitControls(msCamera, msRenderer.domElement);
    msControls.enableDamping = true;
    msControls.dampingFactor = 0.05;
    setMasterControls(msControls);

    msScene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const ml = new THREE.DirectionalLight(0xffffff, 0.7);
    ml.position.set(400, 800, 500);
    msScene.add(ml);

    // 浅灰色网格
    const grid = new THREE.GridHelper(4000, 80, 0xbbbbbb, 0xdddddd);
    grid.position.y = -120;
    msScene.add(grid);
    masterSceneGridHelper = grid;

    const originY = -120;
    const customAxesGroup = new THREE.Group();
    const axesLen = 2000;

    const xLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, originY, 0), new THREE.Vector3(axesLen, originY, 0)
    ]);
    customAxesGroup.add(new THREE.Line(xLineGeo, new THREE.LineBasicMaterial({ color: 0xcc0000, linewidth: 1 })));

    const yLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, originY, 0), new THREE.Vector3(0, axesLen + originY, 0)
    ]);
    customAxesGroup.add(new THREE.Line(yLineGeo, new THREE.LineBasicMaterial({ color: 0x006600, linewidth: 1 })));

    const zLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, originY, 0), new THREE.Vector3(0, originY, axesLen)
    ]);
    customAxesGroup.add(new THREE.Line(zLineGeo, new THREE.LineBasicMaterial({ color: 0x0000cc, linewidth: 1 })));

    msScene.add(customAxesGroup);
    masterSceneAxesGroup = customAxesGroup;

    const rulerGroup = createRulerGroup(4000);
    msScene.add(rulerGroup);
    masterSceneRulerGroup = rulerGroup;

    // 【V3.0】同步显示设置
    displaySettings.showGrid = true;
    displaySettings.showAxes = false;
    displaySettings.showRulers = false;
    updateMasterSceneDisplayVisibility();

    function animateMaster() {
        requestAnimationFrame(animateMaster);
        msControls.update();
        msRenderer.render(msScene, msCamera);
    }
    animateMaster();
}

// ==================== 🔧 V3.0: 爆炸图模式（LayerGroup 架构重写） ====================

/**
 * V2.7: 获取工件所在的 layer 编号
 * 从 item.y 或 item.layer 属性读取。
 * layer 1 = 底层 (Y≈0), layer 2 = 第一层搁板上方, etc.
 */
function getItemLayer(item, furnace) {
    // 导入 JSON 后，item.layer 可能没有正确同步；
    // 只要存在 shelvesUsed，就优先用 item.y 反推真实层级。
    if (
        furnace &&
        Array.isArray(furnace.shelvesUsed) &&
        furnace.shelvesUsed.length > 0 &&
        typeof item.y === 'number'
    ) {
        const sortedShelves = [...furnace.shelvesUsed].sort((a, b) => a.y - b.y);

        for (let i = sortedShelves.length - 1; i >= 0; i--) {
            if (item.y >= sortedShelves[i].y - 0.5) {
                return i + 2;
            }
        }

        return 1;
    }

    // 没有搁板时，再信任 layer 字段
    if (typeof item.layer === 'number' && item.layer >= 1) {
        return item.layer;
    }

    return 1;
}

/**
 * 🔧 V3.0: 保留旧 toggleExplodedView() 用于向后兼容（内部调用 setExplodeVertical/关闭）
 * 新代码应直接调用 setExplodeVertical() / setExplodeHorizontal() / resetExplode()
 */
export async function toggleExplodedView() {
    if (!explodeMode) {
        await setExplodeVertical();
    } else if (explodeMode === 'vertical') {
        await setExplodeHorizontal();
    } else {
        // explodeMode === 'horizontal' → 关闭
        await resetExplode();
    }
}

/**
 * 🔧 V3.0: 纵向爆炸展开 — 按 layer 在 Y 轴方向层叠展开
 *
 * 逻辑：每个 LayerGroup 沿 Y 轴偏移 (layerIndex-1) * EXPLODE_GAP，
 *       X 和 Z 保持在 _originalX/_originalZ（始终为 0）。
 *       内部工件/搁板的 position 完全不动，只移动 LayerGroup 本身。
 */
export async function setExplodeVertical() {
    // 如果已经在纵向模式，不做重复操作
    if (explodeMode === 'vertical') return;
    // 如果当前有其他模式，先复位
    if (explodeMode) {
        await resetExplodeSilent();
    }

    setExplodeMode('vertical');
    setExplodedView(true);
    updateExplodeButtonUI('vertical');

    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !group.userData || !group.userData.layerGroups) return;

    const layerGroups = group.userData.layerGroups;
    const duration = EXPLODE_ANIM_DURATION;
    const startTime = performance.now();

    // 🔧 收集所有 LayerGroup 的动画数据
    const animations = [];
    layerGroups.forEach((layerGroup, layerIndex) => {
        if (!layerGroup.userData || !layerGroup.userData.isLayerGroup) return;
        const targetX = layerGroup.userData._originalX || 0;  // 始终为 0
        const targetY = layerGroup.userData._originalY + (layerIndex - 1) * EXPLODE_GAP;  // Y 轴偏移
        const targetZ = layerGroup.userData._originalZ || 0;  // 始终为 0

        // 记录起始位置
        animations.push({
            obj: layerGroup,
            startX: layerGroup.position.x,
            startY: layerGroup.position.y,
            startZ: layerGroup.position.z,
            targetX, targetY, targetZ,
            layerIndex
        });
    });

    if (animations.length === 0) return;

    return new Promise(resolve => {
        function animStep(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1.0);
            // easeInOutCubic
            const eased = progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            animations.forEach(a => {
                a.obj.position.x = a.startX + (a.targetX - a.startX) * eased;
                a.obj.position.y = a.startY + (a.targetY - a.startY) * eased;
                a.obj.position.z = a.startZ + (a.targetZ - a.startZ) * eased;
            });

            if (progress < 1.0) {
                requestAnimationFrame(animStep);
            } else {
                // 确保最终位置精确
                animations.forEach(a => {
                    a.obj.position.set(a.targetX, a.targetY, a.targetZ);
                });
                resolve();
            }
        }
        requestAnimationFrame(animStep);
    });
}

/**
 * 🔧 V3.0: 横向爆炸展开 — 按 layer 在 X 轴方向平铺展开，Y 轴降至 0（地面）
 *
 * 便于从正上方俯瞰时，所有层平铺在地面上，X 轴分布清晰可见。
 */
export async function setExplodeHorizontal() {
    // 如果已经在横向模式，不做重复操作
    if (explodeMode === 'horizontal') return;
    // 如果当前有其他模式，先复位
    if (explodeMode) {
        await resetExplodeSilent();
    }

    setExplodeMode('horizontal');
    setExplodedView(true);
    updateExplodeButtonUI('horizontal');

    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !group.userData || !group.userData.layerGroups) return;

    const layerGroups = group.userData.layerGroups;
    const duration = EXPLODE_ANIM_DURATION;
    const startTime = performance.now();

    const animations = [];
    layerGroups.forEach((layerGroup, layerIndex) => {
        if (!layerGroup.userData || !layerGroup.userData.isLayerGroup) return;
        // X 轴方向展开
        const targetX = layerGroup.userData._originalX + (layerIndex - 1) * EXPLODE_GAP * 3;
        // Y 轴降至 0（地面），方便俯瞰
        const targetY = 0;
        const targetZ = layerGroup.userData._originalZ || 0;

        animations.push({
            obj: layerGroup,
            startX: layerGroup.position.x,
            startY: layerGroup.position.y,
            startZ: layerGroup.position.z,
            targetX, targetY, targetZ,
            layerIndex
        });
    });

    if (animations.length === 0) return;

    return new Promise(resolve => {
        function animStep(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1.0);
            const eased = progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            animations.forEach(a => {
                a.obj.position.x = a.startX + (a.targetX - a.startX) * eased;
                a.obj.position.y = a.startY + (a.targetY - a.startY) * eased;
                a.obj.position.z = a.startZ + (a.targetZ - a.startZ) * eased;
            });

            if (progress < 1.0) {
                requestAnimationFrame(animStep);
            } else {
                animations.forEach(a => {
                    a.obj.position.set(a.targetX, a.targetY, a.targetZ);
                });
                resolve();
            }
        }
        requestAnimationFrame(animStep);
    });
}

/**
 * 🔧 V3.0: 关闭爆炸图，所有 LayerGroup 回到原始位置 (0,0,0)
 */
export async function resetExplode() {
    if (!explodeMode) return; // 已关闭

    setExplodeMode(null);
    setExplodedView(false);
    updateExplodeButtonUI(null);

    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !group.userData || !group.userData.layerGroups) return;

    const layerGroups = group.userData.layerGroups;
    const duration = EXPLODE_ANIM_DURATION;
    const startTime = performance.now();

    const animations = [];
    layerGroups.forEach((layerGroup) => {
        // 回到原始位置 (0,0,0)
        const targetX = layerGroup.userData._originalX || 0;
        const targetY = layerGroup.userData._originalY || 0;
        const targetZ = layerGroup.userData._originalZ || 0;

        if (Math.abs(layerGroup.position.x - targetX) > 0.01 ||
            Math.abs(layerGroup.position.y - targetY) > 0.01 ||
            Math.abs(layerGroup.position.z - targetZ) > 0.01) {
            animations.push({
                obj: layerGroup,
                startX: layerGroup.position.x,
                startY: layerGroup.position.y,
                startZ: layerGroup.position.z,
                targetX, targetY, targetZ
            });
        }
    });

    if (animations.length === 0) return;

    return new Promise(resolve => {
        function animStep(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1.0);
            const eased = progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            animations.forEach(a => {
                a.obj.position.x = a.startX + (a.targetX - a.startX) * eased;
                a.obj.position.y = a.startY + (a.targetY - a.startY) * eased;
                a.obj.position.z = a.startZ + (a.targetZ - a.startZ) * eased;
            });

            if (progress < 1.0) {
                requestAnimationFrame(animStep);
            } else {
                animations.forEach(a => {
                    a.obj.position.set(a.targetX, a.targetY, a.targetZ);
                });
                resolve();
            }
        }
        requestAnimationFrame(animStep);
    });
}

/**
 * 静默复位（不更新 UI 状态），供 setExplodeVertical/Horizontal 内部切换时使用
 */
async function resetExplodeSilent() {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !group.userData || !group.userData.layerGroups) return;

    const layerGroups = group.userData.layerGroups;
    const animations = [];
    layerGroups.forEach((layerGroup) => {
        if (!layerGroup.userData || !layerGroup.userData.isLayerGroup) return;
        const tx = layerGroup.userData._originalX || 0;
        const ty = layerGroup.userData._originalY || 0;
        const tz = layerGroup.userData._originalZ || 0;
        if (Math.abs(layerGroup.position.x - tx) > 0.01 ||
            Math.abs(layerGroup.position.y - ty) > 0.01 ||
            Math.abs(layerGroup.position.z - tz) > 0.01) {
            animations.push({
                obj: layerGroup,
                startX: layerGroup.position.x, startY: layerGroup.position.y, startZ: layerGroup.position.z,
                targetX: tx, targetY: ty, targetZ: tz
            });
        }
    });

    if (animations.length === 0) return;

    const duration = EXPLODE_ANIM_DURATION * 0.5; // 静默切换用一半时长
    const startTime = performance.now();
    return new Promise(resolve => {
        function animStep(currentTime) {
            const progress = Math.min((currentTime - startTime) / duration, 1.0);
            const eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
            animations.forEach(a => {
                a.obj.position.x = a.startX + (a.targetX - a.startX) * eased;
                a.obj.position.y = a.startY + (a.targetY - a.startY) * eased;
                a.obj.position.z = a.startZ + (a.targetZ - a.startZ) * eased;
            });
            if (progress < 1.0) {
                requestAnimationFrame(animStep);
            } else {
                animations.forEach(a => a.obj.position.set(a.targetX, a.targetY, a.targetZ));
                resolve();
            }
        }
        requestAnimationFrame(animStep);
    });
}

/**
 * 更新爆炸按钮 UI 状态
 */
function updateExplodeButtonUI(mode) {
    const btn = document.getElementById('btn-explode');
    if (!btn) return;

    if (mode === 'vertical') {
        btn.textContent = '🔍 纵向爆炸';
        btn.classList.add('active');
    } else if (mode === 'horizontal') {
        btn.textContent = '🔍 横向爆炸';
        btn.classList.add('active');
    } else {
        btn.textContent = '🔍 开启爆炸图';
        btn.classList.remove('active');
    }
}

// ==================== 🔧 V3.0: 层级聚焦（筛选与隐藏） ====================

/**
 * 🔧 V3.0: 聚焦某一层 — 隐藏所有非目标层的 LayerGroup
 *
 * @param {number|null} layerIndex - 要聚焦的层编号，传 null 显示全部
 *
 * 实现原理：
 *   - 遍历 furnaceGroup.userData.layerGroups Map
 *   - 设置 layerGroup.visible = (layerIndex === null || layerGroup.layerIndex === layerIndex)
 *   - 仅操作 visible 属性，不改变场景结构
 *   - focusLayer(null) 恢复全部显示
 */
export function focusLayer(layerIndex) {
    setFocusedLayer(layerIndex);

    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !group.userData || !group.userData.layerGroups) return;

    const layerGroups = group.userData.layerGroups;
    layerGroups.forEach((layerGroup) => {
        if (!layerGroup.userData || !layerGroup.userData.isLayerGroup) return;
        if (layerIndex === null) {
            // 显示全部
            layerGroup.visible = true;
        } else {
            // 仅显示匹配的层
            layerGroup.visible = (layerGroup.userData.layerIndex === layerIndex);
        }
    });
}

// ==================== 🔧 V3.0: 一键俯视视角（手册截图专用） ====================

/**
 * 🔧 V3.0: 一键俯视 — 将相机移动至炉膛正上方，确保物体居中、全屏可见
 *
 * 实现步骤：
 *   1. 通过 THREE.Box3 计算当前炉膛 Group 的包围盒
 *   2. 获取包围盒中心点和尺寸
 *   3. 将相机移动至中心点正上方
 *   4. 调整相机距离使包围盒全屏可见
 */
export function setTopViewForScreenshot() {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group) return;

    // 1. 计算包围盒（包含所有 LayerGroup + 料框框架）
    const box = new THREE.Box3().setFromObject(group);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);

    // 2. 计算相机距离：取包围盒 XZ 最大尺寸 * 1.3（留 30% 边距）
    const maxDim = Math.max(size.x, size.z);
    // 透视相机：fov=45° 时，高度 distance = (size / 2) / tan(fov/2)
    const fovRad = (camera.fov * Math.PI) / 180;
    const distance = (maxDim * 1.3) / (2 * Math.tan(fovRad / 2));

    // 3. 相机设置到正上方
    camera.position.set(
        center.x,
        center.y + distance * 0.8,  // 正上方，略小于计算值使视野更紧凑
        center.z + 5  // 轻微 Z 偏移避免正交视角导致的 NaN
    );

    // 4. 确保相机朝向正下方（设置 controls target 为包围盒中心）
    controls.target.copy(center);
    controls.update();
}

// ==================== TASK 2: 分层施工清单 (Layered BOM) ====================

/**
 * V2.8: 生成并显示分层施工清单（Layered BOM）— 完整业务字段版
 *
 * 🔧 TASK 3 修复：按 layer → (物料名称 + 材质 + 工艺) 两级分组聚合，
 * 展示完整的 name、material、process、weight、dimensions 信息。
 *
 * 展示格式示例：
 *   第 2 层 (共 150 件)
 *     [搁板] 1000×800mm × 1
 *     [工件] 齿轮轴 | 20CrMnTi | 渗碳淬火 | 5kg × 100件
 *     [工件] 法兰盘 | 42CrMo | 调质 | 2kg × 50件
 */
export function showLayeredBOM() {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return;
    const furnace = globalFurnacesResult[currentFurnaceIndex];
    if (!furnace) return;

    // ===== 第1级分组：按 layer =====
    const layerMap = new Map();

    furnace.packedItems.forEach(item => {
        const layer = getItemLayer(item, furnace);
        if (!layerMap.has(layer)) {
            layerMap.set(layer, { shelfCount: 0, items: new Map(), totalItems: 0, totalWeight: 0 });
        }
        const entry = layerMap.get(layer);

        // 🔧 TASK 3: 第2级分组 key = 物料名称 + 材质 + 工艺（三维精确归类）
        const mat = item.material || '未知材质';
        const proc = item.process || '未知工艺';
        const key = item.name + '|' + mat + '|' + proc;

        if (!entry.items.has(key)) {
            entry.items.set(key, {
                name: item.name,
                material: mat,
                process: proc,
                // 采集尺寸信息（优先使用 originalDims，回退到 w/d/h）
                dimensions: item.originalDims
                    ? `${item.originalDims.l}×${item.originalDims.w}×${item.originalDims.h}mm`
                    : `${item.w}×${item.d}×${item.h}mm`,
                singleWeight: item.weight || 0,
                count: 0,
                totalWeight: 0
            });
        }
        const iEntry = entry.items.get(key);
        iEntry.count++;
        iEntry.totalWeight += item.weight || 0;
        entry.totalItems++;
        entry.totalWeight += item.weight || 0;
    });

    // ===== 统计每个 layer 的搁板信息 =====
    if (furnace.shelvesUsed && furnace.shelvesUsed.length > 0) {
        const sortedShelves = [...furnace.shelvesUsed].sort((a, b) => a.y - b.y);
        sortedShelves.forEach((s, idx) => {
            const layer = idx + 2; // 底层=layer1, 第一块搁板上方=layer2
            if (layerMap.has(layer)) {
                layerMap.get(layer).shelfCount++;
                layerMap.get(layer).shelfInfo = {
                    dimensions: `${furnace.w}×${furnace.d}mm`,
                    thickness: s.thickness || placementRules.shelfThickness || 20
                };
            }
        });
    }

    // ===== 构建 HTML =====
    const sortedLayers = [...layerMap.entries()].sort((a, b) => a[0] - b[0]);
    let html = '<div class="bom-header">📋 ' + furnace.instanceId + ' · 施工分层清单</div>';
    html += '<div class="bom-subtitle">共 ' + sortedLayers.length + ' 层 · ' + furnace.packedItems.length + ' 件工件 · ' + furnace.totalWeight.toFixed(1) + 'kg</div>';

    sortedLayers.forEach(([layer, data]) => {
        const layerLabel = layer === 1 ? '底层（炉底）' : '第 ' + layer + ' 层';
        const shelfInfo = data.shelfCount > 0
            ? '<span style="color:#667788;"> | 搁板 × ' + data.shelfCount + '</span>'
            : '';
        html += '<div class="bom-layer-section">';
        html += '<div class="bom-layer-title">📦 ' + layerLabel + shelfInfo + ' — 共 ' + data.totalItems + ' 件 · ' + data.totalWeight.toFixed(1) + 'kg</div>';

        // 🔧 TASK 3: 先展示搁板行（如果本层有搁板）
        if (data.shelfCount > 0 && data.shelfInfo) {
            html += '<div class="bom-item-row bom-shelf-row">';
            html += '<span class="bom-item-name">[搁板] ' + data.shelfInfo.dimensions + ' (厚' + data.shelfInfo.thickness + 'mm)</span>';
            html += '<span class="bom-item-count">× ' + data.shelfCount + '</span>';
            html += '</div>';
        }

        // 🔧 TASK 3: 按 count 降序展示工件行，完整展示 name | material | process | weight
        const sortedItems = [...data.items.entries()].sort((a, b) => b[1].count - a[1].count);
        sortedItems.forEach(([, iData]) => {
            const avgWeight = iData.count > 0 ? (iData.totalWeight / iData.count).toFixed(1) : '0.0';
            html += '<div class="bom-item-row">';
            html += '<span class="bom-item-name">'
                + '[工件] ' + iData.name
                + ' <span class="bom-mat-badge">' + iData.material + '</span>'
                + ' <span class="bom-process-badge">' + iData.process + '</span>'
                + ' <span class="bom-dim-info">' + iData.dimensions + '</span>'
                + '</span>';
            html += '<span class="bom-item-weight">' + avgWeight + 'kg/件</span>';
            html += '<span class="bom-item-count">× ' + iData.count + ' 件</span>';
            html += '<span class="bom-item-subtotal">' + iData.totalWeight.toFixed(1) + 'kg</span>';
            html += '</div>';
        });

        html += '</div>';
    });

    // 显示在弹窗中
    let panel = document.getElementById('bom-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'bom-panel';
        panel.className = 'bom-panel';
        document.body.appendChild(panel);
    }
    panel.innerHTML = html + '<button class="bom-close-btn" id="bom-close-btn">✕ 关闭</button>';
    panel.style.display = 'block';

    // 关闭按钮事件
    const closeBtn = document.getElementById('bom-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
        });
    }

    // 点击背景关闭
    panel.addEventListener('click', (e) => {
        if (e.target === panel) panel.style.display = 'none';
    });
}

/**
 * 绘制环形工装轮廓。
 *
 * 注意：
 * 环形工装不应该显示为长方体蓝框。
 * 它的真实结构是多个圆形/圆环形托盘层。
 */
function drawRingToolingOutline(furnaceGroup, furnace, baseY) {
    const fw = furnace.w;
    const fh = furnace.h;
    const fd = furnace.d;
    const params = furnace.params || {};

    const outerRadius =
        params.outerRadius ||
        params.radialRadius ||
        Math.min(fw, fd) / 2 - 30;

    const innerRadius =
        params.centerVoidRadius ||
        params.innerRadius ||
        ((params.innerDia || 200) / 2);

    const shelfList =
        furnace.shelvesUsed && furnace.shelvesUsed.length > 0
            ? furnace.shelvesUsed
            : [
                { y: 0 },
                { y: fh * 0.25 },
                { y: fh * 0.5 },
                { y: fh * 0.75 }
            ];

    const mat = new THREE.LineBasicMaterial({
        color: 0x0066cc,
        transparent: true,
        opacity: 0.65
    });

    shelfList.forEach(shelf => {
        const y = baseY + shelf.y;

        // 外圈
        const outerCurve = new THREE.EllipseCurve(
            0, 0,
            outerRadius, outerRadius,
            0, Math.PI * 2,
            false,
            0
        );
        const outerPts = outerCurve.getPoints(96).map(p => new THREE.Vector3(p.x, y, p.y));
        const outerGeo = new THREE.BufferGeometry().setFromPoints(outerPts);
        const outerLine = new THREE.LineLoop(outerGeo, mat);
        furnaceGroup.add(outerLine);

        // 内圈空洞
        const innerCurve = new THREE.EllipseCurve(
            0, 0,
            innerRadius, innerRadius,
            0, Math.PI * 2,
            false,
            0
        );
        const innerPts = innerCurve.getPoints(96).map(p => new THREE.Vector3(p.x, y, p.y));
        const innerGeo = new THREE.BufferGeometry().setFromPoints(innerPts);
        const innerLine = new THREE.LineLoop(innerGeo, mat);
        furnaceGroup.add(innerLine);
    });

    // 高度参考线，避免用户看不出高度范围
    const verticalMat = new THREE.LineBasicMaterial({
        color: 0x0066cc,
        transparent: true,
        opacity: 0.25
    });

    for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2;
        const x = outerRadius * Math.cos(angle);
        const z = outerRadius * Math.sin(angle);

        const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x, baseY, z),
            new THREE.Vector3(x, baseY + fh, z)
        ]);

        furnaceGroup.add(new THREE.Line(geo, verticalMat));
    }
}

// ==================== TASK 1: 多炉膛原点居中渲染 ====================

/**
 * 🔧 重构 V3.0：构建单个炉膛的完整 Group — 引入 LayerGroup 容器架构
 *
 * 新结构：
 *   furnaceGroup
 *   ├── basketGroup (料框框架)
 *   ├── containerLine (蓝色轮廓)
 *   ├── layerGroup_1 (THREE.Group, isLayerGroup=true, layerIndex=1)
 *   │   ├── item_mesh_a (工件)
 *   │   └── shelfMesh_1 (搁板，如存在)
 *   ├── layerGroup_2 (THREE.Group, isLayerGroup=true, layerIndex=2)
 *   │   ├── item_mesh_b, item_mesh_c ...
 *   │   └── shelfMesh_2
 *   └── ...
 *
 * 爆炸位移和层级隐藏操作仅针对 LayerGroup 本身，内部工件/搁板位置不变。
 *
 * @param {Object} furnace - 炉膛配置
 * @param {number} index - 炉膛索引
 * @param {string|null} filterMaterialName - 物料筛选
 * @returns {THREE.Group} furnaceGroup
 */
export function buildFurnaceGroup(furnace, index, filterMaterialName) {
    const furnaceGroup = new THREE.Group();
    const baseY = -120;
    const fw = furnace.w;
    const fh = furnace.h;
    const fd = furnace.d;

    // 根据工装类型创建工装模型（支持夹具、环形工装、挂具等）
    const toolingType = furnace.toolingType || 'standard-basket';
    const toolingParams = furnace.params || {};   // 可包含 rodDiameter、ringCount 等
    let basketGroup;
    try {
        basketGroup = createEmptyTooling(toolingType, fw, fh, fd, toolingParams);
    } catch (e) {
        console.warn('[buildFurnaceGroup] createEmptyTooling 失败，回退到 createBasketFrame:', e);
        const basketType = furnace.basketType || 'grid';
        basketGroup = createBasketFrame(fw, fh, fd, 100, basketType);
    }
    // 【V3.0】应用金属材质
    applyMetallicMaterial(basketGroup);
    
    // 工装局部坐标：原点 (0,0,0) 在 furnaceGroup 的 baseY 处
    basketGroup.position.set(-fw / 2, baseY, -fd / 2);
    furnaceGroup.add(basketGroup);

    // 普通工装显示蓝色长方体轮廓；环形工装显示圆形轮廓
    if (toolingType === 'ring-tooling') {
        drawRingToolingOutline(furnaceGroup, furnace, baseY);
    } else {
        const containerGeo = new THREE.BoxGeometry(fw, fh, fd);
        const containerEdges = new THREE.EdgesGeometry(containerGeo);
        const containerLine = new THREE.LineSegments(
            containerEdges,
            new THREE.LineBasicMaterial({
                color: 0x0066cc,
                linewidth: 1,
                transparent: true,
                opacity: 0.5
            })
        );
        containerLine.position.set(0, fh / 2 + baseY, 0);
        furnaceGroup.add(containerLine);
    }

    // 🔧 重构：预计算每个工件的 layer → itemLayerMap
    const itemLayerMap = new Map(); // itemId → layer
    if (furnace.shelvesUsed && furnace.shelvesUsed.length > 0) {
        const sortedShelves = [...furnace.shelvesUsed].sort((a, b) => a.y - b.y);
        furnace.packedItems.forEach(item => {
            let layer = 1;
            for (let si = sortedShelves.length - 1; si >= 0; si--) {
                if (item.y >= sortedShelves[si].y) {
                    layer = si + 2;
                    break;
                }
            }
            itemLayerMap.set(item.id, layer);
        });
    } else {
        furnace.packedItems.forEach(item => {
            itemLayerMap.set(item.id, 1);
        });
    }

    // 🔧 重构：统计实际用到的 layer 编号，为每个 layer 创建 LayerGroup 容器
    const usedLayers = new Set();
    itemLayerMap.forEach(layer => usedLayers.add(layer));
    // 搁板也可能引入额外的 layer（搁板属于 layer = si+2）
    if (furnace.shelvesUsed && furnace.shelvesUsed.length > 0) {
        for (let i = 0; i < furnace.shelvesUsed.length; i++) {
            usedLayers.add(i + 2);
        }
    }
    usedLayers.add(1); // 确保至少有一个底层 layerGroup

    // 🔧 重构：创建 LayerGroup 容器 Map<layerIndex, THREE.Group>
    const layerGroups = new Map();
    usedLayers.forEach(layerNum => {
        const layerGroup = new THREE.Group();
        layerGroup.userData = {
            isLayerGroup: true,
            layerIndex: layerNum,
            // 🔧 _originalX/Y/Z 始终为 (0,0,0)，表示 LayerGroup 在 furnaceGroup 局部坐标中的原始位置
            // 爆炸时通过动画将 layerGroup.position 从 (0,0,0) 过渡到目标偏移，原值不变
            _originalX: 0,
            _originalY: 0,
            _originalZ: 0
        };
        layerGroup.position.set(0, 0, 0);
        layerGroups.set(layerNum, layerGroup);
        furnaceGroup.add(layerGroup);
    });

    // 🔧 重构：将 furnaceGroup 上的 layerGroups Map 引用保存在 userData 中，
    // 方便后续爆炸/筛选/俯视等操作直接获取
    furnaceGroup.userData = {
        furnaceIndex: index,
        furnaceName: furnace.instanceId,
        layerGroups: layerGroups // 新增：layer编号 → LayerGroup 的映射
    };

    // 渲染工件
    furnace.packedItems.forEach(item => {
        const isFiltered = filterMaterialName && item.material !== filterMaterialName;
        const mesh = createItemMesh(item, furnace, baseY, isFiltered);

        // 【V3.0】按材质固定颜色（覆盖原有动态颜色）
        const fixedColor = getFixedColorByMaterial(item.material);
        if (fixedColor !== null && mesh.material) {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(mat => {
                    if (mat.color) mat.color.setHex(fixedColor);
                });
            } else if (mesh.material.color) {
                mesh.material.color.setHex(fixedColor);
            }
        }

        const itemLayer = itemLayerMap.get(item.id) || 1;
        // 补充 userData 中 createItemMesh 未设置的字段
        mesh.userData.furnaceIndex = index;
        mesh.userData.layer = itemLayer;

        // 🔧 重构：将工件加入对应的 LayerGroup，而非 furnaceGroup
        const targetLayerGroup = layerGroups.get(itemLayer);
        if (targetLayerGroup) {
            targetLayerGroup.add(mesh);
        } else {
            // 回退：如果 LayerGroup 不存在（不应发生），直接加 furnaceGroup
            furnaceGroup.add(mesh);
        }
    });

    // 渲染搁板（传入 layerGroups Map，搁板将加入对应的 LayerGroup）
    if (placementRules.useShelfLayered && furnace.packedItems.length > 0) {
        renderShelvesForFurnace(furnace, furnaceGroup, baseY, layerGroups);
    }

    furnaceGroup.visible = false; // 默认隐藏，由 renderSingleFurnace 控制显示
    return furnaceGroup;
}

/**
 * V2.7: 构建所有炉膛 Group（在原点创建），隐藏全部 → 显示当前索引的炉膛
 */
function buildAllFurnaceGroups(filterMaterialName) {
    // 清理旧 Group
    clearFurnaceGroups();
    disposeShelfMeshes();
    while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);

    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return;

    globalFurnacesResult.forEach((furnace, idx) => {
        const group = buildFurnaceGroup(furnace, idx, filterMaterialName);
        itemsGroup.add(group);
        setFurnaceGroup(idx, group);
    });
}

/**
 * V2.7: 渲染单个炉膛（原点居中版本）
 * 构建所有炉膛 Group，然后只显示当前索引的 Group
 */
export function renderSingleFurnace(index, filterMaterialName) {
    if (!globalFurnacesResult || index >= globalFurnacesResult.length || index < 0) {
        document.getElementById('empty-state').style.display = 'block';
        return;
    }
    document.getElementById('empty-state').style.display = 'none';

    const furnace = globalFurnacesResult[index];

    // 构建所有炉膛（如果尚未构建）
    const existingGroup = furnaceGroups.get(index);
    if (!existingGroup || existingGroup.parent !== itemsGroup) {
        buildAllFurnaceGroups(filterMaterialName);
    }

    // 切换可见性：只显示当前炉膛
    furnaceGroups.forEach((group, grpIdx) => {
        group.visible = (grpIdx === index);
    });

    // 更新相机位置 — 对准原点
    const baseY = -120;
    controls.target.set(0, furnace.h / 2 + baseY, 0);
    camera.position.set(furnace.w * 1.5, furnace.h * 1.8 + baseY, furnace.d * 2.5);
    controls.update();

    // 🔧 V3.0: 如果爆炸图模式开启，需要重新应用爆炸偏移到新构建的 LayerGroup
    if (explodeMode) {
        const currentMode = explodeMode;
        // 先清除状态，避免 setExplodeXXX 内部的防重复逻辑干扰
        setExplodeMode(null);
        setExplodedView(false);
        // 根据之前保存的模式重新应用
        if (currentMode === 'vertical') {
            setExplodeVertical();
        } else if (currentMode === 'horizontal') {
            setExplodeHorizontal();
        }
    }

    update3DStatsPanel(furnace);
}

/**
 * V2.2: 增强版3D统计面板 — 仅显示当前炉膛物料统计
 */
function update3DStatsPanel(furnace) {
    const panel = document.getElementById('stats-3d-panel');
    if (!panel) return;

    if (!furnace || !furnace.packedItems || furnace.packedItems.length === 0) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';

    const items = furnace.packedItems;

    let totalWeightVal = 0;
    const materialWeightMap = new Map();
    const processWeightMap = new Map();
    const batchSet = new Set();

    items.forEach(item => {
        totalWeightVal += (item.weight || 0);

        const mat = item.material || '未知材质';
        materialWeightMap.set(mat, (materialWeightMap.get(mat) || 0) + (item.weight || 0));

        const proc = item.process || '未知工艺';
        processWeightMap.set(proc, (processWeightMap.get(proc) || 0) + (item.weight || 0));

        if (item.name && (item.name.includes('订单') || item.name.includes('批次'))) {
            batchSet.add(item.name.replace(/_\d+$/, ''));
        }
    });

    const totalVol = furnace.w * furnace.h * furnace.d;
    const packedVol = items.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
    const volUtilization = totalVol > 0 ? ((packedVol / totalVol) * 100).toFixed(1) : '0';
    const weightUtilization = furnace.max_weight > 0 ? ((totalWeightVal / furnace.max_weight) * 100).toFixed(1) : '0';

    let materialHTML = '';
    const matEntries = [...materialWeightMap.entries()].sort((a, b) => b[1] - a[1]);
    matEntries.forEach(([mat, wgt]) => {
        materialHTML += '<div class="ssp-item-row"><span class="ssp-item-name">' + mat + '</span><span class="ssp-item-count">' + wgt.toFixed(1) + 'kg</span></div>';
    });

    let processHTML = '';
    const procEntries = [...processWeightMap.entries()].sort((a, b) => b[1] - a[1]);
    procEntries.forEach(([proc, wgt]) => {
        processHTML += '<div class="ssp-item-row"><span class="ssp-item-name">' + proc + '</span><span class="ssp-item-count">' + wgt.toFixed(1) + 'kg</span></div>';
    });

    let batchHTML = '';
    if (batchSet.size > 0) {
        [...batchSet].sort().forEach(b => {
            batchHTML += '<div class="ssp-item-row"><span class="ssp-item-name">' + b + '</span></div>';
        });
    }

    const furnaceName = furnace.instanceId || ('炉膛 #' + (globalFurnacesResult.indexOf(furnace) + 1));
    panel.innerHTML =
        '<div class="ssp-header-wrapper">' +
        '<div class="ssp-header">📊 ' + furnaceName + '</div>' +
        '<button class="ssp-toggle-btn" id="btn-toggle-3d-stats" title="折叠/展开" onclick="window._toggle3DStats && window._toggle3DStats()">▲</button>' +
        '</div>' +
        '<div class="ssp-body">' +
        '<div class="ssp-stat-row"><span class="ssp-label">利用率</span><span class="ssp-value">' + volUtilization + '% (体积)</span></div>' +
        '<div class="ssp-stat-row"><span class="ssp-label">重量利用率</span><span class="ssp-value">' + weightUtilization + '%</span></div>' +
        '<div class="ssp-stat-row"><span class="ssp-label">工件数量</span><span class="ssp-value">' + items.length + ' 件</span></div>' +
        '<div class="ssp-stat-row"><span class="ssp-label">总重量</span><span class="ssp-value">' + totalWeightVal.toFixed(1) + ' kg</span></div>' +
        '<div class="ssp-divider"></div>' +
        '<div class="ssp-list-title">🔧 材质统计</div>' +
        materialHTML +
        '<div class="ssp-divider"></div>' +
        '<div class="ssp-list-title">⚙️ 工艺统计</div>' +
        processHTML +
        (batchSet.size > 0 ?
            '<div class="ssp-divider"></div>' +
            '<div class="ssp-list-title">📦 批次</div>' +
            batchHTML : '') +
        '</div>';
}

// ==================== SCENE NAVIGATION ====================

export function getSelectedMaterialName() {
    if (!selectedMaterialCardId) return null;
    const card = document.getElementById(selectedMaterialCardId);
    if (!card) return null;
    const material = card.getAttribute('data-material');
    return material || null;
}

// ==================== IMPROVED ANIMATION (V2.7) ====================

/**
 * V2.7: 装料动画改进（原点居中 + 性能优化）
 *
 * TASK 3 性能优化：
 *   - 动画开始前关闭方向光阴影 castShadow
 *   - 动画结束后重新开启阴影
 *   - 工件材质强制 transparent: false（杜绝性能杀手）
 */
export async function playLoadingAnimation() {
    if (isAnimating || !globalFurnacesResult || globalFurnacesResult.length === 0) return;

    let startFurnaceIndex = currentFurnaceIndex;
    if (selectedFurnaceCardId) {
        const card = document.getElementById(selectedFurnaceCardId);
        if (card) {
            const fid = parseInt(card.getAttribute('data-fid'));
            const foundIdx = findResultIndexByFid(fid);
            if (foundIdx >= 0) startFurnaceIndex = foundIdx;
        }
    }
    const filterMaterialName = getSelectedMaterialName();

    setIsAnimating(true); setAnimPaused(false); setAnimStopped(false);

    const btnAnimate = document.getElementById('btn-animate');
    btnAnimate.disabled = true; btnAnimate.style.opacity = '0.5';
    const controlBar = document.getElementById('anim-control-bar');
    controlBar.classList.add('visible');

    // V2.7 TASK 3: 动画开始前关闭阴影
    const dirLight = mainDirectionalLight;
    const shadowWasEnabled = dirLight ? dirLight.castShadow : false;
    if (dirLight) dirLight.castShadow = false;

    disposeShelfMeshes();
    while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);
    clearFurnaceGroups();

    const baseY = -120;
    const itemDrawSteps = [];
    const furnace = globalFurnacesResult[startFurnaceIndex];

    // 为动画创建当前炉膛 Group（在原点）
    // 注意：动画不能再只根据 basketType 创建料框，否则 ring-tooling 会退化成 ringnode/普通料框。
    const toolingType = furnace.toolingType || 'standard-basket';
    const toolingParams = furnace.params || {};
    let basketGroup;

    try {
        basketGroup = createEmptyTooling(
            toolingType,
            furnace.w,
            furnace.h,
            furnace.d,
            toolingParams
        );
    } catch (e) {
        console.warn('[playLoadingAnimation] createEmptyTooling 失败，回退到 createBasketFrame:', e);
        const basketType = furnace.basketType || 'grid';
        basketGroup = createBasketFrame(furnace.w, furnace.h, furnace.d, 100, basketType);
    }

    // 【V3.0】应用金属材质
    applyMetallicMaterial(basketGroup);
    basketGroup.position.set(-furnace.w / 2, baseY, -furnace.d / 2);
    itemsGroup.add(basketGroup);

    // 如果是环形工装，将真实环形工装的内部搁板信息同步回 furnace.params
    if (toolingType === 'ring-tooling' && basketGroup.userData && basketGroup.userData.shelves) {
        furnace.params = furnace.params || {};
        furnace.params.radialRadius = basketGroup.userData.radialRadius;
        furnace.params.shelves = basketGroup.userData.shelves;
        furnace.params.useInternalShelves = true;
        furnace.params.isRadialTooling = true;
    }

    // 普通工装显示蓝色长方体轮廓；环形工装显示圆形轮廓
    if (toolingType === 'ring-tooling') {
        drawRingToolingOutline(itemsGroup, furnace, baseY);
    } else {
        const containerGeo = new THREE.BoxGeometry(furnace.w, furnace.h, furnace.d);
        const containerLine = new THREE.LineSegments(
            new THREE.EdgesGeometry(containerGeo),
            new THREE.LineBasicMaterial({
                color: 0x0066cc,
                linewidth: 1,
                transparent: true,
                opacity: 0.5
            })
        );
        containerLine.position.set(0, furnace.h / 2 + baseY, 0);
        itemsGroup.add(containerLine);
    }

    // 🔧 按 layer 分组工件，按层级编排动画步骤：Layer1工件→搁板1→Layer2工件→搁板2→...
    const layerItemMap = new Map(); // layer → [items]
    const sortedShelves = furnace.shelvesUsed && furnace.shelvesUsed.length > 0
        ? [...furnace.shelvesUsed].sort((a, b) => a.y - b.y)
        : [];

    furnace.packedItems.forEach((item) => {
        if (filterMaterialName && item.material !== filterMaterialName) return;
        let layer = 1;
        for (let si = sortedShelves.length - 1; si >= 0; si--) {
            if (item.y >= sortedShelves[si].y) {
                layer = si + 2;
                break;
            }
        }
        if (!layerItemMap.has(layer)) layerItemMap.set(layer, []);
        layerItemMap.get(layer).push(item);
    });

    const maxLayer = layerItemMap.size > 0 ? Math.max(...layerItemMap.keys()) : 1;
    for (let layer = 1; layer <= maxLayer; layer++) {
        // 添加该层工件
        const layerItems = layerItemMap.get(layer) || [];
        layerItems.forEach((item) => {
            let geometry;
            if (item.shape === 'cylinder') {
                if (item.needsRotation) {
                    // 侧放圆盘：h = 原直径(大值), w = 原厚度(小值)
                    geometry = new THREE.CylinderGeometry(item.h / 2, item.h / 2, item.w, 32);
                } else {
                    geometry = new THREE.CylinderGeometry(item.w / 2, item.w / 2, item.h, 32);
                }
            } else {
                geometry = new THREE.BoxGeometry(item.w, item.h, item.d);
            }

            const material = new THREE.MeshStandardMaterial({
                color: new THREE.Color(item.color),
                transparent: false,
                roughness: 0.3, metalness: 0.2,
                depthWrite: true
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = false;
            mesh.receiveShadow = false;

            // 【V3.0】按材质固定颜色（覆盖原有动态颜色）
            const fixedColor = getFixedColorByMaterial(item.material);
            if (fixedColor !== null && mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(mat => {
                        if (mat.color) mat.color.setHex(fixedColor);
                    });
                } else if (mesh.material.color) {
                    mesh.material.color.setHex(fixedColor);
                }
            }

            // 扁平圆盘侧放旋转
            if (item.shape === 'cylinder' && item.needsRotation) {
                mesh.rotation.z = Math.PI / 2;
            }

            mesh.userData = {
                itemName: item.name,
                itemId: item.id,
                shape: item.shape,
                originalColor: item.color,
                itemMaterial: item.material || '',
                itemProcess: item.process || '',
                _originalY: null,
                _animMesh: true
            };
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry),
                new THREE.LineBasicMaterial({ color: 0x444444 })));

            const targetX = item.x - furnace.w / 2 + item.w / 2;
            const targetY = item.y + item.h / 2 + baseY;
            const targetZ = item.z - furnace.d / 2 + item.d / 2;
            const startY = furnace.h + baseY + 300;

            mesh.position.set(targetX, startY, targetZ);
            itemDrawSteps.push({
                mesh, furnaceIndex: startFurnaceIndex,
                furnaceName: furnace.instanceId,
                itemName: item.name,
                x: Math.round(item.x), y: Math.round(item.y), z: Math.round(item.z),
                targetX, targetY, targetZ,
                startY,
                isShelf: false
            });
        });

        // 🔧 在该层工件后插入搁板动画步骤（如果上方一层有工件）
        if (furnace.toolingType !== 'ring-tooling' && layer <= sortedShelves.length) {
            const shelfIdx = layer - 1;
            const shelfY = sortedShelves[shelfIdx].y;
            const nextLayer = layer + 1;
            const nextLayerHasItems = layerItemMap.has(nextLayer) && layerItemMap.get(nextLayer).length > 0;
            if (nextLayerHasItems) {
                const shelfThickness = placementRules.shelfThickness || 20;
                let shelfMesh;

                if (furnace.toolingType === 'ring-tooling') {
                    const params = furnace.params || {};

                    const outerRadius =
                        params.outerRadius ||
                        params.radialRadius ||
                        Math.min(furnace.w, furnace.d) / 2 - 30;

                    const innerRadius =
                        params.centerVoidRadius ||
                        params.innerRadius ||
                        ((params.innerDia || 200) / 2);

                    shelfMesh = createRingShelfMesh(outerRadius, innerRadius);
                } else {
                    shelfMesh = createShelfMesh(furnace.w, furnace.d, shelfThickness);
                }
                shelfMesh.userData = {
                    isShelfMesh: true,
                    shelfY: shelfY,
                    thickness: shelfThickness,
                    _animMesh: true,
                    _isShelfAnim: true
                };
                const shelfTargetY = baseY + shelfY;
                const shelfStartY = furnace.h + baseY + 300;
                shelfMesh.position.set(0, shelfStartY, 0);
                itemsGroup.add(shelfMesh); // 搁板先加入场景（从高处下落）

                itemDrawSteps.push({
                    mesh: shelfMesh,
                    furnaceIndex: startFurnaceIndex,
                    furnaceName: furnace.instanceId,
                    itemName: '[搁板]',
                    x: 0, y: Math.round(shelfY), z: 0,
                    targetX: 0, targetY: shelfTargetY, targetZ: 0,
                    startY: shelfStartY,
                    isShelf: true
                });
            }
        }
    }


    if (itemDrawSteps.length === 0) {
        setIsAnimating(false); controlBar.classList.remove('visible');
        btnAnimate.disabled = false; btnAnimate.style.opacity = '1';
        document.getElementById('stats-3d-panel').style.display = 'none';
        if (dirLight) dirLight.castShadow = shadowWasEnabled;
        return;
    }

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitIfPaused = () => new Promise(resolve => {
        const check = () => { if (animStopped || !animPaused) resolve(); else setTimeout(check, 100); };
        check();
    });

    if (itemDrawSteps.length > 0) {
        const firstStep = itemDrawSteps[0];
        // 🔧 单炉膛模式：工件首次加入，搁板已在创建时加入
        if (!firstStep.isShelf) {
            itemsGroup.add(firstStep.mesh);
        }

        document.getElementById('anim-progress-text').textContent =
            '(1/' + itemDrawSteps.length + ') · 将【' + firstStep.itemName + '】吊装至 ' + firstStep.furnaceName + ' · 坐标(' + firstStep.x + ',' + firstStep.y + ',' + firstStep.z + ')';
    }

    for (let i = 0; i < itemDrawSteps.length; i++) {
        if (animStopped) break;
        await waitIfPaused();
        if (animStopped) break;

        const speedMs = parseInt(document.getElementById('anim-speed-select').value) || 400;
        const dropDurationMs = speedMs * 0.8;
        const entryDelayMs = speedMs * 0.2;

        const step = itemDrawSteps[i];

        // 🔧 单炉膛模式：搁板已在创建时加入 itemsGroup，工件在首次下落前加入
        if (i > 0 && !step.isShelf) {
            itemsGroup.add(step.mesh);
        }

        const entryDelay = 0;
        const startTime = performance.now();

        const animateDrop = new Promise(resolve => {
            function frame() {
                if (animStopped) { resolve(); return; }
                if (animPaused) { requestAnimationFrame(frame); return; }

                const elapsed = performance.now() - startTime;
                if (elapsed < entryDelay) {
                    requestAnimationFrame(frame);
                    return;
                }

                const dropElapsed = elapsed - entryDelay;
                const progress = Math.min(dropElapsed / dropDurationMs, 1.0);

                const eased = 1 - Math.pow(1 - progress, 3);
                step.mesh.position.y = step.startY + (step.targetY - step.startY) * eased;

                if (progress < 1.0) {
                    requestAnimationFrame(frame);
                } else {
                    step.mesh.position.y = step.targetY;
                    resolve();
                }
            }
            requestAnimationFrame(frame);
        });

        const filterLabel = filterMaterialName ? ' · 仅显示【' + filterMaterialName + '】' : '';
        document.getElementById('anim-progress-text').textContent =
            '(' + (i + 1) + '/' + itemDrawSteps.length + ') · 将【' + step.itemName + '】吊装至 ' + step.furnaceName + ' · 坐标(' + step.x + ',' + step.y + ',' + step.z + ')' + filterLabel;

        await animateDrop;

        const currentSpeedMs = parseInt(document.getElementById('anim-speed-select').value) || 400;
        // 只留一段极短的基础睡眠，保证浏览器的渲染线程能喘口气，避免极端卡死
        await sleep(currentSpeedMs * 0.2);
    }

    document.getElementById('anim-progress-text').textContent = '';
    controlBar.classList.remove('visible');

    // V2.7 TASK 3: 动画结束后恢复阴影
    if (dirLight) dirLight.castShadow = shadowWasEnabled;
    // 重新开启所有落下工件的阴影
    itemDrawSteps.forEach(step => {
        step.mesh.castShadow = true;
        step.mesh.receiveShadow = true;
    });

    if (animStopped) {
        renderSingleFurnace(currentFurnaceIndex, filterMaterialName);
    }

    if (globalFurnacesResult && globalFurnacesResult.length > currentFurnaceIndex) {
        update3DStatsPanel(globalFurnacesResult[currentFurnaceIndex]);
    }

    btnAnimate.disabled = false; btnAnimate.style.opacity = '1';
    setIsAnimating(false); setAnimPaused(false); setAnimStopped(false);
}

function rebuildSceneUpTo(stepIndex, allSteps, filterMaterialName) {
    while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);

    const effectiveIndex = Math.max(0, stepIndex);
    const furnaceIndex = allSteps[effectiveIndex].furnaceIndex;
    const furnace = globalFurnacesResult[furnaceIndex];
    const baseY = -120;

    // V2.7: 在原点重建
    const basketType = furnace.basketType || 'grid';
    const basketGroup = createBasketFrame(furnace.w, furnace.h, furnace.d, 100, basketType);
    applyMetallicMaterial(basketGroup);
    basketGroup.position.set(-furnace.w / 2, baseY, -furnace.d / 2);
    itemsGroup.add(basketGroup);

    const containerGeo = new THREE.BoxGeometry(furnace.w, furnace.h, furnace.d);
    const containerLine = new THREE.LineSegments(
        new THREE.EdgesGeometry(containerGeo),
        new THREE.LineBasicMaterial({ color: 0x0066cc, linewidth: 1, transparent: true, opacity: 0.5 })
    );
    containerLine.position.set(0, furnace.h / 2 + baseY, 0);
    itemsGroup.add(containerLine);

    for (let i = 0; i <= stepIndex; i++) {
        if (allSteps[i].furnaceIndex === furnaceIndex) {
            itemsGroup.add(allSteps[i].mesh);
        }
    }

    controls.target.set(0, furnace.h / 2 + baseY, 0);
    camera.position.set(furnace.w * 1.5, furnace.h * 1.8 + baseY, furnace.d * 2.5);
    controls.update();
}

// ==================== MASTER VIEW (V2.3) ====================

export function renderMasterPlan(plan) {
    /* 保留前5个持久元素（ambient, directional, grid, axes, ruler），移除其余动态内容 */
    while (masterScene.children.length > 5) masterScene.remove(masterScene.children[masterScene.children.length - 1]);
    const fw = plan.furnaceW || 800, fh = plan.furnaceH || 600, fd = plan.furnaceD || 600;

    const basketGroup = createBasketFrame(fw, fh, fd, 100, 'grid');
    applyMetallicMaterial(basketGroup);
    basketGroup.position.set(-fw / 2, -120, -fd / 2);
    masterScene.add(basketGroup);

    const containerGeo = new THREE.BoxGeometry(fw, fh, fd);
    const containerLine = new THREE.LineSegments(
        new THREE.EdgesGeometry(containerGeo),
        new THREE.LineBasicMaterial({ color: 0x7c3aed, linewidth: 2 })
    );
    containerLine.position.set(0, fh / 2 - 120, 0);
    masterScene.add(containerLine);

    const group = new THREE.Group();
    plan.items.forEach(item => {
        let geo;
        if (item.shape === 'cylinder') {
            if (item.needsRotation) {
                geo = new THREE.CylinderGeometry(item.h / 2, item.h / 2, item.w, 32);
            } else {
                geo = new THREE.CylinderGeometry(item.w / 2, item.w / 2, item.h, 32);
            }
        } else {
            geo = new THREE.BoxGeometry(item.w, item.h, item.d);
        }
        // V2.7 TASK 3: 主视图工件也关闭透明度
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(item.color),
            transparent: false,
            roughness: 0.3, metalness: 0.2,
            depthWrite: true
        });
        const mesh = new THREE.Mesh(geo, mat);

        // 【V3.0】主视图也应用材质固定颜色
        const fixedColor = getFixedColorByMaterial(item.material);
        if (fixedColor !== null && mesh.material) {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => { if (m.color) m.color.setHex(fixedColor); });
            } else if (mesh.material.color) {
                mesh.material.color.setHex(fixedColor);
            }
        }

        // 扁平圆盘侧放旋转
        if (item.shape === 'cylinder' && item.needsRotation) {
            mesh.rotation.z = Math.PI / 2;
        }

        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x444444 })));
        mesh.position.set(
            item.x - fw / 2 + item.w / 2,
            item.y + item.h / 2 - 120,
            item.z - fd / 2 + item.d / 2
        );
        group.add(mesh);
    });
    masterScene.add(group);
    masterControls.target.set(0, fh / 2 - 120, 0);
    masterCamera.position.set(fw * 1.5, fh * 1.8 - 120, fd * 2.5);
    masterControls.update();

    document.getElementById('master-detail-panel').innerHTML = `
        <strong>${plan.title}</strong> &nbsp;
        <span style="color:#888;font-size:10px;">${plan.furnaceType} · ${plan.date} · 操作员: ${plan.operator}</span><br>
        <span style="color:#a78bfa;">利用率: ${plan.utilization} · 总重: ${plan.totalWeight} · ${plan.itemCount}件</span><br>
        <span style="color:#aaa;">${plan.description}</span>
    `;
}

// ==================== SCREENSHOT CAMERA HELPER (V3.2) ====================

/**
 * 设置紧凑透视相机 — PDF 截图专用
 * 基于包围盒精确计算距离，仅留小比例边距，确保料框/工件占满截图画面
 *
 * @param {THREE.Vector3} direction - 相机方向向量（归一化后使用），如 (1, 1, 1) 或 (0, 0.6, 1.5)
 * @param {number} marginRatio - 边距比例，默认 0.02 (2%)
 */
export function setTightFitCamera(direction, marginRatio = 0.02) {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group) return;

    const box = new THREE.Box3().setFromObject(group);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fovRad = (camera.fov * Math.PI) / 180;
    const distance = (maxDim * (1 + marginRatio)) / (2 * Math.tan(fovRad / 2));

    const dir = direction.clone().normalize();
    camera.position.copy(center.clone().add(dir.clone().multiplyScalar(distance)));
    controls.target.copy(center);
    controls.update();
}

// ==================== ORTHOGRAPHIC TOP-VIEW FOR STEP SCREENSHOTS (V3.4) ====================

/**
 * 创建正交俯视相机并设置位置 — 用于装炉步骤图截图
 *
 * 此函数不修改全局 PerspectiveCamera，而是返回一个新的 OrthographicCamera。
 * 截图引擎通过 forceRender(orthoCamera) 使用它进行渲染，截图后丢弃。
 *
 * 基于当前炉膛 Group 的包围盒自动计算 frustumSize，确保所有物料、搁板完整在画面内。
 *
 * @param {number} [marginRatio=0.02] - 边距比例
 * @returns {THREE.OrthographicCamera|null}
 */
export function setOrthographicTopView(marginRatio = 0.02) {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !renderer) return null;

    // 计算包围盒
    const box = new THREE.Box3().setFromObject(group);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);

    // frustumSize 取 XZ 平面最大尺寸 + 边距
    const maxDim = Math.max(size.x, size.z);
    const frustumSize = maxDim * (1 + marginRatio);

    // 基于 canvas 实际尺寸计算宽高比
    const canvas = renderer.domElement;
    const aspect = canvas.clientWidth / canvas.clientHeight;

    const orthoCamera = new THREE.OrthographicCamera(
        -frustumSize * aspect / 2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        -frustumSize / 2,
        0.1,
        20000
    );

    // 相机放在包围盒正上方
    orthoCamera.position.set(center.x, center.y + 10000, center.z);
    orthoCamera.lookAt(center);
    // 设置 up 方向为 -Z，使屏幕上方对应场景后方（俯视标准方向）
    orthoCamera.up.set(0, 0, -1);

    return orthoCamera;
}

// ==================== HELPERS ====================

export function findResultIndexByFid(fid) {
    if (!globalFurnacesResult) return -1;
    const cardEl = document.getElementById('furnace-card-' + fid);
    if (!cardEl) return -1;
    const name = cardEl.querySelector('.f-card-name').textContent;
    for (let i = 0; i < globalFurnacesResult.length; i++) {
        if (globalFurnacesResult[i].typeName === name) return i;
    }
    return -1;
}

// ==================== PDF 截图辅助函数 (V3.1) ====================

/**
 * 强制执行一次渲染 — 供截图引擎调用
 *
 * 在修改相机/场景状态后，调用此函数确保 WebGL framebuffer 已更新，
 * 然后立即使用 renderer.domElement.toDataURL() 获取截图。
 *
 * 注意：此函数不会阻塞动画循环，动画循环在后台继续运行也不会产生副作用。
 *
 * @param {THREE.Camera} [customCamera] - 可选自定义相机（如 OrthographicCamera 截图时传入）
 */
export function forceRender(customCamera) {
    const activeCamera = customCamera || camera;
    if (renderer && scene && activeCamera) {
        renderer.render(scene, activeCamera);
    }
}

/**
 * 截图前临时覆盖网格/坐标轴/标尺的显示状态
 *
 * 不修改 displaySettings 全局状态，仅直接操作 Helper 对象的 visible 属性。
 * 返回原始状态快照，供 restoreDisplay() 恢复。
 *
 * @param {{ showGrid?: boolean, showAxes?: boolean, showRulers?: boolean }} overrides
 * @returns {Object} 原始状态快照
 */
export function saveAndOverrideDisplay({ showGrid, showAxes, showRulers }) {
    const snapshot = {
        showGrid: mainSceneGridHelper ? mainSceneGridHelper.visible : true,
        showAxes: mainSceneAxesHelper ? mainSceneAxesHelper.visible : true,
        showRulers: mainSceneRulerGroup ? mainSceneRulerGroup.visible : true
    };
    if (mainSceneGridHelper && showGrid !== undefined) mainSceneGridHelper.visible = showGrid;
    if (mainSceneAxesHelper && showAxes !== undefined) mainSceneAxesHelper.visible = showAxes;
    if (mainSceneRulerGroup && showRulers !== undefined) mainSceneRulerGroup.visible = showRulers;
    return snapshot;
}

/**
 * 恢复截图前的显示状态
 * @param {Object} snapshot - saveAndOverrideDisplay() 返回的快照
 */
export function restoreDisplay(snapshot) {
    if (!snapshot) return;
    if (mainSceneGridHelper) mainSceneGridHelper.visible = snapshot.showGrid;
    if (mainSceneAxesHelper) mainSceneAxesHelper.visible = snapshot.showAxes;
    if (mainSceneRulerGroup) mainSceneRulerGroup.visible = snapshot.showRulers;
}

// ==================== AI LOADING OVERLAY HELPERS ====================

/** AI 思考提示文字轮播列表 */
const AI_HINTS = [
    '正在分析物料组合…',
    '计算空间最优排布…',
    '优化利用率指标…',
    '生成装炉方案…',
    '校验安全间距…',
    '正在渲染 3D 场景…'
];

let _aiHintTimer = null;
let _aiHintIndex = 0;

/**
 * 显示极简 AI 思考中加载动画
 * 覆盖整个 3D 视口区域（而不是整个页面），避免遮挡侧边栏
 */
export function showAILoadingLoading() {
    const overlay = document.getElementById('ai-loading-overlay');
    if (!overlay) return;

    // 将 overlay 定位到 canvas-area 内部而非全屏
    const canvasArea = document.getElementById('canvas-area');
    if (canvasArea) {
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.right = '0';
        overlay.style.bottom = '0';
        overlay.style.zIndex = '999';
    }

    overlay.classList.add('active');

    // 启动提示文字轮播
    _aiHintIndex = 0;
    const hintEl = document.getElementById('ai-loading-hint');
    if (hintEl) hintEl.textContent = AI_HINTS[0];

    _aiHintTimer = setInterval(() => {
        _aiHintIndex = (_aiHintIndex + 1) % AI_HINTS.length;
        if (hintEl) {
            hintEl.style.opacity = '0';
            setTimeout(() => {
                hintEl.textContent = AI_HINTS[_aiHintIndex];
                hintEl.style.opacity = '1';
            }, 300);
        }
    }, 1800);
}

/**
 * 隐藏 AI 思考中加载动画
 */
export function hideAILoadingLoading() {
    const overlay = document.getElementById('ai-loading-overlay');
    if (!overlay) return;

    // 停止提示轮播
    if (_aiHintTimer) {
        clearInterval(_aiHintTimer);
        _aiHintTimer = null;
    }

    overlay.classList.remove('active');

    // 恢复 overlay 为 fixed 定位（默认全屏模式）
    overlay.style.position = 'fixed';
}