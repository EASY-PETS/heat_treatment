/**
 * three-scene.js - All Three.js Related Code (V2.7)
 *
 * V2.7 Updates:
 *   - Task 1: 多炉膛原点居中 — 所有炉膛 Group 在原点 (0,0,0) 创建，visible 切换
 *   - Task 2: 爆炸图模式 — 按 layer 在 Y 轴展开 + 分层施工清单 BOM
 *   - Task 3: 性能优化 — 关闭工件透明度、动画阴影降级
 *
 * V2.3 Updates:
 *   - Task: 托盘式搁板料框（Tray Basket）3D模型
 *   - Task: 每个炉膛独立 basketType 参数
 *   - Task: 标尺系统修复 — 原点(0,0,0)为基础，向正方向延伸
 *   - Task: 炉膛沿X轴排列（V2.7 已移除）
 * V2.2:
 *   - Task: 蜂窝料框（Honeycomb Basket）3D模型 — texture-based hexagonal pattern
 *   - Task: 装料动画优化 — 工件从上方缓慢落入目标位置
 *   - Task: 标尺系统恢复 — X/Y/Z axes with dark lines for white background
 *   - Task: 3D显示设置 — grid, axes, ruler toggle controls
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
    setScene, setCamera, setRenderer, setControls,
    setMasterScene, setMasterCamera, setMasterRenderer, setMasterControls,
    setItemsGroup, setShelfMeshes,
    setIsAnimating, setAnimPaused, setAnimStopped,
    setCurrentFurnaceIndex, setSelectedFurnaceCardId,
    setExplodedView, setExplodeMode, setFocusedLayer,
    setMainDirectionalLight,
    clearFurnaceGroups, setFurnaceGroup
} from './state.js';

const COLOR_PALETTE = [
    '#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6',
    '#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a',
    '#ff5722','#607d8b','#673ab7','#009688','#ff9800',
    '#795548','#f44336','#2196f3','#4caf50','#ffeb3b',
    '#ff6b6b','#4ecdc4','#45b7d1','#96ceb4','#ffeaa7',
    '#dda0dd','#98d8c8','#f7dc6f','#bb8fce','#85c1e9'
];

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

// ==================== HELPER: CREATE BAR (CYLINDER ROD) ====================

/**
 * 创建圆柱形钢筋线段 — 用于料框网格建模和搁板建模的通用工具
 * @param {THREE.Vector3} start - 起点
 * @param {THREE.Vector3} end - 终点
 * @param {number} radius - 半径
 * @param {THREE.Material} material - 材质
 * @returns {THREE.Mesh} 圆柱钢筋mesh
 */
function createBar(start, end, radius, material) {
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(radius, radius, len, 8, 1);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(start).add(dir.clone().multiplyScalar(0.5));
    const axis = new THREE.Vector3(0, 1, 0).cross(dir.normalize());
    const angle = Math.acos(new THREE.Vector3(0, 1, 0).dot(dir.normalize()));
    if (axis.length() > 0.001) {
        mesh.quaternion.setFromAxisAngle(axis.normalize(), angle);
    }
    mesh.castShadow = true;
    return mesh;
}

// ==================== HONEYCOMB TEXTURE GENERATION (V2.2) ====================

/**
 * 生成六边形蜂窝纹理Canvas — 用于料框侧面的Alpha Map / Texture
 */
function createHoneycombTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(200, 200, 210, 0.15)';
    ctx.fillRect(0, 0, size, size);

    const hexRadius = 30;
    const hexHeight = hexRadius * Math.sqrt(3);
    const hexWidth = hexRadius * 2;

    ctx.strokeStyle = 'rgba(68, 85, 102, 0.85)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function drawHex(cx, cy, r) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 6 + i * Math.PI / 3;
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
    }

    const cols = Math.ceil(size / (hexWidth * 0.75)) + 1;
    const rows = Math.ceil(size / hexHeight) + 1;
    for (let row = -1; row <= rows; row++) {
        for (let col = -1; col <= cols; col++) {
            const cx = col * hexWidth * 0.75;
            const cy = row * hexHeight + (col % 2) * hexHeight / 2;
            drawHex(cx, cy, hexRadius);
        }
    }

    return canvas;
}

