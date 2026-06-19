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
    'Cr12': 0x1E3A8A,      // 深蓝
    'H13': 0x4B4B4B,       // 深灰
    'MOV': 0xFFBF00,       // 琥珀色
    '20Cr': 0x0E7490,      // 青蓝
    '20CrMnTi': 0x2563EB,  // 工业蓝
    '40Cr': 0x16A34A,      // 绿色
    '45#': 0x9333EA        // 紫色
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


// ==================== V0.7.10: 工件颜色模式 ====================
// 默认模式：主体颜色表达材质，顶部/边框辅助标识表达客户/批次。
let itemColorMode = 'materialCustomer'; // materialCustomer | material | customer | process

const CUSTOMER_MARKER_PALETTE = [
    0xef4444, 0x22c55e, 0xf59e0b, 0x8b5cf6, 0x06b6d4,
    0xec4899, 0x84cc16, 0xf97316, 0x14b8a6, 0x64748b
];

const PROCESS_COLOR_MAP = {
    '真空淬火': 0x0ea5e9,
    '渗碳淬火': 0xf97316,
    '渗碳抛丸': 0x2563eb,
    '碳氮共渗': 0x7c3aed,
    '氮化': 0x16a34a,
    '氰化': 0xdc2626
};

function hashTextToIndex(text, modulo) {
    const raw = String(text || '').trim();
    if (!raw || !modulo) return 0;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
        hash = ((hash << 5) - hash) + raw.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % modulo;
}

function getHashColor(text, palette = CUSTOMER_MARKER_PALETTE) {
    return palette[hashTextToIndex(text || 'default', palette.length)] || 0x64748b;
}

function getCustomerMarkerColor(item) {
    return getHashColor(item?.customer || item?.itemCode || item?.name || item?.id || 'batch');
}

function getProcessColor(process) {
    const raw = String(process || '').trim();
    const key = Object.keys(PROCESS_COLOR_MAP).find(k => raw.includes(k) || k.includes(raw));
    return key ? PROCESS_COLOR_MAP[key] : getHashColor(raw || 'process');
}

function getItemBaseColor(item) {
    if (itemColorMode === 'customer') return getCustomerMarkerColor(item);
    if (itemColorMode === 'process') return getProcessColor(item?.process);
    const materialColor = getFixedColorByMaterial(item?.material);
    return materialColor != null ? materialColor : (item?.color || getHashColor(item?.material || item?.name || 'material'));
}

function shouldShowBatchMarker() {
    return itemColorMode === 'materialCustomer' || itemColorMode === 'material' || itemColorMode === 'process';
}

function applyItemDisplayColor(object3d, item) {
    const color = getItemBaseColor(item);
    if (!object3d || color == null) return;
    object3d.traverse(obj => {
        if (!obj.isMesh || !obj.material) return;
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach(mat => {
            if (mat && mat.color) {
                mat.color.setHex(typeof color === 'number' ? color : new THREE.Color(color).getHex());
                mat.needsUpdate = true;
            }
        });
    });
}

function createBatchMarkerForItem(item, baseY, sourceObject = null) {
    if (!item || !shouldShowBatchMarker()) return null;
    const markerColor = getCustomerMarkerColor(item);
    const w = Math.max(1, Number(item.w || item.dim1 || 1));
    const d = Math.max(1, Number(item.d || item.dim2 || 1));
    const isRound = String(item.shape || '').toLowerCase().includes('cyl') || Math.abs(w - d) < 1;
    const mat = new THREE.MeshBasicMaterial({
        color: markerColor,
        transparent: true,
        opacity: 0.94,
        depthWrite: false,
        depthTest: true
    });
    let marker;
    if (isRound) {
        const radius = Math.max(6, Math.min(w, d) * 0.13);
        marker = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 4, 18), mat);
    } else {
        const size = Math.max(8, Math.min(w, d, 46) * 0.2);
        marker = new THREE.Mesh(new THREE.BoxGeometry(size, 4, size), mat);
    }

    // V0.7.11：不要再用 item.x/y/z 手工猜测标识位置。
    // createItemMesh 内部会根据形状、旋转、坐标系调整 mesh 的真实位置；
    // 直接从 mesh 的包围盒取中心和顶部，才能保证客户/批次色点贴在对应工件上。
    if (sourceObject) {
        const box = new THREE.Box3().setFromObject(sourceObject);
        if (!box.isEmpty()) {
            const center = new THREE.Vector3();
            box.getCenter(center);
            marker.position.set(center.x, box.max.y + 4, center.z);
        }
    } else {
        const h = Math.max(1, Number(item.h || item.dim3 || 1));
        const x = Number(item.x || 0);
        const y = Number(item.y || 0);
        const z = Number(item.z || 0);
        marker.position.set(x, baseY + y + h + 4, z);
    }

    marker.renderOrder = 9;
    marker.userData = {
        isBatchMarker: true,
        batchForItemId: item.id || item.itemId || '',
        itemName: item.name || '',
        customer: item.customer || '',
        markerColor
    };
    return marker;
}

export function setItemColorMode(mode = 'materialCustomer') {
    const allowed = new Set(['materialCustomer', 'material', 'customer', 'process']);
    itemColorMode = allowed.has(mode) ? mode : 'materialCustomer';
}

export function getItemColorMode() {
    return itemColorMode;
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



// ==================== VACUUM QUENCH PROCESS SIMULATION ====================
// 解释型近似仿真：升温热场 + 辐射暴露，不做真实 CFD / FEA / 光线追踪。
// 所有对象都进入独立 thermalSimulationGroup，不污染工装/工件/爆炸图结构。
let thermalSimulationGroup = null;
let thermalSimRuntime = {
    visible: false,
    activeMode: null, // thermal | radiation
    isPlaying: false,
    paused: false,
    progress: 0,
    durationMs: 9000,
    startedAt: 0,
    pointCloud: null,
    heatmapGroup: null,
    selectedThermalHeatmapView: 'middle',
    selectedThermalDisplayMode: 'balanced',
    selectedThermalVerticalAxis: 'z',
    selectedThermalSectionOffset: 0,
    rayGroup: null,
    riskGroup: null,
    sourceGroup: null,
    metrics: null,
    radiationScores: null,
    airflowScores: null,
    atmosphereScores: null,
    atmosphereSurfaceGroup: null,
    atmosphereAnimationStartedAt: 0,
    selectedAirflowDirection: 'z+',
    selectedAirflowDirections: ['z+'],
    selectedAirflowGasType: 'n2',
    airflowCycleMs: 3600,
    selectedAtmosphereMediumType: 'nitriding',
    selectedAtmosphereInletDirections: null,
    selectedQuenchMediumType: 'oil',
    selectedQuenchFurnaceVisibilityMode: 'auto',
    quenchTankGroup: null,
    quenchEquipmentContext: null,
    quenchParticleGroup: null,
    quenchDurationMs: 8500,
    lastQuenchVisualUpdateAt: 0,
    airflowParticles: null,
    airflowStreamGroup: null,
    selectedRadiationItemId: null,
    selectedRadiationEntry: null,
    selectedRadiationBatch: null,
    selectedRadiationSection: null,
    onUpdate: null,
    onFinish: null,
    lastThermalHeavyUpdateAt: 0,
    lastAirflowParticleUpdateAt: 0,
    lastAtmosphereVisualUpdateAt: 0,
    lastAtmosphereUiUpdateAt: 0
};

let radiationSectionDragState = null;

let thermalSceneThemeActive = false;
let thermalSceneThemeMode = null;
let thermalSavedSceneBackground = null;
let thermalSavedGridState = null;

const THERMAL_BASE_Y = -120;
const VACUUM_QUENCH_PROFILE = {
    processName: '真空淬火',
    startTemp: 120,
    targetTemp: 1040,
    quenchTemp: 80
};

function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function getNormalizedProcessSceneTheme(themeKey = thermalSimRuntime.selectedProcessSceneTheme || 'auto') {
    const key = String(themeKey || 'auto').toLowerCase();
    if (['auto', 'dark', 'blue', 'light'].includes(key)) return key;
    if (key === 'gray' || key === 'grey' || key === 'lightgray' || key === 'light-grey') return 'light';
    if (key === 'industrial' || key === 'industrial-blue' || key === 'bluegray' || key === 'blue-grey') return 'blue';
    return 'auto';
}

function getAutoProcessSceneTheme(mode = 'thermal') {
    if (mode === 'airflow' || mode === 'quench') return 'blue';
    if (mode === 'atmosphere') return 'teal';
    return 'dark';
}

function getProcessSceneThemePalette(mode = 'thermal') {
    const selected = getNormalizedProcessSceneTheme();
    const effective = selected === 'auto' ? getAutoProcessSceneTheme(mode) : selected;
    if (effective === 'light') {
        return {
            key: 'light',
            background: 0xf3f6f8,
            gridColor: 0x94a3b8,
            gridOpacity: 0.28,
            labelColor: 0x0f172a,
            quenchPadColor: 0x93c5fd,
            quenchPadOpacity: 0.18
        };
    }
    if (effective === 'blue') {
        return {
            key: 'blue',
            background: 0x0b1f2a,
            gridColor: 0x2f5f75,
            gridOpacity: 0.24,
            labelColor: 0xe0f2fe,
            quenchPadColor: 0x38bdf8,
            quenchPadOpacity: 0.20
        };
    }
    if (effective === 'teal') {
        return {
            key: 'teal',
            background: 0x0f2a2b,
            gridColor: 0x2dd4bf,
            gridOpacity: 0.16,
            labelColor: 0xccfbf1,
            quenchPadColor: 0x22d3ee,
            quenchPadOpacity: 0.18
        };
    }
    return {
        key: 'dark',
        background: mode === 'quench' ? 0x071827 : 0x030712,
        gridColor: 0x334155,
        gridOpacity: mode === 'quench' || mode === 'airflow' ? 0.16 : 0.10,
        labelColor: 0xf8fafc,
        quenchPadColor: 0x38bdf8,
        quenchPadOpacity: 0.16
    };
}

function setThermalGridTheme(active, mode = thermalSceneThemeMode || 'thermal') {
    if (!mainSceneGridHelper || !mainSceneGridHelper.material) return;

    const materials = Array.isArray(mainSceneGridHelper.material)
        ? mainSceneGridHelper.material
        : [mainSceneGridHelper.material];

    if (active) {
        if (!thermalSavedGridState) {
            thermalSavedGridState = materials.map(mat => ({
                transparent: !!mat.transparent,
                opacity: typeof mat.opacity === 'number' ? mat.opacity : 1,
                color: mat.color ? mat.color.getHex() : null,
                visible: mainSceneGridHelper.visible
            }));
        }
        const palette = getProcessSceneThemePalette(mode);
        mainSceneGridHelper.visible = true;
        materials.forEach(mat => {
            mat.transparent = true;
            mat.opacity = palette.gridOpacity;
            if (mat.color) mat.color.setHex(palette.gridColor);
            mat.needsUpdate = true;
        });
        return;
    }

    if (!active && thermalSavedGridState) {
        materials.forEach((mat, idx) => {
            const saved = thermalSavedGridState[idx];
            if (!saved) return;
            mat.transparent = saved.transparent;
            mat.opacity = saved.opacity;
            if (mat.color && saved.color != null) mat.color.setHex(saved.color);
            mat.needsUpdate = true;
        });
        mainSceneGridHelper.visible = thermalSavedGridState[0]?.visible ?? displaySettings.showGrid;
        thermalSavedGridState = null;
    }
}

function getProcessSceneBackgroundColor(mode = 'thermal') {
    return getProcessSceneThemePalette(mode).background;
}

function setThermalSceneTheme(active, mode = 'thermal') {
    if (!scene) return;
    if (active) {
        if (!thermalSceneThemeActive) {
            thermalSavedSceneBackground = scene.background ? scene.background.clone() : null;
            thermalSceneThemeActive = true;
        }
        setThermalGridTheme(true, mode);
        // 模式或背景主题切换时允许更新背景色。
        scene.background = new THREE.Color(getProcessSceneBackgroundColor(mode));
        thermalSceneThemeMode = mode;
    } else if (thermalSceneThemeActive) {
        scene.background = thermalSavedSceneBackground || new THREE.Color(0xf5f5f5);
        thermalSavedSceneBackground = null;
        setThermalGridTheme(false, mode);
        thermalSceneThemeActive = false;
        thermalSceneThemeMode = null;
    }
}

export function setProcessSceneBackgroundTheme(themeKey = 'auto') {
    thermalSimRuntime.selectedProcessSceneTheme = getNormalizedProcessSceneTheme(themeKey);
    if (thermalSceneThemeActive && thermalSimRuntime.activeMode) {
        setThermalSceneTheme(true, thermalSimRuntime.activeMode);
    }
    if (thermalSimRuntime.activeMode === 'quench' && thermalSimRuntime.quenchTankGroup) {
        updateQuenchWorkstationGlow();
    }
    return thermalSimRuntime.metrics || null;
}

export function getProcessSceneBackgroundTheme() {
    return getNormalizedProcessSceneTheme();
}

function ensureThermalSimulationGroup() {
    if (!thermalSimulationGroup) {
        thermalSimulationGroup = new THREE.Group();
        thermalSimulationGroup.name = 'thermalSimulationGroup';
        thermalSimulationGroup.visible = true;
    }
    if (scene && thermalSimulationGroup.parent !== scene) {
        scene.add(thermalSimulationGroup);
    }
    return thermalSimulationGroup;
}

function disposeObject3D(obj) {
    if (!obj) return;
    obj.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(mat => {
                    if (mat && mat.map && typeof mat.map.dispose === 'function') mat.map.dispose();
                    if (mat && typeof mat.dispose === 'function') mat.dispose();
                });
            } else if (child.material.dispose) {
                if (child.material.map && typeof child.material.map.dispose === 'function') child.material.map.dispose();
                child.material.dispose();
            }
        }
    });
}

function clearThermalGroupChildren() {
    const group = ensureThermalSimulationGroup();
    while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);
        disposeObject3D(child);
    }
    thermalSimRuntime.pointCloud = null;
    thermalSimRuntime.heatmapGroup = null;
    thermalSimRuntime.rayGroup = null;
    thermalSimRuntime.riskGroup = null;
    thermalSimRuntime.sourceGroup = null;
    thermalSimRuntime.atmosphereSurfaceGroup = null;
    thermalSimRuntime.quenchTankGroup = null;
    thermalSimRuntime.quenchParticleGroup = null;
}


export function clearThermalSimulationLayer() {
    clearThermalGroupChildren();
    clearRadiationClipPlanes();
    restoreQuenchFurnaceTransform();
    restoreThermalItemMaterials();
    setThermalSceneTheme(false);

    thermalSimRuntime.visible = false;
    thermalSimRuntime.activeMode = null;
    thermalSimRuntime.isPlaying = false;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.progress = 0;
    thermalSimRuntime.metrics = null;
    thermalSimRuntime.radiationScores = null;
    thermalSimRuntime.airflowScores = null;
    thermalSimRuntime.atmosphereScores = null;
    thermalSimRuntime.atmosphereSurfaceGroup = null;
    thermalSimRuntime.atmosphereAnimationStartedAt = 0;
    thermalSimRuntime.selectedAirflowDirection = 'z+';
    thermalSimRuntime.selectedThermalHeatmapView = 'middle';
    thermalSimRuntime.selectedThermalDisplayMode = 'balanced';
    thermalSimRuntime.selectedThermalVerticalAxis = 'z';
    thermalSimRuntime.selectedThermalSectionOffset = 0;
    thermalSimRuntime.selectedAirflowDirections = ['z+'];
    thermalSimRuntime.selectedAirflowGasType = 'n2';
    thermalSimRuntime.airflowCycleMs = 3600;
    thermalSimRuntime.selectedAtmosphereMediumType = 'nitriding';
    thermalSimRuntime.selectedAtmosphereInletDirections = null;
    thermalSimRuntime.selectedQuenchMediumType = 'oil';
    thermalSimRuntime.selectedQuenchFurnaceVisibilityMode = 'auto';
    thermalSimRuntime.quenchTankGroup = null;
    thermalSimRuntime.quenchEquipmentContext = null;
    thermalSimRuntime.quenchParticleGroup = null;
    thermalSimRuntime.quenchDurationMs = 8500;
    thermalSimRuntime.lastQuenchVisualUpdateAt = 0;
    thermalSimRuntime.airflowParticles = null;
    thermalSimRuntime.airflowStreamGroup = null;
    thermalSimRuntime.selectedRadiationItemId = null;
    thermalSimRuntime.selectedRadiationEntry = null;
    thermalSimRuntime.selectedRadiationBatch = null;
    thermalSimRuntime.selectedRadiationSection = null;
    thermalSimRuntime.onUpdate = null;
    thermalSimRuntime.onFinish = null;
    thermalSimRuntime.lastThermalHeavyUpdateAt = 0;
    thermalSimRuntime.lastAirflowParticleUpdateAt = 0;
    thermalSimRuntime.lastAtmosphereVisualUpdateAt = 0;
    thermalSimRuntime.lastAtmosphereUiUpdateAt = 0;
}

function getMeshMaterials(mesh) {
    if (!mesh || !mesh.material) return [];
    return Array.isArray(mesh.material) ? mesh.material.filter(Boolean) : [mesh.material];
}

function clearRadiationClipPlanes() {
    if (!furnaceGroups || typeof furnaceGroups.forEach !== 'function') return;
    furnaceGroups.forEach(group => {
        if (!group) return;
        group.traverse(child => {
            if (!child.isMesh || !child.material) return;
            getMeshMaterials(child).forEach(mat => {
                if (!mat) return;
                const saved = mat.userData && mat.userData._radiationClipOriginal;
                if (saved) {
                    mat.clippingPlanes = saved.clippingPlanes || null;
                    mat.clipIntersection = !!saved.clipIntersection;
                    mat.clipShadows = !!saved.clipShadows;
                    delete mat.userData._radiationClipOriginal;
                } else if (mat.userData && mat.userData._radiationClipApplied) {
                    mat.clippingPlanes = null;
                    mat.clipIntersection = false;
                    mat.clipShadows = false;
                }
                if (mat.userData) delete mat.userData._radiationClipApplied;
                mat.needsUpdate = true;
            });
        });
    });
}

function createClipPlaneFromSectionInfo(sectionInfo) {
    if (!sectionInfo || !sectionInfo.normal) return null;
    const normal = new THREE.Vector3(sectionInfo.normal.x, sectionInfo.normal.y, sectionInfo.normal.z);
    if (normal.lengthSq() < 1e-6) return null;
    normal.normalize();
    const origin = new THREE.Vector3(
        sectionInfo.origin?.x || 0,
        sectionInfo.origin?.y || 0,
        sectionInfo.origin?.z || 0
    );
    return new THREE.Plane(normal, -normal.dot(origin));
}

function applyRadiationClipPlaneToCurrentFurnace(sectionInfo) {
    const clipPlane = createClipPlaneFromSectionInfo(sectionInfo);
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!clipPlane || !group) return;

    if (renderer) renderer.localClippingEnabled = true;

    group.traverse(child => {
        if (!child.isMesh || !child.material) return;
        getMeshMaterials(child).forEach(mat => {
            if (!mat) return;
            if (!mat.userData) mat.userData = {};
            if (!mat.userData._radiationClipOriginal) {
                mat.userData._radiationClipOriginal = {
                    clippingPlanes: mat.clippingPlanes ? mat.clippingPlanes.slice() : null,
                    clipIntersection: !!mat.clipIntersection,
                    clipShadows: !!mat.clipShadows
                };
            }
            mat.clippingPlanes = [clipPlane];
            mat.clipIntersection = false;
            mat.clipShadows = true;
            mat.userData._radiationClipApplied = true;
            mat.needsUpdate = true;
        });
    });
}

function getSectionDirectionNormal(directionKey) {
    const meta = getRadiationSectionAxisMeta(directionKey);
    if (meta.axis === 'x') return new THREE.Vector3(meta.sign, 0, 0);
    if (meta.axis === 'y') return new THREE.Vector3(0, meta.sign, 0);
    return new THREE.Vector3(0, 0, meta.sign);
}

function projectWorldToScreen(point, rect) {
    const p = point.clone().project(camera);
    return {
        x: rect.left + (p.x + 1) * 0.5 * rect.width,
        y: rect.top + (-p.y + 1) * 0.5 * rect.height
    };
}

function restoreThermalItemMaterials() {
    clearRadiationClipPlanes();
    if (!furnaceGroups || typeof furnaceGroups.forEach !== 'function') return;
    furnaceGroups.forEach(group => {
        if (!group) return;
        group.traverse(child => {
            if (!child.isMesh || !child.userData || !child.userData.itemId) return;
            getMeshMaterials(child).forEach(mat => {
                const saved = mat.userData && mat.userData._thermalOriginal;
                if (!saved) return;
                if (mat.color && saved.color != null) mat.color.setHex(saved.color);
                if (mat.emissive && saved.emissive != null) mat.emissive.setHex(saved.emissive);
                if (typeof saved.emissiveIntensity === 'number') mat.emissiveIntensity = saved.emissiveIntensity;
                mat.transparent = saved.transparent;
                mat.opacity = saved.opacity;
                mat.needsUpdate = true;
                delete mat.userData._thermalOriginal;
            });
        });
    });
}

function saveOriginalMaterialIfNeeded(mat) {
    if (!mat || !mat.userData) return;
    if (mat.userData._thermalOriginal) return;
    mat.userData._thermalOriginal = {
        color: mat.color ? mat.color.getHex() : null,
        emissive: mat.emissive ? mat.emissive.getHex() : null,
        emissiveIntensity: typeof mat.emissiveIntensity === 'number' ? mat.emissiveIntensity : 0,
        transparent: !!mat.transparent,
        opacity: typeof mat.opacity === 'number' ? mat.opacity : 1
    };
}

function getCurrentThermalFurnace() {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return null;
    const idx = Math.max(0, Math.min(currentFurnaceIndex || 0, globalFurnacesResult.length - 1));
    return globalFurnacesResult[idx] || null;
}

function getItemWorldBox(item, furnace) {
    const fw = furnace.w || 0;
    const fd = furnace.d || 0;
    return {
        minX: (item.x || 0) - fw / 2,
        maxX: (item.x || 0) - fw / 2 + (item.w || 0),
        minY: THERMAL_BASE_Y + (item.y || 0),
        maxY: THERMAL_BASE_Y + (item.y || 0) + (item.h || 0),
        minZ: (item.z || 0) - fd / 2,
        maxZ: (item.z || 0) - fd / 2 + (item.d || 0)
    };
}

function getItemCenterWorld(item, furnace) {
    const b = getItemWorldBox(item, furnace);
    return new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
}

function estimateShadowAndCoreLag(x, y, z, furnace) {
    const items = furnace.packedItems || [];
    if (!items.length) return { shadow: 0, nearMaterial: 0, coreLag: 0 };

    let shadow = 0;
    let nearMaterial = 0;

    items.forEach(item => {
        const box = getItemWorldBox(item, furnace);
        const cx = (box.minX + box.maxX) / 2;
        const cy = (box.minY + box.maxY) / 2;
        const cz = (box.minZ + box.maxZ) / 2;
        const sx = Math.max((item.w || 1), 1);
        const sy = Math.max((item.h || 1), 1);
        const sz = Math.max((item.d || 1), 1);

        const dx = Math.abs(x - cx) / (sx * 0.75 + 80);
        const dy = Math.abs(y - cy) / (sy * 0.75 + 80);
        const dz = Math.abs(z - cz) / (sz * 0.75 + 80);
        const influence = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy + dz * dz));

        if (influence > 0) {
            nearMaterial = Math.max(nearMaterial, influence);
            const massFactor = Math.min(1, Math.cbrt(Math.max((item.w || 1) * (item.h || 1) * (item.d || 1), 1)) / 420);
            shadow += influence * (0.22 + massFactor * 0.28);
        }
    });

    const packedVolume = items.reduce((sum, item) => sum + (item.w || 0) * (item.h || 0) * (item.d || 0), 0);
    const furnaceVolume = Math.max(1, (furnace.w || 1) * (furnace.h || 1) * (furnace.d || 1));
    const densityPenalty = Math.min(0.22, packedVolume / furnaceVolume * 1.25);

    return {
        shadow: clamp01(shadow + densityPenalty),
        nearMaterial: clamp01(nearMaterial),
        coreLag: clamp01(nearMaterial * 0.85 + densityPenalty)
    };
}

function temperatureRatioFromMeta(meta, progress) {
    const p = clamp01(progress);
    const soakCompensation = Math.max(0, (p - 0.72) / 0.28) * (meta.coreLag * 0.24 + meta.shadow * 0.18);
    const radiationGain = meta.wallFactor * (0.24 + p * 0.14) + meta.heightFactor * 0.05;
    const lag = meta.shadow * (0.30 - p * 0.18) + meta.coreLag * (0.18 - p * 0.10);
    return clamp01(p * 0.98 + radiationGain - lag + soakCompensation);
}

function colorFromTemperatureRatio(ratio) {
    const cold = new THREE.Color(0x2563eb);
    const cyan = new THREE.Color(0x22d3ee);
    const yellow = new THREE.Color(0xfacc15);
    const orange = new THREE.Color(0xf97316);
    const red = new THREE.Color(0xdc2626);
    const whiteHot = new THREE.Color(0xfff7ed);
    const c = new THREE.Color();
    if (ratio < 0.25) c.lerpColors(cold, cyan, ratio / 0.25);
    else if (ratio < 0.55) c.lerpColors(cyan, yellow, (ratio - 0.25) / 0.30);
    else if (ratio < 0.78) c.lerpColors(yellow, orange, (ratio - 0.55) / 0.23);
    else if (ratio < 0.94) c.lerpColors(orange, red, (ratio - 0.78) / 0.16);
    else c.lerpColors(red, whiteHot, (ratio - 0.94) / 0.06);
    return c;
}

function getRadiationScoreColor(score) {
    const low = new THREE.Color(0x475569);
    const bad = new THREE.Color(0xb91c1c);
    const mid = new THREE.Color(0xf97316);
    const good = new THREE.Color(0xfacc15);
    const c = new THREE.Color();
    const s = clamp01(score);
    if (s < 0.34) c.lerpColors(low, bad, s / 0.34);
    else if (s < 0.72) c.lerpColors(bad, mid, (s - 0.34) / 0.38);
    else c.lerpColors(mid, good, (s - 0.72) / 0.28);
    return c;
}

function getRingThermalRadii(furnace) {
    const params = furnace.params || {};
    const fw = Number(furnace.w || 0);
    const fd = Number(furnace.d || 0);
    const outerRadius = Number(params.outerRadius) || Number(params.radialRadius) || Math.min(fw, fd) / 2;
    const innerRadius = Number(params.centerVoidRadius) || Number(params.innerRadius) || (params.innerDia ? Number(params.innerDia) / 2 : 0);
    return { outerRadius: Math.max(outerRadius, 1), innerRadius: Math.max(innerRadius, 0) };
}

function isPointInsideThermalVolume(furnace, x, y, z) {
    const fw = Number(furnace.w || 0);
    const fh = Number(furnace.h || 0);
    const fd = Number(furnace.d || 0);
    const localY = y - THERMAL_BASE_Y;
    if (localY < 0 || localY > fh) return false;
    if (furnace.toolingType !== 'ring-tooling') {
        return x >= -fw / 2 && x <= fw / 2 && z >= -fd / 2 && z <= fd / 2;
    }
    const { outerRadius, innerRadius } = getRingThermalRadii(furnace);
    const r = Math.sqrt(x * x + z * z);
    return r <= outerRadius && r >= innerRadius;
}

function getThermalShapeFactors(furnace, x, y, z, xNorm, yNorm, zNorm) {
    if (furnace.toolingType !== 'ring-tooling') {
        const distWall = Math.min(xNorm, 1 - xNorm, yNorm, 1 - yNorm, zNorm, 1 - zNorm);
        return {
            wallFactor: clamp01(1 - distWall * 2.15),
            centerFactor: clamp01(1 - Math.sqrt((xNorm - 0.5) ** 2 + (zNorm - 0.5) ** 2) * 2)
        };
    }
    const { outerRadius, innerRadius } = getRingThermalRadii(furnace);
    const r = Math.sqrt(x * x + z * z);
    const ringWidth = Math.max(outerRadius - innerRadius, 1);
    const edgeDistance = Math.min(outerRadius - r, r - innerRadius);
    const radialMid = innerRadius + ringWidth / 2;
    return {
        wallFactor: clamp01(1 - edgeDistance / (ringWidth * 0.45)),
        centerFactor: clamp01(1 - Math.abs(r - radialMid) / (ringWidth * 0.5))
    };
}

function createThermalParticleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

function buildThermalPointCloud(furnace, progress) {
    const fw = furnace.w || 600;
    const fh = furnace.h || 600;
    const fd = furnace.d || 600;
    const isRing = furnace.toolingType === 'ring-tooling';
    const nx = isRing ? Math.max(9, Math.min(13, Math.round(fw / 85))) : Math.max(7, Math.min(11, Math.round(fw / 90)));
    const ny = isRing ? Math.max(5, Math.min(7, Math.round(fh / 130))) : Math.max(5, Math.min(8, Math.round(fh / 120)));
    const nz = isRing ? Math.max(9, Math.min(13, Math.round(fd / 85))) : Math.max(7, Math.min(11, Math.round(fd / 90)));
    const positions = [];
    const colors = [];
    const meta = [];
    const jitter = Math.min(fw, fd) * 0.015;

    for (let ix = 0; ix < nx; ix++) {
        const xNorm = nx === 1 ? 0.5 : ix / (nx - 1);
        const x = -fw / 2 + xNorm * fw;
        for (let iy = 0; iy < ny; iy++) {
            const yNorm = ny === 1 ? 0.5 : iy / (ny - 1);
            const y = THERMAL_BASE_Y + yNorm * fh;
            for (let iz = 0; iz < nz; iz++) {
                const zNorm = nz === 1 ? 0.5 : iz / (nz - 1);
                const z = -fd / 2 + zNorm * fd;
                if (!isPointInsideThermalVolume(furnace, x, y, z)) continue;
                const shapeFactors = getThermalShapeFactors(furnace, x, y, z, xNorm, yNorm, zNorm);
                const shadowInfo = estimateShadowAndCoreLag(x, y, z, furnace);
                const pointMeta = {
                    wallFactor: shapeFactors.wallFactor,
                    heightFactor: yNorm,
                    centerFactor: shapeFactors.centerFactor,
                    shadow: shadowInfo.shadow,
                    coreLag: shadowInfo.coreLag,
                    nearMaterial: shadowInfo.nearMaterial
                };
                const ratio = temperatureRatioFromMeta(pointMeta, progress);
                const color = colorFromTemperatureRatio(ratio);
                positions.push(
                    x + (Math.random() - 0.5) * jitter,
                    y + (Math.random() - 0.5) * jitter,
                    z + (Math.random() - 0.5) * jitter
                );
                colors.push(color.r, color.g, color.b);
                meta.push(pointMeta);
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.userData.thermalMeta = meta;
    const pointSize = Math.max(28, Math.min(62, Math.min(fw, fd) / 14));
    const material = new THREE.PointsMaterial({
        size: pointSize,
        map: createThermalParticleTexture(),
        transparent: true,
        opacity: 0.92,
        vertexColors: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending
    });
    const cloud = new THREE.Points(geometry, material);
    cloud.name = 'vacuumQuenchThermalPointCloud';
    cloud.renderOrder = 20;
    cloud.userData = { isThermalPointCloud: true, basePointSize: pointSize };
    return cloud;
}

const THERMAL_HEATMAP_VIEW_META = {
    floor: { key: 'floor', label: '底面热力图', shortLabel: '底面', description: '查看炉底/工装底部边界面的温度分布，适合检查底板、支撑与下层搁板造成的冷区。' },
    bottom: { key: 'bottom', label: '底层热力图', shortLabel: '底层', description: '查看靠近底层/搁板区域的升温滞后与冷点。' },
    middle: { key: 'middle', label: '中层热力图', shortLabel: '中层', description: '查看装载中心区的热场均匀性。' },
    top: { key: 'top', label: '上层热力图', shortLabel: '上层', description: '查看靠近顶部热源区域的温度分布。' },
    vertical: { key: 'vertical', label: '可移动纵向剖面', shortLabel: '纵剖面', description: '可在 X/Z 两个方向之间切换，并沿法线移动剖面，查看不同截面上的上下温差与中心热滞后。' },
    all: { key: 'all', label: '三层热力图', shortLabel: '三层', description: '同时显示底层、中层、上层热力切片，用于快速判断层间温差。' }
};

function normalizeThermalHeatmapView(viewKey = 'middle') {
    const key = String(viewKey || 'middle').toLowerCase();
    return THERMAL_HEATMAP_VIEW_META[key] ? key : 'middle';
}

function getThermalHeatmapViewMeta(viewKey = 'middle') {
    return THERMAL_HEATMAP_VIEW_META[normalizeThermalHeatmapView(viewKey)] || THERMAL_HEATMAP_VIEW_META.middle;
}

const THERMAL_HEATMAP_DISPLAY_MODES = {
    balanced: { key: 'balanced', label: '标准诊断', sliceOpacity: 0.78, itemOpacityScale: 1.0, coldBoost: 1.0, description: '热力剖面、工件结构和冷点标记均衡显示。' },
    workpiece: { key: 'workpiece', label: '工件优先', sliceOpacity: 0.42, itemOpacityScale: 1.42, coldBoost: 0.9, description: '降低热力图透明度，优先看工件和摆放关系。' },
    coldspot: { key: 'coldspot', label: '冷点优先', sliceOpacity: 0.66, itemOpacityScale: 0.72, coldBoost: 1.45, description: '高温区弱化，低温/滞后区域和冷点标记更突出。' }
};

function normalizeThermalDisplayMode(mode = 'balanced') {
    const key = String(mode || 'balanced').toLowerCase();
    return THERMAL_HEATMAP_DISPLAY_MODES[key] ? key : 'balanced';
}

function getThermalDisplayModeMeta(mode = thermalSimRuntime.selectedThermalDisplayMode || 'balanced') {
    return THERMAL_HEATMAP_DISPLAY_MODES[normalizeThermalDisplayMode(mode)] || THERMAL_HEATMAP_DISPLAY_MODES.balanced;
}

function normalizeThermalVerticalAxis(axis = 'z') {
    return String(axis || 'z').toLowerCase() === 'x' ? 'x' : 'z';
}

function getThermalVerticalAxisLabel(axis = thermalSimRuntime.selectedThermalVerticalAxis || 'z') {
    return normalizeThermalVerticalAxis(axis) === 'x' ? 'X向剖面 · YZ面' : 'Z向剖面 · XY面';
}

function getThermalSectionRange(furnace, axis = thermalSimRuntime.selectedThermalVerticalAxis || 'z') {
    const fw = Number(furnace?.w || 600);
    const fd = Number(furnace?.d || 600);
    const a = normalizeThermalVerticalAxis(axis);
    const half = a === 'x' ? fw / 2 : fd / 2;
    return {
        axis: a,
        min: Math.round(-half),
        max: Math.round(half),
        span: Math.round(half * 2)
    };
}

function clampThermalSectionOffset(furnace, offset = 0, axis = thermalSimRuntime.selectedThermalVerticalAxis || 'z') {
    const range = getThermalSectionRange(furnace, axis);
    return Math.max(range.min, Math.min(range.max, Number(offset) || 0));
}

function getHeatmapSliceSpecs(viewKey = 'middle') {
    const key = normalizeThermalHeatmapView(viewKey);
    const verticalAxis = normalizeThermalVerticalAxis(thermalSimRuntime.selectedThermalVerticalAxis || 'z');
    const verticalOffset = Number(thermalSimRuntime.selectedThermalSectionOffset || 0);
    const horizontal = [
        { key: 'bottom', label: '底层', type: 'horizontal', ratio: 0.22, opacity: 0.78 },
        { key: 'middle', label: '中层', type: 'horizontal', ratio: 0.52, opacity: 0.84 },
        { key: 'top', label: '上层', type: 'horizontal', ratio: 0.82, opacity: 0.74 }
    ];
    if (key === 'all') return horizontal;
    if (key === 'floor') return [{ key: 'floor', label: '底面', type: 'floor', ratio: 0.018, opacity: 0.86 }];
    if (key === 'vertical') {
        return [{
            key: 'vertical',
            label: verticalAxis === 'x' ? 'X向纵剖面' : 'Z向纵剖面',
            type: 'vertical',
            axis: verticalAxis,
            offset: verticalOffset,
            ratio: 0.5,
            opacity: 0.88
        }];
    }
    return horizontal.filter(s => s.key === key);
}

function sampleThermalRatioAtPoint(furnace, x, y, z, progress) {
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    if (!isPointInsideThermalVolume(furnace, x, y, z)) return null;
    const xNorm = clamp01((x + fw / 2) / Math.max(1, fw));
    const yNorm = clamp01((y - THERMAL_BASE_Y) / Math.max(1, fh));
    const zNorm = clamp01((z + fd / 2) / Math.max(1, fd));
    const shapeFactors = getThermalShapeFactors(furnace, x, y, z, xNorm, yNorm, zNorm);
    const shadowInfo = estimateShadowAndCoreLag(x, y, z, furnace);
    const meta = {
        wallFactor: shapeFactors.wallFactor,
        heightFactor: yNorm,
        centerFactor: shapeFactors.centerFactor,
        shadow: shadowInfo.shadow,
        coreLag: shadowInfo.coreLag,
        nearMaterial: shadowInfo.nearMaterial
    };
    return temperatureRatioFromMeta(meta, progress);
}

function colorFromThermalHeatmapRatio(ratio, displayMode = thermalSimRuntime.selectedThermalDisplayMode || 'balanced') {
    const mode = normalizeThermalDisplayMode(displayMode);
    const s = clamp01(ratio);
    const deepCold = new THREE.Color(0x1d4ed8);
    const cold = new THREE.Color(0x22d3ee);
    const mid = new THREE.Color(0xfacc15);
    const hot = new THREE.Color(0xf97316);
    const veryHot = new THREE.Color(0xef4444);
    const whiteHot = new THREE.Color(0xfff7ed);
    const c = new THREE.Color();
    if (mode === 'coldspot') {
        if (s < 0.42) c.lerpColors(deepCold, cold, s / 0.42);
        else if (s < 0.66) c.lerpColors(cold, mid, (s - 0.42) / 0.24);
        else if (s < 0.86) c.lerpColors(mid, hot, (s - 0.66) / 0.20);
        else c.lerpColors(hot, veryHot, (s - 0.86) / 0.14);
        return c;
    }
    if (s < 0.30) c.lerpColors(deepCold, cold, s / 0.30);
    else if (s < 0.58) c.lerpColors(cold, mid, (s - 0.30) / 0.28);
    else if (s < 0.80) c.lerpColors(mid, hot, (s - 0.58) / 0.22);
    else if (s < 0.94) c.lerpColors(hot, veryHot, (s - 0.80) / 0.14);
    else c.lerpColors(veryHot, whiteHot, (s - 0.94) / 0.06);
    return c;
}

function heatmapAlphaFromRatio(ratio, spec, displayMode = thermalSimRuntime.selectedThermalDisplayMode || 'balanced') {
    const mode = normalizeThermalDisplayMode(displayMode);
    const s = clamp01(ratio);
    if (mode === 'workpiece') return spec.type === 'vertical' ? 132 + Math.round(s * 30) : 120 + Math.round(s * 28);
    if (mode === 'coldspot') {
        const coldAlpha = Math.round((1 - s) * 84);
        return spec.type === 'vertical' ? 155 + coldAlpha : 145 + coldAlpha;
    }
    return spec.type === 'vertical' ? 168 + Math.round(s * 32) : 154 + Math.round(s * 36);
}

function createThermalHeatmapTexture(furnace, spec, progress) {
    const canvas = document.createElement('canvas');
    const size = 112;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    const data = image.data;
    const ratioGrid = new Array(size * size).fill(null);
    const displayMode = normalizeThermalDisplayMode(thermalSimRuntime.selectedThermalDisplayMode || 'balanced');
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    const fixedY = spec.type === 'floor'
        ? THERMAL_BASE_Y + Math.max(4, fh * (spec.ratio || 0.018))
        : THERMAL_BASE_Y + fh * (spec.ratio || 0.5);
    const fixedZ = clampThermalSectionOffset(furnace, spec.offset ?? 0, 'z');
    const fixedX = clampThermalSectionOffset(furnace, spec.offset ?? 0, 'x');
    const verticalAxis = normalizeThermalVerticalAxis(spec.axis || thermalSimRuntime.selectedThermalVerticalAxis || 'z');

    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            const u = size <= 1 ? 0.5 : px / (size - 1);
            const v = size <= 1 ? 0.5 : py / (size - 1);
            let x = -fw / 2 + u * fw;
            let y = fixedY;
            let z = -fd / 2 + v * fd;

            if (spec.type === 'vertical') {
                y = THERMAL_BASE_Y + (1 - v) * fh;
                if (verticalAxis === 'x') {
                    x = fixedX;
                    z = -fd / 2 + u * fd;
                } else {
                    x = -fw / 2 + u * fw;
                    z = fixedZ;
                }
            }

            const ratio = sampleThermalRatioAtPoint(furnace, x, y, z, progress);
            const offset = (py * size + px) * 4;
            if (ratio == null) {
                data[offset + 0] = 0;
                data[offset + 1] = 0;
                data[offset + 2] = 0;
                data[offset + 3] = 0;
                continue;
            }
            ratioGrid[py * size + px] = ratio;
            const color = colorFromThermalHeatmapRatio(ratio, displayMode);
            const alpha = heatmapAlphaFromRatio(ratio, spec, displayMode);
            data[offset + 0] = Math.round(color.r * 255);
            data[offset + 1] = Math.round(color.g * 255);
            data[offset + 2] = Math.round(color.b * 255);
            data[offset + 3] = alpha;
        }
    }

    ctx.putImageData(image, 0, 0);

    // V1.3：叠加简化等温线。不是严格 CFD/FEA 等温线，但可以显著提升工程图感和低温边界可读性。
    const contourLevels = displayMode === 'coldspot' ? [0.46, 0.58, 0.72] : [0.50, 0.66, 0.82];
    contourLevels.forEach((level, idx) => {
        ctx.beginPath();
        ctx.lineWidth = idx === 0 ? 1.8 : 1.15;
        ctx.strokeStyle = idx === 0
            ? 'rgba(125, 211, 252, 0.78)'
            : (idx === 1 ? 'rgba(250, 204, 21, 0.46)' : 'rgba(248, 113, 113, 0.42)');
        for (let y = 1; y < size - 1; y += 2) {
            for (let x = 1; x < size - 1; x += 2) {
                const here = ratioGrid[y * size + x];
                const right = ratioGrid[y * size + x + 1];
                const down = ratioGrid[(y + 1) * size + x];
                if (here == null) continue;
                if ((right != null && (here - level) * (right - level) < 0) ||
                    (down != null && (here - level) * (down - level) < 0)) {
                    ctx.moveTo(x - 1, y);
                    ctx.lineTo(x + 1, y);
                }
            }
        }
        ctx.stroke();
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function buildThermalHeatmapFrame(width, height, position, rotation, color = 0xffffff, opacity = 0.36) {
    const edges = new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, height));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const lines = new THREE.LineSegments(edges, mat);
    lines.position.copy(position);
    lines.rotation.copy(rotation);
    lines.renderOrder = 32;
    lines.userData = { isThermalHeatmapFrame: true };
    return lines;
}


function buildThermalHeatmapLabel(text, subText, position) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 144;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    roundRect(ctx, 12, 16, 488, 104, 24);
    ctx.fill();
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.72)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#fff7ed';
    ctx.font = '700 34px sans-serif';
    ctx.fillText(text, 34, 58);
    ctx.fillStyle = 'rgba(255, 237, 213, 0.84)';
    ctx.font = '500 24px sans-serif';
    ctx.fillText(subText || '', 34, 94);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.92, depthWrite: false, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(210, 60, 1);
    sprite.renderOrder = 60;
    sprite.userData = { isThermalHeatmapLabel: true };
    return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function buildThermalColdSpotMarker(furnace, progress, viewKey = thermalSimRuntime.selectedThermalHeatmapView || 'middle') {
    const info = findThermalColdSpotInfo(furnace, progress, viewKey);
    if (!info || info.x == null || info.minRatio == null || info.minRatio > 0.86) return null;
    const group = new THREE.Group();
    group.name = 'thermalColdSpotMarker';
    const pos = new THREE.Vector3(info.x, info.y, info.z);
    const size = Math.max(46, Math.min(96, Math.max(furnace.w || 600, furnace.h || 600, furnace.d || 600) * 0.078));
    const normalizedView = normalizeThermalHeatmapView(viewKey);
    const axis = normalizeThermalVerticalAxis(thermalSimRuntime.selectedThermalVerticalAxis || 'z');

    const cyan = 0x38bdf8;
    const amber = 0xf97316;
    const coldScore = 1 - clamp01(info.minRatio || 0);
    const markerColor = coldScore > 0.48 ? cyan : amber;
    const mat = new THREE.LineBasicMaterial({ color: markerColor, transparent: true, opacity: 0.96, depthWrite: false, depthTest: false });

    function addLine(points, material = mat) {
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geo, material);
        line.renderOrder = 62;
        group.add(line);
        return line;
    }

    // 工程化“冷点框 + 十字准星”，替代原来的大圆环，减少游戏感。
    if (normalizedView === 'vertical') {
        if (axis === 'x') {
            addLine([pos.clone().add(new THREE.Vector3(0, -size, -size)), pos.clone().add(new THREE.Vector3(0, size, -size)), pos.clone().add(new THREE.Vector3(0, size, size)), pos.clone().add(new THREE.Vector3(0, -size, size)), pos.clone().add(new THREE.Vector3(0, -size, -size))]);
            addLine([pos.clone().add(new THREE.Vector3(0, -size * 1.22, 0)), pos.clone().add(new THREE.Vector3(0, size * 1.22, 0))]);
            addLine([pos.clone().add(new THREE.Vector3(0, 0, -size * 1.22)), pos.clone().add(new THREE.Vector3(0, 0, size * 1.22))]);
        } else {
            addLine([pos.clone().add(new THREE.Vector3(-size, -size, 0)), pos.clone().add(new THREE.Vector3(size, -size, 0)), pos.clone().add(new THREE.Vector3(size, size, 0)), pos.clone().add(new THREE.Vector3(-size, size, 0)), pos.clone().add(new THREE.Vector3(-size, -size, 0))]);
            addLine([pos.clone().add(new THREE.Vector3(-size * 1.22, 0, 0)), pos.clone().add(new THREE.Vector3(size * 1.22, 0, 0))]);
            addLine([pos.clone().add(new THREE.Vector3(0, -size * 1.22, 0)), pos.clone().add(new THREE.Vector3(0, size * 1.22, 0))]);
        }
    } else {
        addLine([pos.clone().add(new THREE.Vector3(-size, 0, -size)), pos.clone().add(new THREE.Vector3(size, 0, -size)), pos.clone().add(new THREE.Vector3(size, 0, size)), pos.clone().add(new THREE.Vector3(-size, 0, size)), pos.clone().add(new THREE.Vector3(-size, 0, -size))]);
        addLine([pos.clone().add(new THREE.Vector3(-size * 1.22, 0, 0)), pos.clone().add(new THREE.Vector3(size * 1.22, 0, 0))]);
        addLine([pos.clone().add(new THREE.Vector3(0, 0, -size * 1.22)), pos.clone().add(new THREE.Vector3(0, 0, size * 1.22))]);
    }

    const glowGeo = new THREE.SphereGeometry(size * 0.18, 18, 12);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.82, depthWrite: false, depthTest: false });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.copy(pos);
    glow.renderOrder = 63;
    group.add(glow);

    const label = buildThermalHeatmapLabel('冷点风险区', `${info.label} · ${Math.round(info.minRatio * 100)}%`, pos.clone().add(new THREE.Vector3(size * 1.25, size * 1.32, 0)));
    group.add(label);
    group.userData = { isThermalColdSpotMarker: true, info };
    return group;
}

function findThermalColdSpotInfo(furnace, progress = 0.18, viewKey = thermalSimRuntime.selectedThermalHeatmapView || 'middle') {
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    const key = normalizeThermalHeatmapView(viewKey);
    const samples = [];

    function pushSample(x, y, z) {
        const ratio = sampleThermalRatioAtPoint(furnace, x, y, z, progress);
        if (ratio != null) samples.push({ x, y, z, ratio });
    }

    if (key === 'vertical') {
        const axis = normalizeThermalVerticalAxis(thermalSimRuntime.selectedThermalVerticalAxis || 'z');
        const offset = clampThermalSectionOffset(furnace, thermalSimRuntime.selectedThermalSectionOffset || 0, axis);
        const steps = 9;
        for (let a = 0; a < steps; a++) {
            for (let b = 0; b < steps; b++) {
                const u = steps === 1 ? 0.5 : a / (steps - 1);
                const v = steps === 1 ? 0.5 : b / (steps - 1);
                const y = THERMAL_BASE_Y + v * fh;
                if (axis === 'x') {
                    pushSample(offset, y, -fd / 2 + u * fd);
                } else {
                    pushSample(-fw / 2 + u * fw, y, offset);
                }
            }
        }
    } else if (['floor', 'bottom', 'middle', 'top'].includes(key)) {
        const ratioMap = { floor: 0.018, bottom: 0.22, middle: 0.52, top: 0.82 };
        const y = THERMAL_BASE_Y + fh * (ratioMap[key] ?? 0.52);
        const steps = 9;
        for (let ix = 0; ix < steps; ix++) {
            for (let iz = 0; iz < steps; iz++) {
                const x = -fw / 2 + (ix / (steps - 1)) * fw;
                const z = -fd / 2 + (iz / (steps - 1)) * fd;
                pushSample(x, y, z);
            }
        }
    } else {
        const xs = [-0.32, 0, 0.32].map(r => r * fw);
        const ys = [0.22, 0.52, 0.82].map(r => THERMAL_BASE_Y + r * fh);
        const zs = [-0.32, 0, 0.32].map(r => r * fd);
        xs.forEach(x => ys.forEach(y => zs.forEach(z => pushSample(x, y, z))));
    }

    if (!samples.length) return { label: '未见明显冷点', minRatio: 1 };
    const worst = samples.sort((a, b) => a.ratio - b.ratio)[0];
    const xLabel = Math.abs(worst.x) < fw * 0.12 ? '中心' : (worst.x < 0 ? '左侧' : '右侧');
    const yLocal = (worst.y - THERMAL_BASE_Y) / Math.max(1, fh);
    const yLabel = yLocal < 0.08 ? '底面' : (yLocal < 0.34 ? '下层' : (yLocal > 0.68 ? '上层' : '中层'));
    const zLabel = Math.abs(worst.z) < fd * 0.12 ? '中部' : (worst.z < 0 ? '前侧' : '后侧');
    const viewLabel = key === 'vertical'
        ? getThermalVerticalAxisLabel(thermalSimRuntime.selectedThermalVerticalAxis || 'z')
        : (getThermalHeatmapViewMeta(key).shortLabel || '热力图');
    return { label: `${viewLabel} · ${xLabel}${yLabel}${zLabel}`, minRatio: worst.ratio, x: worst.x, y: worst.y, z: worst.z };
}

function buildThermalSliceDiagnosis(furnace, progress, viewKey = thermalSimRuntime.selectedThermalHeatmapView || 'middle') {
    const info = findThermalColdSpotInfo(furnace, progress, viewKey) || {};
    const viewMeta = getThermalHeatmapViewMeta(viewKey);
    const minRatio = Math.round((info.minRatio ?? 1) * 100);
    const axis = normalizeThermalVerticalAxis(thermalSimRuntime.selectedThermalVerticalAxis || 'z');
    const offset = Math.round(thermalSimRuntime.selectedThermalSectionOffset || 0);
    const sectionText = normalizeThermalHeatmapView(viewKey) === 'vertical'
        ? `${getThermalVerticalAxisLabel(axis)} · 位置 ${axis.toUpperCase()}=${offset}mm`
        : viewMeta.label;
    const riskText = minRatio < 48 ? '高风险冷点' : (minRatio < 65 ? '中等热滞后' : (minRatio < 82 ? '轻微温差' : '温度分布较均衡'));
    const reason = minRatio < 65
        ? '可能原因：厚大件中心滞后、层间遮挡、搁板/料框支撑附近热交换较弱，或中心堆叠密度偏高。'
        : '当前剖面未见明显异常，建议继续结合辐射暴露和气流冷却复核。';
    return {
        sectionText,
        minRatio,
        location: info.label || '未见明显冷点',
        riskText,
        reason,
        suggestion: minRatio < 65
            ? '建议优先检查蓝色/青色冷区附近工件间距，必要时降低中心堆叠密度、调整厚大件到外圈或增加热流通道。'
            : '当前剖面的热力分布可接受，可继续查看底面、纵剖面和三层对比。'
    };
}

function buildThermalHeatmapField(furnace, progress, viewKey = 'middle') {
    const group = new THREE.Group();
    group.name = 'thermalHeatmapField';
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    const yMid = THERMAL_BASE_Y + fh / 2;
    const normalizedView = normalizeThermalHeatmapView(viewKey);
    const specs = getHeatmapSliceSpecs(normalizedView);
    const displayMeta = getThermalDisplayModeMeta();

    specs.forEach((spec, idx) => {
        const texture = createThermalHeatmapTexture(furnace, spec, progress);
        const mat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: normalizedView === 'all'
                ? Math.min(0.46, (spec.opacity ?? 0.58) * displayMeta.sliceOpacity)
                : Math.min(0.72, (spec.opacity ?? 0.80) * displayMeta.sliceOpacity),
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false
        });
        let width = fw;
        let height = fd;
        let position = new THREE.Vector3(0, THERMAL_BASE_Y + fh * (spec.ratio || 0.5), 0);
        let rotation = new THREE.Euler(-Math.PI / 2, 0, 0);
        let labelSubText = `Y=${Math.round(position.y - THERMAL_BASE_Y)}mm`;

        if (spec.type === 'floor') {
            position.y = THERMAL_BASE_Y + Math.max(4, fh * (spec.ratio || 0.018));
            labelSubText = `炉底面 · Y=${Math.round(position.y - THERMAL_BASE_Y)}mm`;
        } else if (spec.type === 'vertical') {
            const verticalAxis = normalizeThermalVerticalAxis(spec.axis || thermalSimRuntime.selectedThermalVerticalAxis || 'z');
            const offset = clampThermalSectionOffset(furnace, spec.offset ?? thermalSimRuntime.selectedThermalSectionOffset ?? 0, verticalAxis);
            if (verticalAxis === 'x') {
                width = fd;
                height = fh;
                position = new THREE.Vector3(offset, yMid, 0);
                rotation = new THREE.Euler(0, Math.PI / 2, 0);
                labelSubText = `YZ面 · X=${Math.round(offset)}mm`;
            } else {
                width = fw;
                height = fh;
                position = new THREE.Vector3(0, yMid, offset);
                rotation = new THREE.Euler(0, 0, 0);
                labelSubText = `XY面 · Z=${Math.round(offset)}mm`;
            }
        }

        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
        mesh.position.copy(position);
        mesh.rotation.copy(rotation);
        mesh.renderOrder = 30 + idx;
        mesh.userData = {
            isThermalHeatmapSlice: true,
            heatmapView: spec.key,
            label: spec.label,
            axis: spec.axis || null,
            offset: spec.offset || 0
        };
        group.add(mesh);
        group.add(buildThermalHeatmapFrame(width, height, position, rotation, normalizedView === 'vertical' ? 0x7dd3fc : 0xe2e8f0, spec.type === 'vertical' ? 0.82 : 0.56));
        const labelPos = spec.type === 'vertical'
            ? position.clone().add(new THREE.Vector3(-fw / 2 + 150, fh / 2 + 50, 12))
            : position.clone().add(new THREE.Vector3(-fw / 2 + 150, 36, -fd / 2 + 38));
        group.add(buildThermalHeatmapLabel(`${spec.label}热力图`, labelSubText, labelPos));
    });

    const coldSpotMarker = buildThermalColdSpotMarker(furnace, progress, normalizedView);
    if (coldSpotMarker) group.add(coldSpotMarker);

    group.userData = {
        isThermalHeatmapField: true,
        viewKey: normalizedView,
        progress: clamp01(progress),
        verticalAxis: thermalSimRuntime.selectedThermalVerticalAxis || 'z',
        sectionOffset: thermalSimRuntime.selectedThermalSectionOffset || 0
    };
    return group;
}

function updateThermalHeatmapField(furnace, progress) {
    const group = ensureThermalSimulationGroup();
    if (thermalSimRuntime.heatmapGroup) {
        group.remove(thermalSimRuntime.heatmapGroup);
        disposeObject3D(thermalSimRuntime.heatmapGroup);
    }
    const viewKey = normalizeThermalHeatmapView(thermalSimRuntime.selectedThermalHeatmapView || 'middle');
    const heatmap = buildThermalHeatmapField(furnace, progress, viewKey);
    group.add(heatmap);
    thermalSimRuntime.heatmapGroup = heatmap;
    return heatmap;
}

function buildRadiationRays(furnace) {
    const fw = furnace.w || 600;
    const fh = furnace.h || 600;
    const fd = furnace.d || 600;
    const items = (furnace.packedItems || []).slice(0, 36);
    const positions = [];
    items.forEach((item, idx) => {
        const c = getItemCenterWorld(item, furnace);
        const wallSources = [
            new THREE.Vector3(-fw / 2, c.y, c.z),
            new THREE.Vector3(fw / 2, c.y, c.z),
            new THREE.Vector3(c.x, THERMAL_BASE_Y + fh, c.z),
            new THREE.Vector3(c.x, THERMAL_BASE_Y + fh * 0.55, -fd / 2),
            new THREE.Vector3(c.x, THERMAL_BASE_Y + fh * 0.55, fd / 2)
        ];
        const count = idx % 3 === 0 ? 3 : 2;
        for (let i = 0; i < count; i++) {
            const src = wallSources[(idx + i) % wallSources.length];
            positions.push(src.x, src.y, src.z, c.x, c.y, c.z);
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending });
    const rays = new THREE.LineSegments(geometry, material);
    rays.name = 'vacuumQuenchThermalRays';
    rays.userData = { isThermalRays: true };
    return rays;
}

function estimateItemThermalRisk(item, furnace) {
    const fw = furnace.w || 1;
    const fh = furnace.h || 1;
    const fd = furnace.d || 1;
    const cx = ((item.x || 0) + (item.w || 0) / 2) / fw;
    const cy = ((item.y || 0) + (item.h || 0) / 2) / fh;
    const cz = ((item.z || 0) + (item.d || 0) / 2) / fd;
    const distWall = Math.min(cx, 1 - cx, cy, 1 - cy, cz, 1 - cz);
    const volume = (item.w || 1) * (item.h || 1) * (item.d || 1);
    const massLag = Math.min(0.32, Math.cbrt(volume) / 1100);
    const centerLag = clamp01(distWall * 2) * 0.35;
    return clamp01(massLag + centerLag);
}

function buildRiskMarkers(furnace, scoreMap = null) {
    const group = new THREE.Group();
    group.name = scoreMap ? 'radiationExposureRiskMarkers' : 'vacuumQuenchThermalRiskMarkers';
    const sorted = [...(furnace.packedItems || [])]
        .map(item => ({ item, risk: scoreMap ? (1 - (scoreMap.get(item.id)?.score ?? 0.5)) : estimateItemThermalRisk(item, furnace) }))
        .sort((a, b) => b.risk - a.risk)
        .slice(0, 10);
    sorted.forEach(({ item, risk }) => {
        if (risk < (scoreMap ? 0.30 : 0.28)) return;
        const geometry = new THREE.BoxGeometry((item.w || 1) + 14, (item.h || 1) + 14, (item.d || 1) + 14);
        const edges = new THREE.EdgesGeometry(geometry);
        const mat = new THREE.LineBasicMaterial({
            color: risk > 0.58 ? 0xdc2626 : 0xf97316,
            transparent: true,
            opacity: scoreMap ? 0.62 : 0.45
        });
        const marker = new THREE.LineSegments(edges, mat);
        const c = getItemCenterWorld(item, furnace);
        marker.position.copy(c);
        marker.userData = { isThermalRiskMarker: true, isRadiationRiskMarker: !!scoreMap, risk };
        group.add(marker);
    });
    return group;
}

function buildRingThermalBoundary(furnace) {
    if (furnace.toolingType !== 'ring-tooling') return null;
    const group = new THREE.Group();
    group.name = 'ringThermalBoundary';
    const { outerRadius, innerRadius } = getRingThermalRadii(furnace);
    const height = Number(furnace.h || 0);
    const y0 = THERMAL_BASE_Y;
    const y1 = THERMAL_BASE_Y + height;
    const matOuter = new THREE.LineBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.34, depthWrite: false });
    const matInner = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.22, depthWrite: false });
    function makeCircle(radius, y, mat) {
        const pts = [];
        const segments = 128;
        for (let i = 0; i < segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        return new THREE.LineLoop(geo, mat);
    }
    group.add(makeCircle(outerRadius, y0, matOuter));
    group.add(makeCircle(outerRadius, y1, matOuter));
    if (innerRadius > 1) {
        group.add(makeCircle(innerRadius, y0, matInner));
        group.add(makeCircle(innerRadius, y1, matInner));
    }
    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        const x = Math.cos(a) * outerRadius;
        const z = Math.sin(a) * outerRadius;
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y0, z), new THREE.Vector3(x, y1, z)]);
        group.add(new THREE.Line(geo, matOuter));
    }
    return group;
}


function getProcessEquipmentColor(mode = 'thermal') {
    if (mode === 'airflow') return 0x38bdf8;
    if (mode === 'atmosphere') return 0x2dd4bf;
    if (mode === 'radiation') return 0xf59e0b;
    return 0xf97316;
}

function buildProcessEquipmentContext(furnace, mode = 'thermal') {
    if (!furnace) return null;
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    const y0 = THERMAL_BASE_Y;
    const yMid = y0 + fh / 2;
    const color = getProcessEquipmentColor(mode);
    const group = new THREE.Group();
    group.name = 'processEquipmentContext';
    group.userData = { isProcessEquipmentContext: true, mode };

    const panelOpacity = mode === 'thermal' ? 0.070 : (mode === 'radiation' ? 0.060 : 0.082);
    const edgeOpacity = mode === 'thermal' ? 0.46 : (mode === 'radiation' ? 0.42 : 0.38);

    const shellMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: panelOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: true
    });
    const edgeMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: edgeOpacity,
        depthWrite: false,
        depthTest: true
    });

    if (furnace.toolingType === 'ring-tooling') {
        const { outerRadius, innerRadius } = getRingThermalRadii(furnace);
        const radius = Math.max(outerRadius, Math.min(fw, fd) / 2) * 1.03;
        const cylinder = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, fh, 96, 1, true),
            shellMat
        );
        cylinder.position.y = yMid;
        cylinder.renderOrder = 4;
        group.add(cylinder);

        const topRing = buildRingCircleLine(radius, y0 + fh, color, edgeOpacity + 0.10);
        const bottomRing = buildRingCircleLine(radius, y0, color, edgeOpacity + 0.06);
        group.add(topRing, bottomRing);
        if (innerRadius > 1) {
            group.add(buildRingCircleLine(innerRadius, y0 + 4, 0x94a3b8, 0.18));
        }
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const x = Math.cos(a) * radius;
            const z = Math.sin(a) * radius;
            const geo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(x, y0, z),
                new THREE.Vector3(x, y0 + fh, z)
            ]);
            const line = new THREE.Line(geo, edgeMat.clone());
            line.renderOrder = 5;
            group.add(line);
        }
        group.add(createDimensionLabelSprite('设备有效热区', new THREE.Vector3(-radius * 0.72, y0 + fh + 58, radius * 0.55), {
            width: 170,
            height: 42,
            color: '#e2e8f0',
            bg: 'rgba(15, 23, 42, 0.64)',
            stroke: 'rgba(148, 163, 184, 0.42)'
        }));
        return group;
    }

    const box = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, fd), shellMat);
    box.position.set(0, yMid, 0);
    box.renderOrder = 4;
    group.add(box);

    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(fw, fh, fd)), edgeMat);
    edges.position.copy(box.position);
    edges.renderOrder = 5;
    group.add(edges);

    // UX V2.9：普通料框的外壳以前太淡，增加四角立柱与炉门边框，形成“设备内胆”语境。
    const postMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: edgeOpacity + 0.08, depthWrite: false, depthTest: true });
    const postR = Math.max(5, Math.min(12, Math.min(fw, fd) / 80));
    const postGeo = new THREE.CylinderGeometry(postR, postR, fh, 12);
    [[-fw / 2, -fd / 2], [fw / 2, -fd / 2], [fw / 2, fd / 2], [-fw / 2, fd / 2]].forEach(([x, z]) => {
        const post = new THREE.Mesh(postGeo, postMat.clone());
        post.position.set(x, yMid, z);
        post.renderOrder = 6;
        group.add(post);
    });

    // 保留一个偏后侧的半透明炉门/风道语义面，增强“在设备内部”的空间感，但不遮挡主要工件。
    const backPanel = new THREE.Mesh(
        new THREE.PlaneGeometry(fw, fh),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: Math.min(panelOpacity * 1.65, 0.12), side: THREE.DoubleSide, depthWrite: false })
    );
    backPanel.position.set(0, yMid, fd / 2 + 2);
    backPanel.renderOrder = 3;
    group.add(backPanel);
    group.add(createDimensionLabelSprite('炉膛有效区', new THREE.Vector3(-fw / 2 + 120, y0 + fh + 54, fd / 2 + 12), {
        width: 158,
        height: 42,
        color: '#e2e8f0',
        bg: 'rgba(15, 23, 42, 0.64)',
        stroke: 'rgba(148, 163, 184, 0.42)'
    }));
    return group;
}

function createProcessNozzleVisual(position, normal, color = 0x38bdf8, label = '', options = {}) {
    const group = new THREE.Group();
    group.name = options.name || 'processSourceNozzle';
    group.userData = { isProcessSourceModel: true, label };
    const n = (normal && normal.clone ? normal.clone() : new THREE.Vector3(0, 0, 1));
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
    n.normalize();

    const basePos = position.clone ? position.clone() : new THREE.Vector3(position.x || 0, position.y || 0, position.z || 0);
    const len = options.length || 78;
    const radius = options.radius || 28;
    const opacity = options.opacity ?? 0.74;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: true });
    const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: Math.min(0.26, opacity * 0.36), depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });

    const torus = new THREE.Mesh(new THREE.TorusGeometry(radius, Math.max(2.5, radius * 0.11), 8, 36), mat.clone());
    torus.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    torus.position.copy(basePos.clone().add(n.clone().multiplyScalar(6)));
    torus.renderOrder = 58;
    group.add(torus);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.42, radius * 0.58, len, 24, 1, true), mat.clone());
    barrel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    barrel.position.copy(basePos.clone().sub(n.clone().multiplyScalar(len * 0.30)));
    barrel.renderOrder = 57;
    group.add(barrel);

    const glow = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.38, 18, 12), glowMat);
    glow.position.copy(basePos.clone().add(n.clone().multiplyScalar(radius * 0.36)));
    glow.renderOrder = 59;
    group.add(glow);

    const arrow = new THREE.ArrowHelper(n, basePos.clone().add(n.clone().multiplyScalar(radius * 0.48)), len * 0.82, color, len * 0.24, len * 0.12);
    arrow.renderOrder = 60;
    arrow.userData = { isProcessSourceModel: true, isProcessSourceArrow: true };
    group.add(arrow);

    if (label) {
        const labelOffset = options.labelOffset || new THREE.Vector3(0, 46, 0);
        const labelPos = basePos.clone().add(n.clone().multiplyScalar(len * 0.70)).add(labelOffset);
        group.add(createDimensionLabelSprite(label, labelPos, {
            width: options.labelWidth || 172,
            height: 40,
            color: '#e0f2fe',
            bg: 'rgba(8, 20, 32, 0.72)',
            stroke: 'rgba(56, 189, 248, 0.55)'
        }));
    }
    return group;
}

function addRadiationSourceModules(group, furnace, sources) {
    if (!group || !furnace || !Array.isArray(sources)) return;
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    const size = Math.max(18, Math.min(38, Math.min(fw, fd) / 26));
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.82, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffa000, transparent: true, opacity: 0.22, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    sources.slice(0, 28).forEach((src, idx) => {
        const p = src.position;
        const module = new THREE.Mesh(new THREE.BoxGeometry(size * 0.52, size * 1.35, size * 0.52), mat.clone());
        module.position.copy(p);
        module.renderOrder = 52;
        group.add(module);
        const halo = new THREE.Mesh(new THREE.SphereGeometry(size * 0.76, 12, 8), glowMat.clone());
        halo.position.copy(p);
        halo.renderOrder = 51;
        group.add(halo);
        if (idx === 0) {
            group.add(createDimensionLabelSprite('辐射加热源', p.clone().add(new THREE.Vector3(0, Math.max(70, fh * 0.08), 0)), {
                width: 160,
                height: 40,
                color: '#fff7ed',
                bg: 'rgba(40, 18, 4, 0.72)',
                stroke: 'rgba(251, 191, 36, 0.58)'
            }));
        }
    });
}

function calculateThermalMetrics(furnace, progress) {
    const items = furnace.packedItems || [];
    const risks = items.map(item => estimateItemThermalRisk(item, furnace));
    const avgRisk = risks.length ? risks.reduce((sum, value) => sum + value, 0) / risks.length : 0;
    const maxRisk = risks.length ? Math.max(...risks) : 0;
    const coldSpotCount = risks.filter(value => value > 0.45).length;
    const packedVolume = items.reduce((sum, item) => sum + (item.w || 0) * (item.h || 0) * (item.d || 0), 0);
    const furnaceVolume = Math.max(1, (furnace.w || 1) * (furnace.h || 1) * (furnace.d || 1));
    const density = packedVolume / furnaceVolume;
    const uniformityScore = Math.max(48, Math.round(94 - avgRisk * 42 - maxRisk * 18 - density * 28));
    const currentTemp = Math.round(VACUUM_QUENCH_PROFILE.startTemp + clamp01(progress) * (VACUUM_QUENCH_PROFILE.targetTemp - VACUUM_QUENCH_PROFILE.startTemp));
    const viewMeta = getThermalHeatmapViewMeta(thermalSimRuntime.selectedThermalHeatmapView || 'middle');
    const verticalAxis = normalizeThermalVerticalAxis(thermalSimRuntime.selectedThermalVerticalAxis || 'z');
    const sectionRange = getThermalSectionRange(furnace, verticalAxis);
    const sectionOffset = clampThermalSectionOffset(furnace, thermalSimRuntime.selectedThermalSectionOffset || 0, verticalAxis);
    const coldSpotInfo = findThermalColdSpotInfo(furnace, progress, viewMeta.key);
    const sliceDiagnosis = buildThermalSliceDiagnosis(furnace, progress, viewMeta.key);
    const displayModeMeta = getThermalDisplayModeMeta();
    const estimatedSpread = Math.max(8, Math.round(18 + maxRisk * 72 + density * 44 - clamp01(progress) * 16));
    return {
        mode: 'thermal',
        processName: VACUUM_QUENCH_PROFILE.processName,
        currentTemp,
        targetTemp: VACUUM_QUENCH_PROFILE.targetTemp,
        uniformityScore,
        coldSpotCount,
        radiationExposure: Math.max(52, Math.round(91 - avgRisk * 35 - density * 18)),
        coreLagRisk: maxRisk > 0.55 ? '高' : (maxRisk > 0.38 ? '中' : '低'),
        densityRate: Math.round(density * 1000) / 10,
        progress: Math.round(clamp01(progress) * 100),
        heatmapView: viewMeta.key,
        heatmapViewLabel: viewMeta.label,
        heatmapViewDescription: viewMeta.description,
        heatmapVerticalAxis: verticalAxis,
        heatmapVerticalAxisLabel: getThermalVerticalAxisLabel(verticalAxis),
        heatmapSectionOffset: Math.round(sectionOffset),
        heatmapSectionMinOffset: sectionRange.min,
        heatmapSectionMaxOffset: sectionRange.max,
        thermalSpread: estimatedSpread,
        coldSpotLocation: coldSpotInfo.label,
        minThermalRatio: Math.round((coldSpotInfo.minRatio ?? 1) * 100),
        heatmapDisplayMode: displayModeMeta.key,
        heatmapDisplayModeLabel: displayModeMeta.label,
        heatmapDisplayModeDescription: displayModeMeta.description,
        heatmapSliceSectionText: sliceDiagnosis.sectionText,
        heatmapSliceRiskText: sliceDiagnosis.riskText,
        heatmapSliceReason: sliceDiagnosis.reason,
        heatmapSliceSuggestion: sliceDiagnosis.suggestion,
        heatmapModeName: '热力图 V1.3'
    };
}

function updateThermalPointCloud(progress) {
    const cloud = thermalSimRuntime.pointCloud;
    if (!cloud || !cloud.geometry) return;
    const colors = cloud.geometry.getAttribute('color');
    const meta = cloud.geometry.userData.thermalMeta || [];
    for (let i = 0; i < meta.length; i++) {
        const ratio = temperatureRatioFromMeta(meta[i], progress);
        const c = colorFromTemperatureRatio(ratio);
        colors.setXYZ(i, c.r, c.g, c.b);
    }
    colors.needsUpdate = true;
    if (cloud.material) {
        cloud.material.opacity = 0.58 + Math.sin(progress * Math.PI) * 0.34;
        const baseSize = cloud.userData?.basePointSize || cloud.material.size || 36;
        cloud.material.size = baseSize * (1 + Math.sin(progress * Math.PI * 2) * 0.055);
        cloud.material.needsUpdate = true;
    }
}

function applyThermalTintToItems(furnace, progress) {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !furnace) return;
    const itemMap = new Map((furnace.packedItems || []).map(item => [item.id, item]));
    const p = clamp01(progress);
    group.traverse(child => {
        if (!child.isMesh || !child.userData || !child.userData.itemId) return;
        const item = itemMap.get(child.userData.itemId);
        const risk = item ? estimateItemThermalRisk(item, furnace) : 0.25;
        const surfaceCatchUp = p * (0.18 + Math.max(0, 0.55 - risk) * 0.18);
        const itemRatio = clamp01(p - risk * (0.32 - p * 0.16) + surfaceCatchUp);
        const tint = colorFromTemperatureRatio(itemRatio);
        const emissiveStrength = 0.10 + itemRatio * 0.38;
        getMeshMaterials(child).forEach(mat => {
            if (!mat.color) return;
            saveOriginalMaterialIfNeeded(mat);
            mat.color.copy(tint);
            if (mat.emissive) {
                mat.emissive.copy(tint);
                mat.emissive.multiplyScalar(0.45);
                mat.emissiveIntensity = emissiveStrength;
            }
            mat.transparent = true;
            mat.opacity = 0.34 + itemRatio * 0.18;
            mat.needsUpdate = true;
        });
    });
}

// ---------- 辐射暴露 v1 ----------
function buildRadiationSources(furnace) {
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    const y0 = THERMAL_BASE_Y;
    const yMid = y0 + fh * 0.52;
    const sources = [];

    if (furnace.toolingType === 'ring-tooling') {
        const { outerRadius, innerRadius } = getRingThermalRadii(furnace);
        const radius = outerRadius;
        for (let i = 0; i < 16; i++) {
            const a = i / 16 * Math.PI * 2;
            sources.push({
                position: new THREE.Vector3(Math.cos(a) * radius, yMid, Math.sin(a) * radius),
                side: '外圆周热源',
                strength: 1
            });
        }
        for (let i = 0; i < 8; i++) {
            const a = i / 8 * Math.PI * 2;
            const r = innerRadius + (outerRadius - innerRadius) * 0.65;
            sources.push({
                position: new THREE.Vector3(Math.cos(a) * r, y0 + fh, Math.sin(a) * r),
                side: '顶部圆环热源',
                strength: 0.92
            });
        }
        return sources;
    }

    const yLevels = [0.22, 0.55, 0.86].map(v => y0 + fh * v);
    const zLevels = [-fd * 0.33, 0, fd * 0.33];
    const xLevels = [-fw * 0.33, 0, fw * 0.33];
    yLevels.forEach(y => {
        zLevels.forEach(z => {
            sources.push({ position: new THREE.Vector3(-fw / 2, y, z), side: '左壁热源', strength: 1 });
            sources.push({ position: new THREE.Vector3(fw / 2, y, z), side: '右壁热源', strength: 1 });
        });
        xLevels.forEach(x => {
            sources.push({ position: new THREE.Vector3(x, y, -fd / 2), side: '前壁热源', strength: 0.88 });
            sources.push({ position: new THREE.Vector3(x, y, fd / 2), side: '后壁热源', strength: 0.88 });
        });
    });
    xLevels.forEach(x => zLevels.forEach(z => sources.push({ position: new THREE.Vector3(x, y0 + fh, z), side: '顶部热源', strength: 0.96 })));
    return sources;
}

function getItemRadiationSamplePoints(item, furnace) {
    const b = getItemWorldBox(item, furnace);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    return [
        new THREE.Vector3(cx, cy, cz),
        new THREE.Vector3(cx, b.maxY, cz),
        new THREE.Vector3(b.minX, cy, cz),
        new THREE.Vector3(b.maxX, cy, cz),
        new THREE.Vector3(cx, cy, b.minZ),
        new THREE.Vector3(cx, cy, b.maxZ)
    ];
}

function segmentIntersectsBox(p0, p1, box) {
    let tMin = 0;
    let tMax = 1;
    const axes = [
        ['x', box.minX, box.maxX],
        ['y', box.minY, box.maxY],
        ['z', box.minZ, box.maxZ]
    ];
    for (const [axis, minV, maxV] of axes) {
        const start = p0[axis];
        const end = p1[axis];
        const d = end - start;
        if (Math.abs(d) < 1e-6) {
            if (start < minV || start > maxV) return false;
            continue;
        }
        let t1 = (minV - start) / d;
        let t2 = (maxV - start) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return false;
    }
    // 避免把源点或目标点刚贴边误判为完全遮挡。
    return tMax > 0.035 && tMin < 0.965;
}

function getRadiationBlockers(sourcePoint, targetPoint, targetItem, allItems, furnace) {
    const blockers = [];
    for (const other of allItems) {
        if (!other || other.id === targetItem.id) continue;
        const box = getItemWorldBox(other, furnace);
        if (segmentIntersectsBox(sourcePoint, targetPoint, box)) {
            blockers.push(other);
        }
    }
    return blockers;
}

function isRadiationBlocked(sourcePoint, targetPoint, targetItem, allItems, furnace) {
    return getRadiationBlockers(sourcePoint, targetPoint, targetItem, allItems, furnace).length > 0;
}

function calculateRadiationExposureScores(furnace) {
    const items = furnace.packedItems || [];
    const sources = buildRadiationSources(furnace);
    const result = new Map();
    if (!items.length || !sources.length) return { scores: result, sources };

    items.forEach(item => {
        const samples = getItemRadiationSamplePoints(item, furnace);
        let total = 0;
        let visible = 0;
        let blocked = 0;
        const visibleRays = [];
        const blockedRays = [];
        const blockerMap = new Map();

        sources.forEach((src, si) => {
            // 每个热源只抽样两个目标点，避免成本太高；不同热源错开采样面。
            const sampleA = samples[si % samples.length];
            const sampleB = samples[(si + 2) % samples.length];
            [sampleA, sampleB].forEach(target => {
                total += src.strength;
                const blockers = getRadiationBlockers(src.position, target, item, items, furnace);
                const isBlocked = blockers.length > 0;
                if (isBlocked) {
                    blocked += src.strength;
                    blockers.forEach(blocker => {
                        const existed = blockerMap.get(blocker.id) || { item: blocker, count: 0 };
                        existed.count += 1;
                        blockerMap.set(blocker.id, existed);
                    });
                    if (blockedRays.length < 8) {
                        blockedRays.push({
                            source: src.position.clone(),
                            target: target.clone(),
                            blocked: true,
                            blockers: blockers.map(b => ({ id: b.id, name: b.name || '遮挡工件' }))
                        });
                    }
                } else {
                    const dist = src.position.distanceTo(target);
                    const distanceFactor = clamp01(1.15 - dist / Math.max(furnace.w || 1, furnace.h || 1, furnace.d || 1) * 0.18);
                    visible += src.strength * distanceFactor;
                    if (visibleRays.length < 8) {
                        visibleRays.push({ source: src.position.clone(), target: target.clone(), blocked: false, blockers: [] });
                    }
                }
            });
        });

        const rawScore = total > 0 ? visible / total : 0;
        const thermalRisk = estimateItemThermalRisk(item, furnace);
        const score = clamp01(rawScore * (1 - thermalRisk * 0.18));
        const blockers = [...blockerMap.values()].sort((a, b) => b.count - a.count);
        result.set(item.id, {
            item,
            score,
            visibleRayCount: Math.round(visible),
            blockedRayCount: Math.round(blocked),
            totalRayWeight: Math.round(total),
            rays: [...visibleRays.slice(0, 4), ...blockedRays.slice(0, 4)],
            visibleRays,
            blockedRays,
            blockers
        });

        item.simulation = {
            ...(item.simulation || {}),
            radiationExposureScore: Math.round(score * 100),
            visibleRayCount: Math.round(visible),
            blockedRayCount: Math.round(blocked),
            blockerCount: blockers.length
        };
    });

    return { scores: result, sources };
}

function buildRadiationHeatSourcesVisual(furnace, sources) {
    const group = new THREE.Group();
    group.name = 'radiationHeatSourcesVisual';
    const fw = furnace.w || 600;
    const fh = furnace.h || 600;
    const fd = furnace.d || 600;
    const y0 = THERMAL_BASE_Y;

    const mat = new THREE.MeshBasicMaterial({
        color: 0xff7a18,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    if (furnace.toolingType === 'ring-tooling') {
        const { outerRadius, innerRadius } = getRingThermalRadii(furnace);
        const ringGeo = new THREE.RingGeometry(innerRadius, outerRadius, 128);
        const topRing = new THREE.Mesh(ringGeo, mat.clone());
        topRing.rotation.x = -Math.PI / 2;
        topRing.position.y = y0 + fh;
        group.add(topRing);

        const boundary = buildRingThermalBoundary(furnace);
        if (boundary) group.add(boundary);
    } else {
        const planes = [
            { geo: new THREE.PlaneGeometry(fd, fh), pos: [-fw / 2, y0 + fh / 2, 0], rot: [0, Math.PI / 2, 0] },
            { geo: new THREE.PlaneGeometry(fd, fh), pos: [fw / 2, y0 + fh / 2, 0], rot: [0, Math.PI / 2, 0] },
            { geo: new THREE.PlaneGeometry(fw, fh), pos: [0, y0 + fh / 2, -fd / 2], rot: [0, 0, 0] },
            { geo: new THREE.PlaneGeometry(fw, fh), pos: [0, y0 + fh / 2, fd / 2], rot: [0, 0, 0] },
            { geo: new THREE.PlaneGeometry(fw, fd), pos: [0, y0 + fh, 0], rot: [-Math.PI / 2, 0, 0] }
        ];
        planes.forEach(p => {
            const mesh = new THREE.Mesh(p.geo, mat.clone());
            mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
            mesh.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
            mesh.renderOrder = 9;
            group.add(mesh);
        });
    }

    const sourceGeo = new THREE.BufferGeometry();
    const pts = sources.slice(0, 80).flatMap(s => [s.position.x, s.position.y, s.position.z]);
    sourceGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const sourceMat = new THREE.PointsMaterial({
        size: Math.max(18, Math.min(42, Math.min(fw, fd) / 18)),
        color: 0xffd166,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const sourcePoints = new THREE.Points(sourceGeo, sourceMat);
    sourcePoints.userData = { isRadiationSourcePoints: true };
    group.add(sourcePoints);
    addRadiationSourceModules(group, furnace, sources);
    return group;
}

function buildRadiationExposureRays(scoreMap) {
    const entries = [...scoreMap.values()].sort((a, b) => a.score - b.score);
    const selected = [...entries.slice(0, 12), ...entries.slice(-6)];
    const positions = [];
    const colors = [];
    const gold = new THREE.Color(0xffd166);
    const red = new THREE.Color(0xef4444);
    const weak = new THREE.Color(0xff8a00);

    selected.forEach(entry => {
        (entry.rays || []).slice(0, 5).forEach(ray => {
            const c = ray.blocked ? red : (entry.score > 0.72 ? gold : weak);
            positions.push(ray.source.x, ray.source.y, ray.source.z, ray.target.x, ray.target.y, ray.target.z);
            colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
        });
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const rays = new THREE.LineSegments(geometry, material);
    rays.name = 'radiationExposureRays';
    rays.userData = { isThermalRays: true, isRadiationExposureRays: true };
    return rays;
}

function applyRadiationTintToItems(furnace, scoreMap) {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !furnace) return;
    group.traverse(child => {
        if (!child.isMesh || !child.userData || !child.userData.itemId) return;
        const entry = scoreMap.get(child.userData.itemId);
        const score = entry ? entry.score : 0.55;
        const tint = getRadiationScoreColor(score);
        getMeshMaterials(child).forEach(mat => {
            if (!mat.color) return;
            saveOriginalMaterialIfNeeded(mat);
            mat.color.copy(tint);
            if (mat.emissive) {
                mat.emissive.copy(tint);
                mat.emissive.multiplyScalar(score >= 0.72 ? 0.55 : 0.35);
                mat.emissiveIntensity = 0.12 + score * 0.42;
            }
            mat.transparent = true;
            mat.opacity = 0.62 + score * 0.34;
            mat.needsUpdate = true;
        });
    });
}

function calculateRadiationMetrics(furnace, scoreMap) {
    const scores = [...scoreMap.values()];
    const avgScore = scores.length ? scores.reduce((s, v) => s + v.score, 0) / scores.length : 0;
    const minScore = scores.length ? Math.min(...scores.map(v => v.score)) : 0;
    const blockedItems = scores.filter(v => v.score < 0.58).length;
    const severeBlockedItems = scores.filter(v => v.score < 0.42).length;
    const totalBlockedRays = scores.reduce((s, v) => s + (v.blockedRayCount || 0), 0);
    const worst = scores.sort((a, b) => a.score - b.score)[0];
    return {
        mode: 'radiation',
        processName: VACUUM_QUENCH_PROFILE.processName,
        radiationExposure: Math.round(avgScore * 100),
        minRadiationExposure: Math.round(minScore * 100),
        blockedItemCount: blockedItems,
        severeBlockedItemCount: severeBlockedItems,
        blockedRayCount: totalBlockedRays,
        worstItemName: worst?.item?.name || '-',
        suggestion: severeBlockedItems > 0
            ? '存在明显背辐射区域，建议增加中心间距或调整大件方向。'
            : (blockedItems > 0 ? '存在局部遮挡，可优先复核中部与下层工件。' : '辐射可达性较好，当前装炉无遮挡高风险。')
    };
}

function buildSingleRadiationRays(entry) {
    const positions = [];
    const colors = [];
    const gold = new THREE.Color(0xfff1a6);
    const red = new THREE.Color(0xff1744);
    const weak = new THREE.Color(0xff8a00);
    const selectedRays = [
        ...(entry.visibleRays || []).slice(0, 8),
        ...(entry.blockedRays || []).slice(0, 8)
    ];

    selectedRays.forEach(ray => {
        const c = ray.blocked ? red : (entry.score > 0.72 ? gold : weak);
        positions.push(ray.source.x, ray.source.y, ray.source.z, ray.target.x, ray.target.y, ray.target.z);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const rays = new THREE.LineSegments(geometry, material);
    rays.name = 'selectedRadiationExposureRays';
    rays.userData = { isThermalRays: true, isRadiationExposureRays: true, isSelectedRadiationRays: true };
    return rays;
}

function buildSelectedRadiationMarkers(furnace, entry) {
    const group = new THREE.Group();
    group.name = 'selectedRadiationMarkers';
    if (!entry || !entry.item) return group;

    function addItemMarker(item, color, opacity, scalePad = 20) {
        const geometry = new THREE.BoxGeometry((item.w || 1) + scalePad, (item.h || 1) + scalePad, (item.d || 1) + scalePad);
        const edges = new THREE.EdgesGeometry(geometry);
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
        const marker = new THREE.LineSegments(edges, mat);
        marker.position.copy(getItemCenterWorld(item, furnace));
        marker.userData = { isRadiationRiskMarker: true, isSelectedRadiationMarker: true };
        group.add(marker);
    }

    addItemMarker(entry.item, 0xfacc15, 0.92, 24);
    (entry.blockers || []).slice(0, 8).forEach(({ item }) => {
        if (item) addItemMarker(item, 0xff1744, 0.72, 16);
    });
    return group;
}

function applySelectedRadiationTintToItems(furnace, scoreMap, selectedItemId, blockerIds) {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !furnace) return;
    const blockers = new Set(blockerIds || []);

    group.traverse(child => {
        if (!child.isMesh || !child.userData || !child.userData.itemId) return;
        const itemId = child.userData.itemId;
        const entry = scoreMap.get(itemId);
        const score = entry ? entry.score : 0.55;
        let tint = getRadiationScoreColor(score);
        let opacity = 0.18;
        let emissiveScale = 0.12;
        let emissiveIntensity = 0.08;

        if (itemId === selectedItemId) {
            tint = new THREE.Color(0xfacc15);
            opacity = 0.98;
            emissiveScale = 0.75;
            emissiveIntensity = 0.72;
        } else if (blockers.has(itemId)) {
            tint = new THREE.Color(0xff1744);
            opacity = 0.64;
            emissiveScale = 0.55;
            emissiveIntensity = 0.45;
        }

        getMeshMaterials(child).forEach(mat => {
            if (!mat.color) return;
            saveOriginalMaterialIfNeeded(mat);
            mat.color.copy(tint);
            if (mat.emissive) {
                mat.emissive.copy(tint);
                mat.emissive.multiplyScalar(emissiveScale);
                mat.emissiveIntensity = emissiveIntensity;
            }
            mat.transparent = true;
            mat.opacity = opacity;
            mat.needsUpdate = true;
        });
    });
}



function getRadiationSectionAxisMeta(directionKey = 'z+') {
    const raw = String(directionKey || 'z+').toLowerCase().trim();
    let axis = raw[0];
    if (!['x', 'y', 'z'].includes(axis)) axis = 'z';
    const sign = raw.includes('-') ? -1 : 1;
    const key = `${axis}${sign > 0 ? '+' : '-'}`;

    const labels = {
        'x+': { axisLabel: '+X 方向切割', planeLabel: 'YZ 剖面', keepLabel: '保留右侧 / +X 侧', normalText: '+X' },
        'x-': { axisLabel: '-X 方向切割', planeLabel: 'YZ 剖面', keepLabel: '保留左侧 / -X 侧', normalText: '-X' },
        'y+': { axisLabel: '+Y 方向切割', planeLabel: 'XZ 水平剖面', keepLabel: '保留上层 / +Y 侧', normalText: '+Y' },
        'y-': { axisLabel: '-Y 方向切割', planeLabel: 'XZ 水平剖面', keepLabel: '保留下层 / -Y 侧', normalText: '-Y' },
        'z+': { axisLabel: '+Z 方向切割', planeLabel: 'XY 剖面', keepLabel: '保留后侧 / +Z 侧', normalText: '+Z' },
        'z-': { axisLabel: '-Z 方向切割', planeLabel: 'XY 剖面', keepLabel: '保留前侧 / -Z 侧', normalText: '-Z' }
    };

    return {
        axis,
        sign,
        directionKey: key,
        coordKey: axis,
        ...(labels[key] || labels['z+'])
    };
}

function calculateBestSectionAxis(furnace, entry) {
    const target = entry?.item;
    if (!furnace || !target) return getRadiationSectionAxisMeta('z+');

    const targetCenter = getItemCenterWorld(target, furnace);
    const axisWeight = { x: 0, y: 0, z: 0 };
    let dominant = null;

    (entry.blockers || []).forEach(({ item, count }) => {
        if (!item) return;
        const c = getItemCenterWorld(item, furnace);
        const diffVec = c.clone().sub(targetCenter);
        const diff = {
            x: Math.abs(diffVec.x),
            y: Math.abs(diffVec.y),
            z: Math.abs(diffVec.z)
        };
        const weight = Math.max(1, count || 1);
        axisWeight.x += diff.x * weight;
        axisWeight.y += diff.y * weight;
        axisWeight.z += diff.z * weight;
        const maxAxis = diff.x >= diff.y && diff.x >= diff.z ? 'x' : (diff.y >= diff.z ? 'y' : 'z');
        const score = diff[maxAxis] * weight;
        if (!dominant || score > dominant.score) {
            dominant = { item, axis: maxAxis, score, diff: diffVec, count: weight };
        }
    });

    let axis = 'z';
    if (axisWeight.x >= axisWeight.y && axisWeight.x >= axisWeight.z) axis = 'x';
    else if (axisWeight.y >= axisWeight.z) axis = 'y';

    if (!dominant) {
        const dims = { x: target.w || 0, y: target.h || 0, z: target.d || 0 };
        axis = dims.x >= dims.y && dims.x >= dims.z ? 'x' : (dims.y >= dims.z ? 'y' : 'z');
    } else {
        axis = dominant.axis;
    }

    const diffValue = dominant ? dominant.diff[axis] : 1;
    const sign = diffValue < 0 ? -1 : 1;
    const meta = getRadiationSectionAxisMeta(`${axis}${sign > 0 ? '+' : '-'}`);
    meta.dominantBlocker = dominant?.item || null;
    meta.dominantDirection = dominant ? describeSectionDirection(dominant.diff, dominant.axis) : '当前工件中心剖面';
    return meta;
}

function describeSectionDirection(diff, axis) {
    if (!diff) return '当前工件中心剖面';
    if (axis === 'x') return diff.x < 0 ? '左侧遮挡' : '右侧遮挡';
    if (axis === 'y') return diff.y < 0 ? '下层遮挡' : '上层遮挡';
    return diff.z < 0 ? '前侧遮挡' : '后侧遮挡';
}

function getSectionAxisWorldRange(furnace, axis) {
    const fw = Number(furnace?.w || 600);
    const fh = Number(furnace?.h || 600);
    const fd = Number(furnace?.d || 600);
    if (axis === 'x') return { min: -fw / 2, max: fw / 2 };
    if (axis === 'y') return { min: THERMAL_BASE_Y, max: THERMAL_BASE_Y + fh };
    return { min: -fd / 2, max: fd / 2 };
}

function clampSectionOffset(furnace, baseCoord, axisMeta, offset = 0) {
    const range = getSectionAxisWorldRange(furnace, axisMeta.axis);
    const minOffset = Math.ceil(axisMeta.sign > 0 ? range.min - baseCoord : baseCoord - range.max);
    const maxOffset = Math.floor(axisMeta.sign > 0 ? range.max - baseCoord : baseCoord - range.min);
    const safeOffset = Math.max(minOffset, Math.min(maxOffset, Number(offset) || 0));
    return { offset: safeOffset, minOffset, maxOffset };
}

function buildRadiationSectionInfo(furnace, entry, axisMeta, options = {}) {
    const target = entry?.item;
    const c = target ? getItemCenterWorld(target, furnace) : new THREE.Vector3();
    const fw = Number(furnace?.w || 600);
    const fh = Number(furnace?.h || 600);
    const fd = Number(furnace?.d || 600);
    const baseBand = axisMeta.axis === 'x' ? target?.w : (axisMeta.axis === 'y' ? target?.h : target?.d);
    const focusBand = Math.round(Math.max(90, Math.min(Math.max(fw, fh, fd) * 0.26, (baseBand || 80) * 1.8 + 60)));

    const baseCoord = c[axisMeta.axis] || 0;
    const offsetInfo = clampSectionOffset(furnace, baseCoord, axisMeta, options.offset ?? 0);
    const planeCoord = baseCoord + axisMeta.sign * offsetInfo.offset;

    const normal = getSectionDirectionNormal(axisMeta.directionKey);
    const origin = new THREE.Vector3(c.x, c.y, c.z);
    origin[axisMeta.axis] = planeCoord;

    const blockers = (entry.blockers || []).slice(0, 4).map(({ item, count }) => ({
        id: item?.id,
        name: item?.name || '遮挡工件',
        count: count || 0
    }));

    const blockerNames = blockers.map(b => b.name).join(' / ') || '暂无集中遮挡物';
    const blockerText = axisMeta.dominantBlocker?.name || blockers[0]?.name || '暂无集中遮挡物';
    const suggestion = blockers.length
        ? `已沿 ${axisMeta.normalText} 法线生成真实 clipping plane。蓝色切面可直接拖动，优先观察 ${blockerText} 与当前工件之间的红色遮挡路径。`
        : `当前件没有明显集中遮挡来源，已以当前工件中心为基准生成真实 clipping plane，可切换六个方向复核周边空间。`;

    return {
        active: true,
        trueClip: true,
        draggable: true,
        axis: axisMeta.axis,
        sign: axisMeta.sign,
        directionKey: axisMeta.directionKey,
        axisLabel: `${axisMeta.axisLabel} · ${axisMeta.planeLabel}`,
        planeLabel: axisMeta.planeLabel,
        keepLabel: axisMeta.keepLabel,
        normalText: axisMeta.normalText,
        dominantDirection: axisMeta.dominantDirection,
        focusBand,
        baseCoord: Math.round(baseCoord),
        planeCoord: Math.round(planeCoord),
        offset: Math.round(offsetInfo.offset),
        minOffset: offsetInfo.minOffset,
        maxOffset: offsetInfo.maxOffset,
        center: { x: Math.round(c.x), y: Math.round(c.y), z: Math.round(c.z) },
        origin: { x: origin.x, y: origin.y, z: origin.z },
        normal: { x: normal.x, y: normal.y, z: normal.z },
        blockerText,
        blockerNames,
        blockers,
        suggestion
    };
}

function buildRadiationSectionPlane(furnace, entry, sectionInfo) {
    const group = new THREE.Group();
    group.name = 'radiationSectionPlane';
    if (!furnace || !entry?.item || !sectionInfo) return group;

    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    const c = getItemCenterWorld(entry.item, furnace);
    const yMid = THERMAL_BASE_Y + fh / 2;

    let width = fw;
    let height = fh;
    let position = new THREE.Vector3(0, yMid, 0);
    let rotation = new THREE.Euler(0, 0, 0);

    if (sectionInfo.axis === 'x') {
        width = fd;
        height = fh;
        position = new THREE.Vector3(sectionInfo.planeCoord, yMid, 0);
        rotation = new THREE.Euler(0, Math.PI / 2, 0);
    } else if (sectionInfo.axis === 'y') {
        width = fw;
        height = fd;
        position = new THREE.Vector3(0, sectionInfo.planeCoord, 0);
        rotation = new THREE.Euler(-Math.PI / 2, 0, 0);
    } else {
        width = fw;
        height = fh;
        position = new THREE.Vector3(0, yMid, sectionInfo.planeCoord);
        rotation = new THREE.Euler(0, 0, 0);
    }

    const geo = new THREE.PlaneGeometry(width, height);
    const mat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const plane = new THREE.Mesh(geo, mat);
    plane.name = 'radiationClipPlaneSurface';
    plane.position.copy(position);
    plane.rotation.copy(rotation);
    plane.renderOrder = 45;
    plane.userData = {
        isRadiationRiskMarker: true,
        isRadiationSectionPlane: true,
        isRadiationClipDragHandle: true
    };
    group.add(plane);

    const edgeGeo = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.86,
        depthWrite: false
    });
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    edges.position.copy(position);
    edges.rotation.copy(rotation);
    edges.renderOrder = 46;
    edges.userData = { isRadiationRiskMarker: true, isRadiationSectionPlane: true };
    group.add(edges);

    const normal = getSectionDirectionNormal(sectionInfo.directionKey);
    const arrowLength = Math.max(90, Math.min(180, Math.max(fw, fh, fd) * 0.16));
    const arrow = new THREE.ArrowHelper(normal, position.clone(), arrowLength, 0x7dd3fc, arrowLength * 0.28, arrowLength * 0.14);
    arrow.name = 'radiationClipPlaneNormalArrow';
    arrow.renderOrder = 47;
    arrow.userData = { isRadiationRiskMarker: true, isRadiationSectionPlane: true };
    group.add(arrow);

    const lineMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.52,
        depthWrite: false
    });
    let p1, p2;
    if (sectionInfo.axis === 'y') {
        p1 = new THREE.Vector3(-fw / 2, sectionInfo.planeCoord, c.z);
        p2 = new THREE.Vector3(fw / 2, sectionInfo.planeCoord, c.z);
    } else {
        const axisCoord = sectionInfo.planeCoord;
        p1 = new THREE.Vector3(c.x, THERMAL_BASE_Y, c.z);
        p2 = new THREE.Vector3(c.x, THERMAL_BASE_Y + fh, c.z);
        p1[sectionInfo.axis] = axisCoord;
        p2[sectionInfo.axis] = axisCoord;
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const centerLine = new THREE.Line(lineGeo, lineMat);
    centerLine.renderOrder = 47;
    centerLine.userData = { isRadiationRiskMarker: true, isRadiationSectionCenterLine: true };
    group.add(centerLine);

    group.userData = {
        isRadiationSectionPlaneGroup: true,
        pickTargets: [plane]
    };

    return group;
}

function applySectionFocusTintToItems(furnace, scoreMap, entry, sectionInfo) {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !furnace || !entry?.item || !sectionInfo) return;

    const itemMap = new Map((furnace.packedItems || []).map(item => [item.id, item]));
    const selectedId = entry.item.id;
    const blockerIds = new Set((entry.blockers || []).map(b => b.item?.id).filter(Boolean));
    const axis = sectionInfo.axis || 'z';
    const planeCoord = Number(sectionInfo.planeCoord || 0);
    const focusBand = Math.max(1, sectionInfo.focusBand || 140);

    group.traverse(child => {
        if (!child.isMesh || !child.userData || !child.userData.itemId) return;
        const itemId = child.userData.itemId;
        const item = itemMap.get(itemId);
        const score = scoreMap.get(itemId)?.score ?? 0.55;
        const c = item ? getItemCenterWorld(item, furnace) : new THREE.Vector3();
        const distance = Math.abs(c[axis] - planeCoord);
        const nearPlane = distance <= focusBand;
        const isSelected = itemId === selectedId;
        const isBlocker = blockerIds.has(itemId);

        let tint = getRadiationScoreColor(score);
        let opacity = nearPlane ? 0.42 : 0.18;
        let emissiveScale = nearPlane ? 0.16 : 0.06;
        let emissiveIntensity = nearPlane ? 0.12 : 0.05;

        if (isSelected) {
            tint = new THREE.Color(0xfacc15);
            opacity = 0.98;
            emissiveScale = 0.75;
            emissiveIntensity = 0.72;
        } else if (isBlocker) {
            tint = new THREE.Color(0xff1744);
            opacity = 0.78;
            emissiveScale = 0.58;
            emissiveIntensity = 0.48;
        }

        getMeshMaterials(child).forEach(mat => {
            if (!mat.color) return;
            saveOriginalMaterialIfNeeded(mat);
            mat.color.copy(tint);
            if (mat.emissive) {
                mat.emissive.copy(tint);
                mat.emissive.multiplyScalar(emissiveScale);
                mat.emissiveIntensity = emissiveIntensity;
            }
            mat.transparent = true;
            mat.opacity = opacity;
            mat.needsUpdate = true;
        });
    });

    applyRadiationClipPlaneToCurrentFurnace(sectionInfo);
}


// ---------- 介质场：气流冷却 v2 ----------
const AIRFLOW_DIRECTION_KEYS = ['x+', 'x-', 'y+', 'y-', 'z+', 'z-'];

function normalizeAirflowDirections(value) {
    const raw = Array.isArray(value) ? value : [value || 'z+'];
    const result = [];
    raw.forEach(v => {
        const meta = getAirflowDirectionMeta(v);
        if (meta && !result.includes(meta.key)) result.push(meta.key);
    });
    return result.length ? result : ['z+'];
}

const AIRFLOW_GAS_TYPES = {
    n2: {
        key: 'n2',
        label: '高压氮气 N₂',
        shortLabel: 'N₂',
        pressureLabel: '6–10 bar',
        densityHint: '标准气淬介质，综合成本低，适合大多数真空淬火。',
        speedScale: 1.00,
        coolingBias: 0.00,
        fastColor: 0x7dd3fc,
        slowColor: 0xfb923c
    },
    ar: {
        key: 'ar',
        label: '氩气 Ar',
        shortLabel: 'Ar',
        pressureLabel: '4–8 bar',
        densityHint: '惰性更强，冷却能力相对较弱，适合更保守的保护气氛。',
        speedScale: 0.82,
        coolingBias: -0.04,
        fastColor: 0x93c5fd,
        slowColor: 0xf59e0b
    },
    he: {
        key: 'he',
        label: '氦气 He',
        shortLabel: 'He',
        pressureLabel: '8–15 bar',
        densityHint: '导热能力强、成本高，适合高冷却强度或高附加值工件。',
        speedScale: 1.22,
        coolingBias: 0.05,
        fastColor: 0xa5f3fc,
        slowColor: 0xfbbf24
    }
};

function getAirflowGasMeta(gasType = 'n2') {
    const key = String(gasType || 'n2').toLowerCase();
    return AIRFLOW_GAS_TYPES[key] || AIRFLOW_GAS_TYPES.n2;
}

function getAirflowSpeedColor(speedFactor = 1, gasType = thermalSimRuntime.selectedAirflowGasType || 'n2') {
    const gas = getAirflowGasMeta(gasType);
    const slow = new THREE.Color(gas.slowColor);
    const fast = new THREE.Color(gas.fastColor);
    return new THREE.Color().lerpColors(slow, fast, clamp01(speedFactor));
}

function getAirflowScoreColor(score) {
    const low = new THREE.Color(0x7f1d1d);
    const bad = new THREE.Color(0xef4444);
    const mid = new THREE.Color(0xf97316);
    const good = new THREE.Color(0x38bdf8);
    const high = new THREE.Color(0x7dd3fc);
    const c = new THREE.Color();
    const s = clamp01(score);
    if (s < 0.34) c.lerpColors(low, bad, s / 0.34);
    else if (s < 0.62) c.lerpColors(bad, mid, (s - 0.34) / 0.28);
    else if (s < 0.84) c.lerpColors(mid, good, (s - 0.62) / 0.22);
    else c.lerpColors(good, high, (s - 0.84) / 0.16);
    return c;
}

function getAirflowDirectionMeta(directionKey = 'z+') {
    const key = String(directionKey || 'z+').toLowerCase();
    const table = {
        'x+': { key: 'x+', axis: 'x', sign: 1, label: '+X → 右侧', shortLabel: '+X', sideLabel: '右侧', inletLabel: '左侧进风', outletLabel: '右侧出风' },
        'x-': { key: 'x-', axis: 'x', sign: -1, label: '-X → 左侧', shortLabel: '-X', sideLabel: '左侧', inletLabel: '右侧进风', outletLabel: '左侧出风' },
        'y+': { key: 'y+', axis: 'y', sign: 1, label: '+Y → 上层', shortLabel: '+Y', sideLabel: '上层', inletLabel: '底部进风', outletLabel: '顶部出风' },
        'y-': { key: 'y-', axis: 'y', sign: -1, label: '-Y → 下层', shortLabel: '-Y', sideLabel: '下层', inletLabel: '顶部进风', outletLabel: '底部出风' },
        'z+': { key: 'z+', axis: 'z', sign: 1, label: '+Z → 后侧', shortLabel: '+Z', sideLabel: '后侧', inletLabel: '前侧进风', outletLabel: '后侧出风' },
        'z-': { key: 'z-', axis: 'z', sign: -1, label: '-Z → 前侧', shortLabel: '-Z', sideLabel: '前侧', inletLabel: '后侧进风', outletLabel: '前侧出风' }
    };
    return table[key] || table['z+'];
}

function getAirflowAxisBounds(furnace, axis) {
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    if (axis === 'x') return { min: -fw / 2, max: fw / 2, span: fw };
    if (axis === 'y') return { min: THERMAL_BASE_Y, max: THERMAL_BASE_Y + fh, span: fh };
    return { min: -fd / 2, max: fd / 2, span: fd };
}

function getAirflowNormal(meta) {
    if (meta.axis === 'x') return new THREE.Vector3(meta.sign, 0, 0);
    if (meta.axis === 'y') return new THREE.Vector3(0, meta.sign, 0);
    return new THREE.Vector3(0, 0, meta.sign);
}

function makeAirflowInletPoint(targetPoint, furnace, meta) {
    const p = targetPoint.clone();
    const b = getAirflowAxisBounds(furnace, meta.axis);
    p[meta.axis] = meta.sign > 0 ? b.min : b.max;
    return p;
}

function makeAirflowOutletPoint(targetPoint, furnace, meta) {
    const p = targetPoint.clone();
    const b = getAirflowAxisBounds(furnace, meta.axis);
    p[meta.axis] = meta.sign > 0 ? b.max : b.min;
    return p;
}

function getItemAirflowSamplePoints(item, furnace, meta) {
    const b = getItemWorldBox(item, furnace);
    const center = getItemCenterWorld(item, furnace);
    const axis = meta.axis;
    const upstreamCoord = meta.sign > 0
        ? (axis === 'x' ? b.minX : axis === 'y' ? b.minY : b.minZ)
        : (axis === 'x' ? b.maxX : axis === 'y' ? b.maxY : b.maxZ);

    const pts = [center.clone()];
    const face = center.clone();
    face[axis] = upstreamCoord;
    pts.push(face);

    if (axis !== 'x') {
        pts.push(new THREE.Vector3(b.minX, center.y, center.z));
        pts.push(new THREE.Vector3(b.maxX, center.y, center.z));
    }
    if (axis !== 'y') {
        pts.push(new THREE.Vector3(center.x, b.minY, center.z));
        pts.push(new THREE.Vector3(center.x, b.maxY, center.z));
    }
    if (axis !== 'z') {
        pts.push(new THREE.Vector3(center.x, center.y, b.minZ));
        pts.push(new THREE.Vector3(center.x, center.y, b.maxZ));
    }
    return pts.slice(0, 6);
}

function getAirflowBlockers(sourcePoint, targetPoint, targetItem, allItems, furnace) {
    const blockers = [];
    for (const other of allItems) {
        if (!other || other.id === targetItem.id) continue;
        const box = getItemWorldBox(other, furnace);
        if (segmentIntersectsBox(sourcePoint, targetPoint, box)) blockers.push(other);
    }
    return blockers;
}

function calculateSingleAirflowCoolingScores(furnace, directionKey = 'z+') {
    const items = furnace.packedItems || [];
    const result = new Map();
    const meta = getAirflowDirectionMeta(directionKey);
    if (!items.length) return { scores: result, directionMeta: meta };

    items.forEach(item => {
        const samples = getItemAirflowSamplePoints(item, furnace, meta);
        let total = 0;
        let reached = 0;
        let blocked = 0;
        const openPaths = [];
        const blockedPaths = [];
        const blockerMap = new Map();

        samples.forEach(target => {
            const source = makeAirflowInletPoint(target, furnace, meta);
            total += 1;
            const blockers = getAirflowBlockers(source, target, item, items, furnace);
            if (blockers.length > 0) {
                blocked += 1;
                blockers.forEach(blocker => {
                    const existed = blockerMap.get(blocker.id) || { item: blocker, count: 0 };
                    existed.count += 1;
                    blockerMap.set(blocker.id, existed);
                });
                if (blockedPaths.length < 8) {
                    const rawPoints = buildAirflowDetourPoints(source, target, blockers[0], furnace, meta);
                    const speedFactor = Math.max(0.25, 1 - Math.min(0.65, blockers.length * 0.18) - (blockers[0] ? Math.cbrt(Math.max(1, (blockers[0].w || 1) * (blockers[0].h || 1) * (blockers[0].d || 1))) / 2200 : 0));
                    blockedPaths.push({
                        source: source.clone(),
                        target: target.clone(),
                        points: buildSmoothAirflowPath(rawPoints, 22, furnace),
                        blocked: true,
                        blockers: blockers.map(b => ({ id: b.id, name: b.name || '背风遮挡件' })),
                        directionKey: meta.key,
                        speedFactor
                    });
                }
            } else {
                const itemVolume = Math.max(1, Number((item.w || 1) * (item.h || 1) * (item.d || 1)));
                const massPenalty = Math.min(0.18, Math.cbrt(itemVolume) / 1800);
                reached += Math.max(0.72, 1 - massPenalty);
                if (openPaths.length < 8) {
                    openPaths.push({
                        source: source.clone(),
                        target: target.clone(),
                        points: buildSmoothAirflowPath([source.clone(), target.clone()], 10, furnace),
                        blocked: false,
                        blockers: [],
                        directionKey: meta.key,
                        speedFactor: 1
                    });
                }
            }
        });

        const raw = total > 0 ? reached / total : 0;
        const thermalRisk = estimateItemThermalRisk(item, furnace);
        const score = clamp01(raw * (1 - thermalRisk * 0.22));
        const blockers = [...blockerMap.values()].sort((a, b) => b.count - a.count);
        result.set(item.id, {
            item,
            score,
            visibleFlowCount: Math.round(reached),
            blockedFlowCount: Math.round(blocked),
            totalFlowWeight: Math.round(total),
            rays: [...openPaths.slice(0, 4), ...blockedPaths.slice(0, 4)],
            openPaths,
            blockedPaths,
            blockers,
            directionKey: meta.key
        });
    });

    return { scores: result, directionMeta: meta };
}

function calculateAirflowCoolingScores(furnace, directionKeys = ['z+']) {
    const directions = normalizeAirflowDirections(directionKeys);
    const metas = directions.map(getAirflowDirectionMeta);
    const perDirection = metas.map(meta => calculateSingleAirflowCoolingScores(furnace, meta.key));
    const items = furnace.packedItems || [];
    const result = new Map();

    items.forEach(item => {
        let productMiss = 1;
        let visibleFlowCount = 0;
        let blockedFlowCount = 0;
        let totalFlowWeight = 0;
        const openPaths = [];
        const blockedPaths = [];
        const blockerMap = new Map();
        const directionScores = [];

        perDirection.forEach(({ scores, directionMeta }) => {
            const entry = scores.get(item.id);
            if (!entry) return;
            productMiss *= (1 - clamp01(entry.score) * 0.96);
            visibleFlowCount += entry.visibleFlowCount || 0;
            blockedFlowCount += entry.blockedFlowCount || 0;
            totalFlowWeight += entry.totalFlowWeight || 0;
            directionScores.push({ key: directionMeta.key, score: entry.score });
            (entry.openPaths || []).slice(0, 3).forEach(p => openPaths.push(p));
            (entry.blockedPaths || []).slice(0, 3).forEach(p => blockedPaths.push(p));
            (entry.blockers || []).forEach(({ item: blockerItem, count }) => {
                if (!blockerItem) return;
                const existed = blockerMap.get(blockerItem.id) || { item: blockerItem, count: 0 };
                existed.count += count || 1;
                blockerMap.set(blockerItem.id, existed);
            });
        });

        const gasMeta = getAirflowGasMeta(thermalSimRuntime.selectedAirflowGasType || 'n2');
        const score = clamp01((1 - productMiss) + gasMeta.coolingBias);
        const blockers = [...blockerMap.values()].sort((a, b) => b.count - a.count);
        result.set(item.id, {
            item,
            score,
            visibleFlowCount: Math.round(visibleFlowCount),
            blockedFlowCount: Math.round(blockedFlowCount),
            totalFlowWeight: Math.round(totalFlowWeight),
            rays: [...openPaths.slice(0, 5), ...blockedPaths.slice(0, 5)],
            openPaths,
            blockedPaths,
            blockers,
            directionKey: directions.join(','),
            directionScores
        });

        item.simulation = {
            ...(item.simulation || {}),
            airflowCoolingScore: Math.round(score * 100),
            visibleFlowCount: Math.round(visibleFlowCount),
            blockedFlowCount: Math.round(blockedFlowCount),
            airflowBlockerCount: blockers.length,
            airflowDirections: directions
        };
    });

    return { scores: result, directionMetas: metas, directionMeta: metas[0] };
}

function calculateAirflowCoolingMetrics(furnace, scoreMap, directionMetas) {
    const metas = Array.isArray(directionMetas) ? directionMetas : [directionMetas].filter(Boolean);
    const scores = [...scoreMap.values()];
    const avgScore = scores.length ? scores.reduce((s, v) => s + v.score, 0) / scores.length : 0;
    const minScore = scores.length ? Math.min(...scores.map(v => v.score)) : 0;
    const leewardItems = scores.filter(v => v.score < 0.60).length;
    const severeLeewardItems = scores.filter(v => v.score < 0.42).length;
    const blockedFlowPathCount = scores.reduce((s, v) => s + (v.blockedFlowCount || 0), 0);
    const sorted = [...scores].sort((a, b) => a.score - b.score);
    const worst = sorted[0];
    const denseItems = (furnace.packedItems || []).length;
    const furnaceVolume = Math.max(1, (furnace.w || 1) * (furnace.h || 1) * (furnace.d || 1));
    const packedVolume = (furnace.packedItems || []).reduce((sum, item) => sum + (item.w || 0) * (item.h || 0) * (item.d || 0), 0);
    const densityRate = Math.round((packedVolume / furnaceVolume) * 1000) / 10;
    const directions = metas.map(m => m.key);
    const directionLabel = metas.map(m => m.label).join(' + ') || '+Z → 后侧';
    const inletLabel = metas.map(m => m.inletLabel).join(' / ') || '前侧进风';
    const outletLabel = metas.map(m => m.outletLabel).join(' / ') || '后侧出风';
    const gasMeta = getAirflowGasMeta(thermalSimRuntime.selectedAirflowGasType || 'n2');
    return {
        mode: 'airflow',
        processName: VACUUM_QUENCH_PROFILE.processName,
        gasType: gasMeta.key,
        gasLabel: gasMeta.label,
        gasShortLabel: gasMeta.shortLabel,
        gasPressureLabel: gasMeta.pressureLabel,
        gasDensityHint: gasMeta.densityHint,
        airflowDirection: directions[0] || 'z+',
        airflowDirections: directions,
        airflowDirectionLabel: directionLabel,
        inletLabel,
        outletLabel,
        airflowModeLabel: directions.length > 1 ? `多入口环流 · ${directions.length} 个入口` : '单向进出',
        animationSemantics: 'loop',
        flowCycleLabel: '循环流线，不代表冷却完成度',
        coolingReachability: Math.round(avgScore * 100),
        minCoolingReachability: Math.round(minScore * 100),
        leewardItemCount: leewardItems,
        severeLeewardItemCount: severeLeewardItems,
        blockedFlowPathCount,
        worstItemName: worst?.item?.name || '-',
        coolingUniformityScore: Math.max(45, Math.round(94 - (avgScore ? (1 - avgScore) * 42 : 18) - densityRate * 0.18 - severeLeewardItems * 2.5)),
        densityRate,
        packedItemCount: denseItems,
        animationPlaying: thermalSimRuntime.activeMode === 'airflow' && !!thermalSimRuntime.isPlaying && !thermalSimRuntime.paused,
        suggestion: severeLeewardItems > 0
            ? '存在明显背风冷却区域，建议增加中心通道，或将厚大件/遮挡件向外侧分散；可开启多入口气流复核是否仍有死区。'
            : (leewardItems > 0 ? '存在局部背风件，可优先复核中部密集区、上层遮挡和气流入口方向；多方向进气可缓解单侧遮挡。' : '当前装炉的气流可达性较好，未发现明显背风高风险。')
    };
}

function buildAirflowSourceVisual(furnace, directionMetas) {
    const metas = Array.isArray(directionMetas) ? directionMetas : [directionMetas].filter(Boolean);
    const group = new THREE.Group();
    group.name = 'airflowCoolingSourceVisual';
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);

    metas.forEach(directionMeta => {
        const axis = directionMeta.axis;
        const bounds = getAirflowAxisBounds(furnace, axis);
        const inletCoord = directionMeta.sign > 0 ? bounds.min : bounds.max;
        const outletCoord = directionMeta.sign > 0 ? bounds.max : bounds.min;
        const normal = getAirflowNormal(directionMeta);
        const inletMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: metas.length > 1 ? 0.08 : 0.12, side: THREE.DoubleSide, depthWrite: false });
        const outletMat = new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: metas.length > 1 ? 0.035 : 0.06, side: THREE.DoubleSide, depthWrite: false });
        let inletPlane, outletPlane;
        if (axis === 'x') {
            inletPlane = new THREE.Mesh(new THREE.PlaneGeometry(fd, fh), inletMat);
            outletPlane = new THREE.Mesh(new THREE.PlaneGeometry(fd, fh), outletMat);
            inletPlane.rotation.y = Math.PI / 2;
            outletPlane.rotation.y = Math.PI / 2;
            inletPlane.position.set(inletCoord, THERMAL_BASE_Y + fh / 2, 0);
            outletPlane.position.set(outletCoord, THERMAL_BASE_Y + fh / 2, 0);
        } else if (axis === 'y') {
            inletPlane = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), inletMat);
            outletPlane = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), outletMat);
            inletPlane.rotation.x = -Math.PI / 2;
            outletPlane.rotation.x = -Math.PI / 2;
            inletPlane.position.set(0, inletCoord, 0);
            outletPlane.position.set(0, outletCoord, 0);
        } else {
            inletPlane = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), inletMat);
            outletPlane = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), outletMat);
            inletPlane.position.set(0, THERMAL_BASE_Y + fh / 2, inletCoord);
            outletPlane.position.set(0, THERMAL_BASE_Y + fh / 2, outletCoord);
        }
        inletPlane.renderOrder = 8;
        outletPlane.renderOrder = 7;
        group.add(inletPlane, outletPlane);

        const nozzlePos = axis === 'x'
            ? new THREE.Vector3(inletCoord, THERMAL_BASE_Y + fh * 0.52, 0)
            : (axis === 'y'
                ? new THREE.Vector3(0, inletCoord, 0)
                : new THREE.Vector3(0, THERMAL_BASE_Y + fh * 0.52, inletCoord));
        group.add(createProcessNozzleVisual(nozzlePos, normal, 0x38bdf8, metas.length > 1 ? '气流入口' : '进气风机 / 喷嘴', {
            name: 'airflowInletNozzle',
            radius: Math.max(22, Math.min(38, Math.min(fw, fd) / 22)),
            length: Math.max(70, Math.min(120, Math.max(fw, fh, fd) / 8)),
            opacity: 0.76,
            labelWidth: 190,
            labelOffset: new THREE.Vector3(0, 54, 0)
        }));

        const arrowCountA = metas.length > 2 ? 3 : 4;
        const arrowCountB = 3;
        const arrowLen = Math.max(90, Math.min(180, Math.max(fw, fh, fd) / 6));
        for (let a = 0; a < arrowCountA; a++) {
            for (let b = 0; b < arrowCountB; b++) {
                const u = arrowCountA === 1 ? 0.5 : a / (arrowCountA - 1);
                const v = arrowCountB === 1 ? 0.5 : b / (arrowCountB - 1);
                let pos;
                if (axis === 'x') pos = new THREE.Vector3(inletCoord, THERMAL_BASE_Y + fh * (0.22 + v * 0.58), -fd * 0.35 + u * fd * 0.7);
                else if (axis === 'y') pos = new THREE.Vector3(-fw * 0.35 + u * fw * 0.7, inletCoord, -fd * 0.30 + v * fd * 0.6);
                else pos = new THREE.Vector3(-fw * 0.35 + u * fw * 0.7, THERMAL_BASE_Y + fh * (0.22 + v * 0.58), inletCoord);
                const arrow = new THREE.ArrowHelper(normal, pos, arrowLen, 0x38bdf8, arrowLen * 0.26, arrowLen * 0.13);
                arrow.userData = { isThermalRays: true, isAirflowArrow: true };
                group.add(arrow);
            }
        }
    });

    group.userData = { isAirflowSourceVisual: true, directions: metas.map(m => m.key) };
    return group;
}

function buildAirflowCoolingRays(scoreMap) {
    const entries = [...scoreMap.values()].sort((a, b) => a.score - b.score);
    const selected = [...entries.slice(0, 16), ...entries.slice(-6)];
    const positions = [];
    const colors = [];
    const cyan = new THREE.Color(0x67e8f9);
    const blue = new THREE.Color(0x38bdf8);
    const red = new THREE.Color(0xef4444);
    const orange = new THREE.Color(0xfb923c);
    selected.forEach(entry => {
        (entry.rays || []).slice(0, 6).forEach(path => {
            const pts = (path.points && path.points.length >= 2)
                ? path.points
                : buildSmoothAirflowPath([path.source, path.target], path.blocked ? 22 : 10, null);
            const speedFactor = path.speedFactor != null ? path.speedFactor : (path.blocked ? 0.42 : 1);
            const c = path.blocked ? getAirflowSpeedColor(speedFactor) : (entry.score > 0.74 ? cyan : blue);
            const c2 = path.blocked ? orange : c;
            for (let i = 0; i < pts.length - 1; i++) {
                const a = pts[i];
                const b = pts[i + 1];
                positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
                colors.push(c.r, c.g, c.b, c2.r, c2.g, c2.b);
            }
        });
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const rays = new THREE.LineSegments(geometry, material);
    rays.name = 'airflowCoolingPaths';
    rays.userData = { isThermalRays: true, isAirflowCoolingRays: true };
    return rays;
}

function getAirflowCrossAxes(axis) {
    return ['x', 'y', 'z'].filter(a => a !== axis);
}

function makeInflatedBox(item, furnace, pad = 16) {
    const b = getItemWorldBox(item, furnace);
    return {
        minX: b.minX - pad,
        maxX: b.maxX + pad,
        minY: b.minY - pad,
        maxY: b.maxY + pad,
        minZ: b.minZ - pad,
        maxZ: b.maxZ + pad
    };
}

function getBoxCenter(box) {
    return new THREE.Vector3((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
}

function getBoxAxis(box, axis, side) {
    if (axis === 'x') return side < 0 ? box.minX : box.maxX;
    if (axis === 'y') return side < 0 ? box.minY : box.maxY;
    return side < 0 ? box.minZ : box.maxZ;
}

function clampPointToFurnaceVolume(p, furnace, margin = 20) {
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    p.x = Math.max(-fw / 2 + margin, Math.min(fw / 2 - margin, p.x));
    p.y = Math.max(THERMAL_BASE_Y + margin, Math.min(THERMAL_BASE_Y + fh - margin, p.y));
    p.z = Math.max(-fd / 2 + margin, Math.min(fd / 2 - margin, p.z));
    return p;
}

function findFirstAirflowCollision(source, outlet, furnace, meta) {
    const axis = meta.axis;
    const items = furnace.packedItems || [];
    let best = null;
    items.forEach(item => {
        const box = makeInflatedBox(item, furnace, 18);
        if (!segmentIntersectsBox(source, outlet, box)) return;
        const c = getBoxCenter(box);
        const distanceAlong = meta.sign > 0 ? (c[axis] - source[axis]) : (source[axis] - c[axis]);
        if (distanceAlong < 0) return;
        if (!best || distanceAlong < best.distanceAlong) best = { item, box, distanceAlong };
    });
    return best;
}

function buildDeflectedAirflowPath(source, outlet, furnace, meta) {
    const hit = findFirstAirflowCollision(source, outlet, furnace, meta);
    if (!hit) return { points: buildSmoothAirflowPath([source.clone(), outlet.clone()], 10, furnace), blocked: false, speedFactor: 1 };

    const axis = meta.axis;
    const crossAxes = getAirflowCrossAxes(axis);
    const box = hit.box;
    const center = getBoxCenter(box);
    const lineSpan = Math.max(1, Math.abs(outlet[axis] - source[axis]));
    const before = source.clone().lerp(outlet, clamp01((hit.distanceAlong - 50) / lineSpan));
    const after = source.clone().lerp(outlet, clamp01((hit.distanceAlong + 90) / lineSpan));

    const primarySideAxis = crossAxes.sort((a, b) => Math.abs(source[b] - center[b]) - Math.abs(source[a] - center[a]))[0];
    const sideSign = source[primarySideAxis] < center[primarySideAxis] ? -1 : 1;
    const detourCoord = getBoxAxis(box, primarySideAxis, sideSign) + sideSign * 58;

    const p1 = before.clone();
    const p2 = before.clone();
    const p3 = after.clone();
    const p4 = after.clone();
    p2[primarySideAxis] = detourCoord;
    p3[primarySideAxis] = detourCoord;
    clampPointToFurnaceVolume(p1, furnace);
    clampPointToFurnaceVolume(p2, furnace);
    clampPointToFurnaceVolume(p3, furnace);
    clampPointToFurnaceVolume(p4, furnace);

    const rawPoints = [source.clone(), p1, p2, p3, p4, outlet.clone()];
    return {
        points: buildSmoothAirflowPath(rawPoints, 28, furnace),
        blocked: true,
        blocker: hit.item,
        deflectAxis: primarySideAxis,
        speedFactor: estimateAirflowPathSpeedFactor(hit.item, furnace, 1)
    };
}


function buildAirflowDetourPoints(source, target, blockerItem, furnace, meta) {
    if (!blockerItem) return [source.clone(), target.clone()];
    const blockerCenter = getItemCenterWorld(blockerItem, furnace);
    const mainDir = target.clone().sub(source);
    if (mainDir.lengthSq() < 1e-6) return [source.clone(), target.clone()];
    mainDir.normalize();

    const crossAxes = getAirflowCrossAxes(meta.axis);
    const primaryAxis = crossAxes.sort((a, b) => Math.abs(source[b] - blockerCenter[b]) - Math.abs(source[a] - blockerCenter[a]))[0];
    const sideSign = source[primaryAxis] < blockerCenter[primaryAxis] ? -1 : 1;
    const detourDistance = Math.max(
        70,
        Math.min(220, Math.max(blockerItem.w || 0, blockerItem.h || 0, blockerItem.d || 0) * 0.72 + 40)
    );

    const before = blockerCenter.clone().sub(mainDir.clone().multiplyScalar(detourDistance * 0.82));
    const around = blockerCenter.clone();
    around[primaryAxis] += sideSign * detourDistance;
    const after = blockerCenter.clone().add(mainDir.clone().multiplyScalar(detourDistance * 0.92));
    [before, around, after].forEach(p => clampPointToFurnaceVolume(p, furnace));
    return [source.clone(), before, around, after, target.clone()];
}

function buildSmoothAirflowPath(points, segments = 20, furnace = null) {
    if (!points || points.length < 2) return points || [];
    const raw = points.map(p => p.clone ? p.clone() : new THREE.Vector3(p.x, p.y, p.z));
    if (raw.length === 2) return raw;
    const curve = new THREE.CatmullRomCurve3(raw);
    curve.curveType = 'catmullrom';
    curve.tension = 0.32;
    const smooth = curve.getPoints(Math.max(8, segments));
    if (furnace) smooth.forEach(p => clampPointToFurnaceVolume(p, furnace, 12));
    return smooth;
}

function estimateAirflowPathSpeedFactor(blockerItem, furnace, base = 1) {
    if (!blockerItem) return base;
    const volume = Math.max(1, (blockerItem.w || 1) * (blockerItem.h || 1) * (blockerItem.d || 1));
    const sizePenalty = Math.min(0.34, Math.cbrt(volume) / 1400);
    return Math.max(0.28, Math.min(1, base - 0.28 - sizePenalty));
}

function createAirflowSeedPointsForDirection(furnace, meta) {
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    const axis = meta.axis;
    const bounds = getAirflowAxisBounds(furnace, axis);
    const inletCoord = meta.sign > 0 ? bounds.min : bounds.max;
    const seeds = [];
    const countA = 5;
    const countB = 4;
    for (let a = 0; a < countA; a++) {
        for (let b = 0; b < countB; b++) {
            const u = countA === 1 ? 0.5 : a / (countA - 1);
            const v = countB === 1 ? 0.5 : b / (countB - 1);
            let p;
            if (axis === 'x') p = new THREE.Vector3(inletCoord, THERMAL_BASE_Y + fh * (0.16 + v * 0.68), -fd * 0.40 + u * fd * 0.80);
            else if (axis === 'y') p = new THREE.Vector3(-fw * 0.40 + u * fw * 0.80, inletCoord, -fd * 0.38 + v * fd * 0.76);
            else p = new THREE.Vector3(-fw * 0.40 + u * fw * 0.80, THERMAL_BASE_Y + fh * (0.16 + v * 0.68), inletCoord);
            seeds.push(p);
        }
    }
    return seeds;
}

function buildAirflowStreamlineField(furnace, directionMetas) {
    const metas = Array.isArray(directionMetas) ? directionMetas : [directionMetas].filter(Boolean);
    const group = new THREE.Group();
    group.name = 'airflowStreamlineField';
    const linePositions = [];
    const lineColors = [];
    const paths = [];
    const clearColor = new THREE.Color(0x7dd3fc);
    const weakColor = new THREE.Color(0xfb923c);

    metas.forEach((meta, mi) => {
        const seeds = createAirflowSeedPointsForDirection(furnace, meta);
        seeds.forEach((source, si) => {
            const outlet = makeAirflowOutletPoint(source, furnace, meta);
            const path = buildDeflectedAirflowPath(source, outlet, furnace, meta);
            const speedFactor = path.speedFactor != null ? path.speedFactor : (path.blocked ? 0.55 : 1);
            const colorA = path.blocked ? getAirflowSpeedColor(speedFactor) : clearColor;
            const colorB = path.blocked ? new THREE.Color(0xef4444) : new THREE.Color(0x38bdf8);
            for (let i = 0; i < path.points.length - 1; i++) {
                const a = path.points[i];
                const b = path.points[i + 1];
                linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
                lineColors.push(colorA.r, colorA.g, colorA.b, colorB.r, colorB.g, colorB.b);
            }
            paths.push({
                ...prepareAirflowPath(path.points),
                blocked: path.blocked,
                directionKey: meta.key,
                speed: (path.speedFactor != null ? path.speedFactor : (path.blocked ? 0.55 : 1)) * getAirflowGasMeta(thermalSimRuntime.selectedAirflowGasType || 'n2').speedScale,
                speedFactor: path.speedFactor != null ? path.speedFactor : (path.blocked ? 0.55 : 1),
                phase: ((si * 0.137) + (mi * 0.211)) % 1
            });
        });
    });

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.46, depthWrite: false, blending: THREE.AdditiveBlending });
    const lineSegments = new THREE.LineSegments(lineGeo, lineMat);
    lineSegments.name = 'airflowDeflectedStreamlines';
    lineSegments.userData = { isAirflowStreamline: true, isThermalRays: true };
    group.add(lineSegments);

    const particleCount = Math.min(180, Math.max(48, paths.length * 3));
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        const path = paths[i % paths.length];
        const color = getAirflowSpeedColor(path?.speedFactor != null ? path.speedFactor : (path?.blocked ? 0.48 : 1));
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const pMat = new THREE.PointsMaterial({
        size: Math.max(18, Math.min(34, Math.min(Number(furnace.w || 600), Number(furnace.d || 600)) / 24)),
        transparent: true,
        opacity: 0.96,
        vertexColors: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        map: createThermalParticleTexture()
    });
    const particles = new THREE.Points(pGeo, pMat);
    particles.name = 'airflowMovingParticles';
    particles.renderOrder = 42;
    particles.userData = { isAirflowParticles: true, paths, particleCount };
    group.add(particles);
    thermalSimRuntime.airflowParticles = particles;
    thermalSimRuntime.pointCloud = particles;
    updateAirflowParticles(performance.now(), true);

    group.userData = { isAirflowStreamGroup: true, paths };
    return group;
}

function prepareAirflowPath(points) {
    const cloned = (points || []).map(p => p.clone());
    const cumulativeLengths = [0];
    let totalLength = 0;
    for (let i = 0; i < cloned.length - 1; i++) {
        totalLength += cloned[i].distanceTo(cloned[i + 1]);
        cumulativeLengths.push(totalLength);
    }
    return { points: cloned, cumulativeLengths, totalLength };
}

function sampleAirflowPathInto(pathOrPoints, t, target) {
    const points = pathOrPoints?.points || pathOrPoints || [];
    if (!points.length) return target.set(0, 0, 0);
    if (points.length === 1) return target.copy(points[0]);

    const cumulative = pathOrPoints?.cumulativeLengths;
    const total = Number(pathOrPoints?.totalLength || 0);
    if (Array.isArray(cumulative) && cumulative.length === points.length && total > 1e-6) {
        const wrapped = ((t % 1) + 1) % 1;
        const targetDistance = wrapped * total;
        for (let i = 0; i < cumulative.length - 1; i++) {
            const a = cumulative[i];
            const b = cumulative[i + 1];
            if (targetDistance <= b) {
                const local = b - a <= 1e-6 ? 0 : (targetDistance - a) / (b - a);
                return target.copy(points[i]).lerp(points[i + 1], local);
            }
        }
        return target.copy(points[points.length - 1]);
    }

    return target.copy(sampleAirflowPath(points, t));
}

function sampleAirflowPath(points, t) {
    if (!points || points.length === 0) return new THREE.Vector3();
    if (points.length === 1) return points[0].clone();
    const lens = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const len = points[i].distanceTo(points[i + 1]);
        lens.push(len);
        total += len;
    }
    if (total <= 1e-6) return points[0].clone();
    let target = ((t % 1) + 1) % 1 * total;
    for (let i = 0; i < lens.length; i++) {
        if (target <= lens[i]) {
            const local = lens[i] <= 1e-6 ? 0 : target / lens[i];
            return points[i].clone().lerp(points[i + 1], local);
        }
        target -= lens[i];
    }
    return points[points.length - 1].clone();
}

function updateAirflowParticles(now, force = false) {
    const particles = thermalSimRuntime.airflowParticles;
    if (!particles || !particles.geometry || !particles.userData?.isAirflowParticles) return;
    const paths = particles.userData.paths || [];
    if (!paths.length) return;
    if (!force && (!thermalSimRuntime.isPlaying || thermalSimRuntime.paused || thermalSimRuntime.activeMode !== 'airflow')) return;

    // UX V2.4：粒子层恢复接近 RAF 的顺滑更新；路径采样已预计算，避免每帧分配大量 Vector3。
    if (!force && thermalSimRuntime.lastAirflowParticleUpdateAt && now - thermalSimRuntime.lastAirflowParticleUpdateAt < 16) {
        return;
    }
    thermalSimRuntime.lastAirflowParticleUpdateAt = now;

    if (!thermalSimRuntime.startedAt || force) thermalSimRuntime.startedAt = now;
    const elapsed = now - thermalSimRuntime.startedAt;
    const cycleMs = Math.max(800, Number(thermalSimRuntime.airflowCycleMs || 3600));
    const base = ((elapsed / cycleMs) % 1 + 1) % 1;
    thermalSimRuntime.progress = base;

    const pos = particles.geometry.getAttribute('position');
    const tmp = updateAirflowParticles._tmpVec || (updateAirflowParticles._tmpVec = new THREE.Vector3());
    for (let i = 0; i < particles.userData.particleCount; i++) {
        const path = paths[i % paths.length];
        const laneOffset = ((i / Math.max(1, particles.userData.particleCount)) * 0.93) % 1;
        const t = (base * (path.speed || 1) + (path.phase || 0) + laneOffset) % 1;
        const p = sampleAirflowPathInto(path, t, tmp);
        pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    if (particles.material) {
        particles.material.opacity = thermalSimRuntime.isPlaying ? 0.96 : 0.58;
        particles.material.needsUpdate = true;
    }
}

function buildAirflowRiskMarkers(furnace, scoreMap) {
    const group = new THREE.Group();
    group.name = 'airflowCoolingRiskMarkers';
    const sorted = [...scoreMap.values()].map(entry => ({ item: entry.item, risk: 1 - (entry.score || 0.5) })).sort((a, b) => b.risk - a.risk).slice(0, 10);
    sorted.forEach(({ item, risk }) => {
        if (risk < 0.32) return;
        const geometry = new THREE.BoxGeometry((item.w || 1) + 18, (item.h || 1) + 18, (item.d || 1) + 18);
        const edges = new THREE.EdgesGeometry(geometry);
        const mat = new THREE.LineBasicMaterial({ color: risk > 0.58 ? 0xef4444 : 0xfb923c, transparent: true, opacity: 0.72 });
        const marker = new THREE.LineSegments(edges, mat);
        marker.position.copy(getItemCenterWorld(item, furnace));
        marker.userData = { isAirflowRiskMarker: true, isThermalRiskMarker: true, risk };
        group.add(marker);
    });
    return group;
}

function applyAirflowTintToItems(furnace, scoreMap) {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !furnace) return;
    group.traverse(child => {
        if (!child.isMesh || !child.userData || !child.userData.itemId) return;
        const entry = scoreMap.get(child.userData.itemId);
        const score = entry ? entry.score : 0.55;
        const tint = getAirflowScoreColor(score);
        getMeshMaterials(child).forEach(mat => {
            if (!mat.color) return;
            saveOriginalMaterialIfNeeded(mat);
            mat.color.copy(tint);
            if (mat.emissive) {
                mat.emissive.copy(tint);
                mat.emissive.multiplyScalar(score >= 0.70 ? 0.55 : 0.38);
                mat.emissiveIntensity = 0.12 + score * 0.36;
            }
            mat.transparent = true;
            mat.opacity = 0.58 + score * 0.36;
            mat.needsUpdate = true;
        });
    });
}

function buildSelectedRadiationMetric(furnace, scoreMap, entry) {
    const metrics = calculateRadiationMetrics(furnace, scoreMap);
    if (!entry) return metrics;
    const blockers = (entry.blockers || []).slice(0, 6).map(({ item, count }) => ({
        id: item?.id,
        name: item?.name || '遮挡工件',
        count
    }));
    const scorePercent = Math.round((entry.score || 0) * 100);
    const blocked = entry.blockedRayCount || 0;
    const visible = entry.visibleRayCount || 0;
    metrics.selectedItem = {
        id: entry.item?.id,
        name: entry.item?.name || '当前工件',
        material: entry.item?.material || '-',
        process: entry.item?.process || '-',
        score: scorePercent,
        visibleRayCount: visible,
        blockedRayCount: blocked,
        totalRayWeight: entry.totalRayWeight || 0,
        blockerCount: blockers.length,
        blockers,
        riskLevel: scorePercent < 45 ? '高' : (scorePercent < 65 ? '中' : '低'),
        suggestion: scorePercent < 45
            ? '该工件辐射可达性偏低，建议移向外圈/上层，或增加其周围间距。'
            : (scorePercent < 65 ? '该工件存在局部遮挡，建议优先复核红色遮挡件和相邻间距。' : '该工件辐射暴露较充分，当前无明显单件遮挡风险。')
    };
    return metrics;
}

function findItemIdFromObject(obj) {
    let cur = obj;
    while (cur) {
        if (cur.userData && cur.userData.itemId) return cur.userData.itemId;
        cur = cur.parent;
    }
    return null;
}


export function renderRadiationExposureSimulation() {
    const furnace = getCurrentThermalFurnace();
    if (!furnace) return null;

    clearThermalGroupChildren();
    restoreThermalItemMaterials();
    setThermalSceneTheme(true);

    const group = ensureThermalSimulationGroup();
    const equipmentContext = buildProcessEquipmentContext(furnace, 'radiation');
    if (equipmentContext) group.add(equipmentContext);
    const { scores, sources } = calculateRadiationExposureScores(furnace);
    const sourceVisual = buildRadiationHeatSourcesVisual(furnace, sources);
    const rays = buildRadiationExposureRays(scores);
    const riskMarkers = buildRiskMarkers(furnace, scores);

    group.add(sourceVisual);
    group.add(rays);
    group.add(riskMarkers);
    group.visible = true;

    applyRadiationTintToItems(furnace, scores);

    thermalSimRuntime.visible = true;
    thermalSimRuntime.activeMode = 'radiation';
    thermalSimRuntime.isPlaying = false;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.progress = 0;
    thermalSimRuntime.sourceGroup = sourceVisual;
    thermalSimRuntime.rayGroup = rays;
    thermalSimRuntime.riskGroup = riskMarkers;
    thermalSimRuntime.radiationScores = scores;
    thermalSimRuntime.selectedRadiationItemId = null;
    thermalSimRuntime.selectedRadiationEntry = null;
    thermalSimRuntime.selectedRadiationBatch = null;
    thermalSimRuntime.selectedRadiationSection = null;
    thermalSimRuntime.metrics = calculateRadiationMetrics(furnace, scores);
    return thermalSimRuntime.metrics;
}


export function renderAirflowCoolingSimulation(options = {}) {
    const furnace = getCurrentThermalFurnace();
    if (!furnace) return null;

    const keepPlaying = !!options.keepPlaying && thermalSimRuntime.activeMode === 'airflow' && thermalSimRuntime.isPlaying && !thermalSimRuntime.paused;
    clearThermalGroupChildren();
    restoreThermalItemMaterials();
    setThermalSceneTheme(true, 'airflow');

    if (options.gasType) thermalSimRuntime.selectedAirflowGasType = getAirflowGasMeta(options.gasType).key;
    const directionKeys = normalizeAirflowDirections(options.directionKeys || options.directions || options.directionKey || thermalSimRuntime.selectedAirflowDirections || thermalSimRuntime.selectedAirflowDirection || 'z+');
    const group = ensureThermalSimulationGroup();
    const equipmentContext = buildProcessEquipmentContext(furnace, 'airflow');
    if (equipmentContext) group.add(equipmentContext);
    const { scores, directionMetas } = calculateAirflowCoolingScores(furnace, directionKeys);
    const sourceVisual = buildAirflowSourceVisual(furnace, directionMetas);
    const rays = buildAirflowCoolingRays(scores);
    const streamGroup = buildAirflowStreamlineField(furnace, directionMetas);
    const riskMarkers = buildAirflowRiskMarkers(furnace, scores);
    const ringBoundary = buildRingThermalBoundary(furnace);

    group.add(sourceVisual);
    group.add(rays);
    group.add(streamGroup);
    group.add(riskMarkers);
    if (ringBoundary) group.add(ringBoundary);
    group.visible = true;

    applyAirflowTintToItems(furnace, scores);

    thermalSimRuntime.visible = true;
    thermalSimRuntime.activeMode = 'airflow';
    thermalSimRuntime.isPlaying = keepPlaying;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.progress = 0;
    thermalSimRuntime.startedAt = performance.now();
    thermalSimRuntime.sourceGroup = sourceVisual;
    thermalSimRuntime.rayGroup = rays;
    thermalSimRuntime.riskGroup = riskMarkers;
    thermalSimRuntime.airflowStreamGroup = streamGroup;
    thermalSimRuntime.airflowScores = scores;
    thermalSimRuntime.selectedAirflowDirection = directionKeys[0];
    thermalSimRuntime.selectedAirflowDirections = directionKeys;
    thermalSimRuntime.selectedAirflowGasType = getAirflowGasMeta(options.gasType || thermalSimRuntime.selectedAirflowGasType || 'n2').key;
    thermalSimRuntime.selectedRadiationItemId = null;
    thermalSimRuntime.selectedRadiationEntry = null;
    thermalSimRuntime.selectedRadiationBatch = null;
    thermalSimRuntime.selectedRadiationSection = null;
    thermalSimRuntime.metrics = calculateAirflowCoolingMetrics(furnace, scores, directionMetas);
    thermalSimRuntime.metrics.animationPlaying = thermalSimRuntime.isPlaying && !thermalSimRuntime.paused;
    updateAirflowParticles(performance.now(), true);
    return thermalSimRuntime.metrics;
}

export function setAirflowCoolingDirection(directionKey = 'z+') {
    const meta = getAirflowDirectionMeta(directionKey);
    thermalSimRuntime.selectedAirflowDirection = meta.key;
    thermalSimRuntime.selectedAirflowDirections = [meta.key];
    return renderAirflowCoolingSimulation({ directionKeys: [meta.key] });
}

export function setAirflowCoolingDirections(directionKeys = ['z+']) {
    const directions = normalizeAirflowDirections(directionKeys);
    thermalSimRuntime.selectedAirflowDirection = directions[0];
    thermalSimRuntime.selectedAirflowDirections = directions;
    return renderAirflowCoolingSimulation({ directionKeys: directions, keepPlaying: thermalSimRuntime.isPlaying && !thermalSimRuntime.paused });
}

export function setAirflowCoolingGasType(gasType = 'n2') {
    const gasMeta = getAirflowGasMeta(gasType);
    thermalSimRuntime.selectedAirflowGasType = gasMeta.key;
    return renderAirflowCoolingSimulation({
        directionKeys: thermalSimRuntime.selectedAirflowDirections || [thermalSimRuntime.selectedAirflowDirection || 'z+'],
        gasType: gasMeta.key,
        keepPlaying: thermalSimRuntime.isPlaying && !thermalSimRuntime.paused
    });
}

export function toggleAirflowCoolingDirection(directionKey = 'z+') {
    const key = getAirflowDirectionMeta(directionKey).key;
    const current = normalizeAirflowDirections(thermalSimRuntime.selectedAirflowDirections || thermalSimRuntime.selectedAirflowDirection || 'z+');
    const next = current.includes(key) ? current.filter(v => v !== key) : [...current, key];
    return setAirflowCoolingDirections(next.length ? next : [key]);
}

export function playAirflowCoolingAnimation(options = {}) {
    if (options && options.cycleMs) {
        thermalSimRuntime.airflowCycleMs = Math.max(800, Number(options.cycleMs) || 3600);
    }
    if (thermalSimRuntime.activeMode !== 'airflow' || !thermalSimRuntime.visible) {
        renderAirflowCoolingSimulation({
            directionKeys: thermalSimRuntime.selectedAirflowDirections || ['z+'],
            gasType: thermalSimRuntime.selectedAirflowGasType || 'n2'
        });
    }
    const cycleMs = Math.max(800, Number(thermalSimRuntime.airflowCycleMs || 3600));
    thermalSimRuntime.isPlaying = true;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.startedAt = performance.now() - (thermalSimRuntime.progress || 0) * cycleMs;
    thermalSimRuntime.lastAirflowParticleUpdateAt = 0;
    if (thermalSimRuntime.metrics) {
        thermalSimRuntime.metrics.animationPlaying = true;
        thermalSimRuntime.metrics.progress = Math.round((thermalSimRuntime.progress || 0) * 100);
    }
    return thermalSimRuntime.metrics;
}

export function pauseAirflowCoolingAnimation() {
    if (thermalSimRuntime.activeMode === 'airflow') {
        thermalSimRuntime.paused = true;
        thermalSimRuntime.isPlaying = false;
        if (thermalSimRuntime.metrics) thermalSimRuntime.metrics.animationPlaying = false;
    }
    return thermalSimRuntime.metrics;
}

export function resetAirflowCoolingAnimation() {
    if (thermalSimRuntime.activeMode === 'airflow') {
        thermalSimRuntime.progress = 0;
        thermalSimRuntime.isPlaying = false;
        thermalSimRuntime.paused = false;
        thermalSimRuntime.startedAt = performance.now();
        updateAirflowParticles(performance.now(), true);
        if (thermalSimRuntime.metrics) thermalSimRuntime.metrics.animationPlaying = false;
    }
    return thermalSimRuntime.metrics;
}

export function getAirflowCoolingRuntime() {
    return {
        visible: thermalSimRuntime.visible && thermalSimRuntime.activeMode === 'airflow',
        metrics: thermalSimRuntime.activeMode === 'airflow' ? thermalSimRuntime.metrics : null,
        scores: thermalSimRuntime.airflowScores,
        directionKey: thermalSimRuntime.selectedAirflowDirection || 'z+',
        directionKeys: normalizeAirflowDirections(thermalSimRuntime.selectedAirflowDirections || thermalSimRuntime.selectedAirflowDirection || 'z+'),
        gasType: thermalSimRuntime.selectedAirflowGasType || 'n2',
        gasMeta: getAirflowGasMeta(thermalSimRuntime.selectedAirflowGasType || 'n2'),
        isPlaying: thermalSimRuntime.activeMode === 'airflow' && thermalSimRuntime.isPlaying,
        paused: thermalSimRuntime.activeMode === 'airflow' && thermalSimRuntime.paused,
        progress: thermalSimRuntime.activeMode === 'airflow' ? thermalSimRuntime.progress : 0,
        cycleMs: thermalSimRuntime.airflowCycleMs || 3600
    };
}


// ---------- 介质场：气氛覆盖 v1.5 ----------
function getAtmosphereMediumMeta(mediumType = 'nitriding') {
    const key = String(mediumType || 'nitriding').toLowerCase().trim();
    const table = {
        nitriding: {
            key: 'nitriding',
            label: '氮化气氛',
            shortLabel: 'NH₃ / N₂ / H₂',
            activeSpecies: '活性氮',
            processHint: '适合氮化 / 软氮化，重点关注表面接触、贴靠面与中心死角。',
            targetClearance: 90,
            severeClearance: 24,
            diffusionFactor: 0.92,
            colorHigh: 0x34d399,
            colorMid: 0xa3e635,
            colorLow: 0xf97316,
            backgroundColor: 0x0b1f1c,
            surfaceLayerColor: 0x5eead4,
            fogOpacity: 0.44,
            particleDensityScale: 0.88,
            surfaceLayerBoost: 1.10,
            visualTone: 'nitrogen'
        },
        carburizing: {
            key: 'carburizing',
            label: '渗碳气氛',
            shortLabel: 'CO / CH₄ / N₂',
            activeSpecies: '碳势介质',
            processHint: '适合渗碳 / 可控气氛多用炉，重点关注气氛更新和表面反应均匀性。',
            targetClearance: 110,
            severeClearance: 32,
            diffusionFactor: 0.88,
            colorHigh: 0xffb703,
            colorMid: 0xf97316,
            colorLow: 0x7f1d1d,
            backgroundColor: 0x160d06,
            surfaceLayerColor: 0xffd166,
            fogOpacity: 0.54,
            particleDensityScale: 0.92,
            surfaceLayerBoost: 1.28,
            visualTone: 'carbon'
        },
        protective: {
            key: 'protective',
            label: '保护气氛',
            shortLabel: 'N₂ / Ar / H₂',
            activeSpecies: '防氧化保护介质',
            processHint: '适合保护气氛退火 / 防氧化处理，重点关注是否存在封闭死角。',
            targetClearance: 70,
            severeClearance: 20,
            diffusionFactor: 0.96,
            colorHigh: 0x2dd4bf,
            colorMid: 0x38bdf8,
            colorLow: 0xf59e0b,
            backgroundColor: 0x071827,
            surfaceLayerColor: 0xbae6fd,
            fogOpacity: 0.26,
            particleDensityScale: 0.62,
            surfaceLayerBoost: 1.22,
            visualTone: 'protective'
        },
        carbonitriding: {
            key: 'carbonitriding',
            label: '碳氮共渗',
            shortLabel: '渗碳气 + NH₃',
            activeSpecies: '碳氮活性介质',
            processHint: '适合碳氮共渗，重点关注密集区、贴靠面和小间隙处的复合介质覆盖。',
            targetClearance: 120,
            severeClearance: 36,
            diffusionFactor: 0.84,
            colorHigh: 0xffc857,
            colorMid: 0xfacc15,
            colorLow: 0xdc2626,
            backgroundColor: 0x151106,
            surfaceLayerColor: 0xffe08a,
            fogOpacity: 0.50,
            particleDensityScale: 0.86,
            surfaceLayerBoost: 1.22,
            visualTone: 'carbonitriding'
        }
    };
    return table[key] || table.nitriding;
}


const ATMOSPHERE_INLET_DIRECTION_KEYS = ['x-', 'x+', 'z-', 'z+', 'y+', 'y-'];

function getAtmosphereInletDirectionMeta(directionKey = 'z-') {
    const key = String(directionKey || 'z-').toLowerCase().trim();
    const table = {
        'x-': { key: 'x-', label: '左侧入口', shortLabel: '-X 左侧', normal: new THREE.Vector3(1, 0, 0), axis: 'x', sign: -1 },
        'x+': { key: 'x+', label: '右侧入口', shortLabel: '+X 右侧', normal: new THREE.Vector3(-1, 0, 0), axis: 'x', sign: 1 },
        'z-': { key: 'z-', label: '前侧入口', shortLabel: '-Z 前侧', normal: new THREE.Vector3(0, 0, 1), axis: 'z', sign: -1 },
        'z+': { key: 'z+', label: '后侧入口', shortLabel: '+Z 后侧', normal: new THREE.Vector3(0, 0, -1), axis: 'z', sign: 1 },
        'y+': { key: 'y+', label: '顶部补给', shortLabel: '+Y 顶部', normal: new THREE.Vector3(0, -1, 0), axis: 'y', sign: 1 },
        'y-': { key: 'y-', label: '底部补给', shortLabel: '-Y 底部', normal: new THREE.Vector3(0, 1, 0), axis: 'y', sign: -1 }
    };
    return table[key] || table['z-'];
}

function getDefaultAtmosphereInletsForMedium(mediumMeta = getAtmosphereMediumMeta('nitriding')) {
    if (mediumMeta.visualTone === 'protective') return ['x-', 'x+', 'z-', 'z+', 'y+'];
    if (mediumMeta.visualTone === 'carbon' || mediumMeta.visualTone === 'carbonitriding') return ['x-', 'x+', 'z-', 'z+'];
    return ['x-', 'x+', 'z-', 'z+', 'y+'];
}

function normalizeAtmosphereInletDirections(value, mediumMeta = getAtmosphereMediumMeta('nitriding')) {
    const fallback = getDefaultAtmosphereInletsForMedium(mediumMeta);
    const raw = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(',') : fallback);
    const result = [];
    raw.forEach(v => {
        const meta = getAtmosphereInletDirectionMeta(v);
        if (meta && ATMOSPHERE_INLET_DIRECTION_KEYS.includes(meta.key) && !result.includes(meta.key)) {
            result.push(meta.key);
        }
    });
    return result.length ? result : fallback;
}

function getSelectedAtmosphereInletDirections(mediumMeta = getAtmosphereMediumMeta('nitriding')) {
    return normalizeAtmosphereInletDirections(thermalSimRuntime.selectedAtmosphereInletDirections, mediumMeta);
}

function getAtmosphereInletDirectionLabel(keys, compact = false) {
    const list = normalizeAtmosphereInletDirections(keys || []);
    const labels = list.map(k => compact ? getAtmosphereInletDirectionMeta(k).shortLabel : getAtmosphereInletDirectionMeta(k).label);
    if (labels.length <= 2) return labels.join(' / ');
    return `${labels.slice(0, 2).join(' / ')} 等 ${labels.length} 个入口`;
}

function getAtmosphereCoverageColor(score, mediumType = 'nitriding') {
    const meta = getAtmosphereMediumMeta(mediumType);
    const low = new THREE.Color(meta.colorLow);
    const mid = new THREE.Color(meta.colorMid);
    const high = new THREE.Color(meta.colorHigh);
    const c = new THREE.Color();
    const s = clamp01(score);
    if (s < 0.55) c.lerpColors(low, mid, s / 0.55);
    else c.lerpColors(mid, high, (s - 0.55) / 0.45);
    return c;
}

function isCarbonAtmosphere(mediumType = 'nitriding') {
    const key = String(mediumType || '').toLowerCase();
    return key === 'carburizing' || key === 'carbonitriding';
}

function estimateCaseDepthRange(avgScore = 0.75, mediumType = 'nitriding') {
    if (!isCarbonAtmosphere(mediumType)) return null;
    const baseMin = mediumType === 'carbonitriding' ? 0.35 : 0.80;
    const baseMax = mediumType === 'carbonitriding' ? 0.70 : 1.25;
    const quality = 0.78 + clamp01(avgScore) * 0.30;
    return {
        min: Math.round(baseMin * quality * 100) / 100,
        max: Math.round(baseMax * quality * 100) / 100
    };
}

function getAtmosphereModeCopy(mediumMeta) {
    if (mediumMeta.key === 'carburizing') {
        return {
            modeName: '渗碳碳势覆盖',
            coverageLabel: '平均碳势覆盖',
            minLabel: '最低碳势工件',
            weakExchangeLabel: '碳势交换弱区',
            deadLabel: '真实碳势死角',
            severeLabel: '严重碳势死角',
            uniformityLabel: '预计渗层均匀性',
            faceRateLabel: '有效吸碳表面',
            riskFaceLabel: '最低碳势表面',
            visualNote: '金橙色碳势云 = CO/CH₄ 有效碳势；金色外轮廓 = 表面吸碳/渗层形成；红棕色 = 贴靠面或中心碳势死角。'
        };
    }
    if (mediumMeta.key === 'carbonitriding') {
        return {
            modeName: '碳氮共渗覆盖',
            coverageLabel: '碳氮介质覆盖',
            minLabel: '最低共渗工件',
            weakExchangeLabel: '共渗交换弱区',
            deadLabel: '真实共渗死角',
            severeLabel: '严重共渗死角',
            uniformityLabel: '共渗层均匀性',
            faceRateLabel: '有效反应表面',
            riskFaceLabel: '最低反应表面',
            visualNote: '金黄/青绿复合雾场 = 碳氮活性介质；亮色外轮廓 = 表面反应层；红色 = 贴靠面或小间隙死角。'
        };
    }
    if (mediumMeta.key === 'protective') {
        return {
            modeName: '保护气氛覆盖',
            coverageLabel: '平均保护覆盖',
            minLabel: '最低保护工件',
            weakExchangeLabel: '保护交换弱区',
            deadLabel: '真实保护死角',
            severeLabel: '严重保护死角',
            uniformityLabel: '防氧化均匀性',
            faceRateLabel: '有效保护表面',
            riskFaceLabel: '最低保护表面',
            visualNote: '淡蓝/银灰雾场 = 惰性保护气氛；亮色表面 = 有效保护；橙色 = 封闭死角或防氧化不足。'
        };
    }
    return {
        modeName: '氮化气氛覆盖',
        coverageLabel: '平均氮势覆盖',
        minLabel: '最低氮势工件',
        weakExchangeLabel: '氮势交换弱区',
        deadLabel: '真实氮势死角',
        severeLabel: '严重氮势死角',
        uniformityLabel: '氮化层均匀性',
        faceRateLabel: '有效氮化表面',
        riskFaceLabel: '最低氮势表面',
        visualNote: '青绿色氮势雾场 = 活性氮覆盖；亮色表面 = 氮化反应充分；橙红色 = 贴靠面或气氛死角。'
    };
}

function getAtmosphereFaceSamples(item, furnace) {
    const b = getItemWorldBox(item, furnace);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    return [
        { key: 'x-', label: '左侧面', point: new THREE.Vector3(b.minX, cy, cz), normal: new THREE.Vector3(-1, 0, 0), axis: 'x', sign: -1 },
        { key: 'x+', label: '右侧面', point: new THREE.Vector3(b.maxX, cy, cz), normal: new THREE.Vector3(1, 0, 0), axis: 'x', sign: 1 },
        { key: 'y-', label: '下表面', point: new THREE.Vector3(cx, b.minY, cz), normal: new THREE.Vector3(0, -1, 0), axis: 'y', sign: -1 },
        { key: 'y+', label: '上表面', point: new THREE.Vector3(cx, b.maxY, cz), normal: new THREE.Vector3(0, 1, 0), axis: 'y', sign: 1 },
        { key: 'z-', label: '前侧面', point: new THREE.Vector3(cx, cy, b.minZ), normal: new THREE.Vector3(0, 0, -1), axis: 'z', sign: -1 },
        { key: 'z+', label: '后侧面', point: new THREE.Vector3(cx, cy, b.maxZ), normal: new THREE.Vector3(0, 0, 1), axis: 'z', sign: 1 }
    ];
}

function getAxisRangeFromBox(box, axis) {
    if (axis === 'x') return { min: box.minX, max: box.maxX };
    if (axis === 'y') return { min: box.minY, max: box.maxY };
    return { min: box.minZ, max: box.maxZ };
}

function rangesOverlapWithPad(aMin, aMax, bMin, bMax, pad = 0) {
    return aMax + pad >= bMin && bMax + pad >= aMin;
}

function getFurnaceWorldBounds(furnace) {
    return {
        minX: -(Number(furnace?.w || 600) / 2),
        maxX: Number(furnace?.w || 600) / 2,
        minY: THERMAL_BASE_Y,
        maxY: THERMAL_BASE_Y + Number(furnace?.h || 600),
        minZ: -(Number(furnace?.d || 600) / 2),
        maxZ: Number(furnace?.d || 600) / 2
    };
}

function estimateAtmosphereFaceClearance(face, targetItem, allItems, furnace) {
    const targetBox = getItemWorldBox(targetItem, furnace);
    const axis = face.axis;
    const orthAxes = ['x', 'y', 'z'].filter(a => a !== axis);
    let bestClearance = Infinity;
    let bestBlocker = null;
    const overlapPad = 12;

    for (const other of allItems) {
        if (!other || other.id === targetItem.id) continue;
        const otherBox = getItemWorldBox(other, furnace);
        const overlapsOrthogonal = orthAxes.every(oa => {
            const a = getAxisRangeFromBox(targetBox, oa);
            const b = getAxisRangeFromBox(otherBox, oa);
            return rangesOverlapWithPad(a.min, a.max, b.min, b.max, overlapPad);
        });
        if (!overlapsOrthogonal) continue;

        let clearance = Infinity;
        if (axis === 'x') clearance = face.sign > 0 ? otherBox.minX - targetBox.maxX : targetBox.minX - otherBox.maxX;
        if (axis === 'y') clearance = face.sign > 0 ? otherBox.minY - targetBox.maxY : targetBox.minY - otherBox.maxY;
        if (axis === 'z') clearance = face.sign > 0 ? otherBox.minZ - targetBox.maxZ : targetBox.minZ - otherBox.maxZ;

        if (clearance >= -2 && clearance < bestClearance) {
            bestClearance = Math.max(0, clearance);
            bestBlocker = other;
        }
    }

    const furnaceBox = getFurnaceWorldBounds(furnace);
    let wallClearance = Infinity;
    if (axis === 'x') wallClearance = face.sign > 0 ? furnaceBox.maxX - targetBox.maxX : targetBox.minX - furnaceBox.minX;
    if (axis === 'y') wallClearance = face.sign > 0 ? furnaceBox.maxY - targetBox.maxY : targetBox.minY - furnaceBox.minY;
    if (axis === 'z') wallClearance = face.sign > 0 ? furnaceBox.maxZ - targetBox.maxZ : targetBox.minZ - furnaceBox.minZ;

    return {
        clearance: Number.isFinite(bestClearance) ? bestClearance : wallClearance,
        blocker: bestBlocker,
        wallClearance
    };
}

function estimateAtmosphereLocalDensity(item, furnace) {
    const center = getItemCenterWorld(item, furnace);
    const items = furnace.packedItems || [];
    const radius = Math.max(180, Math.min(360, Math.max(furnace.w || 600, furnace.d || 600) * 0.22));
    let density = 0;
    items.forEach(other => {
        if (!other || other.id === item.id) return;
        const c = getItemCenterWorld(other, furnace);
        const dist = c.distanceTo(center);
        if (dist < radius) {
            const volumeFactor = Math.min(1, Math.cbrt(Math.max((other.w || 1) * (other.h || 1) * (other.d || 1), 1)) / 360);
            density += (1 - dist / radius) * (0.35 + volumeFactor * 0.65);
        }
    });
    return clamp01(density / 4.2);
}

function getAtmosphereInletPointForFace(face, furnace, inletKey = 'z-') {
    const fw = Number(furnace?.w || 600);
    const fh = Number(furnace?.h || 600);
    const fd = Number(furnace?.d || 600);
    const y0 = THERMAL_BASE_Y;
    const p = face?.point || new THREE.Vector3();
    const key = getAtmosphereInletDirectionMeta(inletKey).key;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    if (key === 'x-') return new THREE.Vector3(-fw / 2, clamp(p.y, y0, y0 + fh), clamp(p.z, -fd / 2, fd / 2));
    if (key === 'x+') return new THREE.Vector3(fw / 2, clamp(p.y, y0, y0 + fh), clamp(p.z, -fd / 2, fd / 2));
    if (key === 'z-') return new THREE.Vector3(clamp(p.x, -fw / 2, fw / 2), clamp(p.y, y0, y0 + fh), -fd / 2);
    if (key === 'z+') return new THREE.Vector3(clamp(p.x, -fw / 2, fw / 2), clamp(p.y, y0, y0 + fh), fd / 2);
    if (key === 'y+') return new THREE.Vector3(clamp(p.x, -fw / 2, fw / 2), y0 + fh, clamp(p.z, -fd / 2, fd / 2));
    return new THREE.Vector3(clamp(p.x, -fw / 2, fw / 2), y0, clamp(p.z, -fd / 2, fd / 2));
}

function estimateAtmosphereInletReachability(face, targetItem, allItems, furnace, mediumMeta) {
    const selectedKeys = getSelectedAtmosphereInletDirections(mediumMeta);
    const facePoint = face?.point || getItemCenterWorld(targetItem, furnace);
    const maxDim = Math.max(Number(furnace?.w || 600), Number(furnace?.h || 600), Number(furnace?.d || 600), 1);
    let best = {
        score: 0,
        inletKey: selectedKeys[0] || 'z-',
        blockerCount: 0,
        blockers: [],
        distance: 0,
        exposure: 0
    };

    selectedKeys.forEach(key => {
        const inletPoint = getAtmosphereInletPointForFace(face, furnace, key);
        const toInlet = inletPoint.clone().sub(facePoint);
        const distance = Math.max(1, toInlet.length());
        const inletDirection = toInlet.clone().normalize();
        // face.normal points outward from the workpiece. If the inlet lies on that side,
        // the face is directly exposed; otherwise it can still be reached by diffusion.
        const directExposure = clamp01(face.normal.dot(inletDirection));
        const diffusionExposure = 0.24 + directExposure * 0.76;
        const distanceFactor = Math.max(0.36, clamp01(1.08 - distance / (maxDim * 1.58)));
        const blockers = [];

        for (const other of allItems) {
            if (!other || other.id === targetItem.id) continue;
            const box = getItemWorldBox(other, furnace);
            if (segmentIntersectsBox(inletPoint, facePoint, box)) {
                blockers.push(other);
            }
        }

        const multiInletBonus = selectedKeys.length >= 4 ? 0.08 : (selectedKeys.length >= 2 ? 0.04 : 0);
        const blockerPenalty = Math.max(0.24, 1 - blockers.length * 0.22);
        const score = clamp01(
            diffusionExposure * (0.42 + distanceFactor * 0.58) * blockerPenalty * (mediumMeta.diffusionFactor || 0.9)
            + multiInletBonus
        );

        if (score > best.score) {
            best = {
                score,
                inletKey: key,
                blockerCount: blockers.length,
                blockers,
                distance,
                exposure: directExposure
            };
        }
    });

    return best;
}

function getAtmosphereFaceRiskType(faceScore, info, inletInfo, localDensity, mediumMeta) {
    const severe = mediumMeta.severeClearance || 28;
    const target = mediumMeta.targetClearance || 100;
    const contactLimit = Math.max(6, severe * 0.36);
    const tightLimit = severe;
    const pathBlocked = (inletInfo?.blockerCount || 0) >= 3 && (inletInfo?.score || 0) < 0.36 && info.clearance < target * 0.72;

    if (info.clearance <= contactLimit) {
        return {
            type: 'dead',
            level: 'severe',
            label: '真实死角',
            reason: '表面间隙接近贴靠，活性介质难以进入'
        };
    }
    if (info.clearance < tightLimit || pathBlocked) {
        return {
            type: 'dead',
            level: 'normal',
            label: '真实死角',
            reason: pathBlocked ? '入口路径被多件工件连续遮挡' : '表面间隙低于工艺安全阈值'
        };
    }
    if (info.clearance < target || (inletInfo?.score || 0) < 0.52 || localDensity > 0.52 || faceScore < 0.64) {
        return {
            type: 'weak',
            level: 'weak',
            label: '低交换区',
            reason: info.clearance < target
                ? '表面间距偏小但未形成封闭死角'
                : ((inletInfo?.score || 0) < 0.52 ? '入口路径较长或被遮挡，气氛刷新较慢' : '周边局部密集，气氛交换速度偏慢')
        };
    }
    return {
        type: 'ok',
        level: 'ok',
        label: '覆盖正常',
        reason: '表面间距和入口路径均可接受'
    };
}


function calculateAtmosphereCoverageScores(furnace, mediumType = 'nitriding') {
    const items = furnace.packedItems || [];
    const result = new Map();
    const mediumMeta = getAtmosphereMediumMeta(mediumType);
    if (!items.length) return { scores: result, mediumMeta };

    items.forEach(item => {
        const faces = getAtmosphereFaceSamples(item, furnace);
        const localDensity = estimateAtmosphereLocalDensity(item, furnace);
        const blockerMap = new Map();
        const pathBlockerMap = new Map();
        const faceResults = [];
        let totalScore = 0;
        let deadFaceCount = 0;
        let severeDeadFaceCount = 0;
        let weakExchangeFaceCount = 0;
        let totalInletReachability = 0;
        let totalPathBlockers = 0;

        faces.forEach(face => {
            const info = estimateAtmosphereFaceClearance(face, item, items, furnace);
            const inletInfo = estimateAtmosphereInletReachability(face, item, items, furnace, mediumMeta);
            const target = mediumMeta.targetClearance || 100;
            const severe = mediumMeta.severeClearance || 28;
            const clearanceScore = clamp01((info.clearance - severe * 0.20) / Math.max(1, target - severe * 0.20));
            let faceScore = clamp01(
                clearanceScore * 0.62
                + (inletInfo.score || 0) * 0.30
                + (1 - localDensity) * 0.08
            );
            if (info.wallClearance < 18) faceScore *= 0.90;

            const risk = getAtmosphereFaceRiskType(faceScore, info, inletInfo, localDensity, mediumMeta);
            if (risk.type === 'dead') {
                faceScore *= risk.level === 'severe' ? 0.48 : 0.62;
                deadFaceCount += 1;
                if (risk.level === 'severe') severeDeadFaceCount += 1;
            } else if (risk.type === 'weak') {
                faceScore *= 0.88;
                weakExchangeFaceCount += 1;
            }
            faceScore = clamp01(faceScore);

            if (info.blocker && info.clearance < target) {
                const existed = blockerMap.get(info.blocker.id) || { item: info.blocker, count: 0, minClearance: Infinity };
                existed.count += 1;
                existed.minClearance = Math.min(existed.minClearance, info.clearance);
                blockerMap.set(info.blocker.id, existed);
            }
            (inletInfo.blockers || []).forEach(blocker => {
                if (!blocker) return;
                const existed = pathBlockerMap.get(blocker.id) || { item: blocker, count: 0, minClearance: Infinity };
                existed.count += 1;
                existed.minClearance = Math.min(existed.minClearance, info.clearance);
                pathBlockerMap.set(blocker.id, existed);
            });

            totalScore += faceScore;
            totalInletReachability += inletInfo.score || 0;
            totalPathBlockers += inletInfo.blockerCount || 0;
            faceResults.push({
                key: face.key,
                label: face.label,
                score: Math.round(faceScore * 100),
                clearance: Math.round(info.clearance),
                blockerName: info.blocker?.name || '',
                inletKey: inletInfo.inletKey,
                inletLabel: getAtmosphereInletDirectionMeta(inletInfo.inletKey).shortLabel,
                inletReachability: Math.round((inletInfo.score || 0) * 100),
                pathBlockerCount: inletInfo.blockerCount || 0,
                riskType: risk.type,
                riskLevel: risk.level,
                riskLabel: risk.label,
                reason: risk.reason
            });
        });

        const score = clamp01(totalScore / Math.max(1, faces.length));
        const blockers = [...blockerMap.values(), ...pathBlockerMap.values()]
            .reduce((acc, cur) => {
                if (!cur?.item?.id) return acc;
                const existed = acc.get(cur.item.id) || { item: cur.item, count: 0, minClearance: Infinity };
                existed.count += cur.count || 0;
                existed.minClearance = Math.min(existed.minClearance, cur.minClearance || Infinity);
                acc.set(cur.item.id, existed);
                return acc;
            }, new Map());
        const blockerList = [...blockers.values()].sort((a, b) => b.count - a.count || a.minClearance - b.minClearance);
        const worstFace = [...faceResults].sort((a, b) => {
            const priority = { dead: 0, weak: 1, ok: 2 };
            return (priority[a.riskType] ?? 2) - (priority[b.riskType] ?? 2) || a.score - b.score;
        })[0];
        const avgInletReachability = totalInletReachability / Math.max(1, faces.length);
        result.set(item.id, {
            item,
            score,
            coveragePercent: Math.round(score * 100),
            deadFaceCount,
            trueDeadFaceCount: deadFaceCount,
            severeDeadFaceCount,
            weakExchangeFaceCount,
            localDensity,
            inletReachability: avgInletReachability,
            pathBlockerCount: totalPathBlockers,
            faceResults,
            worstFace,
            blockers: blockerList,
            mediumType: mediumMeta.key,
            riskType: deadFaceCount > 0 ? 'dead' : (weakExchangeFaceCount > 0 || score < 0.72 ? 'weak' : 'ok')
        });

        item.simulation = {
            ...(item.simulation || {}),
            atmosphereCoverageScore: Math.round(score * 100),
            atmosphereDeadFaceCount: deadFaceCount,
            atmosphereWeakExchangeFaceCount: weakExchangeFaceCount,
            atmosphereInletReachability: Math.round(avgInletReachability * 100),
            atmosphereBlockerCount: blockerList.length,
            atmosphereMediumType: mediumMeta.key
        };
    });

    return { scores: result, mediumMeta };
}

function calculateAtmosphereCoverageMetrics(furnace, scoreMap, mediumMeta) {
    const entries = [...scoreMap.values()];
    const avgScore = entries.length ? entries.reduce((s, v) => s + v.score, 0) / entries.length : 0;
    const minScore = entries.length ? Math.min(...entries.map(v => v.score)) : 0;
    const weakExchangeItems = entries.filter(v => (v.weakExchangeFaceCount || 0) > 0 || ((v.score || 0) < 0.72 && (v.deadFaceCount || 0) === 0)).length;
    const deadCornerItems = entries.filter(v => (v.deadFaceCount || 0) > 0).length;
    const severeDeadCornerItems = entries.filter(v => (v.severeDeadFaceCount || 0) > 0 || (v.deadFaceCount || 0) >= 2).length;
    const worst = [...entries].sort((a, b) => a.score - b.score)[0];
    const avgDensity = entries.length ? entries.reduce((s, v) => s + (v.localDensity || 0), 0) / entries.length : 0;
    const avgInletReachability = entries.length ? entries.reduce((s, v) => s + (v.inletReachability || 0), 0) / entries.length : 0;
    const coveredFaces = entries.reduce((s, v) => s + (v.faceResults || []).filter(f => f.score >= 65 && f.riskType !== 'dead').length, 0);
    const totalFaces = entries.reduce((s, v) => s + (v.faceResults || []).length, 0) || 1;
    const uniformity = Math.max(42, Math.round(96 - (1 - avgScore) * 36 - severeDeadCornerItems * 3.6 - weakExchangeItems * 0.18 - avgDensity * 12));
    const worstFaceLabel = worst?.worstFace?.label || '-';
    const worstBlocker = worst?.blockers?.[0]?.item?.name || '-';

    const modeCopy = getAtmosphereModeCopy(mediumMeta);
    const caseDepth = estimateCaseDepthRange(avgScore, mediumMeta.key);
    const carbonPotential = isCarbonAtmosphere(mediumMeta.key)
        ? Math.round((0.72 + avgScore * 0.28 - avgDensity * 0.06 - Math.max(0, 0.72 - avgInletReachability) * 0.05) * 100) / 100
        : null;

    const topRiskAreas = [...entries]
        .filter(v => v && ((v.deadFaceCount || 0) > 0 || (v.weakExchangeFaceCount || 0) > 0 || (v.score || 0) < 0.72))
        .sort((a, b) => {
            const pa = (a.deadFaceCount || 0) > 0 ? 0 : 1;
            const pb = (b.deadFaceCount || 0) > 0 ? 0 : 1;
            return pa - pb || a.score - b.score || (b.pathBlockerCount || 0) - (a.pathBlockerCount || 0);
        })
        .slice(0, 3)
        .map((entry, idx) => {
            const isDead = (entry.deadFaceCount || 0) > 0;
            const wf = entry.worstFace || {};
            return {
                rank: idx + 1,
                itemName: entry.item?.name || '风险工件',
                faceLabel: wf.label || '-',
                score: Math.round((entry.score || 0) * 100),
                blockerName: entry.blockers?.[0]?.item?.name || '-',
                riskType: isDead ? 'dead' : 'weak',
                riskTypeLabel: isDead ? '真实死角' : '低交换区',
                inletLabel: wf.inletLabel || '-',
                inletReachability: wf.inletReachability ?? Math.round((entry.inletReachability || 0) * 100),
                reason: isDead
                    ? (wf.reason || '表面间距过小或路径被连续遮挡，气氛难以进入')
                    : (wf.reason || '入口路径较长或局部密集，属于气氛交换弱，不是封闭死角')
            };
        });
    const primaryRisk = topRiskAreas[0] || null;
    const primaryRiskReason = primaryRisk
        ? `${primaryRisk.itemName} 的 ${primaryRisk.faceLabel} 为${primaryRisk.riskTypeLabel}，覆盖 ${primaryRisk.score}%；主要原因：${primaryRisk.reason}${primaryRisk.inletLabel && primaryRisk.inletLabel !== '-' ? `；最佳入口：${primaryRisk.inletLabel}` : ''}${primaryRisk.blockerName && primaryRisk.blockerName !== '-' ? `；邻近/路径遮蔽：${primaryRisk.blockerName}` : ''}。`
        : '当前气氛覆盖较均匀，未发现真实死角或明显低交换区域。';
    const primaryAdjustment = primaryRisk
        ? (primaryRisk.riskType === 'dead'
            ? (mediumMeta.key === 'carburizing'
                ? '建议优先消除贴靠面，增加 15–25mm 间隙或移向外圈通道，避免碳势气氛无法刷新。'
                : '建议优先检查贴靠面、下表面和搁板附近，打开局部间隙后再复核入口路径。')
            : (mediumMeta.key === 'protective'
                ? '该区域更像保护气氛交换慢，可通过增加入口方向、打开中心/下层通道或延长置换时间改善。'
                : '该区域属于气氛交换弱，可优先调整入口方向或增加局部通道；若工艺时间足够，不一定等同于质量死角。'))
        : '当前方案可作为基准方案，仅需在报告中保留气氛覆盖截图。';

    const baseSuggestion = deadCornerItems > 0
        ? `存在 ${deadCornerItems} 件真实气氛死角，建议优先复核 ${worst?.item?.name || '最低覆盖工件'} 的 ${worstFaceLabel}。`
        : (weakExchangeItems > 0 ? `未发现明显真实死角，但有 ${weakExchangeItems} 件处于气氛交换弱区，可结合入口方向和工艺保温时间复核。` : '当前表面覆盖较均匀，未发现明显气氛覆盖风险。');
    const carbonSuggestion = mediumMeta.key === 'carburizing'
        ? `${baseSuggestion} 渗碳模式下重点区分“碳势交换慢”和“贴靠死角”，只有贴靠/小间隙才应判为高风险。`
        : baseSuggestion;

    const inletDirections = getSelectedAtmosphereInletDirections(mediumMeta);
    const inletDirectionLabel = getAtmosphereInletDirectionLabel(inletDirections);
    const inletDirectionCompactLabel = getAtmosphereInletDirectionLabel(inletDirections, true);

    return {
        mode: 'atmosphere',
        processName: VACUUM_QUENCH_PROFILE.processName,
        mediumType: mediumMeta.key,
        mediumLabel: mediumMeta.label,
        mediumShortLabel: mediumMeta.shortLabel,
        activeSpecies: mediumMeta.activeSpecies,
        processHint: mediumMeta.processHint,
        visualNote: modeCopy.visualNote,
        modeName: modeCopy.modeName,
        coverageLabel: modeCopy.coverageLabel,
        minLabel: modeCopy.minLabel,
        weakExchangeLabel: modeCopy.weakExchangeLabel || '气氛交换弱区',
        deadLabel: modeCopy.deadLabel,
        severeLabel: modeCopy.severeLabel,
        uniformityLabel: modeCopy.uniformityLabel,
        faceRateLabel: modeCopy.faceRateLabel,
        riskFaceLabel: modeCopy.riskFaceLabel,
        atmosphereCoverage: Math.round(avgScore * 100),
        minAtmosphereCoverage: Math.round(minScore * 100),
        weakExchangeItemCount: weakExchangeItems,
        deadCornerItemCount: deadCornerItems,
        trueDeadCornerItemCount: deadCornerItems,
        severeDeadCornerItemCount: severeDeadCornerItems,
        surfaceUniformityScore: uniformity,
        effectiveFaceRate: Math.round((coveredFaces / totalFaces) * 100),
        worstItemName: worst?.item?.name || '-',
        worstFaceLabel,
        worstBlocker,
        localDensityRate: Math.round(avgDensity * 100),
        inletReachabilityRate: Math.round(avgInletReachability * 100),
        carbonPotential,
        estimatedCaseDepth: caseDepth ? `${caseDepth.min.toFixed(2)}–${caseDepth.max.toFixed(2)}mm` : null,
        topRiskAreas,
        primaryRiskReason,
        primaryAdjustment,
        inletDirections,
        inletDirectionLabel,
        inletDirectionCompactLabel,
        inletModeLabel: inletDirections.length >= 4 ? '多面补给' : (inletDirections.length >= 2 ? '双向/多向补给' : '单侧补给'),
        suggestion: carbonSuggestion
    };
}

function getAtmosphereInletPointForPosition(point, furnace, mediumMeta) {
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    const y0 = THERMAL_BASE_Y;
    const selectedKeys = getSelectedAtmosphereInletDirections(mediumMeta);
    const candidateMap = {
        'x-': { side: 'x-', d: Math.abs(point.x + fw / 2), p: new THREE.Vector3(-fw / 2, point.y, point.z) },
        'x+': { side: 'x+', d: Math.abs(fw / 2 - point.x), p: new THREE.Vector3(fw / 2, point.y, point.z) },
        'z-': { side: 'z-', d: Math.abs(point.z + fd / 2), p: new THREE.Vector3(point.x, point.y, -fd / 2) },
        'z+': { side: 'z+', d: Math.abs(fd / 2 - point.z), p: new THREE.Vector3(point.x, point.y, fd / 2) },
        'y+': { side: 'y+', d: Math.abs(y0 + fh - point.y) * 1.08, p: new THREE.Vector3(point.x, y0 + fh, point.z) },
        'y-': { side: 'y-', d: Math.abs(point.y - y0) * 1.12, p: new THREE.Vector3(point.x, y0, point.z) }
    };
    const distances = selectedKeys.map(k => candidateMap[k]).filter(Boolean);
    const chosen = (distances.length ? distances : Object.values(candidateMap)).sort((a, b) => a.d - b.d)[0];
    const inlet = chosen.p.clone();
    const wallJitter = Math.min(fw, fd) * 0.025;
    inlet.x += (Math.random() - 0.5) * wallJitter;
    inlet.y += (Math.random() - 0.5) * wallJitter;
    inlet.z += (Math.random() - 0.5) * wallJitter;
    inlet.x = Math.max(-fw / 2, Math.min(fw / 2, inlet.x));
    inlet.y = Math.max(y0, Math.min(y0 + fh, inlet.y));
    inlet.z = Math.max(-fd / 2, Math.min(fd / 2, inlet.z));
    return inlet;
}

function getAtmosphereAnimationStage(progress = 1, mediumMeta = getAtmosphereMediumMeta('nitriding')) {
    const p = clamp01(progress);
    if (p < 0.32) return { key: 'fill', label: '气氛充入', desc: `${mediumMeta.activeSpecies} 从炉壁/入口边界进入装载空间` };
    if (p < 0.72) return { key: 'diffuse', label: '浓度扩散', desc: '外圈先达到有效浓度，中心密集区逐步扩散' };
    return { key: 'react', label: '表面反应', desc: '工件表面形成有效反应层，死角区域仍保持低覆盖' };
}

function buildAtmosphereFogField(furnace, scoreMap, mediumMeta, progress = 1) {
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    const nx = Math.max(8, Math.min(13, Math.round(fw / 85)));
    const ny = Math.max(5, Math.min(8, Math.round(fh / 125)));
    const nz = Math.max(8, Math.min(13, Math.round(fd / 85)));
    const positions = [];
    const colors = [];
    const meta = [];
    const jitter = Math.min(fw, fd) * 0.016;
    const p = clamp01(progress);

    for (let ix = 0; ix < nx; ix++) {
        const xNorm = nx === 1 ? 0.5 : ix / (nx - 1);
        const x = -fw / 2 + xNorm * fw;
        for (let iy = 0; iy < ny; iy++) {
            const yNorm = ny === 1 ? 0.5 : iy / (ny - 1);
            const y = THERMAL_BASE_Y + yNorm * fh;
            for (let iz = 0; iz < nz; iz++) {
                const zNorm = nz === 1 ? 0.5 : iz / (nz - 1);
                const z = -fd / 2 + zNorm * fd;
                if (!isPointInsideThermalVolume(furnace, x, y, z)) continue;
                const shadow = estimateShadowAndCoreLag(x, y, z, furnace);
                const wallShape = getThermalShapeFactors(furnace, x, y, z, xNorm, yNorm, zNorm);
                const centerPenalty = clamp01(Math.sqrt((xNorm - 0.5) ** 2 + (zNorm - 0.5) ** 2) * -0.10 + 0.10);
                const concentration = clamp01(
                    0.88
                    - shadow.nearMaterial * 0.42
                    - shadow.shadow * 0.24
                    + wallShape.wallFactor * 0.16
                    - centerPenalty * 0.08
                );
                const densityScale = mediumMeta.particleDensityScale ?? 0.86;
                const keepChance = clamp01(0.18 + concentration * 0.82) * densityScale;
                if (Math.random() > keepChance) continue;
                const base = new THREE.Vector3(
                    x + (Math.random() - 0.5) * jitter,
                    y + (Math.random() - 0.5) * jitter,
                    z + (Math.random() - 0.5) * jitter
                );
                const inlet = getAtmosphereInletPointForPosition(base, furnace, mediumMeta);
                const phase = Math.random() * Math.PI * 2;
                const delay = Math.random() * 0.20;
                const fill = clamp01((p - delay) / Math.max(0.01, 1 - delay));
                const ease = 1 - Math.pow(1 - fill, 3);
                const pos = inlet.clone().lerp(base, ease);
                const c = getAtmosphereCoverageColor(concentration * (0.42 + ease * 0.58), mediumMeta.key);
                positions.push(pos.x, pos.y, pos.z);
                colors.push(c.r, c.g, c.b);
                meta.push({
                    base: [base.x, base.y, base.z],
                    inlet: [inlet.x, inlet.y, inlet.z],
                    phase,
                    delay,
                    concentration,
                    drift: 6 + (1 - concentration) * 18
                });
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.userData.atmosphereMeta = meta;
    const particleSize = Math.max(26, Math.min(62, Math.min(fw, fd) / (mediumMeta.visualTone === 'protective' ? 15 : 13)));
    const material = new THREE.PointsMaterial({
        size: particleSize,
        map: createThermalParticleTexture(),
        transparent: true,
        opacity: (mediumMeta.fogOpacity ?? 0.46) * (0.30 + p * 0.70),
        vertexColors: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending
    });
    material.userData = {
        baseOpacity: mediumMeta.fogOpacity ?? 0.46,
        baseSize: particleSize,
        mediumType: mediumMeta.key
    };
    const fog = new THREE.Points(geometry, material);
    fog.name = 'atmosphereConcentrationCloud';
    fog.renderOrder = 21;
    fog.userData = { isAtmosphereFogField: true, isAtmosphereConcentrationCloud: true };
    return fog;
}


function buildAtmosphereDiagnosticLabel(text, subText, position, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 560;
    canvas.height = 152;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bg = options.bg || 'rgba(20, 9, 6, 0.80)';
    const stroke = options.stroke || 'rgba(251, 146, 60, 0.86)';
    const primary = options.primary || '#fff7ed';
    const secondary = options.secondary || 'rgba(255, 237, 213, 0.86)';
    ctx.fillStyle = bg;
    roundRect(ctx, 14, 18, 532, 110, 24);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = primary;
    ctx.font = '800 32px sans-serif';
    ctx.fillText(text, 36, 62);
    ctx.fillStyle = secondary;
    ctx.font = '500 22px sans-serif';
    ctx.fillText(subText || '', 36, 98);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.94, depthWrite: false, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(options.width || 230, options.height || 62, 1);
    sprite.renderOrder = options.renderOrder || 72;
    sprite.userData = { isAtmosphereDiagnosticLabel: true };
    return sprite;
}

function buildAtmosphereRiskMarkers(furnace, scoreMap) {
    const group = new THREE.Group();
    group.name = 'atmosphereRiskMarkersTop3';
    const sorted = [...scoreMap.values()]
        .filter(entry => entry && ((entry.deadFaceCount || 0) > 0 || (entry.weakExchangeFaceCount || 0) > 0 || entry.score <= 0.72))
        .sort((a, b) => {
            const pa = (a.deadFaceCount || 0) > 0 ? 0 : 1;
            const pb = (b.deadFaceCount || 0) > 0 ? 0 : 1;
            return pa - pb || a.score - b.score || (b.pathBlockerCount || 0) - (a.pathBlockerCount || 0);
        })
        .slice(0, 3);

    sorted.forEach((entry, idx) => {
        const item = entry.item;
        if (!item) return;
        const center = getItemCenterWorld(item, furnace);
        const isDead = (entry.deadFaceCount || 0) > 0;
        const severe = (entry.severeDeadFaceCount || 0) > 0 || (entry.deadFaceCount || 0) >= 2;
        const color = isDead ? (severe ? 0xef4444 : 0xf97316) : 0xfacc15;
        const geometry = new THREE.BoxGeometry((item.w || 1) + 22, (item.h || 1) + 22, (item.d || 1) + 22);
        const edges = new THREE.EdgesGeometry(geometry);
        const mat = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: isDead ? (severe ? 0.92 : 0.76) : 0.62,
            depthWrite: false
        });
        const marker = new THREE.LineSegments(edges, mat);
        marker.position.copy(center);
        marker.renderOrder = 66;
        marker.userData = { isAtmosphereRiskMarker: true, risk: 1 - entry.score, rank: idx + 1, riskType: isDead ? 'dead' : 'weak' };
        group.add(marker);

        const planeAxis = entry.worstFace?.key?.[0] || 'z';
        const planeGeo = planeAxis === 'y'
            ? new THREE.PlaneGeometry((item.w || 1) + 28, (item.d || 1) + 28)
            : (planeAxis === 'x'
                ? new THREE.PlaneGeometry((item.d || 1) + 28, (item.h || 1) + 28)
                : new THREE.PlaneGeometry((item.w || 1) + 28, (item.h || 1) + 28));
        const planeMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: isDead ? (severe ? 0.18 : 0.12) : 0.075,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const plane = new THREE.Mesh(planeGeo, planeMat);
        plane.position.copy(center);
        if (planeAxis === 'x') plane.rotation.y = Math.PI / 2;
        if (planeAxis === 'y') plane.rotation.x = -Math.PI / 2;
        plane.renderOrder = 65;
        plane.userData = { isAtmosphereRiskMarker: true, isAtmosphereDeadCornerPatch: isDead, isAtmosphereWeakExchangePatch: !isDead, rank: idx + 1 };
        group.add(plane);

        const labelPos = center.clone().add(new THREE.Vector3(0, (item.h || 1) * 0.62 + 58 + idx * 18, 0));
        const label = buildAtmosphereDiagnosticLabel(
            `${isDead ? '真实死角' : '低交换区'} #${idx + 1}`,
            `${entry.worstFace?.label || '风险表面'} · ${Math.round((entry.score || 0) * 100)}%`,
            labelPos,
            {
                bg: isDead ? (severe ? 'rgba(69, 10, 10, 0.82)' : 'rgba(67, 20, 7, 0.80)') : 'rgba(63, 43, 8, 0.78)',
                stroke: isDead ? (severe ? 'rgba(248, 113, 113, 0.9)' : 'rgba(251, 146, 60, 0.9)') : 'rgba(250, 204, 21, 0.86)',
                width: isDead ? 210 : 218,
                height: 58,
                renderOrder: 74
            }
        );
        group.add(label);
    });
    return group;
}

function applyAtmosphereTintToItems(furnace, scoreMap, mediumMeta) {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !furnace) return;
    const carbonMode = isCarbonAtmosphere(mediumMeta.key);
    group.traverse(child => {
        if (!child.isMesh || !child.userData || !child.userData.itemId) return;
        const entry = scoreMap.get(child.userData.itemId);
        const score = entry ? entry.score : 0.65;
        const tint = getAtmosphereCoverageColor(score, mediumMeta.key);
        const protectiveMode = mediumMeta.key === 'protective';
        getMeshMaterials(child).forEach(mat => {
            if (!mat.color) return;
            saveOriginalMaterialIfNeeded(mat);
            if (carbonMode) {
                const core = new THREE.Color(score > 0.62 ? 0x8a4b16 : 0x4a1710);
                mat.color.copy(core.lerp(tint, 0.28 + score * 0.28));
            } else if (protectiveMode) {
                const base = new THREE.Color(0xbfd7e3);
                mat.color.copy(base.lerp(tint, 0.34 + score * 0.18));
            } else {
                mat.color.copy(tint);
            }
            if (mat.emissive) {
                mat.emissive.copy(tint);
                mat.emissive.multiplyScalar(carbonMode ? (score > 0.72 ? 0.72 : 0.42) : (protectiveMode ? (score > 0.72 ? 0.38 : 0.20) : (score > 0.72 ? 0.52 : 0.28)));
                mat.emissiveIntensity = carbonMode ? (0.18 + score * 0.48) : (protectiveMode ? (0.08 + score * 0.24) : (0.10 + score * 0.34));
            }
            mat.transparent = true;
            mat.opacity = carbonMode ? (0.48 + score * 0.30) : (protectiveMode ? (0.50 + score * 0.24) : (0.56 + score * 0.34));
            mat.needsUpdate = true;
        });
    });
}

function buildAtmosphereSurfaceLayerVisual(furnace, scoreMap, mediumMeta, progress = 1) {
    const group = new THREE.Group();
    group.name = 'atmosphereSurfaceReactionLayer';

    const entries = [...scoreMap.values()].sort((a, b) => b.score - a.score).slice(0, 90);
    const p = clamp01(progress);
    const carbonMode = isCarbonAtmosphere(mediumMeta.key);
    entries.forEach(entry => {
        const item = entry.item;
        if (!item) return;
        const score = clamp01(entry.score || 0);
        const reactionProgress = clamp01((p - 0.58 + score * 0.18) / 0.42);
        const layerColor = getAtmosphereCoverageColor(Math.max(0.50, score), mediumMeta.key);
        const pad = carbonMode ? (4 + score * 9) : (3 + score * 6);
        const geo = new THREE.BoxGeometry((item.w || 1) + pad, (item.h || 1) + pad, (item.d || 1) + pad);
        const layerBoost = mediumMeta.surfaceLayerBoost ?? 1;
        const baseOpacity = (carbonMode ? (0.062 + score * 0.13) : (0.048 + score * 0.095)) * layerBoost;
        const mat = new THREE.MeshBasicMaterial({
            color: layerColor,
            transparent: true,
            opacity: baseOpacity * (0.18 + reactionProgress * 0.82),
            side: THREE.BackSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        mat.userData = { baseOpacity, score, reactionDelay: 0.58 - score * 0.18 };
        const shell = new THREE.Mesh(geo, mat);
        shell.position.copy(getItemCenterWorld(item, furnace));
        shell.renderOrder = 31;
        shell.userData = { isAtmosphereSurfaceLayer: true, itemId: item.id, score };
        group.add(shell);

        const edgeGeo = new THREE.EdgesGeometry(geo);
        const edgeBaseOpacity = (carbonMode ? (0.24 + score * 0.55) : (0.20 + score * 0.42)) * layerBoost;
        const edgeMat = new THREE.LineBasicMaterial({
            color: mediumMeta.surfaceLayerColor || mediumMeta.colorHigh,
            transparent: true,
            opacity: edgeBaseOpacity * (0.15 + reactionProgress * 0.85),
            depthWrite: false
        });
        edgeMat.userData = { baseOpacity: edgeBaseOpacity, score, reactionDelay: 0.56 - score * 0.15 };
        const edge = new THREE.LineSegments(edgeGeo, edgeMat);
        edge.position.copy(shell.position);
        edge.renderOrder = 32;
        edge.userData = { isAtmosphereSurfaceLayer: true, itemId: item.id, score };
        group.add(edge);
    });
    return group;
}

function buildAtmosphereBoundaryVisual(furnace, mediumMeta) {
    const group = new THREE.Group();
    group.name = 'atmosphereCoverageBoundary';
    const fw = Number(furnace.w || 600);
    const fh = Number(furnace.h || 600);
    const fd = Number(furnace.d || 600);
    const y0 = THERMAL_BASE_Y;
    const mainColor = mediumMeta.colorHigh;
    const inletOpacity = mediumMeta.visualTone === 'protective' ? 0.055 : 0.085;
    const mat = new THREE.MeshBasicMaterial({
        color: mainColor,
        transparent: true,
        opacity: inletOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const sideMat = mat.clone();
    sideMat.opacity *= 0.45;

    const planes = [
        { key: 'x-', geo: new THREE.PlaneGeometry(fd, fh), pos: [-fw / 2, y0 + fh / 2, 0], rot: [0, Math.PI / 2, 0], normal: new THREE.Vector3(1, 0, 0), label: '左侧入口' },
        { key: 'x+', geo: new THREE.PlaneGeometry(fd, fh), pos: [fw / 2, y0 + fh / 2, 0], rot: [0, Math.PI / 2, 0], normal: new THREE.Vector3(-1, 0, 0), label: '右侧入口' },
        { key: 'z-', geo: new THREE.PlaneGeometry(fw, fh), pos: [0, y0 + fh / 2, -fd / 2], rot: [0, 0, 0], normal: new THREE.Vector3(0, 0, 1), label: '前侧入口' },
        { key: 'z+', geo: new THREE.PlaneGeometry(fw, fh), pos: [0, y0 + fh / 2, fd / 2], rot: [0, 0, 0], normal: new THREE.Vector3(0, 0, -1), label: '后侧入口' },
        { key: 'y+', geo: new THREE.PlaneGeometry(fw, fd), pos: [0, y0 + fh, 0], rot: [-Math.PI / 2, 0, 0], normal: new THREE.Vector3(0, -1, 0), label: '顶部补给' },
        { key: 'y-', geo: new THREE.PlaneGeometry(fw, fd), pos: [0, y0, 0], rot: [-Math.PI / 2, 0, 0], normal: new THREE.Vector3(0, 1, 0), label: '底部补给' }
    ];

    const primaryKeys = getSelectedAtmosphereInletDirections(mediumMeta);

    planes.forEach(p => {
        const isPrimary = primaryKeys.includes(p.key);
        const mesh = new THREE.Mesh(p.geo, isPrimary ? mat.clone() : sideMat.clone());
        mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
        mesh.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
        mesh.renderOrder = 8;
        mesh.userData = { isAtmosphereBoundary: true, side: p.key, isPrimaryInlet: isPrimary };
        group.add(mesh);
        if (isPrimary) {
            group.add(createProcessNozzleVisual(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]), p.normal, mainColor, '气氛喷入口', {
                name: 'atmosphereInletNozzle',
                radius: Math.max(20, Math.min(34, Math.min(fw, fd) / 24)),
                length: Math.max(62, Math.min(108, Math.max(fw, fh, fd) / 9)),
                opacity: 0.66,
                labelWidth: 166,
                labelOffset: new THREE.Vector3(0, 48, 0)
            }));
        }
    });

    const arrowLen = Math.max(90, Math.min(190, Math.max(fw, fh, fd) * 0.16));
    const arrowColor = mediumMeta.surfaceLayerColor || mediumMeta.colorHigh;
    const arrowOrigins = [];
    primaryKeys.forEach(key => {
        if (key === 'x-') arrowOrigins.push(new THREE.Vector3(-fw / 2, y0 + fh * 0.52, -fd * 0.22), new THREE.Vector3(-fw / 2, y0 + fh * 0.35, fd * 0.22));
        if (key === 'x+') arrowOrigins.push(new THREE.Vector3(fw / 2, y0 + fh * 0.52, fd * 0.22), new THREE.Vector3(fw / 2, y0 + fh * 0.35, -fd * 0.22));
        if (key === 'z-') arrowOrigins.push(new THREE.Vector3(-fw * 0.22, y0 + fh * 0.66, -fd / 2), new THREE.Vector3(fw * 0.22, y0 + fh * 0.42, -fd / 2));
        if (key === 'z+') arrowOrigins.push(new THREE.Vector3(fw * 0.22, y0 + fh * 0.66, fd / 2), new THREE.Vector3(-fw * 0.22, y0 + fh * 0.42, fd / 2));
        if (key === 'y+') arrowOrigins.push(new THREE.Vector3(-fw * 0.24, y0 + fh, 0), new THREE.Vector3(fw * 0.24, y0 + fh, 0));
        if (key === 'y-') arrowOrigins.push(new THREE.Vector3(-fw * 0.24, y0, 0), new THREE.Vector3(fw * 0.24, y0, 0));
    });
    arrowOrigins.slice(0, mediumMeta.visualTone === 'protective' ? 8 : 6).forEach(origin => {
        const dir = new THREE.Vector3(-origin.x * 0.65, (y0 + fh * 0.50) - origin.y, -origin.z * 0.65).normalize();
        if (dir.lengthSq() < 0.001) dir.set(0, -1, 0);
        const arrow = new THREE.ArrowHelper(dir, origin, arrowLen, arrowColor, arrowLen * 0.24, arrowLen * 0.12);
        arrow.renderOrder = 40;
        arrow.userData = { isAtmosphereBoundary: true, isAtmosphereInletArrow: true };
        group.add(arrow);
    });

    const label = buildAtmosphereDiagnosticLabel(
        '气氛入口 / 扩散方向',
        `${mediumMeta.activeSpecies} · ${getAtmosphereInletDirectionLabel(primaryKeys, true)}`,
        new THREE.Vector3(-fw * 0.42, y0 + fh + 70, -fd * 0.42),
        {
            bg: 'rgba(6, 24, 28, 0.72)',
            stroke: `rgba(${new THREE.Color(arrowColor).r * 255}, ${new THREE.Color(arrowColor).g * 255}, ${new THREE.Color(arrowColor).b * 255}, 0.78)`,
            primary: '#ecfeff',
            secondary: 'rgba(207, 250, 254, 0.86)',
            width: 250,
            height: 64,
            renderOrder: 75
        }
    );
    group.add(label);
    return group;
}

function updateAtmosphereConcentrationCloud(now, progress = 1) {
    const cloud = thermalSimRuntime.pointCloud;
    if (!cloud || !cloud.geometry || !cloud.geometry.userData.atmosphereMeta) return;
    const meta = cloud.geometry.userData.atmosphereMeta || [];
    const posAttr = cloud.geometry.getAttribute('position');
    const colorAttr = cloud.geometry.getAttribute('color');
    const mediumType = thermalSimRuntime.selectedAtmosphereMediumType || cloud.material?.userData?.mediumType || 'nitriding';
    const p = clamp01(progress);
    const time = now * 0.001;
    for (let i = 0; i < meta.length; i++) {
        const m = meta[i];
        const delay = typeof m.delay === 'number' ? m.delay : 0;
        const fill = clamp01((p - delay) / Math.max(0.01, 1 - delay));
        const ease = 1 - Math.pow(1 - fill, 3);
        const inlet = m.inlet || [0, 0, 0];
        const base = m.base || [0, 0, 0];
        const drift = (m.drift || 10) * (0.35 + ease * 0.65);
        const phase = m.phase || 0;
        const x = inlet[0] + (base[0] - inlet[0]) * ease + Math.sin(time * 0.75 + phase) * drift * 0.45;
        const y = inlet[1] + (base[1] - inlet[1]) * ease + Math.sin(time * 0.55 + phase * 1.31) * drift * 0.30;
        const z = inlet[2] + (base[2] - inlet[2]) * ease + Math.cos(time * 0.70 + phase * 0.77) * drift * 0.45;
        posAttr.setXYZ(i, x, y, z);
        if (colorAttr) {
            const concentration = clamp01((m.concentration || 0.7) * (0.35 + ease * 0.65));
            const c = getAtmosphereCoverageColor(concentration, mediumType);
            colorAttr.setXYZ(i, c.r, c.g, c.b);
        }
    }
    posAttr.needsUpdate = true;
    if (colorAttr) colorAttr.needsUpdate = true;
    if (cloud.material) {
        const baseOpacity = cloud.material.userData?.baseOpacity ?? 0.46;
        const baseSize = cloud.material.userData?.baseSize || cloud.material.size || 42;
        cloud.material.opacity = baseOpacity * (0.28 + p * 0.72) * (0.92 + Math.sin(time * 1.4) * 0.08);
        cloud.material.size = baseSize * (0.82 + p * 0.20 + Math.sin(time * 1.2) * 0.025);
        cloud.material.needsUpdate = true;
    }
}

function updateAtmosphereSurfaceReactionLayer(now, progress = 1) {
    const group = thermalSimRuntime.atmosphereSurfaceGroup;
    if (!group) return;
    const p = clamp01(progress);
    const pulse = 0.88 + (Math.sin(now * 0.003) + 1) * 0.06;
    group.traverse(child => {
        if (!child.material || !child.userData?.isAtmosphereSurfaceLayer) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(mat => {
            const baseOpacity = mat.userData?.baseOpacity ?? mat.opacity ?? 0.2;
            const delay = mat.userData?.reactionDelay ?? 0.55;
            const reaction = clamp01((p - delay) / Math.max(0.01, 1 - delay));
            mat.opacity = baseOpacity * (0.14 + reaction * 0.86) * pulse;
            mat.needsUpdate = true;
        });
    });
}

function updateAtmosphereCoverageAnimation(now) {
    if (thermalSimRuntime.activeMode !== 'atmosphere') return;
    if (thermalSimRuntime.isPlaying && !thermalSimRuntime.paused) {
        const elapsed = now - (thermalSimRuntime.atmosphereAnimationStartedAt || thermalSimRuntime.startedAt || now);
        const duration = thermalSimRuntime.durationMs || 8500;
        thermalSimRuntime.progress = clamp01(elapsed / duration);
        if (thermalSimRuntime.progress >= 1) {
            thermalSimRuntime.isPlaying = false;
            thermalSimRuntime.paused = false;
        }
    }
    const progress = typeof thermalSimRuntime.progress === 'number' ? thermalSimRuntime.progress : 1;

    // UX V2.3：气氛动画恢复较顺滑的视觉，但限制到约 30fps；UI 回调限制到约 180ms。
    const shouldUpdateVisual = !thermalSimRuntime.lastAtmosphereVisualUpdateAt ||
        now - thermalSimRuntime.lastAtmosphereVisualUpdateAt >= 33 ||
        progress >= 1 ||
        !thermalSimRuntime.isPlaying;
    if (shouldUpdateVisual) {
        thermalSimRuntime.lastAtmosphereVisualUpdateAt = now;
        updateAtmosphereConcentrationCloud(now, progress);
        updateAtmosphereSurfaceReactionLayer(now, progress);
    }

    if (thermalSimRuntime.metrics) {
        const mediumMeta = getAtmosphereMediumMeta(thermalSimRuntime.selectedAtmosphereMediumType || 'nitriding');
        const stage = getAtmosphereAnimationStage(progress, mediumMeta);
        thermalSimRuntime.metrics.animationPlaying = !!thermalSimRuntime.isPlaying && !thermalSimRuntime.paused;
        thermalSimRuntime.metrics.progress = Math.round(progress * 100);
        thermalSimRuntime.metrics.atmosphereStageLabel = stage.label;
        thermalSimRuntime.metrics.atmosphereStageDesc = stage.desc;
        const shouldUpdateUi = !thermalSimRuntime.lastAtmosphereUiUpdateAt ||
            now - thermalSimRuntime.lastAtmosphereUiUpdateAt >= 180 ||
            progress >= 1 ||
            !thermalSimRuntime.isPlaying;
        if (shouldUpdateUi && thermalSimRuntime.isPlaying && !thermalSimRuntime.paused && typeof thermalSimRuntime.onUpdate === 'function') {
            thermalSimRuntime.lastAtmosphereUiUpdateAt = now;
            thermalSimRuntime.onUpdate(thermalSimRuntime.metrics);
        }
        if (!thermalSimRuntime.isPlaying && progress >= 1 && typeof thermalSimRuntime.onFinish === 'function') {
            const finish = thermalSimRuntime.onFinish;
            thermalSimRuntime.onFinish = null;
            finish(thermalSimRuntime.metrics);
        }
    }
}

export function renderAtmosphereCoverageSimulation(options = {}) {
    const furnace = getCurrentThermalFurnace();
    if (!furnace) return null;

    const wasAtmosphere = thermalSimRuntime.activeMode === 'atmosphere';
    const keepPlaying = !!options.keepPlaying && wasAtmosphere && thermalSimRuntime.isPlaying && !thermalSimRuntime.paused;
    const previousProgress = wasAtmosphere && typeof thermalSimRuntime.progress === 'number' ? thermalSimRuntime.progress : 1;
    const progress = typeof options.progress === 'number' ? clamp01(options.progress) : (keepPlaying ? previousProgress : 1);

    clearThermalGroupChildren();
    restoreThermalItemMaterials();
    setThermalSceneTheme(true, 'atmosphere');

    const mediumMeta = getAtmosphereMediumMeta(options.mediumType || thermalSimRuntime.selectedAtmosphereMediumType || 'nitriding');
    const inletDirections = normalizeAtmosphereInletDirections(options.inletDirections || thermalSimRuntime.selectedAtmosphereInletDirections, mediumMeta);
    thermalSimRuntime.selectedAtmosphereInletDirections = inletDirections;
    if (scene && mediumMeta.backgroundColor) {
        scene.background = new THREE.Color(mediumMeta.backgroundColor);
    }
    const { scores } = calculateAtmosphereCoverageScores(furnace, mediumMeta.key);
    const group = ensureThermalSimulationGroup();
    const equipmentContext = buildProcessEquipmentContext(furnace, 'atmosphere');
    if (equipmentContext) group.add(equipmentContext);
    const boundary = buildAtmosphereBoundaryVisual(furnace, mediumMeta);
    const fog = buildAtmosphereFogField(furnace, scores, mediumMeta, progress);
    const surfaceLayer = buildAtmosphereSurfaceLayerVisual(furnace, scores, mediumMeta, progress);
    const risks = buildAtmosphereRiskMarkers(furnace, scores);
    const ringBoundary = buildRingThermalBoundary(furnace);

    group.add(boundary);
    group.add(fog);
    group.add(surfaceLayer);
    group.add(risks);
    if (ringBoundary) group.add(ringBoundary);
    group.visible = true;

    applyAtmosphereTintToItems(furnace, scores, mediumMeta);

    thermalSimRuntime.visible = true;
    thermalSimRuntime.activeMode = 'atmosphere';
    thermalSimRuntime.isPlaying = keepPlaying;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.progress = progress;
    thermalSimRuntime.durationMs = options.durationMs || thermalSimRuntime.durationMs || 8500;
    thermalSimRuntime.pointCloud = fog;
    thermalSimRuntime.sourceGroup = boundary;
    thermalSimRuntime.riskGroup = risks;
    thermalSimRuntime.atmosphereSurfaceGroup = surfaceLayer;
    thermalSimRuntime.atmosphereScores = scores;
    thermalSimRuntime.selectedAtmosphereMediumType = mediumMeta.key;
    thermalSimRuntime.selectedAtmosphereInletDirections = inletDirections;
    thermalSimRuntime.selectedRadiationItemId = null;
    thermalSimRuntime.selectedRadiationEntry = null;
    thermalSimRuntime.selectedRadiationBatch = null;
    thermalSimRuntime.selectedRadiationSection = null;
    thermalSimRuntime.metrics = calculateAtmosphereCoverageMetrics(furnace, scores, mediumMeta);
    const stage = getAtmosphereAnimationStage(progress, mediumMeta);
    thermalSimRuntime.metrics.progress = Math.round(progress * 100);
    thermalSimRuntime.metrics.animationPlaying = keepPlaying;
    thermalSimRuntime.metrics.atmosphereStageLabel = stage.label;
    thermalSimRuntime.metrics.atmosphereStageDesc = stage.desc;
    return thermalSimRuntime.metrics;
}

export function setAtmosphereMediumType(mediumType = 'nitriding') {
    const meta = getAtmosphereMediumMeta(mediumType);
    thermalSimRuntime.selectedAtmosphereMediumType = meta.key;
    return renderAtmosphereCoverageSimulation({ mediumType: meta.key, progress: 1 });
}

export function setAtmosphereInletDirections(directions = null) {
    const mediumMeta = getAtmosphereMediumMeta(thermalSimRuntime.selectedAtmosphereMediumType || 'nitriding');
    thermalSimRuntime.selectedAtmosphereInletDirections = normalizeAtmosphereInletDirections(directions, mediumMeta);
    return renderAtmosphereCoverageSimulation({
        mediumType: mediumMeta.key,
        inletDirections: thermalSimRuntime.selectedAtmosphereInletDirections,
        progress: thermalSimRuntime.activeMode === 'atmosphere' ? (thermalSimRuntime.progress || 1) : 1,
        keepPlaying: thermalSimRuntime.isPlaying && !thermalSimRuntime.paused
    });
}

export function toggleAtmosphereInletDirection(directionKey = 'z-') {
    const mediumMeta = getAtmosphereMediumMeta(thermalSimRuntime.selectedAtmosphereMediumType || 'nitriding');
    const key = getAtmosphereInletDirectionMeta(directionKey).key;
    const current = getSelectedAtmosphereInletDirections(mediumMeta);
    let next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    if (!next.length) next = [key];
    thermalSimRuntime.selectedAtmosphereInletDirections = normalizeAtmosphereInletDirections(next, mediumMeta);
    return renderAtmosphereCoverageSimulation({
        mediumType: mediumMeta.key,
        inletDirections: thermalSimRuntime.selectedAtmosphereInletDirections,
        progress: thermalSimRuntime.activeMode === 'atmosphere' ? (thermalSimRuntime.progress || 1) : 1,
        keepPlaying: thermalSimRuntime.isPlaying && !thermalSimRuntime.paused
    });
}

export function resetAtmosphereInletDirections() {
    const mediumMeta = getAtmosphereMediumMeta(thermalSimRuntime.selectedAtmosphereMediumType || 'nitriding');
    thermalSimRuntime.selectedAtmosphereInletDirections = getDefaultAtmosphereInletsForMedium(mediumMeta);
    return renderAtmosphereCoverageSimulation({ mediumType: mediumMeta.key, inletDirections: thermalSimRuntime.selectedAtmosphereInletDirections, progress: 1 });
}


export function playAtmosphereCoverageAnimation(options = {}) {
    const furnace = getCurrentThermalFurnace();
    if (!furnace) return null;
    if (thermalSimRuntime.activeMode !== 'atmosphere') {
        renderAtmosphereCoverageSimulation({ mediumType: thermalSimRuntime.selectedAtmosphereMediumType || 'nitriding', progress: 0 });
    }
    const duration = options.durationMs || thermalSimRuntime.durationMs || 8500;
    const startProgress = typeof options.startProgress === 'number'
        ? clamp01(options.startProgress)
        : (thermalSimRuntime.activeMode === 'atmosphere' && thermalSimRuntime.paused ? clamp01(thermalSimRuntime.progress || 0) : 0);
    thermalSimRuntime.activeMode = 'atmosphere';
    thermalSimRuntime.visible = true;
    thermalSimRuntime.isPlaying = true;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.progress = startProgress;
    thermalSimRuntime.durationMs = duration;
    thermalSimRuntime.atmosphereAnimationStartedAt = performance.now() - startProgress * duration;
    thermalSimRuntime.lastAtmosphereVisualUpdateAt = 0;
    thermalSimRuntime.lastAtmosphereUiUpdateAt = 0;
    thermalSimRuntime.onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : thermalSimRuntime.onUpdate;
    thermalSimRuntime.onFinish = typeof options.onFinish === 'function' ? options.onFinish : thermalSimRuntime.onFinish;
    updateAtmosphereCoverageAnimation(performance.now());
    return thermalSimRuntime.metrics;
}

export function pauseAtmosphereCoverageAnimation() {
    if (thermalSimRuntime.activeMode !== 'atmosphere') return thermalSimRuntime.metrics;
    thermalSimRuntime.paused = true;
    thermalSimRuntime.isPlaying = false;
    if (thermalSimRuntime.metrics) {
        thermalSimRuntime.metrics.animationPlaying = false;
        thermalSimRuntime.metrics.progress = Math.round((thermalSimRuntime.progress || 0) * 100);
    }
    return thermalSimRuntime.metrics;
}

export function resetAtmosphereCoverageAnimation() {
    if (thermalSimRuntime.activeMode !== 'atmosphere') {
        return renderAtmosphereCoverageSimulation({ mediumType: thermalSimRuntime.selectedAtmosphereMediumType || 'nitriding', progress: 0 });
    }
    thermalSimRuntime.isPlaying = false;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.progress = 0;
    updateAtmosphereCoverageAnimation(performance.now());
    return thermalSimRuntime.metrics;
}

export function getAtmosphereCoverageRuntime() {
    const meta = getAtmosphereMediumMeta(thermalSimRuntime.selectedAtmosphereMediumType || 'nitriding');
    return {
        visible: thermalSimRuntime.visible && thermalSimRuntime.activeMode === 'atmosphere',
        metrics: thermalSimRuntime.activeMode === 'atmosphere' ? thermalSimRuntime.metrics : null,
        scores: thermalSimRuntime.atmosphereScores,
        mediumType: meta.key,
        mediumMeta: meta,
        inletDirections: getSelectedAtmosphereInletDirections(meta),
        inletDirectionLabel: getAtmosphereInletDirectionLabel(getSelectedAtmosphereInletDirections(meta)),
        progress: thermalSimRuntime.activeMode === 'atmosphere' ? thermalSimRuntime.progress : 0,
        animationPlaying: thermalSimRuntime.activeMode === 'atmosphere' ? !!thermalSimRuntime.isPlaying && !thermalSimRuntime.paused : false
    };
}

function normalizeRadiationText(value) {
    return String(value || '').trim().toLowerCase();
}

function matchesRadiationBatchCriteria(item, criteria = {}) {
    if (!item) return false;
    const name = normalizeRadiationText(criteria.name);
    const showName = normalizeRadiationText(criteria.showName);
    const itemCode = normalizeRadiationText(criteria.itemCode);
    const itemName = normalizeRadiationText(item.name);
    const itemShowName = normalizeRadiationText(item.showName);
    const itemItemCode = normalizeRadiationText(item.itemCode);

    if (itemCode && itemItemCode && itemCode === itemItemCode) return true;
    if (showName && (showName === itemShowName || showName === itemName)) return true;
    if (name && (name === itemName || name === itemShowName)) return true;
    return false;
}

function getRadiationBatchLabel(criteria = {}, entries = []) {
    const firstItem = entries[0]?.item || {};
    return criteria.showName || criteria.name || criteria.itemCode || firstItem.showName || firstItem.name || '当前批次';
}

function buildBatchRadiationRays(entries) {
    const selectedEntries = [...entries]
        .sort((a, b) => (a.score || 0) - (b.score || 0))
        .slice(0, 8);
    const positions = [];
    const colors = [];
    const gold = new THREE.Color(0xffd166);
    const red = new THREE.Color(0xff1744);
    const weak = new THREE.Color(0xff8a00);

    selectedEntries.forEach(entry => {
        const rays = [
            ...(entry.visibleRays || []).slice(0, 3),
            ...(entry.blockedRays || []).slice(0, 3)
        ];
        rays.forEach(ray => {
            const c = ray.blocked ? red : (entry.score > 0.72 ? gold : weak);
            positions.push(ray.source.x, ray.source.y, ray.source.z, ray.target.x, ray.target.y, ray.target.z);
            colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
        });
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.70,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const rays = new THREE.LineSegments(geometry, material);
    rays.name = 'batchRadiationExposureRays';
    rays.userData = { isThermalRays: true, isRadiationExposureRays: true, isBatchRadiationRays: true };
    return rays;
}

function buildBatchRadiationMarkers(furnace, entries) {
    const group = new THREE.Group();
    group.name = 'batchRadiationMarkers';

    const sorted = [...entries].sort((a, b) => (a.score || 0) - (b.score || 0));
    sorted.slice(0, 10).forEach((entry, idx) => {
        const item = entry.item;
        if (!item) return;
        const risk = 1 - (entry.score || 0.5);
        if (idx > 0 && risk < 0.30) return;
        const geometry = new THREE.BoxGeometry((item.w || 1) + 18, (item.h || 1) + 18, (item.d || 1) + 18);
        const edges = new THREE.EdgesGeometry(geometry);
        const mat = new THREE.LineBasicMaterial({
            color: idx === 0 ? 0xfacc15 : (risk > 0.58 ? 0xff1744 : 0xf97316),
            transparent: true,
            opacity: idx === 0 ? 0.92 : 0.58,
            depthWrite: false
        });
        const marker = new THREE.LineSegments(edges, mat);
        marker.position.copy(getItemCenterWorld(item, furnace));
        marker.userData = { isRadiationRiskMarker: true, isBatchRadiationMarker: true, risk };
        group.add(marker);
    });

    return group;
}

function applyBatchRadiationTintToItems(furnace, scoreMap, matchedEntries) {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !furnace) return;
    const batchIds = new Set(matchedEntries.map(entry => entry.item?.id).filter(Boolean));
    const sorted = [...matchedEntries].sort((a, b) => (a.score || 0) - (b.score || 0));
    const worstId = sorted[0]?.item?.id;
    const highRiskIds = new Set(sorted.filter(entry => (entry.score || 0) < 0.58).map(entry => entry.item?.id));

    group.traverse(child => {
        if (!child.isMesh || !child.userData || !child.userData.itemId) return;
        const itemId = child.userData.itemId;
        const entry = scoreMap.get(itemId);
        const score = entry ? entry.score : 0.55;
        let tint = getRadiationScoreColor(score);
        let opacity = 0.12;
        let emissiveScale = 0.10;
        let emissiveIntensity = 0.06;

        if (batchIds.has(itemId)) {
            opacity = 0.78 + score * 0.18;
            emissiveScale = score >= 0.72 ? 0.52 : 0.35;
            emissiveIntensity = 0.16 + score * 0.36;
        }
        if (highRiskIds.has(itemId)) {
            opacity = 0.90;
            emissiveScale = 0.55;
            emissiveIntensity = 0.45;
        }
        if (itemId === worstId) {
            tint = new THREE.Color(0xfacc15);
            opacity = 0.98;
            emissiveScale = 0.72;
            emissiveIntensity = 0.68;
        }

        getMeshMaterials(child).forEach(mat => {
            if (!mat.color) return;
            saveOriginalMaterialIfNeeded(mat);
            mat.color.copy(tint);
            if (mat.emissive) {
                mat.emissive.copy(tint);
                mat.emissive.multiplyScalar(emissiveScale);
                mat.emissiveIntensity = emissiveIntensity;
            }
            mat.transparent = true;
            mat.opacity = opacity;
            mat.needsUpdate = true;
        });
    });
}

function buildBatchRadiationMetric(furnace, scoreMap, entries, criteria = {}) {
    const metrics = calculateRadiationMetrics(furnace, scoreMap);
    const sorted = [...entries].sort((a, b) => (a.score || 0) - (b.score || 0));
    const worst = sorted[0] || null;
    const avgScore = entries.length ? entries.reduce((s, v) => s + (v.score || 0), 0) / entries.length : 0;
    const minScore = worst ? (worst.score || 0) : 0;
    const highRiskEntries = entries.filter(v => (v.score || 0) < 0.58);
    const severeRiskEntries = entries.filter(v => (v.score || 0) < 0.42);
    const blockedRayCount = entries.reduce((s, v) => s + (v.blockedRayCount || 0), 0);
    const visibleRayCount = entries.reduce((s, v) => s + (v.visibleRayCount || 0), 0);

    const blockerSummary = new Map();
    entries.forEach(entry => {
        (entry.blockers || []).forEach(({ item, count }) => {
            if (!item) return;
            const existed = blockerSummary.get(item.id) || { id: item.id, name: item.name || '遮挡工件', count: 0 };
            existed.count += count || 0;
            blockerSummary.set(item.id, existed);
        });
    });
    const blockers = [...blockerSummary.values()].sort((a, b) => b.count - a.count).slice(0, 6);

    const layerSummary = new Map();
    entries.forEach(entry => {
        const item = entry.item || {};
        const layer = item.layer || (typeof item.y === 'number' ? Math.round(item.y) : 1);
        const stat = layerSummary.get(layer) || { layer, count: 0, riskCount: 0 };
        stat.count += 1;
        if ((entry.score || 0) < 0.58) stat.riskCount += 1;
        layerSummary.set(layer, stat);
    });
    const riskLayer = [...layerSummary.values()].sort((a, b) => b.riskCount - a.riskCount || b.count - a.count)[0];

    const label = getRadiationBatchLabel(criteria, entries);
    const scorePercent = Math.round(avgScore * 100);
    const minPercent = Math.round(minScore * 100);
    const riskText = severeRiskEntries.length > 0 ? '高' : (highRiskEntries.length > 0 ? '中' : '低');
    const suggestion = severeRiskEntries.length > 0
        ? '该批次存在明显低暴露实例，建议点击“定位最低暴露件”查看具体路径，并优先移向外圈/上层或增加周围间距。'
        : (highRiskEntries.length > 0
            ? '该批次存在局部遮挡，建议优先复核最低暴露件及其相邻遮挡来源。'
            : '该批次整体辐射暴露较均衡，当前无明显批次级遮挡风险。');

    metrics.selectedBatch = {
        name: label,
        count: entries.length,
        avgScore: scorePercent,
        minScore: minPercent,
        highRiskCount: highRiskEntries.length,
        severeRiskCount: severeRiskEntries.length,
        visibleRayCount,
        blockedRayCount,
        blockerCount: blockers.length,
        blockers,
        riskLevel: riskText,
        worstItemId: worst?.item?.id || '',
        worstItemName: worst?.item?.name || '-',
        riskLocation: riskLayer ? `第 ${riskLayer.layer} 层 / ${riskLayer.riskCount} 件风险` : '-',
        suggestion
    };
    metrics.suggestion = suggestion;
    return metrics;
}

export function selectRadiationExposureBatch(criteria = {}) {
    const furnace = getCurrentThermalFurnace();
    if (!furnace) return null;

    clearThermalGroupChildren();
    restoreThermalItemMaterials();
    setThermalSceneTheme(true);

    const group = ensureThermalSimulationGroup();
    const { scores, sources } = calculateRadiationExposureScores(furnace);
    const matchedEntries = [...scores.values()].filter(entry => matchesRadiationBatchCriteria(entry.item, criteria));

    if (!matchedEntries.length) {
        return renderRadiationExposureSimulation();
    }

    const sourceVisual = buildRadiationHeatSourcesVisual(furnace, sources);
    const rays = buildBatchRadiationRays(matchedEntries);
    const markers = buildBatchRadiationMarkers(furnace, matchedEntries);
    group.add(sourceVisual);
    group.add(rays);
    group.add(markers);
    group.visible = true;

    applyBatchRadiationTintToItems(furnace, scores, matchedEntries);

    thermalSimRuntime.visible = true;
    thermalSimRuntime.activeMode = 'radiation';
    thermalSimRuntime.isPlaying = false;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.progress = 0;
    thermalSimRuntime.sourceGroup = sourceVisual;
    thermalSimRuntime.rayGroup = rays;
    thermalSimRuntime.riskGroup = markers;
    thermalSimRuntime.radiationScores = scores;
    thermalSimRuntime.selectedRadiationItemId = null;
    thermalSimRuntime.selectedRadiationEntry = null;
    thermalSimRuntime.selectedRadiationBatch = criteria;
    thermalSimRuntime.selectedRadiationSection = null;
    thermalSimRuntime.metrics = buildBatchRadiationMetric(furnace, scores, matchedEntries, criteria);
    return thermalSimRuntime.metrics;
}

export function selectLowestRadiationExposureItemInCurrentBatch() {
    const selectedBatch = thermalSimRuntime.metrics?.selectedBatch;
    const itemId = selectedBatch?.worstItemId;
    if (!itemId) return thermalSimRuntime.metrics || null;
    return selectRadiationExposureItem(itemId);
}


export function selectRadiationExposureItem(itemId) {
    const furnace = getCurrentThermalFurnace();
    if (!furnace || !itemId) return null;

    clearThermalGroupChildren();
    restoreThermalItemMaterials();
    setThermalSceneTheme(true);

    const group = ensureThermalSimulationGroup();
    const { scores, sources } = calculateRadiationExposureScores(furnace);
    const entry = scores.get(itemId);
    if (!entry) {
        return renderRadiationExposureSimulation();
    }

    const sourceVisual = buildRadiationHeatSourcesVisual(furnace, sources);
    const rays = buildSingleRadiationRays(entry);
    const markers = buildSelectedRadiationMarkers(furnace, entry);
    group.add(sourceVisual);
    group.add(rays);
    group.add(markers);
    group.visible = true;

    const blockerIds = (entry.blockers || []).map(b => b.item?.id).filter(Boolean);
    applySelectedRadiationTintToItems(furnace, scores, itemId, blockerIds);

    thermalSimRuntime.visible = true;
    thermalSimRuntime.activeMode = 'radiation';
    thermalSimRuntime.isPlaying = false;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.progress = 0;
    thermalSimRuntime.sourceGroup = sourceVisual;
    thermalSimRuntime.rayGroup = rays;
    thermalSimRuntime.riskGroup = markers;
    thermalSimRuntime.radiationScores = scores;
    thermalSimRuntime.selectedRadiationItemId = itemId;
    thermalSimRuntime.selectedRadiationEntry = entry;
    thermalSimRuntime.selectedRadiationBatch = null;
    thermalSimRuntime.selectedRadiationSection = null;
    thermalSimRuntime.metrics = buildSelectedRadiationMetric(furnace, scores, entry);
    return thermalSimRuntime.metrics;
}



export function enterRadiationSectionView(options = {}) {
    const furnace = getCurrentThermalFurnace();
    const itemId = options.itemId || thermalSimRuntime.selectedRadiationItemId;
    if (!furnace || !itemId) return thermalSimRuntime.metrics || null;

    clearThermalGroupChildren();
    restoreThermalItemMaterials();
    setThermalSceneTheme(true);

    const group = ensureThermalSimulationGroup();
    const { scores, sources } = calculateRadiationExposureScores(furnace);
    const entry = scores.get(itemId);
    if (!entry) return renderRadiationExposureSimulation();

    const currentSection = thermalSimRuntime.selectedRadiationSection || null;
    const autoMeta = calculateBestSectionAxis(furnace, entry);
    const requestedDirection = options.directionKey || options.direction || currentSection?.directionKey || autoMeta.directionKey;
    const axisMeta = getRadiationSectionAxisMeta(requestedDirection);
    axisMeta.dominantBlocker = autoMeta.dominantBlocker || null;
    axisMeta.dominantDirection = autoMeta.dominantDirection || axisMeta.keepLabel;

    const offset = options.offset != null
        ? Number(options.offset)
        : (currentSection && currentSection.directionKey === axisMeta.directionKey ? Number(currentSection.offset || 0) : 0);

    const sectionInfo = buildRadiationSectionInfo(furnace, entry, axisMeta, { offset });

    const sourceVisual = buildRadiationHeatSourcesVisual(furnace, sources);
    const rays = buildSingleRadiationRays(entry);
    const markers = buildSelectedRadiationMarkers(furnace, entry);
    const sectionPlane = buildRadiationSectionPlane(furnace, entry, sectionInfo);

    group.add(sourceVisual);
    group.add(sectionPlane);
    group.add(rays);
    group.add(markers);
    group.visible = true;

    applySectionFocusTintToItems(furnace, scores, entry, sectionInfo);

    thermalSimRuntime.visible = true;
    thermalSimRuntime.activeMode = 'radiation';
    thermalSimRuntime.isPlaying = false;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.progress = 0;
    thermalSimRuntime.sourceGroup = sourceVisual;
    thermalSimRuntime.rayGroup = rays;
    thermalSimRuntime.riskGroup = markers;
    thermalSimRuntime.radiationScores = scores;
    thermalSimRuntime.selectedRadiationItemId = itemId;
    thermalSimRuntime.selectedRadiationEntry = entry;
    thermalSimRuntime.selectedRadiationBatch = null;
    thermalSimRuntime.selectedRadiationSection = sectionInfo;

    const metrics = buildSelectedRadiationMetric(furnace, scores, entry);
    metrics.sectionView = sectionInfo;
    if (metrics.selectedItem) {
        metrics.selectedItem.sectionView = sectionInfo;
        metrics.selectedItem.suggestion = sectionInfo.suggestion;
    }
    metrics.suggestion = sectionInfo.suggestion;
    thermalSimRuntime.metrics = metrics;
    return thermalSimRuntime.metrics;
}

export function setRadiationSectionDirection(directionKey) {
    if (!thermalSimRuntime.selectedRadiationItemId) return thermalSimRuntime.metrics || null;
    return enterRadiationSectionView({ directionKey, offset: 0 });
}

export function setRadiationSectionOffset(offset) {
    const section = thermalSimRuntime.selectedRadiationSection;
    if (!thermalSimRuntime.selectedRadiationItemId || !section) return thermalSimRuntime.metrics || null;
    return enterRadiationSectionView({ directionKey: section.directionKey, offset });
}

export function exitRadiationSectionView() {
    const itemId = thermalSimRuntime.selectedRadiationItemId;
    radiationSectionDragState = null;
    thermalSimRuntime.selectedRadiationSection = null;
    clearRadiationClipPlanes();
    if (controls) controls.enabled = true;
    if (itemId) return selectRadiationExposureItem(itemId);
    return renderRadiationExposureSimulation();
}

export function tryStartRadiationSectionDragAtClientPoint(clientX, clientY) {
    if (!renderer || !renderer.domElement || !camera) return false;
    const section = thermalSimRuntime.selectedRadiationSection;
    if (!section?.active || !thermalSimulationGroup) return false;

    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const pointer = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
    );

    const pickTargets = [];
    thermalSimulationGroup.traverse(child => {
        if (child.userData?.isRadiationClipDragHandle) pickTargets.push(child);
    });
    if (!pickTargets.length) return false;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickTargets, true);
    if (!hits.length) return false;

    const origin = new THREE.Vector3(section.origin?.x || 0, section.origin?.y || 0, section.origin?.z || 0);
    const normal = new THREE.Vector3(section.normal?.x || 0, section.normal?.y || 0, section.normal?.z || 0).normalize();
    if (normal.lengthSq() < 1e-6) return false;

    const s0 = projectWorldToScreen(origin, rect);
    const s1 = projectWorldToScreen(origin.clone().add(normal.clone().multiplyScalar(100)), rect);
    const screenDir = { x: s1.x - s0.x, y: s1.y - s0.y };
    const pixelPer100 = Math.hypot(screenDir.x, screenDir.y);
    if (pixelPer100 < 4) return false;

    radiationSectionDragState = {
        startX: clientX,
        startY: clientY,
        startOffset: Number(section.offset || 0),
        directionKey: section.directionKey,
        screenDir: { x: screenDir.x / pixelPer100, y: screenDir.y / pixelPer100 },
        pixelsPerUnit: pixelPer100 / 100
    };

    if (controls) controls.enabled = false;
    if (renderer.domElement) renderer.domElement.style.cursor = 'ew-resize';
    return true;
}

export function dragRadiationSectionPlaneToClientPoint(clientX, clientY) {
    if (!radiationSectionDragState) return thermalSimRuntime.metrics || null;
    const dx = clientX - radiationSectionDragState.startX;
    const dy = clientY - radiationSectionDragState.startY;
    const projectedPixels = dx * radiationSectionDragState.screenDir.x + dy * radiationSectionDragState.screenDir.y;
    const delta = projectedPixels / Math.max(0.001, radiationSectionDragState.pixelsPerUnit);
    const nextOffset = radiationSectionDragState.startOffset + delta;
    return setRadiationSectionOffset(Math.round(nextOffset));
}

export function endRadiationSectionDrag() {
    radiationSectionDragState = null;
    if (controls) controls.enabled = true;
    if (renderer?.domElement) renderer.domElement.style.cursor = '';
    return thermalSimRuntime.metrics || null;
}

export function clearRadiationExposureSelection() {
    if (thermalSimRuntime.activeMode !== 'radiation') return null;
    return renderRadiationExposureSimulation();
}

export function selectRadiationExposureItemAtClientPoint(clientX, clientY) {
    if (!renderer || !renderer.domElement || !camera) return null;
    if (!thermalSimRuntime.visible || thermalSimRuntime.activeMode !== 'radiation') return null;
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group) return null;

    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const pointer = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(group.children, true);
    for (const hit of intersects) {
        const itemId = findItemIdFromObject(hit.object);
        if (itemId) return selectRadiationExposureItem(itemId);
    }

    return clearRadiationExposureSelection();
}


// ==================== Placement Edit API restore (V0.7.10 compile fix) ====================
let placementEditRuntime = {
    active: false,
    selectedItemId: null,
    activeLayer: null,
    showAllLayers: false
};

function getPlacementEditCurrentFurnace() {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return null;
    const idx = Math.max(0, Math.min(currentFurnaceIndex || 0, globalFurnacesResult.length - 1));
    return globalFurnacesResult[idx] || null;
}

function getPlacementEditItem(itemId) {
    const furnace = getPlacementEditCurrentFurnace();
    if (!furnace || !itemId) return null;
    return (furnace.packedItems || []).find(item => String(item.id || item.itemId) === String(itemId)) || null;
}

function getPlacementEditLayerGroups() {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !group.userData || !group.userData.layerGroups) return null;
    return group.userData.layerGroups;
}

function getPlacementEditAvailableLayers() {
    const layerGroups = getPlacementEditLayerGroups();
    if (!layerGroups || typeof layerGroups.keys !== 'function') return [1];
    const layers = [...layerGroups.keys()].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    return layers.length ? layers : [1];
}

function getPlacementEditObjectLayer(obj) {
    let cur = obj;
    while (cur) {
        if (cur.userData) {
            if (typeof cur.userData.layer === 'number') return cur.userData.layer;
            if (typeof cur.userData.layerIndex === 'number') return cur.userData.layerIndex;
            if (cur.userData.isLayerGroup && typeof cur.userData.layerIndex === 'number') return cur.userData.layerIndex;
        }
        cur = cur.parent;
    }
    return null;
}

function getPlacementEditItemLayer(itemId) {
    const item = getPlacementEditItem(itemId);
    if (item && typeof item.layer === 'number' && item.layer >= 1) return Math.round(item.layer);
    const root = findPlacementEditRootObject(itemId);
    const layerFromObject = getPlacementEditObjectLayer(root);
    if (Number.isFinite(layerFromObject)) return layerFromObject;
    return 1;
}

function normalizePlacementEditActiveLayer(preferred = null) {
    const layers = getPlacementEditAvailableLayers();
    const target = Number(preferred ?? placementEditRuntime.activeLayer);
    if (layers.includes(target)) return target;
    return layers[0] || 1;
}


function setPlacementEditShelfVisibilityForCurrentGroup() {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group) return;
    const showShelves = !placementEditRuntime.active;
    group.traverse(obj => {
        if (!obj || !obj.userData || !obj.userData.isShelfMesh) return;
        obj.visible = showShelves;
    });
}

function applyPlacementEditLayerVisibility() {

    const layerGroups = getPlacementEditLayerGroups();
    const group = furnaceGroups.get(currentFurnaceIndex);

    function setItemObjectVisibility(showAll, activeLayer = null) {
        if (!group) return;
        group.traverse(obj => {
            if (!obj || !obj.userData) return;
            if (obj.userData.isShelfMesh) return;
            const itemId = obj.userData.itemId || obj.userData.itemID || obj.userData.item?.id || obj.userData.itemData?.id;
            if (!itemId) return;
            if (showAll || activeLayer == null) {
                obj.visible = true;
                return;
            }
            const itemLayer = getPlacementEditObjectLayer(obj) || getPlacementEditItemLayer(itemId);
            obj.visible = Number(itemLayer) === Number(activeLayer);
        });
    }

    if (!layerGroups || typeof layerGroups.forEach !== 'function') {
        if (!placementEditRuntime.active || placementEditRuntime.showAllLayers) {
            setItemObjectVisibility(true);
            return;
        }
        const activeLayer = normalizePlacementEditActiveLayer();
        placementEditRuntime.activeLayer = activeLayer;
        setItemObjectVisibility(false, activeLayer);
        return;
    }

    if (!placementEditRuntime.active || placementEditRuntime.showAllLayers) {
        layerGroups.forEach(layerGroup => {
            if (layerGroup && layerGroup.userData && layerGroup.userData.isLayerGroup) layerGroup.visible = true;
        });
        setItemObjectVisibility(true);
        return;
    }
    const activeLayer = normalizePlacementEditActiveLayer();
    placementEditRuntime.activeLayer = activeLayer;
    layerGroups.forEach((layerGroup, layerIndex) => {
        if (!layerGroup || !layerGroup.userData || !layerGroup.userData.isLayerGroup) return;
        layerGroup.visible = Number(layerIndex) === Number(activeLayer);
    });

    // V0.7.18：多层料框里部分物件/客户标识可能不在 layerGroup 下，
    // 仅切换 layerGroup.visible 会导致“第 2 层仅本层时第 1 层仍显示”。
    // 因此额外按 itemId 的真实层号逐个隐藏/显示。
    setItemObjectVisibility(false, activeLayer);
}

function getPlacementEditLayerStateInternal() {
    const layers = getPlacementEditAvailableLayers();
    const activeLayer = normalizePlacementEditActiveLayer();
    return {
        layers,
        activeLayer,
        showAllLayers: !!placementEditRuntime.showAllLayers,
        layerCount: layers.length,
        activeIndex: Math.max(0, layers.indexOf(activeLayer))
    };
}

function getPlacementEditMaterials(mesh) {
    if (!mesh || !mesh.material) return [];
    return Array.isArray(mesh.material) ? mesh.material.filter(Boolean) : [mesh.material];
}

function savePlacementOriginalMaterial(mat) {
    if (!mat || !mat.userData) return;
    if (mat.userData._placementEditOriginal) return;
    mat.userData._placementEditOriginal = {
        color: mat.color ? mat.color.getHex() : null,
        emissive: mat.emissive ? mat.emissive.getHex() : null,
        emissiveIntensity: typeof mat.emissiveIntensity === 'number' ? mat.emissiveIntensity : 0,
        transparent: !!mat.transparent,
        opacity: typeof mat.opacity === 'number' ? mat.opacity : 1,
        depthWrite: typeof mat.depthWrite === 'boolean' ? mat.depthWrite : true
    };
}

function restorePlacementEditMaterials() {
    if (!furnaceGroups || typeof furnaceGroups.forEach !== 'function') return;
    furnaceGroups.forEach(group => {
        if (!group) return;
        group.traverse(child => {
            if (!child.isMesh || !child.material) return;
            getPlacementEditMaterials(child).forEach(mat => {
                const saved = mat?.userData?._placementEditOriginal;
                if (!saved) return;
                if (mat.color && saved.color != null) mat.color.setHex(saved.color);
                if (mat.emissive && saved.emissive != null) mat.emissive.setHex(saved.emissive);
                if (typeof saved.emissiveIntensity === 'number') mat.emissiveIntensity = saved.emissiveIntensity;
                mat.transparent = saved.transparent;
                mat.opacity = saved.opacity;
                mat.depthWrite = saved.depthWrite;
                mat.needsUpdate = true;
                delete mat.userData._placementEditOriginal;
            });
        });
    });
}

function applyPlacementEditTint() {
    restorePlacementEditMaterials();
    applyPlacementEditLayerVisibility();
    setPlacementEditShelfVisibilityForCurrentGroup();
    if (!placementEditRuntime.active) return;

    const selectedId = placementEditRuntime.selectedItemId;
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group) return;

    // 未选择工件时，不再把所有工件变透明；只通过“当前编辑层”减少多层干扰。
    if (!selectedId) return;

    const selectedLayer = getPlacementEditItemLayer(selectedId);
    placementEditRuntime.activeLayer = selectedLayer;
    if (!placementEditRuntime.showAllLayers) applyPlacementEditLayerVisibility();

    group.traverse(child => {
        if (!child.isMesh || !child.userData || !child.userData.itemId) return;
        const itemLayer = getPlacementEditObjectLayer(child) || selectedLayer;
        const isSelected = selectedId && String(child.userData.itemId) === String(selectedId);
        const isSameLayer = Number(itemLayer) === Number(selectedLayer);
        getPlacementEditMaterials(child).forEach(mat => {
            savePlacementOriginalMaterial(mat);
            if (isSelected) {
                mat.transparent = false;
                mat.opacity = 1;
                mat.depthWrite = true;
                if (mat.emissive) {
                    mat.emissive.setHex(0x2563eb);
                    mat.emissiveIntensity = 0.30;
                }
                child.renderOrder = 40;
            } else if (isSameLayer) {
                mat.transparent = true;
                mat.opacity = 0.38;
                mat.depthWrite = false;
                if (mat.emissive) {
                    mat.emissive.setHex(0x000000);
                    mat.emissiveIntensity = 0;
                }
                child.renderOrder = 4;
            } else {
                mat.transparent = true;
                mat.opacity = 0.06;
                mat.depthWrite = false;
                if (mat.emissive) {
                    mat.emissive.setHex(0x000000);
                    mat.emissiveIntensity = 0;
                }
                child.renderOrder = 1;
            }
            mat.needsUpdate = true;
        });
    });
}

export function setPlacementEditMode(active) {
    placementEditRuntime.active = !!active;
    if (!placementEditRuntime.active) {
        placementEditRuntime.selectedItemId = null;
        placementEditRuntime.activeLayer = null;
        placementEditRuntime.showAllLayers = false;
        restorePlacementEditMaterials();
        applyPlacementEditLayerVisibility();
        setPlacementEditShelfVisibilityForCurrentGroup();
        return null;
    }
    placementEditRuntime.activeLayer = normalizePlacementEditActiveLayer(placementEditRuntime.activeLayer);
    placementEditRuntime.showAllLayers = false;
    setPlacementEditShelfVisibilityForCurrentGroup();
    applyPlacementEditTint();
    return getPlacementEditSelection();
}

export function getPlacementEditSelection() {
    const item = getPlacementEditItem(placementEditRuntime.selectedItemId);
    if (!item) return null;
    return {
        itemId: placementEditRuntime.selectedItemId,
        item,
        furnaceIndex: currentFurnaceIndex,
        layerState: getPlacementEditLayerStateInternal()
    };
}

export function clearPlacementEditSelection() {
    placementEditRuntime.selectedItemId = null;
    if (placementEditRuntime.active) applyPlacementEditTint();
    return null;
}

export function getPlacementEditLayerState() {
    return getPlacementEditLayerStateInternal();
}

export function setPlacementEditActiveLayer(layerIndex) {
    if (!placementEditRuntime.active) return getPlacementEditLayerStateInternal();
    const nextLayer = normalizePlacementEditActiveLayer(layerIndex);
    placementEditRuntime.activeLayer = nextLayer;
    placementEditRuntime.showAllLayers = false;
    const selectedLayer = placementEditRuntime.selectedItemId ? getPlacementEditItemLayer(placementEditRuntime.selectedItemId) : null;
    if (selectedLayer != null && Number(selectedLayer) !== Number(nextLayer)) {
        placementEditRuntime.selectedItemId = null;
    }
    applyPlacementEditTint();
    return getPlacementEditLayerStateInternal();
}

export function stepPlacementEditActiveLayer(delta = 1) {
    const layers = getPlacementEditAvailableLayers();
    const state = getPlacementEditLayerStateInternal();
    const currentIndex = Math.max(0, layers.indexOf(state.activeLayer));
    const nextIndex = Math.max(0, Math.min(layers.length - 1, currentIndex + Number(delta || 0)));
    return setPlacementEditActiveLayer(layers[nextIndex] || state.activeLayer || 1);
}

export function setPlacementEditShowAllLayers(showAll = false) {
    if (!placementEditRuntime.active) return getPlacementEditLayerStateInternal();
    placementEditRuntime.showAllLayers = !!showAll;
    applyPlacementEditTint();
    return getPlacementEditLayerStateInternal();
}

export function selectPlacementEditItem(itemId) {
    const item = getPlacementEditItem(itemId);
    if (!item) return clearPlacementEditSelection();
    placementEditRuntime.selectedItemId = String(item.id || item.itemId || itemId);
    placementEditRuntime.activeLayer = getPlacementEditItemLayer(placementEditRuntime.selectedItemId);
    placementEditRuntime.showAllLayers = false;
    applyPlacementEditTint();
    return getPlacementEditSelection();
}

export function refreshPlacementEditSelection() {
    if (!placementEditRuntime.active) return null;
    applyPlacementEditTint();
    return getPlacementEditSelection();
}

export function selectPlacementEditItemAtClientPoint(clientX, clientY) {
    if (!placementEditRuntime.active) return null;
    if (!renderer || !renderer.domElement || !camera) return null;
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group) return null;

    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const pointer = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(group.children, true);

    const state = getPlacementEditLayerStateInternal();
    for (const hit of intersects) {
        const itemId = findItemIdFromObject(hit.object);
        if (!itemId) continue;
        const itemLayer = getPlacementEditObjectLayer(hit.object) || getPlacementEditItemLayer(itemId);
        if (!placementEditRuntime.showAllLayers && state.activeLayer != null && Number(itemLayer) !== Number(state.activeLayer)) {
            continue;
        }
        return selectPlacementEditItem(itemId);
    }

    return clearPlacementEditSelection();
}


function findPlacementEditRootObject(itemId) {
    const id = String(itemId || '');
    if (!id) return null;
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group) return null;

    const layerGroups = group.userData && group.userData.layerGroups;
    if (layerGroups && typeof layerGroups.forEach === 'function') {
        let found = null;
        layerGroups.forEach(layerGroup => {
            if (found || !layerGroup || !Array.isArray(layerGroup.children)) return;
            found = layerGroup.children.find(child =>
                child && child.userData &&
                String(child.userData.itemId || '') === id &&
                !child.userData._animMesh
            ) || null;
        });
        if (found) return found;
    }

    let found = null;
    group.traverse(obj => {
        if (found || !obj || !obj.userData) return;
        if (String(obj.userData.itemId || '') !== id) return;
        if (obj.userData._animMesh) return;
        if (obj.parent && obj.parent.userData && obj.parent.userData.isLayerGroup) {
            found = obj;
        }
    });
    return found;
}

export function updatePlacementEditItemVisual(itemId) {
    const furnace = getPlacementEditCurrentFurnace();
    const item = getPlacementEditItem(itemId);
    const root = findPlacementEditRootObject(itemId);
    if (!furnace || !item || !root) return false;

    const baseY = -120;
    const targetX = Number(item.x || 0) - Number(furnace.w || 0) / 2 + Number(item.w || 0) / 2;
    const targetY = baseY + Number(item.y || 0) + Number(item.h || 0) / 2;
    const targetZ = Number(item.z || 0) - Number(furnace.d || 0) / 2 + Number(item.d || 0) / 2;

    root.position.set(targetX, targetY, targetZ);
    root.updateMatrixWorld(true);
    applyPlacementEditTint();
    return true;
}

export function focusPlacementEditTopView() {
    if (typeof setTightFitCamera === 'function') {
        setTightFitCamera(new THREE.Vector3(0, 1, 0), 0.06);
    }
}


export function getRadiationExposureRuntime() {
    return {
        visible: thermalSimRuntime.visible && thermalSimRuntime.activeMode === 'radiation',
        metrics: thermalSimRuntime.activeMode === 'radiation' ? thermalSimRuntime.metrics : null,
        scores: thermalSimRuntime.radiationScores,
        selectedItemId: thermalSimRuntime.selectedRadiationItemId,
        selectedItem: thermalSimRuntime.metrics?.selectedItem || null,
        selectedBatch: thermalSimRuntime.metrics?.selectedBatch || null,
        sectionView: thermalSimRuntime.metrics?.sectionView || thermalSimRuntime.selectedRadiationSection || null
    };
}

export function renderVacuumQuenchThermalSimulation(progress = 0.12, options = {}) {
    const furnace = getCurrentThermalFurnace();
    if (!furnace) return null;

    clearThermalGroupChildren();
    restoreThermalItemMaterials();
    const safeProgress = clamp01(progress);
    if (options.heatmapView) {
        thermalSimRuntime.selectedThermalHeatmapView = normalizeThermalHeatmapView(options.heatmapView);
    }
    if (options.heatmapDisplayMode) {
        thermalSimRuntime.selectedThermalDisplayMode = normalizeThermalDisplayMode(options.heatmapDisplayMode);
    }
    if (options.heatmapVerticalAxis) {
        thermalSimRuntime.selectedThermalVerticalAxis = normalizeThermalVerticalAxis(options.heatmapVerticalAxis);
    }
    if (options.heatmapSectionOffset != null) {
        thermalSimRuntime.selectedThermalSectionOffset = clampThermalSectionOffset(furnace, options.heatmapSectionOffset, thermalSimRuntime.selectedThermalVerticalAxis || 'z');
    } else {
        thermalSimRuntime.selectedThermalSectionOffset = clampThermalSectionOffset(furnace, thermalSimRuntime.selectedThermalSectionOffset || 0, thermalSimRuntime.selectedThermalVerticalAxis || 'z');
    }
    setThermalSceneTheme(true, 'thermal');

    const group = ensureThermalSimulationGroup();
    const equipmentContext = buildProcessEquipmentContext(furnace, 'thermal');
    if (equipmentContext) group.add(equipmentContext);
    const heatmap = buildThermalHeatmapField(furnace, safeProgress, thermalSimRuntime.selectedThermalHeatmapView || 'middle');
    const riskMarkers = buildRiskMarkers(furnace);
    const ringBoundary = buildRingThermalBoundary(furnace);

    group.add(heatmap);
    group.add(riskMarkers);
    if (ringBoundary) group.add(ringBoundary);
    group.visible = true;

    thermalSimRuntime.visible = true;
    thermalSimRuntime.activeMode = 'thermal';
    thermalSimRuntime.progress = safeProgress;
    thermalSimRuntime.pointCloud = null;
    thermalSimRuntime.heatmapGroup = heatmap;
    thermalSimRuntime.rayGroup = null;
    thermalSimRuntime.riskGroup = riskMarkers;
    thermalSimRuntime.metrics = calculateThermalMetrics(furnace, safeProgress);
    applyThermalTintToItems(furnace, safeProgress);
    return thermalSimRuntime.metrics;
}

export function playVacuumQuenchThermalSimulation(options = {}) {
    const furnace = getCurrentThermalFurnace();
    if (!furnace) return null;
    const startProgress = clamp01(options.startProgress != null ? options.startProgress : 0);
    const initialMetrics = renderVacuumQuenchThermalSimulation(startProgress);
    thermalSimRuntime.isPlaying = true;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.durationMs = options.durationMs || thermalSimRuntime.durationMs || 9000;
    thermalSimRuntime.startedAt = performance.now() - startProgress * thermalSimRuntime.durationMs;
    thermalSimRuntime.lastThermalHeavyUpdateAt = 0;
    thermalSimRuntime.onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : thermalSimRuntime.onUpdate;
    thermalSimRuntime.onFinish = typeof options.onFinish === 'function' ? options.onFinish : thermalSimRuntime.onFinish;
    if (thermalSimRuntime.onUpdate) thermalSimRuntime.onUpdate(initialMetrics);
    return initialMetrics;
}

export function stopVacuumQuenchThermalSimulation() {
    thermalSimRuntime.isPlaying = false;
    thermalSimRuntime.paused = true;
}

export function pauseVacuumQuenchThermalSimulation() {
    thermalSimRuntime.isPlaying = false;
    thermalSimRuntime.paused = true;
    return thermalSimRuntime.metrics;
}

export function resumeVacuumQuenchThermalSimulation(options = {}) {
    if (!thermalSimRuntime.visible || thermalSimRuntime.activeMode !== 'thermal') return playVacuumQuenchThermalSimulation(options);
    return playVacuumQuenchThermalSimulation({ ...options, startProgress: thermalSimRuntime.progress || 0 });
}

export function setVacuumQuenchThermalProgress(progress) {
    const furnace = getCurrentThermalFurnace();
    if (!furnace) return null;
    thermalSimRuntime.isPlaying = false;
    thermalSimRuntime.paused = true;
    const p = clamp01(progress);
    if (!thermalSimRuntime.visible || !thermalSimRuntime.heatmapGroup || thermalSimRuntime.activeMode !== 'thermal') {
        return renderVacuumQuenchThermalSimulation(p);
    }
    thermalSimRuntime.progress = p;
    updateThermalHeatmapField(furnace, p);
    applyThermalTintToItems(furnace, p);
    thermalSimRuntime.metrics = calculateThermalMetrics(furnace, p);
    if (thermalSimRuntime.onUpdate) thermalSimRuntime.onUpdate(thermalSimRuntime.metrics);
    return thermalSimRuntime.metrics;
}

export function setThermalHeatmapDisplayMode(mode = 'balanced') {
    const furnace = getCurrentThermalFurnace();
    thermalSimRuntime.selectedThermalDisplayMode = normalizeThermalDisplayMode(mode);
    if (!furnace || thermalSimRuntime.activeMode !== 'thermal') {
        return thermalSimRuntime.metrics || null;
    }
    return renderVacuumQuenchThermalSimulation(thermalSimRuntime.progress || 0, {
        heatmapView: thermalSimRuntime.selectedThermalHeatmapView || 'middle',
        heatmapDisplayMode: thermalSimRuntime.selectedThermalDisplayMode
    });
}

export function setThermalHeatmapView(viewKey = 'middle') {
    const furnace = getCurrentThermalFurnace();
    thermalSimRuntime.selectedThermalHeatmapView = normalizeThermalHeatmapView(viewKey);
    if (!furnace || thermalSimRuntime.activeMode !== 'thermal') {
        return thermalSimRuntime.metrics || null;
    }
    return renderVacuumQuenchThermalSimulation(thermalSimRuntime.progress || 0, {
        heatmapView: thermalSimRuntime.selectedThermalHeatmapView
    });
}

export function setThermalHeatmapVerticalAxis(axis = 'z') {
    const furnace = getCurrentThermalFurnace();
    thermalSimRuntime.selectedThermalVerticalAxis = normalizeThermalVerticalAxis(axis);
    if (furnace) {
        thermalSimRuntime.selectedThermalSectionOffset = clampThermalSectionOffset(furnace, thermalSimRuntime.selectedThermalSectionOffset || 0, thermalSimRuntime.selectedThermalVerticalAxis);
    }
    if (!furnace || thermalSimRuntime.activeMode !== 'thermal') {
        return thermalSimRuntime.metrics || null;
    }
    return renderVacuumQuenchThermalSimulation(thermalSimRuntime.progress || 0, {
        heatmapView: 'vertical',
        heatmapVerticalAxis: thermalSimRuntime.selectedThermalVerticalAxis,
        heatmapSectionOffset: thermalSimRuntime.selectedThermalSectionOffset
    });
}

export function setThermalHeatmapSectionOffset(offset = 0) {
    const furnace = getCurrentThermalFurnace();
    if (furnace) {
        thermalSimRuntime.selectedThermalSectionOffset = clampThermalSectionOffset(furnace, offset, thermalSimRuntime.selectedThermalVerticalAxis || 'z');
    } else {
        thermalSimRuntime.selectedThermalSectionOffset = Number(offset) || 0;
    }
    if (!furnace || thermalSimRuntime.activeMode !== 'thermal') {
        return thermalSimRuntime.metrics || null;
    }
    return renderVacuumQuenchThermalSimulation(thermalSimRuntime.progress || 0, {
        heatmapView: 'vertical',
        heatmapVerticalAxis: thermalSimRuntime.selectedThermalVerticalAxis || 'z',
        heatmapSectionOffset: thermalSimRuntime.selectedThermalSectionOffset
    });
}

export function resetThermalHeatmapSectionOffset() {
    return setThermalHeatmapSectionOffset(0);
}

export function getVacuumQuenchThermalRuntime() {
    return {
        visible: thermalSimRuntime.visible,
        activeMode: thermalSimRuntime.activeMode,
        isPlaying: thermalSimRuntime.isPlaying,
        paused: thermalSimRuntime.paused,
        progress: thermalSimRuntime.progress,
        durationMs: thermalSimRuntime.durationMs,
        metrics: thermalSimRuntime.metrics,
        heatmapView: thermalSimRuntime.selectedThermalHeatmapView || 'middle',
        heatmapDisplayMode: thermalSimRuntime.selectedThermalDisplayMode || 'balanced',
        heatmapVerticalAxis: thermalSimRuntime.selectedThermalVerticalAxis || 'z',
        heatmapSectionOffset: thermalSimRuntime.selectedThermalSectionOffset || 0
    };
}

function updateThermalRayPulse(now) {
    const rayGroup = thermalSimRuntime.rayGroup;
    if (!rayGroup) return;
    const pulse = 0.18 + (Math.sin(now * 0.004) + 1) * 0.16;
    rayGroup.traverse(child => {
        if (child.material && child.userData && child.userData.isThermalRays) {
            child.material.opacity = child.userData.isRadiationExposureRays ? (0.42 + pulse * 0.75) : pulse;
            child.material.needsUpdate = true;
        }
    });
}

function updateThermalSimulationFrame(now) {
    if (!thermalSimRuntime.visible) return;

    if (thermalSimRuntime.activeMode === 'thermal' && thermalSimRuntime.isPlaying) {
        const elapsed = now - thermalSimRuntime.startedAt;
        const progress = clamp01(elapsed / thermalSimRuntime.durationMs);
        thermalSimRuntime.progress = progress;
        const furnace = getCurrentThermalFurnace();
        const shouldHeavyUpdate = !thermalSimRuntime.lastThermalHeavyUpdateAt ||
            now - thermalSimRuntime.lastThermalHeavyUpdateAt >= 220 ||
            progress >= 1;
        if (furnace && shouldHeavyUpdate) {
            thermalSimRuntime.lastThermalHeavyUpdateAt = now;
            updateThermalHeatmapField(furnace, progress);
            thermalSimRuntime.metrics = calculateThermalMetrics(furnace, progress);
            applyThermalTintToItems(furnace, progress);
            if (thermalSimRuntime.onUpdate && thermalSimRuntime.metrics) thermalSimRuntime.onUpdate(thermalSimRuntime.metrics);
        }
        if (progress >= 1) {
            thermalSimRuntime.isPlaying = false;
            thermalSimRuntime.paused = false;
            if (thermalSimRuntime.onFinish && thermalSimRuntime.metrics) thermalSimRuntime.onFinish(thermalSimRuntime.metrics);
        }
    }

    if (thermalSimRuntime.activeMode === 'airflow') {
        updateAirflowParticles(now);
        if (thermalSimRuntime.metrics) {
            thermalSimRuntime.metrics.animationPlaying = !!thermalSimRuntime.isPlaying && !thermalSimRuntime.paused;
            thermalSimRuntime.metrics.progress = Math.round((thermalSimRuntime.progress || 0) * 100);
        }
    }

    if (thermalSimRuntime.activeMode === 'atmosphere') {
        updateAtmosphereCoverageAnimation(now);
    }

    if (thermalSimRuntime.activeMode === 'quench') {
        updateQuenchMediumAnimation(now);
    }

    updateThermalRayPulse(now);

    if (thermalSimRuntime.sourceGroup) {
        thermalSimRuntime.sourceGroup.traverse(child => {
            if (child.material && child.userData && child.userData.isRadiationSourcePoints) {
                child.material.opacity = 0.55 + (Math.sin(now * 0.004) + 1) * 0.18;
                child.material.needsUpdate = true;
            }
        });
    }

    if (thermalSimRuntime.riskGroup) {
        thermalSimRuntime.riskGroup.traverse(child => {
            if (child.material && child.userData && (child.userData.isThermalRiskMarker || child.userData.isRadiationRiskMarker)) {
                child.material.opacity = 0.28 + (Math.sin(now * 0.005) + 1) * 0.18;
                child.material.needsUpdate = true;
            }
        });
    }
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
        // 跳过上方无工件的空搁板。
        // 即使 shelvesUsed 是算法明确输出，也不应该渲染没有承载物料的顶部空搁板。
        const layerHasItems = furnace.packedItems.some(
            item => getItemLayer(item, furnace) === shelfLayer
        );

        if (!layerHasItems) {
            return;
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
    if (mainSceneRulerGroup) {
        rebuildCurrentToolingDimensionAnnotations();
        mainSceneRulerGroup.visible = !!displaySettings.showRulers && mainSceneRulerGroup.children.length > 0;
    }
}

function clearDimensionAnnotationGroup(group) {
    if (!group) return;
    while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);
        disposeObject3D(child);
    }
}

function createRulerGroup() {
    const group = new THREE.Group();
    group.name = 'toolingDimensionAnnotationGroup';
    group.userData = { isRulerGroup: true, isToolingDimensionAnnotation: true };
    return group;
}

function createDimensionLabelSprite(text, position, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = options.bg || 'rgba(248, 250, 252, 0.92)';
    roundRect(ctx, 14, 20, 484, 88, 24);
    ctx.fill();
    ctx.strokeStyle = options.stroke || 'rgba(37, 99, 235, 0.54)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = options.color || '#0f172a';
    ctx.font = '800 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(text || ''), 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0.94,
        depthTest: false,
        depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(options.width || 210, options.height || 52, 1);
    sprite.renderOrder = 90;
    sprite.userData = { isDimensionLabel: true };
    return sprite;
}

function addDimensionLine(group, p1, p2, label, labelPos, color = 0x2563eb) {
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.88, depthWrite: false, depthTest: false });
    const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(lineGeo, material);
    line.renderOrder = 82;
    group.add(line);

    const tickSize = Math.max(18, Math.min(54, p1.distanceTo(p2) * 0.055));
    const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
    const tick = Math.abs(dir.y) > 0.7 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    [p1, p2].forEach(pt => {
        const a = pt.clone().add(tick.clone().multiplyScalar(-tickSize));
        const b = pt.clone().add(tick.clone().multiplyScalar(tickSize));
        const tickGeo = new THREE.BufferGeometry().setFromPoints([a, b]);
        const tickLine = new THREE.Line(tickGeo, material.clone());
        tickLine.renderOrder = 83;
        group.add(tickLine);
    });

    group.add(createDimensionLabelSprite(label, labelPos, { stroke: 'rgba(37, 99, 235, 0.54)' }));
}

function getCurrentDimensionFurnace() {
    if (!Array.isArray(globalFurnacesResult) || globalFurnacesResult.length === 0) return null;
    const idx = Math.max(0, Math.min(currentFurnaceIndex || 0, globalFurnacesResult.length - 1));
    return globalFurnacesResult[idx] || null;
}

function buildRingCircleLine(radius, y, color, opacity = 0.54) {
    const points = [];
    const segments = 128;
    for (let i = 0; i < segments; i++) {
        const a = i / segments * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false });
    const line = new THREE.LineLoop(geo, mat);
    line.renderOrder = 81;
    return line;
}

function rebuildCurrentToolingDimensionAnnotations() {
    if (!mainSceneRulerGroup) return;
    clearDimensionAnnotationGroup(mainSceneRulerGroup);
    if (!displaySettings.showRulers) return;

    const furnace = getCurrentDimensionFurnace();
    if (!furnace) return;

    const fw = Number(furnace.w || furnace.width || 0);
    const fh = Number(furnace.h || furnace.height || 0);
    const fd = Number(furnace.d || furnace.depth || 0);
    if (fw <= 0 || fh <= 0 || fd <= 0) return;

    const baseY = THERMAL_BASE_Y;
    const pad = Math.max(80, Math.min(180, Math.max(fw, fd) * 0.12));
    const y0 = baseY + 6;
    const yTop = baseY + fh;
    const labelY = baseY + 34;

    if (furnace.toolingType === 'ring-tooling') {
        const params = furnace.params || {};
        const outerRadius = Number(params.outerRadius || params.radialRadius || Math.min(fw, fd) / 2) || Math.min(fw, fd) / 2;
        const innerRadius = Number(params.centerVoidRadius || params.innerRadius || (params.innerDia ? Number(params.innerDia) / 2 : 0)) || 0;
        const outerDia = Math.round(outerRadius * 2);
        const innerDia = Math.round(innerRadius * 2);
        const zLine = -outerRadius - pad;

        mainSceneRulerGroup.add(buildRingCircleLine(outerRadius, y0 + 2, 0x2563eb, 0.64));
        if (innerRadius > 1) mainSceneRulerGroup.add(buildRingCircleLine(innerRadius, y0 + 4, 0xf97316, 0.58));

        addDimensionLine(
            mainSceneRulerGroup,
            new THREE.Vector3(-outerRadius, y0, zLine),
            new THREE.Vector3(outerRadius, y0, zLine),
            `外径 ${outerDia} mm`,
            new THREE.Vector3(0, labelY, zLine - pad * 0.18),
            0x2563eb
        );
        if (innerDia > 0) {
            addDimensionLine(
                mainSceneRulerGroup,
                new THREE.Vector3(-innerRadius, y0 + 12, 0),
                new THREE.Vector3(innerRadius, y0 + 12, 0),
                `内径 ${innerDia} mm`,
                new THREE.Vector3(0, labelY + 64, 0),
                0xf97316
            );
        }
        addDimensionLine(
            mainSceneRulerGroup,
            new THREE.Vector3(outerRadius + pad, baseY, outerRadius + pad * 0.25),
            new THREE.Vector3(outerRadius + pad, yTop, outerRadius + pad * 0.25),
            `高度 ${Math.round(fh)} mm`,
            new THREE.Vector3(outerRadius + pad * 1.45, baseY + fh / 2, outerRadius + pad * 0.25),
            0x16a34a
        );
        const ringCount = Number(params.ringCount || params.stationCount || furnace.shelfCount || 0);
        if (ringCount > 0) {
            mainSceneRulerGroup.add(createDimensionLabelSprite(`圆盘层数 ${ringCount} 层`, new THREE.Vector3(0, yTop + 80, 0), {
                width: 230,
                stroke: 'rgba(15, 23, 42, 0.28)'
            }));
        }
        return;
    }

    addDimensionLine(
        mainSceneRulerGroup,
        new THREE.Vector3(-fw / 2, y0, -fd / 2 - pad),
        new THREE.Vector3(fw / 2, y0, -fd / 2 - pad),
        `宽度 X ${Math.round(fw)} mm`,
        new THREE.Vector3(0, labelY, -fd / 2 - pad * 1.28),
        0x2563eb
    );
    addDimensionLine(
        mainSceneRulerGroup,
        new THREE.Vector3(-fw / 2 - pad, y0, -fd / 2),
        new THREE.Vector3(-fw / 2 - pad, y0, fd / 2),
        `纵深 Z ${Math.round(fd)} mm`,
        new THREE.Vector3(-fw / 2 - pad * 1.25, labelY, 0),
        0x7c3aed
    );
    addDimensionLine(
        mainSceneRulerGroup,
        new THREE.Vector3(fw / 2 + pad, baseY, fd / 2 + pad * 0.28),
        new THREE.Vector3(fw / 2 + pad, yTop, fd / 2 + pad * 0.28),
        `高度 Y ${Math.round(fh)} mm`,
        new THREE.Vector3(fw / 2 + pad * 1.45, baseY + fh / 2, fd / 2 + pad * 0.28),
        0x16a34a
    );
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
    // 真实剖面切割需要开启 local clipping，默认关闭会导致 clippingPlanes 不生效。
    newRenderer.localClippingEnabled = true;
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
    const axesLen = 360;
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
    customAxesGroup.add(createDimensionLabelSprite('X 宽度', new THREE.Vector3(axesLen + 78, originY + 22, 0), { width: 118, height: 34, color: '#991b1b', stroke: 'rgba(220,38,38,0.35)' }));
    customAxesGroup.add(createDimensionLabelSprite('Y 高度', new THREE.Vector3(0, originY + axesLen + 58, 0), { width: 118, height: 34, color: '#166534', stroke: 'rgba(22,163,74,0.35)' }));
    customAxesGroup.add(createDimensionLabelSprite('Z 纵深', new THREE.Vector3(0, originY + 22, axesLen + 78), { width: 118, height: 34, color: '#1d4ed8', stroke: 'rgba(37,99,235,0.35)' }));

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

    ensureThermalSimulationGroup();

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
        updateThermalSimulationFrame(performance.now());
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
    const axesLen = 360;

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
    customAxesGroup.add(createDimensionLabelSprite('X 宽度', new THREE.Vector3(axesLen + 78, originY + 22, 0), { width: 118, height: 34, color: '#991b1b', stroke: 'rgba(220,38,38,0.35)' }));
    customAxesGroup.add(createDimensionLabelSprite('Y 高度', new THREE.Vector3(0, originY + axesLen + 58, 0), { width: 118, height: 34, color: '#166534', stroke: 'rgba(22,163,74,0.35)' }));
    customAxesGroup.add(createDimensionLabelSprite('Z 纵深', new THREE.Vector3(0, originY + 22, axesLen + 78), { width: 118, height: 34, color: '#1d4ed8', stroke: 'rgba(37,99,235,0.35)' }));

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

export function focusLayersUpTo(layerIndex) {
    setFocusedLayer(layerIndex);

    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !group.userData || !group.userData.layerGroups) return;

    const layerGroups = group.userData.layerGroups;

    layerGroups.forEach((layerGroup, idx) => {
        if (!layerGroup.userData || !layerGroup.userData.isLayerGroup) return;

        if (layerIndex === null) {
            layerGroup.visible = true;
        } else {
            layerGroup.visible = idx <= layerIndex;
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

        // V0.7.10：颜色模式优化。默认保留“材质主色”，并用客户/批次辅助标识区分相似工件。
        applyItemDisplayColor(mesh, item);

        const itemLayer = itemLayerMap.get(item.id) || 1;
        // 补充 userData 中 createItemMesh 未设置的字段。
        // 🔧 辐射单件诊断依赖 itemId 做 3D 拾取；
        // createItemMesh 可能只把 itemId 写在根 Mesh/Group 上，
        // 圆柱体/复杂工件的子 Mesh 被 raycaster 命中时会拿不到 itemId。
        // 因此这里强制把工件身份同步到根对象和所有子 Mesh。
        const runtimeItemId = item.id || item.itemId || `${item.name || 'item'}-${index}-${itemLayer}`;
        mesh.userData.itemId = runtimeItemId;
        mesh.userData.itemName = item.name || '';
        mesh.userData.furnaceIndex = index;
        mesh.userData.layer = itemLayer;
        if (typeof mesh.traverse === 'function') {
            mesh.traverse(child => {
                if (!child.userData) child.userData = {};
                child.userData.itemId = runtimeItemId;
                child.userData.itemName = item.name || '';
                child.userData.furnaceIndex = index;
                child.userData.layer = itemLayer;
            });
        }

        // 🔧 重构：将工件加入对应的 LayerGroup，而非 furnaceGroup
        const targetLayerGroup = layerGroups.get(itemLayer);
        if (targetLayerGroup) {
            targetLayerGroup.add(mesh);
            const marker = createBatchMarkerForItem(item, baseY, mesh);
            if (marker) targetLayerGroup.add(marker);
        } else {
            // 回退：如果 LayerGroup 不存在（不应发生），直接加 furnaceGroup
            furnaceGroup.add(mesh);
            const marker = createBatchMarkerForItem(item, baseY, mesh);
            if (marker) furnaceGroup.add(marker);
        }
    });

    // 渲染搁板：
    // 1. 当前规则启用了搁板分层；或
    // 2. 历史方案 / JSON 恢复出来的 furnace 本身已经有 shelvesUsed
    const hasSavedShelves =
        Array.isArray(furnace.shelvesUsed) &&
        furnace.shelvesUsed.length > 0;

    if ((placementRules.useShelfLayered || hasSavedShelves) && furnace.packedItems.length > 0) {
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

    if (thermalSimRuntime.visible) {
        if (thermalSimRuntime.activeMode === 'radiation') {
            renderRadiationExposureSimulation();
        } else if (thermalSimRuntime.activeMode === 'airflow') {
            renderAirflowCoolingSimulation({ directionKeys: thermalSimRuntime.selectedAirflowDirections || thermalSimRuntime.selectedAirflowDirection || 'z+', keepPlaying: thermalSimRuntime.isPlaying && !thermalSimRuntime.paused });
        } else if (thermalSimRuntime.activeMode === 'atmosphere') {
            renderAtmosphereCoverageSimulation({ mediumType: thermalSimRuntime.selectedAtmosphereMediumType || 'nitriding', keepPlaying: thermalSimRuntime.isPlaying && !thermalSimRuntime.paused });
        } else {
            renderVacuumQuenchThermalSimulation(thermalSimRuntime.progress || 0.12);
        }
    }

    updateMainSceneDisplayVisibility();
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

export async function playLayeredLoadingAnimation(options = {}) {
    const getViewMode = typeof options.getViewMode === 'function'
        ? options.getViewMode
        : () => 'cumulative';

    const onStepChange = typeof options.onStepChange === 'function'
        ? options.onStepChange
        : null;

    const onFinish = typeof options.onFinish === 'function'
        ? options.onFinish
        : null;

    if (isAnimating || !globalFurnacesResult || globalFurnacesResult.length === 0) return;

    const furnace = globalFurnacesResult[currentFurnaceIndex];
    if (!furnace) return;

    // 确保当前炉次已经渲染
    let group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !group.userData || !group.userData.layerGroups) {
        renderSingleFurnace(currentFurnaceIndex, getSelectedMaterialName());
        group = furnaceGroups.get(currentFurnaceIndex);
    }

    if (!group || !group.userData || !group.userData.layerGroups) {
        // 如果没有 layerGroup，回退到旧的逐件动画
        playLoadingAnimation();
        return;
    }

    const layerGroups = group.userData.layerGroups;
    const allLayerIndexes = [...layerGroups.keys()].sort((a, b) => a - b);

    if (allLayerIndexes.length === 0) {
        playLoadingAnimation();
        return;
    }

    // 如果用户已经点击过某一层，则从当前聚焦层开始播放；否则从第一层开始
    let startLayer = null;

    if (typeof options.startLayer === 'number') {
        startLayer = options.startLayer;
    } else if (typeof options.getStartLayer === 'function') {
        startLayer = options.getStartLayer();
    } else if (typeof focusedLayer === 'number') {
        startLayer = focusedLayer;
    }

    let startIndex = 0;
    if (typeof startLayer === 'number' && !isNaN(startLayer)) {
        const foundIndex = allLayerIndexes.findIndex(layer => layer === startLayer);
        if (foundIndex >= 0) {
            startIndex = foundIndex;
        }
    }

    const layerIndexes = allLayerIndexes.slice(startIndex);

    setIsAnimating(true);
    setAnimPaused(false);
    setAnimStopped(false);

    const btnAnimate = document.getElementById('btn-animate');
    if (btnAnimate) {
        btnAnimate.disabled = true;
        btnAnimate.style.opacity = '0.5';
    }

    const controlBar = document.getElementById('anim-control-bar');
    if (controlBar) {
        controlBar.classList.add('visible');
    }

    const label = document.querySelector('#anim-control-bar .acb-label');
    if (label) {
        label.textContent = '🎬 逐层装炉仿真中';
    }

    const progressText = document.getElementById('anim-progress-text');

    function getAnimationSpeedMs() {
        const raw = parseInt(document.getElementById('anim-speed-select')?.value, 10);
        return !isNaN(raw) ? raw : 400;
    }

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const waitIfPaused = () => new Promise(resolve => {
        const check = () => {
            if (animStopped || !animPaused) {
                resolve();
            } else {
                setTimeout(check, 100);
            }
        };
        check();
    });

    function showLayersUpTo(targetLayer) {
        layerGroups.forEach((layerGroup, layerIndex) => {
            if (!layerGroup.userData || !layerGroup.userData.isLayerGroup) return;
            layerGroup.visible = layerIndex <= targetLayer;
        });
    }

    function showOnlyLayer(targetLayer) {
        layerGroups.forEach((layerGroup, layerIndex) => {
            if (!layerGroup.userData || !layerGroup.userData.isLayerGroup) return;
            layerGroup.visible = layerIndex === targetLayer;
        });
    }

    function applyLayerVisibility(targetLayer) {
        const mode = getViewMode();

        if (mode === 'single') {
            showOnlyLayer(targetLayer);
        } else {
            showLayersUpTo(targetLayer);
        }
    }

    function showAllLayers() {
        layerGroups.forEach((layerGroup) => {
            if (!layerGroup.userData || !layerGroup.userData.isLayerGroup) return;
            layerGroup.visible = true;
        });
    }

    function getItemsInLayer(layerIndex) {
        const filterMaterialName = getSelectedMaterialName();

        return (furnace.packedItems || []).filter(item => {
            if (filterMaterialName && item.material !== filterMaterialName) return false;
            return getItemLayer(item, furnace) === layerIndex;
        });
    }

    function getFinalItemMeshMap(layerGroup) {
        const map = new Map();

        layerGroup.traverse(child => {
            if (
                child.isMesh &&
                child.userData &&
                child.userData.itemId &&
                !child.userData._animMesh
            ) {
                map.set(child.userData.itemId, child);
            }
        });

        return map;
    }

    function disposeAnimMesh(mesh) {
        if (!mesh) return;

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

        if (mesh.parent) {
            mesh.parent.remove(mesh);
        }
    }

    function animateMeshDrop(mesh, targetY, durationMs) {
        return new Promise(resolve => {
            const startY = mesh.position.y;
            let elapsed = 0;
            let lastTime = performance.now();

            function frame(now) {
                if (animStopped) {
                    resolve(false);
                    return;
                }

                if (animPaused) {
                    lastTime = now;
                    requestAnimationFrame(frame);
                    return;
                }

                elapsed += now - lastTime;
                lastTime = now;

                const progress = Math.min(elapsed / durationMs, 1);
                const eased = 1 - Math.pow(1 - progress, 3);

                mesh.position.y = startY + (targetY - startY) * eased;

                if (progress < 1) {
                    requestAnimationFrame(frame);
                } else {
                    mesh.position.y = targetY;
                    resolve(true);
                }
            }

            requestAnimationFrame(frame);
        });
    }

    async function playItemsOneByOneInLayer(layerIndex, layerGroup, stepIndex, totalSteps) {
        if (!layerGroup) return;

        const layerItems = getItemsInLayer(layerIndex);
        if (layerItems.length === 0) return;

        const finalMeshMap = getFinalItemMeshMap(layerGroup);

        // 先隐藏当前层最终工件 Mesh，保留搁板可见
        finalMeshMap.forEach(mesh => {
            mesh.visible = false;
        });

        const baseY = -120;

        for (let itemIndex = 0; itemIndex < layerItems.length; itemIndex++) {
            if (animStopped) break;

            await waitIfPaused();
            if (animStopped) break;

            const speedMs = getAnimationSpeedMs();
            const dropDurationMs = Math.max(speedMs, 60);
            const entryDelayMs = Math.max(speedMs * 0.15, 10);
            const item = layerItems[itemIndex];
            const animMesh = createAnimItemMesh(item, furnace, baseY);

            animMesh.userData._animMesh = true;
            animMesh.userData._layerAnimMesh = true;
            animMesh.userData.layer = layerIndex;

            layerGroup.add(animMesh);

            const targetY = item.y + item.h / 2 + baseY;

            if (progressText) {
                const layerLabel = layerIndex === 1 ? '底层' : `第 ${layerIndex} 层`;
                progressText.textContent =
                    `(${stepIndex + 1}/${totalSteps}) · ${layerLabel} · 工件 ${itemIndex + 1}/${layerItems.length} · ${item.name}`;
            }

            await animateMeshDrop(animMesh, targetY, dropDurationMs);

            const finalMesh = finalMeshMap.get(item.id);
            if (finalMesh) {
                finalMesh.visible = true;
                disposeAnimMesh(animMesh);
            } else {
                // 理论上不会发生；兜底：保留动画 Mesh 在目标位置
                animMesh.position.y = targetY;
            }

            await sleep(entryDelayMs);
        }

        // 防止中途停止后当前层永久隐藏
        finalMeshMap.forEach(mesh => {
            mesh.visible = true;
        });
    }

    function highlightSimulationLayer(layerIndex) {
        const panel = document.getElementById('loading-simulation-panel');
        if (!panel) return;

        panel.querySelectorAll('.sim-step-card').forEach(card => {
            card.classList.remove('playing');
        });

        const card = panel.querySelector(`.sim-step-card[data-layer="${layerIndex}"]`);
        if (card) {
            card.classList.add('playing', 'active');
            card.scrollIntoView({
                block: 'nearest',
                behavior: 'smooth'
            });
        }
    }

    // 开始前先隐藏所有层，只保留工装框架
    layerGroups.forEach((layerGroup) => {
        if (!layerGroup.userData || !layerGroup.userData.isLayerGroup) return;
        layerGroup.visible = false;
    });

    for (let i = 0; i < layerIndexes.length; i++) {
        if (animStopped) break;

        await waitIfPaused();
        if (animStopped) break;

        const layerIndex = layerIndexes[i];
        const speedMs = getAnimationSpeedMs();
        const holdMs = Math.max(speedMs * 1.2, 80);

        applyLayerVisibility(layerIndex);

        if (onStepChange) {
            onStepChange(layerIndex, i, layerIndexes.length);
        } else {
            highlightSimulationLayer(layerIndex);
        }

        const mode = getViewMode();

        if (mode === 'single') {
            if (label) {
                label.textContent = '🎬 单层逐件装炉仿真中';
            }

            const layerGroup = layerGroups.get(layerIndex);
            await playItemsOneByOneInLayer(layerIndex, layerGroup, i, layerIndexes.length);
        } else {
            if (label) {
                label.textContent = '🎬 逐层装炉仿真中';
            }

            if (progressText) {
                const layerLabel = layerIndex === 1 ? '底层摆放' : `第 ${layerIndex} 层摆放`;
                progressText.textContent =
                    `(${i + 1}/${layerIndexes.length}) · ${layerLabel} · ${furnace.instanceId || '当前炉次'}`;
            }

            await sleep(holdMs);
        }
    }

    showAllLayers();

    const panel = document.getElementById('loading-simulation-panel');
    if (panel) {
        panel.querySelectorAll('.sim-step-card').forEach(card => {
            card.classList.remove('playing');
        });
    }

    if (onFinish) {
        onFinish(animStopped);
    }

    setIsAnimating(false);
    setAnimPaused(false);
    setAnimStopped(false);

    if (controlBar) {
        setTimeout(() => {
            controlBar.classList.remove('visible');
        }, 600);
    }

    if (btnAnimate) {
        btnAnimate.disabled = false;
        btnAnimate.style.opacity = '1';
    }

    const pauseBtn = document.getElementById('btn-anim-pause');
    if (pauseBtn) {
        pauseBtn.textContent = '⏸ 暂停';
        pauseBtn.style.background = '#f59e0b';
        pauseBtn.style.color = '#000';
    }
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
export function setTightFitCamera(direction, marginRatio = 0.18) {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !camera || !controls) return;

    // 1. 确保当前炉次可见
    group.visible = true;

    // 2. 计算当前炉膛/工装/工件的包围盒
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return;

    const center = new THREE.Vector3();
    box.getCenter(center);

    const size = new THREE.Vector3();
    box.getSize(size);

    // 3. 用包围球半径计算距离，比只取 maxDim 更稳，三视图都能看全
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);

    const dir = direction.clone().normalize();

    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const aspect = renderer && renderer.domElement
        ? renderer.domElement.clientWidth / renderer.domElement.clientHeight
        : camera.aspect || 1;

    // 同时考虑垂直 FOV 和水平 FOV，避免宽屏下正视/侧视被裁切
    const verticalDistance = sphere.radius / Math.sin(fovRad / 2);
    const horizontalFovRad = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);
    const horizontalDistance = sphere.radius / Math.sin(horizontalFovRad / 2);

    const distance = Math.max(verticalDistance, horizontalDistance) * (1 + marginRatio);

    // 4. 设置相机位置
    camera.position.copy(center.clone().add(dir.multiplyScalar(distance)));

    // 5. 修正相机 up，避免俯视时画面旋转/翻转
    if (Math.abs(direction.y) > 0.8) {
        // 俯视时，让画面上方对应场景 -Z 方向
        camera.up.set(0, 0, -1);
    } else {
        // 正视/侧视恢复正常 Y 向上
        camera.up.set(0, 1, 0);
    }

    // 6. 对准中心
    controls.target.copy(center);

    // 7. 根据模型大小设置合理的 Orbit 距离范围
    controls.minDistance = Math.max(sphere.radius * 0.15, 10);
    controls.maxDistance = Math.max(sphere.radius * 8, 3000);

    camera.near = Math.max(distance / 1000, 0.1);
    camera.far = Math.max(distance * 10, 10000);
    camera.updateProjectionMatrix();

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


// ---------- 淬火阶段：淬火介质仿真 V3.2 ----------
function getQuenchMediumMeta(mediumType = 'oil') {
    const key = String(mediumType || 'oil').toLowerCase().trim();
    const table = {
        oil: {
            key: 'oil',
            label: '淬火油',
            shortLabel: 'Oil · 60℃',
            tankColor: 0x7c3f12,
            surfaceColor: 0x8b5a2b,
            bubbleColor: 0xfbbf24,
            coolingColor: 0x38bdf8,
            coolingIntensity: 0.82,
            vaporFilmRiskFactor: 0.92,
            description: '适合多用炉/渗碳淬火场景，重点看入油一致性、蒸汽膜、中心冷却滞后与变形开裂风险。'
        },
        polymer: {
            key: 'polymer',
            label: '聚合物淬火液',
            shortLabel: 'Polymer',
            tankColor: 0x0891b2,
            surfaceColor: 0x22d3ee,
            bubbleColor: 0xa7f3d0,
            coolingColor: 0x67e8f9,
            coolingIntensity: 0.70,
            vaporFilmRiskFactor: 0.74,
            description: '适合降低开裂风险的水基聚合物淬火，重点看搅拌覆盖与冷却均匀性。'
        },
        water: {
            key: 'water',
            label: '水淬',
            shortLabel: 'Water',
            tankColor: 0x0ea5e9,
            surfaceColor: 0x38bdf8,
            bubbleColor: 0xe0f2fe,
            coolingColor: 0x7dd3fc,
            coolingIntensity: 1.0,
            vaporFilmRiskFactor: 1.12,
            description: '强冷介质，冷却速度高，但厚薄混装、尖角和高碳钢开裂/变形风险更敏感。'
        }
    };
    return table[key] || table.oil;
}

function estimateQuenchItemRisk(item, furnace) {
    const fw = Math.max(1, Number(furnace?.w || 1));
    const fd = Math.max(1, Number(furnace?.d || 1));
    const fh = Math.max(1, Number(furnace?.h || 1));
    const volume = Math.max(1, Number((item.w || 1) * (item.h || 1) * (item.d || 1)));
    const maxDim = Math.max(item.w || 1, item.h || 1, item.d || 1);
    const minDim = Math.max(1, Math.min(item.w || 1, item.h || 1, item.d || 1));
    const slenderness = clamp01((maxDim / minDim - 1.8) / 6.5);
    const cx = ((item.x || 0) + (item.w || 0) / 2) / fw;
    const cz = ((item.z || 0) + (item.d || 0) / 2) / fd;
    const cy = ((item.y || 0) + (item.h || 0) / 2) / fh;
    const centerPenalty = clamp01(1 - Math.sqrt((cx - 0.5) ** 2 + (cz - 0.5) ** 2) * 2.1);
    const lowerLayerPenalty = clamp01(1 - cy);
    const massLag = clamp01(Math.cbrt(volume) / 520);
    return clamp01(massLag * 0.46 + centerPenalty * 0.24 + lowerLayerPenalty * 0.16 + slenderness * 0.14);
}


function getQuenchItemDisplayName(item, fallbackIndex = 0) {
    const raw = String(item?.showName || item?.itemCode || item?.name || '').trim();
    const looksBad = !raw || raw.length > 22 || /广告|undefined|null|测试字段/i.test(raw);
    if (looksBad) return `工件 #${fallbackIndex + 1}`;
    return raw;
}

function getQuenchRiskRecords(furnace) {
    return [...(furnace?.packedItems || [])]
        .map((item, idx) => ({ item, idx, risk: estimateQuenchItemRisk(item, furnace), name: getQuenchItemDisplayName(item, idx) }))
        .sort((a, b) => b.risk - a.risk);
}

function getQuenchItemLayerIndex(item, furnace) {
    if (typeof item?.layer === 'number' && item.layer >= 1) return Math.round(item.layer);
    const y = Number(item?.y || 0);
    if (Array.isArray(furnace?.shelvesUsed) && furnace.shelvesUsed.length > 0) {
        const sorted = [...furnace.shelvesUsed].sort((a, b) => Number(a.y || 0) - Number(b.y || 0));
        for (let i = sorted.length - 1; i >= 0; i--) {
            if (y >= Number(sorted[i].y || 0) - 0.5) return i + 2;
        }
        return 1;
    }
    const fh = Math.max(1, Number(furnace?.h || 1));
    const centerY = y + Number(item?.h || 0) / 2;
    if (centerY < fh * 0.34) return 1;
    if (centerY < fh * 0.67) return 2;
    return 3;
}

function getQuenchLayerRecords(furnace) {
    const layers = new Map();
    (furnace?.packedItems || []).forEach((item, idx) => {
        const layer = getQuenchItemLayerIndex(item, furnace);
        if (!layers.has(layer)) {
            layers.set(layer, { layer, items: [], minY: Infinity, maxY: -Infinity, riskSum: 0, maxRisk: 0 });
        }
        const rec = layers.get(layer);
        const risk = estimateQuenchItemRisk(item, furnace);
        rec.items.push({ item, idx, risk });
        rec.minY = Math.min(rec.minY, Number(item.y || 0));
        rec.maxY = Math.max(rec.maxY, Number(item.y || 0) + Number(item.h || 0));
        rec.riskSum += risk;
        rec.maxRisk = Math.max(rec.maxRisk, risk);
    });
    const arr = [...layers.values()].sort((a, b) => a.minY - b.minY).map((rec, idx, all) => {
        const rank = idx;
        const norm = all.length <= 1 ? 0 : idx / (all.length - 1);
        const avgRisk = rec.items.length ? rec.riskSum / rec.items.length : 0;
        const layerName = all.length <= 1 ? '单层' : (idx === 0 ? '底层' : (idx === all.length - 1 ? '上层' : `第 ${idx + 1} 层`));
        return { ...rec, rank, norm, avgRisk, layerName };
    });
    return arr;
}

function getQuenchLayerInfoForItem(item, furnace) {
    const layer = getQuenchItemLayerIndex(item, furnace);
    const layers = getQuenchLayerRecords(furnace);
    return layers.find(rec => rec.layer === layer) || { layer, rank: 0, norm: 0, layerName: '单层', avgRisk: 0, maxRisk: 0 };
}

function getQuenchLocalImmersionProgress(item, furnace, globalProgress = 0) {
    const p = clamp01(globalProgress);
    const info = getQuenchLayerInfoForItem(item, furnace);
    // V3.2: 底层先入油，上层后入油。20% 前主要是出炉转移，20%~58% 依层穿透油面。
    const onset = 0.20 + info.norm * 0.18;
    const full = onset + 0.20 + info.norm * 0.06;
    return clamp01((p - onset) / Math.max(0.08, full - onset));
}

function getQuenchLayerDiagnostics(furnace, progress = 0) {
    const layers = getQuenchLayerRecords(furnace);
    if (!layers.length) {
        return {
            layerCount: 0,
            immersedLayerCount: 0,
            fullyImmersedLayerCount: 0,
            slowestLayerLabel: '-',
            layerCoolingSpreadLabel: '-',
            interLayerCoolingRisk: '低',
            layerProgressText: '暂无分层数据',
            bottomImmersionTime: '-',
            middleImmersionTime: '-',
            topImmersionTime: '-'
        };
    }
    const p = clamp01(progress);
    const enriched = layers.map(layer => {
        const pseudoItem = { y: layer.minY, h: Math.max(1, layer.maxY - layer.minY), layer: layer.layer };
        const local = getQuenchLocalImmersionProgress(pseudoItem, furnace, p);
        return { ...layer, local };
    });
    const immersedLayerCount = enriched.filter(layer => layer.local > 0.05).length;
    const fullyImmersedLayerCount = enriched.filter(layer => layer.local > 0.86).length;
    const slowest = [...enriched].sort((a, b) => (a.local - b.local) || (b.avgRisk - a.avgRisk))[0];
    const spread = Math.max(...enriched.map(l => l.local)) - Math.min(...enriched.map(l => l.local));
    const risk = spread > 0.58 ? '高' : (spread > 0.30 ? '中' : '低');
    const layerProgressText = `已入油 ${immersedLayerCount}/${layers.length} 层，完全入油 ${fullyImmersedLayerCount}/${layers.length} 层`;
    const first = enriched[0];
    const mid = enriched[Math.floor((enriched.length - 1) / 2)] || first;
    const last = enriched[enriched.length - 1] || first;
    function timeLabel(layer) {
        if (!layer) return '-';
        const seconds = 0.8 + layer.norm * 3.6 + layer.avgRisk * 1.8;
        return `${seconds.toFixed(1)}s`;
    }
    return {
        layerCount: layers.length,
        immersedLayerCount,
        fullyImmersedLayerCount,
        slowestLayerLabel: slowest?.layerName || '-',
        layerCoolingSpreadLabel: risk,
        interLayerCoolingRisk: risk,
        layerProgressText,
        bottomImmersionTime: timeLabel(first),
        middleImmersionTime: layers.length >= 3 ? timeLabel(mid) : '-',
        topImmersionTime: layers.length >= 2 ? timeLabel(last) : '-',
        layers: enriched.map(layer => ({ layer: layer.layer, label: layer.layerName, progress: Math.round(layer.local * 100), avgRisk: Math.round(layer.avgRisk * 100) }))
    };
}

function getQuenchFurnaceLift(progress, furnace) {
    const p = clamp01(progress);
    const fh = Math.max(1, Number(furnace?.h || 900));
    const maxLift = Math.max(180, Math.min(380, fh * 0.42));
    const t = clamp01((p - 0.08) / 0.38);
    const smooth = t * t * (3 - 2 * t);
    return maxLift * (1 - smooth);
}

function getCurrentQuenchFurnaceGroup() {
    return furnaceGroups && typeof furnaceGroups.get === 'function' ? furnaceGroups.get(currentFurnaceIndex) : null;
}

function updateQuenchFurnaceImmersionTransform(progress, furnace) {
    const group = getCurrentQuenchFurnaceGroup();
    if (!group || !furnace) return 0;
    if (!group.userData._quenchOriginalPosition) {
        group.userData._quenchOriginalPosition = group.position.clone();
    }
    const original = group.userData._quenchOriginalPosition;
    const lift = getQuenchFurnaceLift(progress, furnace);
    group.position.set(original.x, original.y + lift, original.z);
    if (thermalSimRuntime.riskGroup) {
        thermalSimRuntime.riskGroup.position.y = lift;
    }
    return lift;
}

function restoreQuenchFurnaceTransform() {
    const group = getCurrentQuenchFurnaceGroup();
    if (group && group.userData && group.userData._quenchOriginalPosition) {
        group.position.copy(group.userData._quenchOriginalPosition);
        delete group.userData._quenchOriginalPosition;
    }
}

function normalizeQuenchFurnaceVisibilityMode(mode = 'auto') {
    const key = String(mode || 'auto').toLowerCase();
    return ['auto', 'hidden', 'ghost', 'shown'].includes(key) ? key : 'auto';
}

function getQuenchFurnaceVisibilityState(progress = thermalSimRuntime.progress || 0, mode = thermalSimRuntime.selectedQuenchFurnaceVisibilityMode || 'auto') {
    const p = clamp01(progress);
    const normalized = normalizeQuenchFurnaceVisibilityMode(mode);
    if (normalized === 'hidden') {
        return { mode: normalized, visible: false, opacityScale: 0, label: '炉体隐藏', description: '仅显示油槽、工装、工件和冷却风险，适合入油后观察。' };
    }
    if (normalized === 'ghost') {
        return { mode: normalized, visible: true, opacityScale: 0.24, label: '炉体半透明', description: '保留少量设备语境，但不遮挡油槽和工件。' };
    }
    if (normalized === 'shown') {
        return { mode: normalized, visible: true, opacityScale: 1, label: '炉体显示', description: '完整显示热处理设备语境，用于查看出炉前后空间关系。' };
    }

    if (p < 0.20) {
        return { mode: normalized, visible: true, opacityScale: 1, label: '自动 · 出炉转移', description: '出炉转移阶段保留炉体，说明工装从炉内离开。' };
    }
    if (p < 0.45) {
        const fade = 1 - ((p - 0.20) / 0.25);
        return { mode: normalized, visible: true, opacityScale: 0.18 + fade * 0.42, label: '自动 · 炉体弱化', description: '入油穿透阶段弱化炉体，让油面和底层入油关系更清楚。' };
    }
    return { mode: normalized, visible: false, opacityScale: 0, label: '自动 · 入油后隐藏', description: '沸腾/对流冷却阶段隐藏炉体，突出油槽、气泡、蒸汽膜和风险工件。' };
}

function applyOpacityScaleToObject3D(obj, opacityScale = 1) {
    if (!obj) return;
    obj.traverse(child => {
        if (!child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(mat => {
            if (!mat) return;
            if (!mat.userData) mat.userData = {};
            if (mat.userData._quenchBaseOpacity == null) {
                mat.userData._quenchBaseOpacity = typeof mat.opacity === 'number' ? mat.opacity : 1;
            }
            mat.transparent = true;
            mat.opacity = Math.max(0, Math.min(1, mat.userData._quenchBaseOpacity * opacityScale));
            mat.needsUpdate = true;
        });
    });
}

function updateQuenchFurnaceVisibility(progress = thermalSimRuntime.progress || 0) {
    const context = thermalSimRuntime.quenchEquipmentContext;
    if (!context) return getQuenchFurnaceVisibilityState(progress);
    const state = getQuenchFurnaceVisibilityState(progress);
    context.visible = !!state.visible;
    if (state.visible) {
        applyOpacityScaleToObject3D(context, state.opacityScale);
    }
    context.userData.quenchVisibilityState = state;
    return state;
}

let quenchBubbleTexture = null;
function getQuenchBubbleTexture() {
    if (quenchBubbleTexture) return quenchBubbleTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(30, 28, 3, 32, 32, 30);
    gradient.addColorStop(0, 'rgba(255,255,255,0.96)');
    gradient.addColorStop(0.36, 'rgba(186,230,253,0.72)');
    gradient.addColorStop(0.68, 'rgba(125,211,252,0.28)');
    gradient.addColorStop(1, 'rgba(125,211,252,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    quenchBubbleTexture = new THREE.CanvasTexture(canvas);
    quenchBubbleTexture.needsUpdate = true;
    return quenchBubbleTexture;
}

function calculateQuenchMediumMetrics(furnace, progress = 0, mediumMeta = getQuenchMediumMeta()) {
    const items = furnace?.packedItems || [];
    const risks = getQuenchRiskRecords(furnace);
    const avgRisk = risks.length ? risks.reduce((sum, record) => sum + record.risk, 0) / risks.length : 0;
    const maxRisk = risks.length ? risks[0].risk : 0;
    const packedVolume = items.reduce((sum, item) => sum + Number((item.w || 0) * (item.h || 0) * (item.d || 0)), 0);
    const furnaceVolume = Math.max(1, Number((furnace?.w || 1) * (furnace?.h || 1) * (furnace?.d || 1)));
    const density = packedVolume / furnaceVolume;
    const immersionUniformity = Math.max(42, Math.round(96 - avgRisk * 34 - maxRisk * 12 - density * 28));
    const coolingUniformity = Math.max(38, Math.round(94 - avgRisk * 38 - density * 36));
    const vaporFilmCount = risks.filter(r => r.risk * (mediumMeta.vaporFilmRiskFactor || 1) > 0.58).length;
    const severeRiskCount = risks.filter(r => r.risk > 0.66).length;
    const crackRiskScore = clamp01(maxRisk * (mediumMeta.coolingIntensity || 0.8) * 0.72 + density * 0.26);
    const deformationRiskScore = clamp01(avgRisk * 0.62 + density * 0.34);
    const p = clamp01(progress);
    const layerDiag = getQuenchLayerDiagnostics(furnace, p);
    let stageLabel = '出炉转移';
    let stageDesc = `工装位于油面上方，红橙色表示高温状态；当前${layerDiag.layerProgressText}，重点关注出炉到入油延迟。`;
    if (p >= 0.20 && p < 0.45) {
        stageLabel = '入油穿透';
        stageDesc = `工装沿 Y 方向下降穿过液面，底层先接触介质，上层延迟入油；${layerDiag.layerProgressText}。`;
    } else if (p >= 0.45 && p < 0.76) {
        stageLabel = '沸腾冷却';
        stageDesc = `已入油层周围产生蓝白气泡，厚大件/密集层保留红橙核心；层间冷却差为${layerDiag.interLayerCoolingRisk}。`;
    } else if (p >= 0.76) {
        stageLabel = '对流冷却';
        stageDesc = `气泡逐步减少，蓝色冷却区扩散；仍需关注${layerDiag.slowestLayerLabel}和中心厚大件的冷却滞后。`;
    }
    const worstRecord = risks[0];
    const primaryReason = vaporFilmCount > 0
        ? '高风险件集中在中心/下层或厚大件附近，可能形成蒸汽膜和中心冷却滞后。'
        : (density > 0.12 ? '当前装载密度偏高，建议重点复核层间油液交换和搅拌覆盖。' : '当前入油路径较顺畅，主要关注个别厚大件中心冷却。');
    return {
        mode: 'quench',
        processName: '淬火阶段',
        mediumType: mediumMeta.key,
        mediumLabel: mediumMeta.label,
        mediumShortLabel: mediumMeta.shortLabel,
        oilTemperature: mediumMeta.key === 'water' ? '25℃' : (mediumMeta.key === 'polymer' ? '35℃' : '60℃'),
        agitationLevel: density > 0.18 ? '中高' : '中',
        transferDelaySec: Math.round(6 + density * 18 + maxRisk * 7),
        immersionUniformity,
        coolingUniformity,
        vaporFilmRiskCount: vaporFilmCount,
        severeRiskCount,
        deformationRisk: deformationRiskScore > 0.62 ? '高' : (deformationRiskScore > 0.42 ? '中' : '低'),
        crackRisk: crackRiskScore > 0.66 ? '高' : (crackRiskScore > 0.45 ? '中' : '低'),
        coreLagRisk: maxRisk > 0.62 ? '高' : (maxRisk > 0.42 ? '中' : '低'),
        worstItemName: worstRecord?.name || '-',
        primaryRiskReason: primaryReason,
        densityRate: Math.round(density * 1000) / 10,
        progress: Math.round(p * 100),
        quenchStageLabel: stageLabel,
        quenchStageDesc: stageDesc,
        suggestion: vaporFilmCount > 0
            ? '建议提高搅拌强度、降低单框密度，或调整厚大件/环件入油方向，减少中心区蒸汽膜停留。'
            : (deformationRiskScore > 0.42 ? '建议复核薄长件/环件入油方向，必要时分层或分框淬火。' : '当前淬火介质覆盖较均衡，可继续结合回火稳定性复核。'),
        visualNote: '油槽/液面表示淬火介质；炉体按阶段自动显示/弱化/隐藏；工装下降表示入油路径；波纹表示液面冲击；蓝白气泡只在已入油层附近增强；红橙线框表示高风险工件。',
        layerCount: layerDiag.layerCount,
        immersedLayerCount: layerDiag.immersedLayerCount,
        fullyImmersedLayerCount: layerDiag.fullyImmersedLayerCount,
        layerProgressText: layerDiag.layerProgressText,
        bottomImmersionTime: layerDiag.bottomImmersionTime,
        middleImmersionTime: layerDiag.middleImmersionTime,
        topImmersionTime: layerDiag.topImmersionTime,
        slowestCoolingLayer: layerDiag.slowestLayerLabel,
        interLayerCoolingRisk: layerDiag.interLayerCoolingRisk,
        layerCoolingSpreadLabel: layerDiag.layerCoolingSpreadLabel,
        quenchLayerDetails: layerDiag.layers || [],
        quenchFurnaceVisibilityMode: normalizeQuenchFurnaceVisibilityMode(thermalSimRuntime.selectedQuenchFurnaceVisibilityMode || 'auto'),
        quenchFurnaceVisibilityLabel: getQuenchFurnaceVisibilityState(p).label,
        quenchFurnaceVisibilityDesc: getQuenchFurnaceVisibilityState(p).description,
        quenchModeName: '淬火介质 V3.4'
    };
}
function updateQuenchWorkstationGlow() {
    const group = thermalSimRuntime.quenchTankGroup;
    if (!group) return;
    const palette = getProcessSceneThemePalette('quench');
    group.traverse(child => {
        if (!child.userData?.isQuenchWorkstationGlow || !child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(mat => {
            if (mat.color) mat.color.setHex(palette.quenchPadColor);
            mat.opacity = palette.quenchPadOpacity;
            mat.needsUpdate = true;
        });
    });
}

function buildQuenchMediumVisual(furnace, mediumMeta) {
    const group = new THREE.Group();
    group.name = 'quenchMediumVisual';
    const fw = Number(furnace.w || 900);
    const fh = Number(furnace.h || 900);
    const fd = Number(furnace.d || 900);
    const y0 = THERMAL_BASE_Y;
    const isRing = furnace.toolingType === 'ring-tooling';
    const outerRadius = isRing ? getRingThermalRadii(furnace).outerRadius : Math.max(fw, fd) / 2;
    const pad = Math.max(90, Math.min(180, Math.max(fw, fd) * 0.16));
    const tankHeight = fh * 0.72;
    const tankY = y0 + tankHeight / 2 - 24;
    const liquidY = y0 + tankHeight * 0.46;
    const sideMat = new THREE.MeshBasicMaterial({ color: mediumMeta.tankColor, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false });
    const edgeMat = new THREE.LineBasicMaterial({ color: mediumMeta.coolingColor, transparent: true, opacity: 0.56, depthWrite: false });
    const surfaceMat = new THREE.MeshBasicMaterial({ color: mediumMeta.surfaceColor, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false });
    let tankWidth = fw + pad * 2;
    let tankDepth = fd + pad * 2;
    let tankRadius = outerRadius + pad * 0.65;

    if (isRing) {
        const radius = tankRadius;
        const wall = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, tankHeight, 112, 1, true), sideMat);
        wall.position.y = tankY;
        wall.renderOrder = 10;
        group.add(wall);
        const bottomRing = buildRingCircleLine(radius, y0 - 24, mediumMeta.coolingColor, 0.30);
        const topRing = buildRingCircleLine(radius, y0 + tankHeight - 24, mediumMeta.coolingColor, 0.62);
        group.add(bottomRing, topRing);
        const surface = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.96, 112), surfaceMat);
        surface.rotation.x = -Math.PI / 2;
        surface.position.y = liquidY;
        surface.renderOrder = 16;
        surface.userData.isQuenchLiquidSurface = true;
        group.add(surface);
    } else {
        const tw = tankWidth;
        const td = tankDepth;
        const boxGeo = new THREE.BoxGeometry(tw, tankHeight, td);
        const box = new THREE.Mesh(boxGeo, sideMat);
        box.position.y = tankY;
        box.renderOrder = 10;
        group.add(box);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), edgeMat);
        edges.position.copy(box.position);
        edges.renderOrder = 18;
        group.add(edges);
        // 液位线和槽壁内框更明确，避免普通料框看起来像透明方块。
        const surface = new THREE.Mesh(new THREE.PlaneGeometry(tw * 0.96, td * 0.96), surfaceMat);
        surface.rotation.x = -Math.PI / 2;
        surface.position.y = liquidY;
        surface.renderOrder = 16;
        surface.userData.isQuenchLiquidSurface = true;
        group.add(surface);
        const liquidEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(tw * 0.96, 2, td * 0.96)), edgeMat.clone());
        liquidEdge.position.set(0, liquidY, 0);
        liquidEdge.renderOrder = 19;
        group.add(liquidEdge);
    }

    // V3.4：淬火工位冷蓝光。让油槽从深色/浅色背景里独立出来，不再和炉体/工装糊在一起。
    const themePalette = getProcessSceneThemePalette('quench');
    const glowGeo = isRing
        ? new THREE.CircleGeometry(tankRadius * 1.10, 112)
        : new THREE.PlaneGeometry(tankWidth * 1.10, tankDepth * 1.10);
    const glowMat = new THREE.MeshBasicMaterial({
        color: themePalette.quenchPadColor,
        transparent: true,
        opacity: themePalette.quenchPadOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending
    });
    const workstationGlow = new THREE.Mesh(glowGeo, glowMat);
    workstationGlow.rotation.x = -Math.PI / 2;
    workstationGlow.position.y = y0 - 32;
    workstationGlow.renderOrder = 4;
    workstationGlow.userData.isQuenchWorkstationGlow = true;
    group.add(workstationGlow);

    // 入油路径：向下箭头 + 当前液面冲击语义。
    const arrowMat = new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.72, depthWrite: false });
    const arrowCount = isRing ? 10 : 8;
    for (let i = 0; i < arrowCount; i++) {
        const a = (i / arrowCount) * Math.PI * 2;
        const x = isRing ? Math.cos(a) * outerRadius * 0.76 : (-fw / 2 + (i % 4 + 0.5) * fw / 4);
        const z = isRing ? Math.sin(a) * outerRadius * 0.76 : (i < 4 ? -fd * 0.34 : fd * 0.34);
        const yTop = y0 + fh + 150;
        const yEnd = liquidY + 12;
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, yTop, z), new THREE.Vector3(x, yEnd, z)]);
        const line = new THREE.Line(geo, arrowMat);
        line.renderOrder = 26;
        group.add(line);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(13, 34, 18), new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.78, depthWrite: false }));
        cone.rotation.x = Math.PI;
        cone.position.set(x, yEnd + 18, z);
        cone.renderOrder = 27;
        group.add(cone);
    }

    // V3.1：油面波纹 / 入油冲击圈。用圆环低成本表达液面冲击，不做真实流体。
    const waveGroup = new THREE.Group();
    waveGroup.name = 'quenchSurfaceWaveRings';
    const waveBaseRadius = isRing ? tankRadius * 0.22 : Math.min(tankWidth, tankDepth) * 0.16;
    const waveMaxRadius = isRing ? tankRadius * 0.92 : Math.min(tankWidth, tankDepth) * 0.52;
    for (let i = 0; i < 4; i++) {
        const ringGeo = new THREE.RingGeometry(waveBaseRadius + i * 28, waveBaseRadius + i * 28 + 4, 96);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.20, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = liquidY + 4 + i * 0.4;
        ring.renderOrder = 28;
        ring.userData = { isQuenchWaveRing: true, waveIndex: i, baseRadius: waveBaseRadius, maxRadius: waveMaxRadius };
        waveGroup.add(ring);
    }
    group.add(waveGroup);

    // V3.1：冷却层和蒸汽膜语义层，随动画阶段改变透明度。
    const coolingLayer = isRing
        ? new THREE.Mesh(new THREE.CylinderGeometry(Math.max(outerRadius * 0.92, 1), Math.max(outerRadius * 0.92, 1), fh * 0.34, 96, 1, true), new THREE.MeshBasicMaterial({ color: mediumMeta.coolingColor, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }))
        : new THREE.Mesh(new THREE.BoxGeometry(fw * 0.96, fh * 0.34, fd * 0.96), new THREE.MeshBasicMaterial({ color: mediumMeta.coolingColor, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    coolingLayer.position.y = liquidY - fh * 0.18;
    coolingLayer.renderOrder = 17;
    coolingLayer.userData.isQuenchCoolingLayer = true;
    group.add(coolingLayer);

    const riskRecords = getQuenchRiskRecords(furnace);
    const particleCount = Math.min(220, Math.max(88, (furnace.packedItems || []).length * 4));
    const positions = [];
    const colors = [];
    const base = [];
    const hotItems = riskRecords.slice(0, Math.min(18, riskRecords.length));
    const bubbleColor = new THREE.Color(mediumMeta.bubbleColor);
    for (let i = 0; i < particleCount; i++) {
        const anchor = hotItems.length ? hotItems[i % hotItems.length] : null;
        let x, y, z, risk = anchor?.risk || 0.35;
        if (anchor?.item) {
            const center = getItemCenterWorld(anchor.item, furnace);
            const spread = Math.max(24, Math.min(90, Math.max(anchor.item.w || 1, anchor.item.d || 1) * 0.42));
            x = center.x + (Math.random() - 0.5) * spread;
            z = center.z + (Math.random() - 0.5) * spread;
            y = Math.max(y0 + 12, Math.min(liquidY - 8, center.y + (Math.random() - 0.5) * 50));
        } else if (isRing) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * (outerRadius + pad * 0.35);
            x = Math.cos(a) * r;
            z = Math.sin(a) * r;
            y = y0 + Math.random() * tankHeight * 0.55;
        } else {
            x = (Math.random() - 0.5) * (fw + pad * 1.2);
            z = (Math.random() - 0.5) * (fd + pad * 1.2);
            y = y0 + Math.random() * tankHeight * 0.55;
        }
        positions.push(x, y, z);
        const c = bubbleColor.clone().lerp(new THREE.Color(0xffffff), 0.38 + Math.random() * 0.30);
        colors.push(c.r, c.g, c.b);
        const layerInfo = anchor?.item ? getQuenchLayerInfoForItem(anchor.item, furnace) : { norm: 0.35 };
        const layerOnset = 0.20 + (layerInfo.norm || 0) * 0.18 + Math.random() * 0.08;
        base.push(x, y, z, 0.55 + Math.random() * 0.95, Math.random(), risk, layerInfo.norm || 0, layerOnset);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
        size: Math.max(14, Math.min(32, Math.max(fw, fd) / 36)),
        map: getQuenchBubbleTexture(),
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const bubbles = new THREE.Points(geo, mat);
    bubbles.name = 'quenchBubbleParticles';
    bubbles.userData = { isQuenchParticles: true, base, tankHeight, y0, liquidY };
    bubbles.renderOrder = 30;
    group.add(bubbles);
    thermalSimRuntime.quenchParticleGroup = bubbles;

    const label = buildThermalHeatmapLabel('入油 / 沸腾冷却', `${mediumMeta.label} · 波纹=液面冲击 · 气泡=沸腾换热`, new THREE.Vector3(-fw / 2 - 20, y0 + fh + 120, -fd / 2 - 40));
    label.userData.isQuenchLabel = true;
    group.add(label);
    group.userData = { isQuenchMediumVisual: true, mediumType: mediumMeta.key, waveGroup, coolingLayer, liquidY, tankHeight, y0 };
    return group;
}
function applyQuenchTintToItems(furnace, progress = 0, mediumMeta = getQuenchMediumMeta()) {
    const group = furnaceGroups.get(currentFurnaceIndex);
    if (!group || !furnace) return;
    const p = clamp01(progress);
    const itemMap = new Map((furnace.packedItems || []).map(item => [item.id, item]));
    const hot = new THREE.Color(0xf97316);
    const cool = new THREE.Color(mediumMeta.coolingColor);
    const riskColor = new THREE.Color(0xef4444);
    group.traverse(child => {
        if (!child.isMesh || !child.userData || !child.userData.itemId) return;
        const item = itemMap.get(child.userData.itemId);
        const risk = item ? estimateQuenchItemRisk(item, furnace) : 0.3;
        const layerImmersion = item ? getQuenchLocalImmersionProgress(item, furnace, p) : p;
        const localCooling = clamp01(layerImmersion * (1.12 - risk * 0.46));
        const tint = new THREE.Color().lerpColors(hot, cool, localCooling);
        if (risk > 0.60 && p > 0.30) tint.lerp(riskColor, 0.22);
        getMeshMaterials(child).forEach(mat => {
            if (!mat.color) return;
            saveOriginalMaterialIfNeeded(mat);
            mat.color.copy(tint);
            if (mat.emissive) {
                mat.emissive.copy(tint);
                mat.emissive.multiplyScalar(0.35);
                mat.emissiveIntensity = 0.10 + (1 - localCooling) * 0.34;
            }
            mat.transparent = true;
            mat.opacity = 0.56 + localCooling * 0.20;
            mat.needsUpdate = true;
        });
    });
}

function buildQuenchRiskMarkers(furnace) {
    const group = new THREE.Group();
    group.name = 'quenchRiskMarkers';
    const sorted = getQuenchRiskRecords(furnace).slice(0, 6);
    sorted.forEach(({ item, risk, name }, idx) => {
        if (risk < 0.42) return;
        const center = getItemCenterWorld(item, furnace);
        const geometry = new THREE.BoxGeometry((item.w || 1) + 18, (item.h || 1) + 18, (item.d || 1) + 18);
        const marker = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: idx === 0 ? 0xef4444 : 0xf97316, transparent: true, opacity: idx === 0 ? 0.92 : 0.66, depthWrite: false, depthTest: false }));
        marker.position.copy(center);
        marker.renderOrder = 42;
        group.add(marker);

        if (risk > 0.56) {
            // 紫灰色薄膜：表示蒸汽膜/局部换热不良风险，不等同于真实液体仿真。
            const film = new THREE.Mesh(
                new THREE.BoxGeometry((item.w || 1) + 26, Math.max(8, (item.h || 1) * 0.16), (item.d || 1) + 26),
                new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.18, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending })
            );
            film.position.copy(center).add(new THREE.Vector3(0, Math.max(4, (item.h || 1) * 0.38), 0));
            film.renderOrder = 41;
            film.userData.isQuenchVaporFilmMarker = true;
            group.add(film);
        }

        if (idx < 3) {
            group.add(createDimensionLabelSprite(idx === 0 ? `最高风险 · ${name}` : `风险 #${idx + 1}`, center.clone().add(new THREE.Vector3(0, (item.h || 1) * 0.72 + 58, 0)), {
                width: idx === 0 ? 220 : 112,
                height: 42,
                color: '#fee2e2',
                bg: 'rgba(69, 10, 10, 0.74)',
                stroke: 'rgba(248, 113, 113, 0.62)'
            }));
        }
    });
    return group;
}
function updateQuenchMediumAnimation(now) {
    if (thermalSimRuntime.activeMode !== 'quench') return;
    if (thermalSimRuntime.isPlaying && !thermalSimRuntime.paused) {
        const duration = Math.max(1200, Number(thermalSimRuntime.quenchDurationMs || 8500));
        const elapsed = now - (thermalSimRuntime.startedAt || now);
        thermalSimRuntime.progress = clamp01(elapsed / duration);
    }
    const progress = clamp01(thermalSimRuntime.progress || 0);
    const furnace = getCurrentThermalFurnace();
    if (furnace) updateQuenchFurnaceImmersionTransform(progress, furnace);
    updateQuenchFurnaceVisibility(progress);
    const quenchVisual = thermalSimRuntime.quenchTankGroup;
    const liquidSurface = quenchVisual?.children?.find(child => child.userData?.isQuenchLiquidSurface);
    const coolingLayer = quenchVisual?.userData?.coolingLayer;
    const waveGroup = quenchVisual?.userData?.waveGroup;

    if (liquidSurface && liquidSurface.material) {
        liquidSurface.position.y = (quenchVisual.userData?.liquidY || liquidSurface.position.y) + Math.sin(now * 0.003) * 2.4 * Math.min(1, Math.max(0.15, progress));
        liquidSurface.material.opacity = 0.22 + Math.sin(progress * Math.PI) * 0.18;
        liquidSurface.material.needsUpdate = true;
    }
    if (coolingLayer && coolingLayer.material) {
        const layerProgress = clamp01((progress - 0.28) / 0.62);
        coolingLayer.material.opacity = 0.06 + layerProgress * 0.20;
        coolingLayer.scale.y = 0.72 + layerProgress * 0.55;
        coolingLayer.position.y = (quenchVisual.userData?.liquidY || coolingLayer.position.y) - 80 - layerProgress * 90;
        coolingLayer.material.needsUpdate = true;
    }
    if (waveGroup) {
        waveGroup.children.forEach(ring => {
            if (!ring.userData?.isQuenchWaveRing) return;
            const idx = ring.userData.waveIndex || 0;
            const phase = (progress * 1.65 + idx * 0.22 + now * 0.000035) % 1;
            const amp = progress > 0.12 && progress < 0.78 ? 1 : 0.28;
            const scale = 0.18 + phase * 2.4;
            ring.scale.setScalar(scale);
            if (ring.material) {
                ring.material.opacity = Math.max(0, (1 - phase) * 0.34 * amp);
                ring.material.needsUpdate = true;
            }
        });
    }

    const bubbles = thermalSimRuntime.quenchParticleGroup;
    if (bubbles && bubbles.geometry && bubbles.userData?.base) {
        const attr = bubbles.geometry.getAttribute('position');
        const base = bubbles.userData.base;
        const y0 = bubbles.userData.y0 || THERMAL_BASE_Y;
        const liquidY = bubbles.userData.liquidY || (y0 + 320);
        const tankHeight = bubbles.userData.tankHeight || 600;
        const stageBoost = progress < 0.28 ? 0.25 : (progress < 0.76 ? 1.0 : 0.55);
        for (let i = 0; i < attr.count; i++) {
            const bi = i * 8;
            const risk = base[bi + 5] || 0.4;
            const onset = base[bi + 7] == null ? 0.24 : base[bi + 7];
            const localActive = clamp01((progress - onset) / 0.16);
            const drift = (now * 0.00028 * base[bi + 3] + base[bi + 4] + progress * 0.85) % 1;
            const riseRange = tankHeight * (0.22 + risk * 0.24);
            if (localActive <= 0.02) {
                attr.setXYZ(i, base[bi], y0 - 220 - i * 0.05, base[bi + 2]);
            } else {
                attr.setXYZ(
                    i,
                    base[bi] + Math.sin(now * 0.0014 + i) * (3 + risk * 7),
                    Math.min(liquidY + 32, base[bi + 1] + drift * riseRange * localActive),
                    base[bi + 2] + Math.cos(now * 0.0011 + i) * (3 + risk * 7)
                );
            }
        }
        attr.needsUpdate = true;
        if (bubbles.material) {
            bubbles.material.opacity = 0.16 + Math.sin(progress * Math.PI) * 0.50 * stageBoost;
            bubbles.material.size = (bubbles.material.size || 20) * (1 + Math.sin(now * 0.004) * 0.002);
            bubbles.material.needsUpdate = true;
        }
    }
    const mediumMeta = getQuenchMediumMeta(thermalSimRuntime.selectedQuenchMediumType || 'oil');
    const shouldUpdate = !thermalSimRuntime.lastQuenchVisualUpdateAt || now - thermalSimRuntime.lastQuenchVisualUpdateAt > 160 || progress >= 1;
    if (furnace && shouldUpdate) {
        thermalSimRuntime.lastQuenchVisualUpdateAt = now;
        applyQuenchTintToItems(furnace, progress, mediumMeta);
        thermalSimRuntime.metrics = calculateQuenchMediumMetrics(furnace, progress, mediumMeta);
        if (thermalSimRuntime.onUpdate && thermalSimRuntime.metrics) thermalSimRuntime.onUpdate(thermalSimRuntime.metrics);
    }
    if (progress >= 1 && thermalSimRuntime.isPlaying) {
        thermalSimRuntime.isPlaying = false;
        thermalSimRuntime.paused = false;
        if (thermalSimRuntime.onFinish && thermalSimRuntime.metrics) thermalSimRuntime.onFinish(thermalSimRuntime.metrics);
    }
}
export function renderQuenchMediumSimulation(options = {}) {
    const furnace = getCurrentThermalFurnace();
    if (!furnace) return null;
    clearThermalGroupChildren();
    restoreThermalItemMaterials();
    setThermalSceneTheme(true, 'quench');
    if (options.mediumType) thermalSimRuntime.selectedQuenchMediumType = getQuenchMediumMeta(options.mediumType).key;
    const mediumMeta = getQuenchMediumMeta(thermalSimRuntime.selectedQuenchMediumType || 'oil');
    const progress = clamp01(options.progress != null ? Number(options.progress) : (thermalSimRuntime.progress || 0.08));
    const group = ensureThermalSimulationGroup();
    const equipmentContext = buildProcessEquipmentContext(furnace, 'quench');
    if (equipmentContext) {
        equipmentContext.name = 'quenchStageFurnaceContext';
        group.add(equipmentContext);
    }
    thermalSimRuntime.quenchEquipmentContext = equipmentContext || null;
    const visual = buildQuenchMediumVisual(furnace, mediumMeta);
    const risk = buildQuenchRiskMarkers(furnace);
    group.add(visual);
    group.add(risk);
    group.visible = true;
    thermalSimRuntime.visible = true;
    thermalSimRuntime.activeMode = 'quench';
    thermalSimRuntime.isPlaying = false;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.progress = progress;
    thermalSimRuntime.startedAt = performance.now();
    thermalSimRuntime.quenchTankGroup = visual;
    thermalSimRuntime.riskGroup = risk;
    thermalSimRuntime.metrics = calculateQuenchMediumMetrics(furnace, progress, mediumMeta);
    applyQuenchTintToItems(furnace, progress, mediumMeta);
    updateQuenchFurnaceImmersionTransform(progress, furnace);
    updateQuenchFurnaceVisibility(progress);
    return thermalSimRuntime.metrics;
}

export function playQuenchMediumSimulation(options = {}) {
    if (options && options.durationMs) {
        thermalSimRuntime.quenchDurationMs = Math.max(1200, Number(options.durationMs) || 8500);
    }
    if (thermalSimRuntime.activeMode !== 'quench' || !thermalSimRuntime.visible) {
        renderQuenchMediumSimulation({ mediumType: thermalSimRuntime.selectedQuenchMediumType || 'oil', progress: 0 });
    }
    const duration = Math.max(1200, Number(thermalSimRuntime.quenchDurationMs || 8500));
    const startProgress = clamp01(options.startProgress != null ? Number(options.startProgress) : (thermalSimRuntime.progress || 0));
    thermalSimRuntime.progress = startProgress >= 1 ? 0 : startProgress;
    thermalSimRuntime.isPlaying = true;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.startedAt = performance.now() - thermalSimRuntime.progress * duration;
    thermalSimRuntime.onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : null;
    thermalSimRuntime.onFinish = typeof options.onFinish === 'function' ? options.onFinish : null;
    thermalSimRuntime.lastQuenchVisualUpdateAt = 0;
    if (thermalSimRuntime.metrics) thermalSimRuntime.metrics.animationPlaying = true;
    return thermalSimRuntime.metrics;
}

export function pauseQuenchMediumSimulation() {
    if (thermalSimRuntime.activeMode === 'quench') {
        thermalSimRuntime.paused = true;
        thermalSimRuntime.isPlaying = false;
        if (thermalSimRuntime.metrics) thermalSimRuntime.metrics.animationPlaying = false;
    }
    return thermalSimRuntime.metrics;
}

export function resetQuenchMediumSimulation() {
    if (thermalSimRuntime.activeMode === 'quench') {
        thermalSimRuntime.progress = 0;
        thermalSimRuntime.isPlaying = false;
        thermalSimRuntime.paused = false;
        const metrics = renderQuenchMediumSimulation({ mediumType: thermalSimRuntime.selectedQuenchMediumType || 'oil', progress: 0 });
        return metrics;
    }
    return thermalSimRuntime.metrics;
}

export function setQuenchMediumType(mediumType = 'oil') {
    thermalSimRuntime.selectedQuenchMediumType = getQuenchMediumMeta(mediumType).key;
    return renderQuenchMediumSimulation({ mediumType: thermalSimRuntime.selectedQuenchMediumType, progress: thermalSimRuntime.progress || 0.08 });
}

export function setQuenchFurnaceVisibilityMode(mode = 'auto') {
    thermalSimRuntime.selectedQuenchFurnaceVisibilityMode = normalizeQuenchFurnaceVisibilityMode(mode);
    updateQuenchFurnaceVisibility(thermalSimRuntime.progress || 0);
    const furnace = getCurrentThermalFurnace();
    if (furnace && thermalSimRuntime.activeMode === 'quench') {
        const mediumMeta = getQuenchMediumMeta(thermalSimRuntime.selectedQuenchMediumType || 'oil');
        thermalSimRuntime.metrics = calculateQuenchMediumMetrics(furnace, thermalSimRuntime.progress || 0, mediumMeta);
    }
    return thermalSimRuntime.metrics;
}

export function getQuenchMediumRuntime() {
    const mediumMeta = getQuenchMediumMeta(thermalSimRuntime.selectedQuenchMediumType || 'oil');
    return {
        visible: thermalSimRuntime.visible && thermalSimRuntime.activeMode === 'quench',
        metrics: thermalSimRuntime.activeMode === 'quench' ? thermalSimRuntime.metrics : null,
        mediumType: mediumMeta.key,
        mediumMeta,
        furnaceVisibilityMode: normalizeQuenchFurnaceVisibilityMode(thermalSimRuntime.selectedQuenchFurnaceVisibilityMode || 'auto'),
        furnaceVisibilityState: getQuenchFurnaceVisibilityState(thermalSimRuntime.progress || 0),
        isPlaying: thermalSimRuntime.activeMode === 'quench' && thermalSimRuntime.isPlaying,
        paused: thermalSimRuntime.activeMode === 'quench' && thermalSimRuntime.paused,
        progress: thermalSimRuntime.activeMode === 'quench' ? thermalSimRuntime.progress : 0,
        durationMs: thermalSimRuntime.quenchDurationMs || 8500
    };
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