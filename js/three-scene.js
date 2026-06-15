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
    rayGroup: null,
    riskGroup: null,
    sourceGroup: null,
    metrics: null,
    radiationScores: null,
    selectedRadiationItemId: null,
    selectedRadiationEntry: null,
    selectedRadiationBatch: null,
    selectedRadiationSection: null,
    onUpdate: null,
    onFinish: null
};

let radiationSectionDragState = null;

let thermalSceneThemeActive = false;
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

function setThermalGridTheme(active) {
    if (!mainSceneGridHelper || !mainSceneGridHelper.material) return;

    const materials = Array.isArray(mainSceneGridHelper.material)
        ? mainSceneGridHelper.material
        : [mainSceneGridHelper.material];

    if (active && !thermalSavedGridState) {
        thermalSavedGridState = materials.map(mat => ({
            transparent: !!mat.transparent,
            opacity: typeof mat.opacity === 'number' ? mat.opacity : 1,
            color: mat.color ? mat.color.getHex() : null,
            visible: mainSceneGridHelper.visible
        }));

        mainSceneGridHelper.visible = true;
        materials.forEach(mat => {
            mat.transparent = true;
            mat.opacity = 0.10;
            if (mat.color) mat.color.setHex(0x334155);
            mat.needsUpdate = true;
        });
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

function setThermalSceneTheme(active) {
    if (!scene) return;
    if (active && !thermalSceneThemeActive) {
        thermalSavedSceneBackground = scene.background ? scene.background.clone() : null;
        scene.background = new THREE.Color(0x030712);
        setThermalGridTheme(true);
        thermalSceneThemeActive = true;
    } else if (!active && thermalSceneThemeActive) {
        scene.background = thermalSavedSceneBackground || new THREE.Color(0xf5f5f5);
        thermalSavedSceneBackground = null;
        setThermalGridTheme(false);
        thermalSceneThemeActive = false;
    }
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
                child.material.forEach(mat => mat && mat.dispose && mat.dispose());
            } else if (child.material.dispose) {
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
    thermalSimRuntime.rayGroup = null;
    thermalSimRuntime.riskGroup = null;
    thermalSimRuntime.sourceGroup = null;
}


export function clearThermalSimulationLayer() {
    clearThermalGroupChildren();
    clearRadiationClipPlanes();
    restoreThermalItemMaterials();
    setThermalSceneTheme(false);

    thermalSimRuntime.visible = false;
    thermalSimRuntime.activeMode = null;
    thermalSimRuntime.isPlaying = false;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.progress = 0;
    thermalSimRuntime.metrics = null;
    thermalSimRuntime.radiationScores = null;
    thermalSimRuntime.selectedRadiationItemId = null;
    thermalSimRuntime.selectedRadiationEntry = null;
    thermalSimRuntime.selectedRadiationBatch = null;
    thermalSimRuntime.selectedRadiationSection = null;
    thermalSimRuntime.onUpdate = null;
    thermalSimRuntime.onFinish = null;
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

function calculateThermalMetrics(furnace, progress) {
    const items = furnace.packedItems || [];
    const risks = items.map(item => estimateItemThermalRisk(item, furnace));
    const avgRisk = risks.length ? risks.reduce((s, v) => s + v, 0) / risks.length : 0;
    const maxRisk = risks.length ? Math.max(...risks) : 0;
    const coldSpotCount = risks.filter(v => v > 0.45).length;
    const packedVolume = items.reduce((sum, item) => sum + (item.w || 0) * (item.h || 0) * (item.d || 0), 0);
    const furnaceVolume = Math.max(1, (furnace.w || 1) * (furnace.h || 1) * (furnace.d || 1));
    const density = packedVolume / furnaceVolume;
    const uniformityScore = Math.max(48, Math.round(94 - avgRisk * 42 - maxRisk * 18 - density * 28));
    const currentTemp = Math.round(VACUUM_QUENCH_PROFILE.startTemp + clamp01(progress) * (VACUUM_QUENCH_PROFILE.targetTemp - VACUUM_QUENCH_PROFILE.startTemp));
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
        progress: Math.round(clamp01(progress) * 100)
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
            mat.opacity = 0.72 + itemRatio * 0.24;
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

export function renderVacuumQuenchThermalSimulation(progress = 0.12) {
    const furnace = getCurrentThermalFurnace();
    if (!furnace) return null;

    clearThermalGroupChildren();
    restoreThermalItemMaterials();
    const safeProgress = clamp01(progress);
    setThermalSceneTheme(true);

    const group = ensureThermalSimulationGroup();
    const cloud = buildThermalPointCloud(furnace, safeProgress);
    const rays = buildRadiationRays(furnace);
    const riskMarkers = buildRiskMarkers(furnace);
    const ringBoundary = buildRingThermalBoundary(furnace);

    group.add(cloud);
    group.add(rays);
    group.add(riskMarkers);
    if (ringBoundary) group.add(ringBoundary);
    group.visible = true;

    thermalSimRuntime.visible = true;
    thermalSimRuntime.activeMode = 'thermal';
    thermalSimRuntime.progress = safeProgress;
    thermalSimRuntime.pointCloud = cloud;
    thermalSimRuntime.rayGroup = rays;
    thermalSimRuntime.riskGroup = riskMarkers;
    thermalSimRuntime.metrics = calculateThermalMetrics(furnace, safeProgress);
    applyThermalTintToItems(furnace, safeProgress);
    return thermalSimRuntime.metrics;
}

export function playVacuumQuenchThermalSimulation(options = {}) {
    const furnace = getCurrentThermalFurnace();
    if (!furnace) return null;
    const startProgress = clamp01(options.startProgress != null ? options.startProgress : 0.03);
    const initialMetrics = renderVacuumQuenchThermalSimulation(startProgress);
    thermalSimRuntime.isPlaying = true;
    thermalSimRuntime.paused = false;
    thermalSimRuntime.durationMs = options.durationMs || thermalSimRuntime.durationMs || 9000;
    thermalSimRuntime.startedAt = performance.now() - startProgress * thermalSimRuntime.durationMs;
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
    if (!thermalSimRuntime.visible || !thermalSimRuntime.pointCloud || thermalSimRuntime.activeMode !== 'thermal') {
        return renderVacuumQuenchThermalSimulation(p);
    }
    thermalSimRuntime.progress = p;
    updateThermalPointCloud(p);
    applyThermalTintToItems(furnace, p);
    thermalSimRuntime.metrics = calculateThermalMetrics(furnace, p);
    if (thermalSimRuntime.onUpdate) thermalSimRuntime.onUpdate(thermalSimRuntime.metrics);
    return thermalSimRuntime.metrics;
}

export function getVacuumQuenchThermalRuntime() {
    return {
        visible: thermalSimRuntime.visible,
        activeMode: thermalSimRuntime.activeMode,
        isPlaying: thermalSimRuntime.isPlaying,
        paused: thermalSimRuntime.paused,
        progress: thermalSimRuntime.progress,
        durationMs: thermalSimRuntime.durationMs,
        metrics: thermalSimRuntime.metrics
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
        updateThermalPointCloud(progress);
        const furnace = getCurrentThermalFurnace();
        if (furnace) {
            thermalSimRuntime.metrics = calculateThermalMetrics(furnace, progress);
            applyThermalTintToItems(furnace, progress);
        }
        if (thermalSimRuntime.onUpdate && thermalSimRuntime.metrics) thermalSimRuntime.onUpdate(thermalSimRuntime.metrics);
        if (progress >= 1) {
            thermalSimRuntime.isPlaying = false;
            thermalSimRuntime.paused = false;
            if (thermalSimRuntime.onFinish && thermalSimRuntime.metrics) thermalSimRuntime.onFinish(thermalSimRuntime.metrics);
        }
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
        } else {
            // 回退：如果 LayerGroup 不存在（不应发生），直接加 furnaceGroup
            furnaceGroup.add(mesh);
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
        } else {
            renderVacuumQuenchThermalSimulation(thermalSimRuntime.progress || 0.12);
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