/** 缓存蜂窝纹理，避免重复生成 */
let cachedHoneycombTexture = null;
function getHoneycombTexture() {
    if (!cachedHoneycombTexture) {
        const canvas = createHoneycombTexture();
        cachedHoneycombTexture = new THREE.CanvasTexture(canvas);
        cachedHoneycombTexture.wrapS = THREE.RepeatWrapping;
        cachedHoneycombTexture.wrapT = THREE.RepeatWrapping;
        cachedHoneycombTexture.repeat.set(1, 1);
        cachedHoneycombTexture.magFilter = THREE.LinearFilter;
        cachedHoneycombTexture.minFilter = THREE.LinearMipmapLinearFilter;
        cachedHoneycombTexture.generateMipmaps = true;
    }
    return cachedHoneycombTexture;
}

// ==================== BASKET FRAME MODELING ====================

function createGridBasketFrame(w, h, d, gridSize) {
    gridSize = gridSize || 100;
    const group = new THREE.Group();

    const frameRadius = 4;
    const gridRadius = 2;

    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x445566,
        roughness: 0.5,
        metalness: 0.85,
        transparent: true,
        opacity: 0.7,
        depthWrite: false
    });

    const gridMaterial = new THREE.MeshStandardMaterial({
        color: 0x334455,
        roughness: 0.55,
        metalness: 0.8,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
    });

    function createGridFace(plane, width, height_, depth) {
        const faceGroup = new THREE.Group();
        let originX, originY, originZ;
        let dirU, dirV, lenU, lenV;

        switch (plane) {
            case 'bottom':
                originX = 0; originY = 0; originZ = 0;
                dirU = new THREE.Vector3(1, 0, 0); lenU = width;
                dirV = new THREE.Vector3(0, 0, 1); lenV = depth;
                break;
            case 'front':
                originX = 0; originY = 0; originZ = depth;
                dirU = new THREE.Vector3(1, 0, 0); lenU = width;
                dirV = new THREE.Vector3(0, 1, 0); lenV = height_;
                break;
            case 'back':
                originX = 0; originY = 0; originZ = 0;
                dirU = new THREE.Vector3(1, 0, 0); lenU = width;
                dirV = new THREE.Vector3(0, 1, 0); lenV = height_;
                break;
            case 'left':
                originX = 0; originY = 0; originZ = 0;
                dirU = new THREE.Vector3(0, 0, 1); lenU = depth;
                dirV = new THREE.Vector3(0, 1, 0); lenV = height_;
                break;
            case 'right':
                originX = width; originY = 0; originZ = 0;
                dirU = new THREE.Vector3(0, 0, 1); lenU = depth;
                dirV = new THREE.Vector3(0, 1, 0); lenV = height_;
                break;
            default: return faceGroup;
        }

        const origin = new THREE.Vector3(originX, originY, originZ);

        const corners = [
            origin.clone(),
            origin.clone().add(dirU.clone().multiplyScalar(lenU)),
            origin.clone().add(dirU.clone().multiplyScalar(lenU)).add(dirV.clone().multiplyScalar(lenV)),
            origin.clone().add(dirV.clone().multiplyScalar(lenV))
        ];
        for (let i = 0; i < 4; i++) {
            faceGroup.add(createBar(corners[i], corners[(i + 1) % 4], frameRadius, frameMaterial));
        }

        let uSteps = Math.floor(lenU / gridSize);
        if (uSteps < 1) uSteps = 1;
        for (let ui = 1; ui < uSteps; ui++) {
            const u = ui * gridSize;
            if (u >= lenU) break;
            const p1 = origin.clone().add(dirU.clone().multiplyScalar(u));
            const p2 = p1.clone().add(dirV.clone().multiplyScalar(lenV));
            faceGroup.add(createBar(p1, p2, gridRadius, gridMaterial));
        }
        let vSteps = Math.floor(lenV / gridSize);
        if (vSteps < 1) vSteps = 1;
        for (let vi = 1; vi < vSteps; vi++) {
            const v = vi * gridSize;
            if (v >= lenV) break;
            const p1 = origin.clone().add(dirV.clone().multiplyScalar(v));
            const p2 = p1.clone().add(dirU.clone().multiplyScalar(lenU));
            faceGroup.add(createBar(p1, p2, gridRadius, gridMaterial));
        }

        return faceGroup;
    }

    group.add(createGridFace('bottom', w, h, d));
    group.add(createGridFace('front', w, h, d));
    group.add(createGridFace('back', w, h, d));
    group.add(createGridFace('left', w, h, d));
    group.add(createGridFace('right', w, h, d));

    const topCorners = [
        new THREE.Vector3(0, h, 0), new THREE.Vector3(w, h, 0),
        new THREE.Vector3(w, h, d), new THREE.Vector3(0, h, d)
    ];
    for (let i = 0; i < 4; i++) {
        group.add(createBar(topCorners[i], topCorners[(i + 1) % 4], frameRadius, frameMaterial));
    }

    const verticalCorners = [
        [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, h, 0)],
        [new THREE.Vector3(w, 0, 0), new THREE.Vector3(w, h, 0)],
        [new THREE.Vector3(w, 0, d), new THREE.Vector3(w, h, d)],
        [new THREE.Vector3(0, 0, d), new THREE.Vector3(0, h, d)]
    ];
    verticalCorners.forEach(([s, e]) => {
        group.add(createBar(s, e, frameRadius, frameMaterial));
    });

    group.userData = { isBasketFrame: true, basketType: 'grid' };
    return group;
}

function createHoneycombBasketFrame(w, h, d) {
    const group = new THREE.Group();
    const frameRadius = 4.5;

    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x445566,
        roughness: 0.5,
        metalness: 0.85,
        transparent: true,
        opacity: 0.75,
        depthWrite: false
    });

    const honeycombTex = getHoneycombTexture();
    const panelMaterial = new THREE.MeshStandardMaterial({
        color: 0x556677,
        roughness: 0.55,
        metalness: 0.7,
        transparent: true,
        opacity: 0.6,
        alphaMap: honeycombTex,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    function createHoneycombPanel(panelW, panelH, originX, originY, originZ, orientation) {
        const panelGeo = new THREE.PlaneGeometry(panelW, panelH);
        const texMaterial = panelMaterial.clone();
        texMaterial.alphaMap = getHoneycombTexture();
        const panel = new THREE.Mesh(panelGeo, texMaterial);
        panel.position.set(originX, originY, originZ);

        switch (orientation) {
            case 'xy': break;
            case 'yz': panel.rotation.y = Math.PI / 2; break;
            case 'xz': panel.rotation.x = -Math.PI / 2; break;
        }
        return panel;
    }

    group.add(createHoneycombPanel(w, d, w / 2, 1, d / 2, 'xz'));
    group.add(createHoneycombPanel(w, h, w / 2, h / 2, d, 'xy'));
    group.add(createHoneycombPanel(w, h, w / 2, h / 2, 0, 'xy'));
    group.add(createHoneycombPanel(d, h, 0, h / 2, d / 2, 'yz'));
    group.add(createHoneycombPanel(d, h, w, h / 2, d / 2, 'yz'));

    function createEdgeBar(x1, y1, z1, x2, y2, z2) {
        return createBar(
            new THREE.Vector3(x1, y1, z1),
            new THREE.Vector3(x2, y2, z2),
            frameRadius, frameMaterial
        );
    }

    group.add(createEdgeBar(0, 0, 0, w, 0, 0));
    group.add(createEdgeBar(w, 0, 0, w, 0, d));
    group.add(createEdgeBar(w, 0, d, 0, 0, d));
    group.add(createEdgeBar(0, 0, d, 0, 0, 0));

    group.add(createEdgeBar(0, h, 0, w, h, 0));
    group.add(createEdgeBar(w, h, 0, w, h, d));
    group.add(createEdgeBar(w, h, d, 0, h, d));
    group.add(createEdgeBar(0, h, d, 0, h, 0));

    group.add(createEdgeBar(0, 0, 0, 0, h, 0));
    group.add(createEdgeBar(w, 0, 0, w, h, 0));
    group.add(createEdgeBar(w, 0, d, w, h, d));
    group.add(createEdgeBar(0, 0, d, 0, h, d));

    group.userData = { isBasketFrame: true, basketType: 'honeycomb' };
    return group;
}

function createTrayBasketFrame(w, h, d) {
    const group = new THREE.Group();

    const supportHeight = 50;
    const supportCount = 10;
    const supportSpacing = d / supportCount;
    const frameRadius = 4;

    const trayMaterial = new THREE.MeshStandardMaterial({
        color: 0x667788,
        roughness: 0.45,
        metalness: 0.8,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    const supportMaterial = new THREE.MeshStandardMaterial({
        color: 0x445566,
        roughness: 0.5,
        metalness: 0.85,
        transparent: true,
        opacity: 0.75,
        depthWrite: false
    });

    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x556677,
        roughness: 0.5,
        metalness: 0.85,
        transparent: true,
        opacity: 0.8,
        depthWrite: false
    });

    const bottomPanelGeo = new THREE.PlaneGeometry(w, d);
    const bottomPanel = new THREE.Mesh(bottomPanelGeo, trayMaterial.clone());
    bottomPanel.rotation.x = -Math.PI / 2;
    bottomPanel.position.set(w / 2, supportHeight, d / 2);
    group.add(bottomPanel);

    for (let i = 0; i < supportCount; i++) {
        const zCenter = supportSpacing * (i + 0.5);
        const startH = new THREE.Vector3(0, supportHeight * 0.3, zCenter);
        const endH = new THREE.Vector3(w, supportHeight * 0.3, zCenter);
        group.add(createBar(startH, endH, frameRadius, supportMaterial));
    }

    function createEdgeBar(x1, y1, z1, x2, y2, z2) {
        return createBar(
            new THREE.Vector3(x1, y1, z1),
            new THREE.Vector3(x2, y2, z2),
            frameRadius, frameMaterial
        );
    }

    const baseY = 0;
    group.add(createEdgeBar(0, baseY, 0, w, baseY, 0));
    group.add(createEdgeBar(w, baseY, 0, w, baseY, d));
    group.add(createEdgeBar(w, baseY, d, 0, baseY, d));
    group.add(createEdgeBar(0, baseY, d, 0, baseY, 0));

    group.userData = { isBasketFrame: true, basketType: 'tray' };
    return group;
}

function createSolidBasketFrame(w, h, d) {
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(w, h, d);
    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(edges,
        new THREE.LineBasicMaterial({ color: 0x0066cc, linewidth: 1.5, transparent: true, opacity: 0.6 }));
    line.position.set(w / 2, h / 2, d / 2);
    group.add(line);

    const panelGeo = new THREE.BoxGeometry(w, h, d);
    const panelMat = new THREE.MeshStandardMaterial({
        color: 0x8899aa,
        roughness: 0.4,
        metalness: 0.3,
        transparent: true,
        opacity: 0.25,
        depthWrite: false
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(w / 2, h / 2, d / 2);
    group.add(panel);

    group.userData = { isBasketFrame: true, basketType: 'solid' };
    return group;
}

/**
 * 统一料框创建入口 — 根据 basketType 参数选择对应类型
 */
function createBasketFrame(w, h, d, gridSize, basketType) {
    const type = basketType || 'grid';
    switch (type) {
        case 'honeycomb':
            return createHoneycombBasketFrame(w, h, d);
        case 'tray':
            return createTrayBasketFrame(w, h, d);
        case 'solid':
            return createSolidBasketFrame(w, h, d);
        case 'grid':
        default:
            return createGridBasketFrame(w, h, d, gridSize || 100);
    }
}

// ==================== SHELF MESH (V2.6 重构) ====================

/**
 * 创建搁板实体 3D 模型 — BoxGeometry 实体厚度
 */
function createShelfMesh(w, d, thickness) {
    const geo = new THREE.BoxGeometry(w, thickness, d);

    const mat = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        roughness: 0.5,
        metalness: 0.8,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: true
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const edgesGeo = new THREE.EdgesGeometry(geo);
    const edgesLine = new THREE.LineSegments(
        edgesGeo,
        new THREE.LineBasicMaterial({ color: 0x888888, linewidth: 1, transparent: true, opacity: 0.5 })
    );
    mesh.add(edgesLine);

    mesh.userData = { isShelfMesh: true };
    return mesh;
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
    if (baseY === undefined) baseY = -120;
    const shelfThickness = placementRules.shelfThickness || 20;

    const shelfYs = new Set();
    if (furnace.shelvesUsed && furnace.shelvesUsed.length > 0) {
        furnace.shelvesUsed.forEach(s => shelfYs.add(s.y));
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

        const shelfMesh = createShelfMesh(fw, fd, shelfThickness);

        // 🔧 搁板 XZ 必须对齐料框几何中心（furnaceGroup 原点）
        // 搁板在 LayerGroup 内部，其 position 保持为全局坐标值
        const shelfYSpace = baseY + shelfY + shelfThickness / 2;
        shelfMesh.position.set(0, shelfYSpace, 0);

        // 计算搁板所属 layer — 用于爆炸图展开
        let shelfLayer = 1;
        for (let li = 0; li < sortedShelves.length; li++) {
            if (Math.abs(sortedShelves[li].y - shelfY) < 0.5) {
                shelfLayer = li + 2; // 底层=layer1, 第一块搁板上方=layer2, ...
                break;
            }
        }

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

    /* 地面网格 */
    const gridHelper = new THREE.GridHelper(4000, 80, 0x333333, 0x555555);
    gridHelper.position.y = -120;
    newScene.add(gridHelper);

    /* 坐标轴 */
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

    /* 标尺刻度组 */
    const rulerGroup = createRulerGroup(4000);
    newScene.add(rulerGroup);

    setMainSceneDisplayRefs(gridHelper, customAxesGroup, rulerGroup);

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
        newRenderer.render(newScene, newCamera);
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

    const grid = new THREE.GridHelper(4000, 80, 0x333333, 0x555555);
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
    if (typeof item.layer === 'number' && item.layer >= 1) return item.layer;
    // 从 item.y 推算：y=0 附近是 layer 1
    if (furnace.shelvesUsed && furnace.shelvesUsed.length > 0) {
        const sortedShelves = [...furnace.shelvesUsed].sort((a, b) => a.y - b.y);
        for (let i = sortedShelves.length - 1; i >= 0; i--) {
            if (item.y >= sortedShelves[i].y) return i + 2;
        }
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
        const targetX = layerGroup.userData._originalX + (layerIndex - 1) * EXPLODE_GAP;
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
function buildFurnaceGroup(furnace, index, filterMaterialName) {
    const furnaceGroup = new THREE.Group();
    const baseY = -120;
    const fw = furnace.w;
    const fh = furnace.h;
    const fd = furnace.d;

    // 料框框架 — 在原点，底部对齐 baseY
    const basketType = furnace.basketType || 'grid';
    const basketGroup = createBasketFrame(fw, fh, fd, 100, basketType);
    // 料框局部坐标：原点 (0,0,0) 在 furnaceGroup 的 baseY 处
    basketGroup.position.set(-fw / 2, baseY, -fd / 2);
    furnaceGroup.add(basketGroup);

    // 蓝色外轮廓边框
    const containerGeo = new THREE.BoxGeometry(fw, fh, fd);
    const containerEdges = new THREE.EdgesGeometry(containerGeo);
    const containerLine = new THREE.LineSegments(containerEdges,
        new THREE.LineBasicMaterial({ color: 0x0066cc, linewidth: 1, transparent: true, opacity: 0.5 }));
    containerLine.position.set(0, fh / 2 + baseY, 0);
    furnaceGroup.add(containerLine);

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
        let geometry;
        if (item.shape === 'cylinder') {
            geometry = new THREE.CylinderGeometry(item.w / 2, item.w / 2, item.h, 32);
        } else {
            geometry = new THREE.BoxGeometry(item.w, item.h, item.d);
        }

        const originalColor = new THREE.Color(item.color);
        // V2.7 TASK 3: 工件材质 — 强制关闭透明度，除非被筛选
        const material = new THREE.MeshStandardMaterial({
            color: originalColor,
            transparent: isFiltered,
            opacity: isFiltered ? 0.12 : 1.0,
            roughness: 0.3,
            metalness: 0.2,
            depthWrite: !isFiltered
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const itemLayer = itemLayerMap.get(item.id) || 1;
        const meshOriginalY = item.y + item.h / 2 + baseY;

        mesh.userData = {
            itemName: item.name,
            itemId: item.id,
            furnaceIndex: index,
            originalColor: item.color,
            itemMaterial: item.material || '',
            itemProcess: item.process || '',
            itemWeight: item.weight || 0,
            itemDimensions: item.originalDims || { l: item.w, w: item.d, h: item.h },
            layer: itemLayer,
            _originalY: meshOriginalY
        };
        const edgeMat = new THREE.LineBasicMaterial({ color: isFiltered ? 0xcccccc : 0x444444 });
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMat));

        // 工件位置：基于炉膛局部坐标系（料框原点对齐 baseY）
        mesh.position.set(
            item.x - fw / 2 + item.w / 2,
            meshOriginalY,
            item.z - fd / 2 + item.d / 2
        );

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
    if ((placementRules.useShelfLayered || placementRules.centerOfGravity) && furnace.packedItems.length > 0) {
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
        '<div class="ssp-header">📊 ' + furnaceName + '</div>' +
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
    const furnaceCount = globalFurnacesResult.length;
    const orderedIndices = [];
    for (let i = 0; i < furnaceCount; i++) {
        orderedIndices.push((startFurnaceIndex + i) % furnaceCount);
    }

    // 为动画创建初始炉膛 Group（在原点）
    const initialFurnace = globalFurnacesResult[orderedIndices[0]];
    const initialBasketType = initialFurnace.basketType || 'grid';
    const basketGroup = createBasketFrame(initialFurnace.w, initialFurnace.h, initialFurnace.d, 100, initialBasketType);
    basketGroup.position.set(-initialFurnace.w / 2, baseY, -initialFurnace.d / 2);
    itemsGroup.add(basketGroup);

    const initialContainerGeo = new THREE.BoxGeometry(initialFurnace.w, initialFurnace.h, initialFurnace.d);
    const initialContainerLine = new THREE.LineSegments(
        new THREE.EdgesGeometry(initialContainerGeo),
        new THREE.LineBasicMaterial({ color: 0x0066cc, linewidth: 1, transparent: true, opacity: 0.5 })
    );
    initialContainerLine.position.set(0, initialFurnace.h / 2 + baseY, 0);
    itemsGroup.add(initialContainerLine);

    orderedIndices.forEach(fIdx => {
        const furnace = globalFurnacesResult[fIdx];
        furnace.packedItems.forEach((item) => {
            if (filterMaterialName && item.material !== filterMaterialName) return;
            let geometry;
            if (item.shape === 'cylinder') geometry = new THREE.CylinderGeometry(item.w / 2, item.w / 2, item.h, 32);
            else geometry = new THREE.BoxGeometry(item.w, item.h, item.d);

            // V2.7 TASK 3: 工件材质 — 强制 transparent: false
            const material = new THREE.MeshStandardMaterial({
                color: new THREE.Color(item.color),
                transparent: false,
                roughness: 0.3, metalness: 0.2,
                depthWrite: true
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = false;  // TASK 3: 动画期间关闭工件阴影
            mesh.receiveShadow = false;
            mesh.userData = {
                itemName: item.name,
                itemId: item.id,
                shape: item.shape,
                originalColor: item.color,
                itemMaterial: item.material || '',
                itemProcess: item.process || '',
                _originalY: null,
                _animMesh: true  // 标记为动画工件
            };
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry),
                new THREE.LineBasicMaterial({ color: 0x444444 })));

            // 目标位置（基于原点，无 xOffset）
            const targetX = item.x - furnace.w / 2 + item.w / 2;
            const targetY = item.y + item.h / 2 + baseY;
            const targetZ = item.z - furnace.d / 2 + item.d / 2;

            const startY = furnace.h + baseY + 300;

            mesh.position.set(targetX, startY, targetZ);
            itemDrawSteps.push({
                mesh, furnaceIndex: fIdx,
                furnaceName: furnace.instanceId,
                itemName: item.name,
                x: Math.round(item.x), y: Math.round(item.y), z: Math.round(item.z),
                targetX, targetY, targetZ,
                startY
            });
        });
    });

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

    const entryDelayMs = 100;
    const dropDurationMs = 500;

    if (itemDrawSteps.length > 0) {
        const firstStep = itemDrawSteps[0];
        if (firstStep.furnaceIndex !== currentFurnaceIndex) {
            setCurrentFurnaceIndex(firstStep.furnaceIndex);
            rebuildSceneUpTo(-1, itemDrawSteps, filterMaterialName);
        }
        itemsGroup.add(firstStep.mesh);

        document.getElementById('anim-progress-text').textContent =
            '(1/' + itemDrawSteps.length + ') · 将【' + firstStep.itemName + '】吊装至 ' + firstStep.furnaceName + ' · 坐标(' + firstStep.x + ',' + firstStep.y + ',' + firstStep.z + ')';
    }

    for (let i = 0; i < itemDrawSteps.length; i++) {
        if (animStopped) break;
        await waitIfPaused();
        if (animStopped) break;

        const step = itemDrawSteps[i];

        if (step.furnaceIndex !== currentFurnaceIndex && i > 0) {
            setCurrentFurnaceIndex(step.furnaceIndex);
            rebuildSceneUpTo(i - 1, itemDrawSteps, filterMaterialName);
            itemsGroup.add(step.mesh);
            update3DStatsPanel(globalFurnacesResult[step.furnaceIndex]);
        } else if (i > 0) {
            itemsGroup.add(step.mesh);
        }

        const entryDelay = i * entryDelayMs;
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

        const speedMs = parseInt(document.getElementById('anim-speed-select').value) || 400;
        await sleep(Math.max(50, speedMs - dropDurationMs));
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
        if (item.shape === 'cylinder') geo = new THREE.CylinderGeometry(item.w / 2, item.w / 2, item.h, 32);
        else geo = new THREE.BoxGeometry(item.w, item.h, item.d);
        // V2.7 TASK 3: 主视图工件也关闭透明度
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(item.color),
            transparent: false,
            roughness: 0.3, metalness: 0.2,
            depthWrite: true
        });
        const mesh = new THREE.Mesh(geo, mat);
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
