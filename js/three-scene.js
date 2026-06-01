/**
 * three-scene.js - All Three.js Related Code (V2.0)
 *
 * V2.0 Updates:
 *   - Task 1: 真实料框（篮筐）网格结构三维模型
 *   - Task 4: 搁板实体厚度渲染（使用网格结构）
 *   - Task 5: 增强工件选中高亮效果（白色边缘+外发光+未选中变透明）
 *   - Fix: 背景色改为白色以配合料框蓝框可见
 *   - Fix: 选中高亮存储原始颜色，reset时恢复，解决反复选中颜色异常Bug
 *   - Fix: 3D场景底部统计悬浮面板
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
    itemsGroup,
    globalFurnacesResult, shelfMeshes, globalUnpackedItems,
    isAnimating, animPaused, animStopped,
    currentFurnaceIndex, selectedFurnaceCardId, selectedMaterialCardId,
    originalOpacityStore, opacityResetTimerId,
    placementRules,
    setScene, setCamera, setRenderer, setControls,
    setMasterScene, setMasterCamera, setMasterRenderer, setMasterControls,
    setItemsGroup, setShelfMeshes,
    setIsAnimating, setAnimPaused, setAnimStopped,
    setCurrentFurnaceIndex, setSelectedFurnaceCardId,
    setOriginalOpacityStore, setOpacityResetTimerId
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

// ==================== THREE.JS INITIALIZATION ====================

export function initThree() {
    const container = document.getElementById('canvas-container');
    const newScene = new THREE.Scene();
    /* Fix: 背景色改为浅色，使黑色料框蓝框及工件清晰可见，改善视觉对比度 */
    newScene.background = new THREE.Color(0xf5f5f5);  // 浅灰白色背景
    setScene(newScene);

    const newCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 10000);
    setCamera(newCamera);

    const newRenderer = new THREE.WebGLRenderer({ antialias: true });
    newRenderer.setSize(container.clientWidth, container.clientHeight);
    newRenderer.setPixelRatio(window.devicePixelRatio);
    newRenderer.shadowMap.enabled = true;
    newRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(newRenderer.domElement);
    setRenderer(newRenderer);

    const newControls = new OrbitControls(newCamera, newRenderer.domElement);
    newControls.enableDamping = true;
    newControls.dampingFactor = 0.05;
    setControls(newControls);

    /* 光照强度适当调整以配合浅色背景 */
    newScene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.7);
    mainLight.position.set(400, 800, 500);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    newScene.add(mainLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-400, -200, -300);
    newScene.add(fillLight);

    /* 网格颜色也需调整为白色背景可见 */
    const gridHelper = new THREE.GridHelper(4000, 80, 0xcccccc, 0xdddddd);
    gridHelper.position.y = -120;
    newScene.add(gridHelper);

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

export function initMasterThree() {
    const container = document.getElementById('master-canvas-container');
    const msScene = new THREE.Scene();
    /* Fix: Master view 背景也改为浅色 */
    msScene.background = new THREE.Color(0xf5f5f5);
    setMasterScene(msScene);

    const msCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 10000);
    setMasterCamera(msCamera);

    const msRenderer = new THREE.WebGLRenderer({ antialias: true });
    msRenderer.setSize(container.clientWidth, container.clientHeight);
    msRenderer.setPixelRatio(window.devicePixelRatio);
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

    const grid = new THREE.GridHelper(4000, 80, 0xcccccc, 0xdddddd);
    grid.position.y = -120;
    msScene.add(grid);

    function animateMaster() {
        requestAnimationFrame(animateMaster);
        msControls.update();
        msRenderer.render(msScene, msCamera);
    }
    animateMaster();
}

// ==================== 料框网格建模（Task 1） ====================

/**
 * 创建真实热处理料框（篮筐）三维模型。
 *
 * 结构特点：
 *   - 顶部开口，底部封闭，四周封闭（共5个面）
 *   - 每个面由钢筋网格焊接组成，网格尺寸 100mm×100mm
 *   - 边框为粗钢筋，网格为细钢筋
 *   - 深灰色金属材质，透明度 0.4~0.6
 *   - 白色背景上深色料框更加醒目
 *
 * @param {number} w - 料框宽度 (mm)
 * @param {number} h - 料框高度 (mm)
 * @param {number} d - 料框深度 (mm)
 * @param {number} gridSize - 网格尺寸 (mm)，默认 100mm
 * @returns {THREE.Group} 料框模型组
 */
function createBasketFrame(w, h, d, gridSize) {
    gridSize = gridSize || 100;
    const group = new THREE.Group();

    // 边框钢筋半径 (粗)
    const frameRadius = 4;
    // 网格钢筋半径 (细)
    const gridRadius = 2;

    // 深灰色金属材质 — 边框（粗钢筋），白色背景下降低透明度使料框更明显
    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x445566,
        roughness: 0.5,
        metalness: 0.85,
        transparent: true,
        opacity: 0.7,
        depthWrite: false
    });

    // 深灰色金属材质 — 网格（细钢筋）
    const gridMaterial = new THREE.MeshStandardMaterial({
        color: 0x334455,
        roughness: 0.55,
        metalness: 0.8,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
    });

    /**
     * 创建圆柱形钢筋线段
     * @param {THREE.Vector3} start
     * @param {THREE.Vector3} end
     * @param {number} radius
     * @param {THREE.Material} material
     */
    function createBar(start, end, radius, material) {
        const dir = new THREE.Vector3().subVectors(end, start);
        const len = dir.length();
        const geo = new THREE.CylinderGeometry(radius, radius, len, 8, 1);
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.copy(start).add(dir.clone().multiplyScalar(0.5));
        // 旋转圆柱体使其对齐方向
        const axis = new THREE.Vector3(0, 1, 0).cross(dir.normalize());
        const angle = Math.acos(new THREE.Vector3(0, 1, 0).dot(dir.normalize()));
        if (axis.length() > 0.001) {
            mesh.quaternion.setFromAxisAngle(axis.normalize(), angle);
        }
        mesh.castShadow = true;
        return mesh;
    }

    /**
     * 在指定平面上创建网格面
     * @param {string} plane - 'bottom' | 'front' | 'back' | 'left' | 'right'
     */
    function createGridFace(plane, width, height_, depth) {
        const faceGroup = new THREE.Group();
        let originX, originY, originZ;
        let dirU, dirV, lenU, lenV;

        // 计算每个面的坐标系
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

        // 绘制边框（四条边）- 粗钢筋
        const corners = [
            origin.clone(),
            origin.clone().add(dirU.clone().multiplyScalar(lenU)),
            origin.clone().add(dirU.clone().multiplyScalar(lenU)).add(dirV.clone().multiplyScalar(lenV)),
            origin.clone().add(dirV.clone().multiplyScalar(lenV))
        ];
        for (let i = 0; i < 4; i++) {
            faceGroup.add(createBar(corners[i], corners[(i + 1) % 4], frameRadius, frameMaterial));
        }

        // 绘制内部网格线 - 细钢筋
        // U方向（沿dirU）
        let uSteps = Math.floor(lenU / gridSize);
        if (uSteps < 1) uSteps = 1;
        for (let ui = 1; ui < uSteps; ui++) {
            const u = ui * gridSize;
            if (u >= lenU) break;
            const p1 = origin.clone().add(dirU.clone().multiplyScalar(u));
            const p2 = p1.clone().add(dirV.clone().multiplyScalar(lenV));
            faceGroup.add(createBar(p1, p2, gridRadius, gridMaterial));
        }

        // V方向（沿dirV）
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

    // 创建五个面：底面 + 四个侧面（顶部开放）
    group.add(createGridFace('bottom', w, h, d));   // 底面
    group.add(createGridFace('front', w, h, d));    // 前面
    group.add(createGridFace('back', w, h, d));     // 后面
    group.add(createGridFace('left', w, h, d));     // 左面
    group.add(createGridFace('right', w, h, d));    // 右面

    // 顶部边框（开口）— 仅边框无网格，4条边
    const topCorners = [
        new THREE.Vector3(0, h, 0),
        new THREE.Vector3(w, h, 0),
        new THREE.Vector3(w, h, d),
        new THREE.Vector3(0, h, d)
    ];
    for (let i = 0; i < 4; i++) {
        group.add(createBar(topCorners[i], topCorners[(i + 1) % 4], frameRadius, frameMaterial));
    }

    // 底部四角竖立柱（连接底面和顶面）
    const verticalCorners = [
        [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, h, 0)],
        [new THREE.Vector3(w, 0, 0), new THREE.Vector3(w, h, 0)],
        [new THREE.Vector3(w, 0, d), new THREE.Vector3(w, h, d)],
        [new THREE.Vector3(0, 0, d), new THREE.Vector3(0, h, d)]
    ];
    verticalCorners.forEach(([s, e]) => {
        group.add(createBar(s, e, frameRadius, frameMaterial));
    });

    group.userData = { isBasketFrame: true };
    return group;
}

// ==================== 搁板网格模型（Task 4） ====================

/**
 * 创建搁板实体网格模型。
 * 采用与料框相同的 100mm×100mm 网格结构，统一工业视觉语言。
 *
 * @param {number} w - 宽度 (mm)
 * @param {number} d - 深度 (mm)
 * @param {number} thickness - 搁板厚度 (mm)
 * @param {number} gridSize - 网格尺寸 (mm)
 * @returns {THREE.Group} 搁板模型组
 */
function createShelfGridMesh(w, d, thickness, gridSize) {
    gridSize = gridSize || 100;
    const group = new THREE.Group();

    const frameRadius = 3.5;
    const gridRadius = 1.8;

    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x556677,
        roughness: 0.5,
        metalness: 0.85,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
    });
    const gridMaterial = new THREE.MeshStandardMaterial({
        color: 0x445566,
        roughness: 0.55,
        metalness: 0.8,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
    });

    function createBar(start, end, radius, material) {
        const dir = new THREE.Vector3().subVectors(end, start);
        const len = dir.length();
        const geo = new THREE.CylinderGeometry(radius, radius, len, 8, 1);
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.copy(start).add(dir.clone().multiplyScalar(0.5));
        const axis = new THREE.Vector3(0, 1, 0).cross(dir.normalize());
        const angle = Math.acos(new THREE.Vector3(0, 1, 0).dot(dir.normalize()));
        if (axis.length() > 0.001) mesh.quaternion.setFromAxisAngle(axis.normalize(), angle);
        mesh.castShadow = true;
        return mesh;
    }

    function createGridFace(width_, depth_, originX, originY, originZ) {
        const faceGroup = new THREE.Group();
        const origin = new THREE.Vector3(originX, originY, originZ);
        const dirU = new THREE.Vector3(1, 0, 0);
        const dirV = new THREE.Vector3(0, 0, 1);
        const lenU = width_, lenV = depth_;

        // 边框
        const corners = [origin.clone(),
            origin.clone().add(dirU.clone().multiplyScalar(lenU)),
            origin.clone().add(dirU.clone().multiplyScalar(lenU)).add(dirV.clone().multiplyScalar(lenV)),
            origin.clone().add(dirV.clone().multiplyScalar(lenV))];
        for (let i = 0; i < 4; i++) {
            faceGroup.add(createBar(corners[i], corners[(i + 1) % 4], frameRadius, frameMaterial));
        }

        // U方向网格
        let uSteps = Math.floor(lenU / gridSize);
        if (uSteps < 1) uSteps = 1;
        for (let ui = 1; ui < uSteps; ui++) {
            const u = ui * gridSize;
            if (u >= lenU) break;
            const p1 = origin.clone().add(dirU.clone().multiplyScalar(u));
            const p2 = p1.clone().add(dirV.clone().multiplyScalar(lenV));
            faceGroup.add(createBar(p1, p2, gridRadius, gridMaterial));
        }

        // V方向网格
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

    // 搁板是一个带有厚度的平面网格结构
    // 顶面网格
    group.add(createGridFace(w, d, 0, 0, 0));
    // 底面网格
    group.add(createGridFace(w, d, 0, thickness, 0));

    // 侧面连接
    const mat = frameMaterial;
    // 四条厚度边缘
    const edgeDefs = [
        [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, thickness, 0)],
        [new THREE.Vector3(w, 0, 0), new THREE.Vector3(w, thickness, 0)],
        [new THREE.Vector3(w, 0, d), new THREE.Vector3(w, thickness, d)],
        [new THREE.Vector3(0, 0, d), new THREE.Vector3(0, thickness, d)],
        [new THREE.Vector3(0, 0, 0), new THREE.Vector3(w, 0, 0)],
        [new THREE.Vector3(w, 0, 0), new THREE.Vector3(w, 0, d)],
        [new THREE.Vector3(w, 0, d), new THREE.Vector3(0, 0, d)],
        [new THREE.Vector3(0, 0, d), new THREE.Vector3(0, 0, 0)]
    ];
    edgeDefs.forEach(([s, e]) => {
        if (s.distanceTo(e) > 0.01) group.add(createBar(s, e, frameRadius, mat));
    });

    group.userData = { isShelfMesh: true };
    return group;
}

// ==================== SHELF MESH MANAGEMENT ====================

export function disposeShelfMeshes() {
    shelfMeshes.forEach(mesh => {
        if (mesh.parent) mesh.parent.remove(mesh);
        // 递归清理组内所有子节点
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
 * Render shelves with real thickness (Task 4).
 * Uses grid structure matching the basket frame for unified visual language.
 *
 * @param {Object} furnace - {w, h, d, packedItems, shelvesUsed}
 * @param {number} baseY - Base Y offset
 */
export function renderShelvesForFurnace(furnace, baseY) {
    const shelfThickness = placementRules.shelfThickness || 20;

    // 优先使用算法返回的 shelvesUsed，否则从 packedItems 推断
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

    shelfYs.forEach(shelfY => {
        if (shelfY + shelfThickness > fh) {
            console.warn('[搁板渲染] 搁板高度 ' + shelfY + 'mm 超出炉膛总高度 ' + fh + 'mm，已跳过');
            return;
        }

        // Task 4: 使用网格结构搁板模型
        const shelfGroup = createShelfGridMesh(fw, fd, shelfThickness, 100);
        const shelfCenterY = shelfY + shelfThickness / 2 + baseY;
        shelfGroup.position.set(0, shelfCenterY, 0);
        shelfGroup.userData = { isShelfMesh: true, shelfY: shelfY, thickness: shelfThickness };

        itemsGroup.add(shelfGroup);
        shelfMeshes.push(shelfGroup);
    });
}

// ==================== SCENE RENDERING（V2.0: 料框 + 搁板实体）====================

/**
 * Render a single furnace's contents in the 3D scene.
 * V2.0: 加入了真实料框网格模型 + 搁板实体厚度
 *
 * Fix: 每个工件mesh存储原始颜色到 userData.originalColor，供高亮/恢复使用
 */
export function renderSingleFurnace(index, filterMaterialName) {
    disposeShelfMeshes();
    while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);

    if (!globalFurnacesResult || index >= globalFurnacesResult.length || index < 0) {
        document.getElementById('empty-state').style.display = 'block';
        return;
    }
    document.getElementById('empty-state').style.display = 'none';

    const furnace = globalFurnacesResult[index];
    const baseY = -120;

    // Task 1: 真实料框模型（替换原来的简单线框）
    const basketGroup = createBasketFrame(furnace.w, furnace.h, furnace.d, 100);
    basketGroup.position.set(-furnace.w / 2, baseY, -furnace.d / 2);
    itemsGroup.add(basketGroup);

    // 保留橙色边框以显示炉膛外廓
    const containerGeo = new THREE.BoxGeometry(furnace.w, furnace.h, furnace.d);
    const containerEdges = new THREE.EdgesGeometry(containerGeo);
    const containerLine = new THREE.LineSegments(containerEdges,
        new THREE.LineBasicMaterial({ color: 0x0066cc, linewidth: 1, transparent: true, opacity: 0.5 }));
    containerLine.position.set(0, furnace.h / 2 + baseY, 0);
    itemsGroup.add(containerLine);

    // 渲染每个工件
    furnace.packedItems.forEach(item => {
        const isFiltered = filterMaterialName && item.name !== filterMaterialName;
        let geometry;
        if (item.shape === 'cylinder') {
            geometry = new THREE.CylinderGeometry(item.w / 2, item.w / 2, item.h, 32);
        } else {
            geometry = new THREE.BoxGeometry(item.w, item.h, item.d);
        }

        /* 使用 item.color 创建颜色对象 */
        const originalColor = new THREE.Color(item.color);
        const material = new THREE.MeshStandardMaterial({
            color: originalColor,
            transparent: true,
            opacity: isFiltered ? 0.12 : 0.85,
            roughness: 0.3, metalness: 0.2
        });
        const mesh = new THREE.Mesh(geometry, material);
        /* Fix: 存储原始颜色到 userData，用于高亮结束后恢复 */
        mesh.userData = {
            itemName: item.name,
            itemId: item.id,
            furnaceIndex: index,
            originalColor: item.color,       // 保存原始颜色字符串
            itemMaterial: item.material || '',
            itemProcess: item.process || ''
        };
        const edgeMat = new THREE.LineBasicMaterial({ color: isFiltered ? 0xcccccc : 0x444444 });
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMat));
        mesh.position.set(
            item.x - furnace.w / 2 + item.w / 2,
            item.y + item.h / 2 + baseY,
            item.z - furnace.d / 2 + item.d / 2
        );
        itemsGroup.add(mesh);
    });

    controls.target.set(0, furnace.h / 2 + baseY, 0);
    camera.position.set(furnace.w * 1.5, furnace.h * 1.8 + baseY, furnace.d * 2.5);
    controls.update();

    if (placementRules.useShelfLayered && furnace.packedItems.length > 0) {
        renderShelvesForFurnace(furnace, baseY);
    }

    /* Fix: 更新3D场景统计悬浮面板 */
    update3DStatsPanel(furnace);
}

/**
 * Fix: 更新3D场景右下角统计悬浮面板
 * 展示当前炉膛内物料的数量、材质、种类和工艺信息
 *
 * @param {Object} furnace - 当前炉膛数据
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

    // 统计物料种类（按名称去重）
    const nameSet = new Set();
    const materialSet = new Set();
    const processSet = new Set();
    let totalWeightVal = 0;

    items.forEach(item => {
        nameSet.add(item.name);
        if (item.material) materialSet.add(item.material);
        if (item.process) processSet.add(item.process);
        totalWeightVal += (item.weight || 0);
    });

    const totalVol = furnace.w * furnace.h * furnace.d;
    const packedVol = items.reduce((acc, curr) => acc + (curr.w * curr.h * curr.d), 0);
    const utilization = totalVol > 0 ? ((packedVol / totalVol) * 100).toFixed(1) : '0';

    // 统计每种物料的数量
    const nameCountMap = new Map();
    items.forEach(item => {
        nameCountMap.set(item.name, (nameCountMap.get(item.name) || 0) + 1);
    });

    // 构建物料列表HTML（最多显示8行，超出的折叠）
    const maxShow = 8;
    const nameEntries = [...nameCountMap.entries()];
    const shownEntries = nameEntries.slice(0, maxShow);
    const hiddenCount = nameEntries.length - maxShow;

    let itemListHTML = '';
    shownEntries.forEach(([name, count]) => {
        itemListHTML += '<div class="ssp-item-row"><span class="ssp-item-name">' + name + '</span><span class="ssp-item-count">×' + count + '件</span></div>';
    });
    if (hiddenCount > 0) {
        itemListHTML += '<div class="ssp-item-row"><span class="ssp-item-name" style="color:#999;">... 还有' + hiddenCount + '种物料</span></div>';
    }

    panel.innerHTML = '<div class="ssp-header">📊 当前炉膛统计</div>' +
        '<div class="ssp-body">' +
        '<div class="ssp-stat-row"><span class="ssp-label">物料总数</span><span class="ssp-value">' + items.length + ' 件</span></div>' +
        '<div class="ssp-stat-row"><span class="ssp-label">物料种类</span><span class="ssp-value">' + nameSet.size + ' 种</span></div>' +
        '<div class="ssp-stat-row"><span class="ssp-label">材质类型</span><span class="ssp-value">' + (materialSet.size || 0) + ' 种</span></div>' +
        '<div class="ssp-stat-row"><span class="ssp-label">工艺类型</span><span class="ssp-value">' + (processSet.size || 0) + ' 种</span></div>' +
        '<div class="ssp-stat-row"><span class="ssp-label">总重量</span><span class="ssp-value">' + totalWeightVal.toFixed(1) + ' kg</span></div>' +
        '<div class="ssp-stat-row"><span class="ssp-label">空间利用率</span><span class="ssp-value">' + utilization + '%</span></div>' +
        '<div class="ssp-divider"></div>' +
        '<div class="ssp-list-title">📦 物料明细</div>' +
        itemListHTML +
        '</div>';
}

// ==================== SCENE NAVIGATION ====================

export function navigateFurnace(direction) {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return;
    resetAllItemOpacityToOpaque();
    setCurrentFurnaceIndex(
        (currentFurnaceIndex + direction + globalFurnacesResult.length) % globalFurnacesResult.length
    );
    const filterName = getSelectedMaterialName();
    return { filterName, newIndex: currentFurnaceIndex };
}

export function getSelectedMaterialName() {
    if (!selectedMaterialCardId) return null;
    const card = document.getElementById(selectedMaterialCardId);
    if (!card) return null;
    return card.querySelector('.m-name').textContent;
}

// ==================== OPACITY / HIGHLIGHT MANAGEMENT ====================

/**
 * 用于存储高亮增强效果的引用
 */
let currentHighlightGroup = null;

/**
 * 【Bug修复】存储每个工件材料在进入高亮前的原始颜色状态
 * 用于 resetAllItemOpacityToOpaque 时恢复，防止反复选中导致颜色累积变暗
 * 结构: Map<THREE.Mesh, { originalColorHex: string }>
 */
const originalColorStore = new Map();

/**
 * 恢复所有工件到原始不透明状态。
 *
 * Fix: 同时从 originalColorStore 恢复原始颜色，解决反复选中/取消导致颜色异常的问题。
 */
export function resetAllItemOpacityToOpaque() {
    if (!itemsGroup) return;

    // 清除所有高亮效果
    if (currentHighlightGroup) {
        itemsGroup.remove(currentHighlightGroup);
        disposeHighlightGroup(currentHighlightGroup);
        currentHighlightGroup = null;
    }

    itemsGroup.children.forEach(child => {
        if (!child.isMesh) return;
        if (!child.material) return;
        if (child.material.isLineBasicMaterial) return;

        child.material.transparent = true;
        child.material.opacity = 0.85;
        child.material.needsUpdate = true;

        /* Fix: 恢复原始颜色，而不是用可能已经变灰的颜色 */
        if (originalColorStore.has(child)) {
            const stored = originalColorStore.get(child);
            if (stored.originalColorHex) {
                child.material.color.set(stored.originalColorHex);
            }
            originalColorStore.delete(child);
        } else if (child.userData && child.userData.originalColor) {
            /* 如果 colorStore 中没有缓存，从 userData.originalColor 恢复 */
            child.material.color.set(child.userData.originalColor);
        }

        /* 恢复边框为默认深色 */
        child.children.forEach(subChild => {
            if (subChild.isLineSegments && subChild.material && subChild.material.isLineBasicMaterial) {
                subChild.material.color = new THREE.Color(0x444444);
                subChild.material.linewidth = 1;
            }
        });

        /* 清除发光效果 */
        if (child.material.emissive !== undefined) {
            child.material.emissive = new THREE.Color(0x000000);
            child.material.emissiveIntensity = 0;
        }
    });

    originalOpacityStore.clear();
}

/**
 * 工件选中高亮 / 取消选中恢复。
 *
 * 【修正后的逻辑】:
 *   - 选中物料卡 → 切换至对应炉膛 → 该物料高亮（白色发光边缘）+ 其他物料变透明（opacity 0.15）
 *   - 取消选中物料卡 → 全部物料恢复原始颜色和透明度
 *   - 修复Bug: 颜色修改前先备份原始颜色到 originalColorStore，
 *     恢复时从备份中还原，而不是直接用被污染的颜色
 *
 * @param {string|null} cardId - Material card ID to highlight, or null to reset
 */
export function highlightItemsInScene(cardId) {
    if (opacityResetTimerId) { clearTimeout(opacityResetTimerId); setOpacityResetTimerId(null); }

    // 先清除之前的增强高亮
    if (currentHighlightGroup) {
        itemsGroup.remove(currentHighlightGroup);
        disposeHighlightGroup(currentHighlightGroup);
        currentHighlightGroup = null;
    }

    if (!cardId) {
        resetAllItemOpacityToOpaque();
        return;
    }

    if (!globalFurnacesResult || currentFurnaceIndex >= globalFurnacesResult.length) return;
    const card = document.getElementById(cardId);
    if (!card) return;
    const selectedName = card.querySelector('.m-name').textContent;

    let firstSelectedMesh = null;

    itemsGroup.children.forEach(child => {
        if (!child.isMesh) return;
        if (!child.material || child.material.isLineBasicMaterial) return;

        const isSelected = (child.userData && child.userData.itemName === selectedName);

        if (isSelected) {
            if (!firstSelectedMesh) firstSelectedMesh = child;

            /* 先备份原始颜色（防止之前已被修改） */
            if (!originalColorStore.has(child) && child.userData && child.userData.originalColor) {
                originalColorStore.set(child, {
                    originalColorHex: child.userData.originalColor
                });
            }
            /* 确保选中工件颜色为其原始颜色 */
            const origColor = (child.userData && child.userData.originalColor) ? child.userData.originalColor : '#' + child.material.color.getHexString();
            child.material.color.set(origColor);

            /* 选中工件：白色发光 + 白色粗边框描边（比绿色更醒目） */
            if (child.material.emissive !== undefined) {
                child.material.emissive = new THREE.Color(0xffffff);  // 白色发光
                child.material.emissiveIntensity = 0.6;
            }
            child.material.transparent = true;
            child.material.opacity = 1.0;
            child.material.needsUpdate = true;

            // 边框变白色加粗
            child.children.forEach(subChild => {
                if (subChild.isLineSegments && subChild.material && subChild.material.isLineBasicMaterial) {
                    subChild.material.color = new THREE.Color(0xffffff);  // 白色边框
                    subChild.material.linewidth = 3;
                }
            });

            // 创建白色外发光轮廓（略大于原工件）
            let outlineGeo;
            if (child.geometry.type === 'CylinderGeometry') {
                outlineGeo = new THREE.CylinderGeometry(
                    child.geometry.parameters.radiusTop * 1.08,
                    child.geometry.parameters.radiusBottom * 1.08,
                    child.geometry.parameters.height * 1.05,
                    32
                );
            } else {
                const b = child.geometry.parameters;
                outlineGeo = new THREE.BoxGeometry(
                    (b.width || 1) * 1.08, (b.height || 1) * 1.05, (b.depth || 1) * 1.08
                );
            }
            const outlineEdges = new THREE.EdgesGeometry(outlineGeo);
            const outlineLine = new THREE.LineSegments(outlineEdges,
                new THREE.LineBasicMaterial({
                    color: 0xffaa00,  /* 橙金色外发光轮廓，在白色背景上足够醒目 */
                    linewidth: 2,
                    transparent: true,
                    opacity: 0.85
                }));
            outlineLine.userData = { isHighlightOutline: true, parentItemId: child.userData.itemId };
            outlineLine.position.copy(child.position);
            outlineLine.rotation.copy(child.rotation);
            outlineLine.scale.copy(child.scale);
            if (!currentHighlightGroup) {
                currentHighlightGroup = new THREE.Group();
                currentHighlightGroup.userData = { isHighlightGroup: true };
                itemsGroup.add(currentHighlightGroup);
            }
            currentHighlightGroup.add(outlineLine);
        } else {
            /* 【Bug修复】未选中工件：先备份原始颜色，再设置为透明淡色 */
            if (!originalColorStore.has(child) && child.userData && child.userData.originalColor) {
                originalColorStore.set(child, {
                    originalColorHex: child.userData.originalColor
                });
            }

            const origTransparent = child.material.transparent;
            const origOpacity = child.material.opacity;
            originalOpacityStore.set(child, { transparent: origTransparent, opacity: origOpacity });

            child.material.transparent = true;
            child.material.opacity = 0.15;  /* 未选中工件几乎完全透明 */
            child.material.needsUpdate = true;
            /* 不修改颜色！保持其原始颜色，仅降低透明度即可 */

            /* 边框也变淡 */
            child.children.forEach(subChild => {
                if (subChild.isLineSegments && subChild.material && subChild.material.isLineBasicMaterial) {
                    subChild.material.color = new THREE.Color(0xcccccc);
                }
            });

            /* 清除发光效果 */
            if (child.material.emissive !== undefined) {
                child.material.emissive = new THREE.Color(0x000000);
                child.material.emissiveIntensity = 0;
            }
        }
    });

    // 相机自动定位聚焦目标工件
    if (firstSelectedMesh) {
        const targetPos = firstSelectedMesh.position.clone();
        controls.target.copy(targetPos);
        controls.update();
    }
}

function disposeHighlightGroup(group) {
    group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
            } else {
                child.material.dispose();
            }
        }
    });
}

// ==================== ANIMATION ====================

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

    resetAllItemOpacityToOpaque();
    disposeShelfMeshes();
    while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);

    const baseY = -120;
    const itemDrawSteps = [];
    const furnaceCount = globalFurnacesResult.length;
    const orderedIndices = [];
    for (let i = 0; i < furnaceCount; i++) {
        orderedIndices.push((startFurnaceIndex + i) % furnaceCount);
    }

    // V2.0: 动画中也使用料框网格模型
    const initialFurnace = globalFurnacesResult[orderedIndices[0]];
    const basketGroup = createBasketFrame(initialFurnace.w, initialFurnace.h, initialFurnace.d, 100);
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
            if (filterMaterialName && item.name !== filterMaterialName) return;
            let geometry;
            if (item.shape === 'cylinder') geometry = new THREE.CylinderGeometry(item.w / 2, item.w / 2, item.h, 32);
            else geometry = new THREE.BoxGeometry(item.w, item.h, item.d);

            const material = new THREE.MeshStandardMaterial({
                color: new THREE.Color(item.color),
                transparent: true, opacity: 0.85,
                roughness: 0.3, metalness: 0.2
            });
            const mesh = new THREE.Mesh(geometry, material);
            /* Fix: 存储原始颜色到 userData */
            mesh.userData = {
                itemName: item.name,
                itemId: item.id,
                shape: item.shape,
                originalColor: item.color,
                itemMaterial: item.material || '',
                itemProcess: item.process || ''
            };
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry),
                new THREE.LineBasicMaterial({ color: 0x444444 })));
            mesh.position.set(
                item.x - furnace.w / 2 + item.w / 2,
                item.y + item.h / 2 + baseY,
                item.z - furnace.d / 2 + item.d / 2
            );
            itemDrawSteps.push({
                mesh, furnaceIndex: fIdx,
                furnaceName: furnace.instanceId,
                itemName: item.name,
                x: Math.round(item.x), y: Math.round(item.y), z: Math.round(item.z)
            });
        });
    });

    if (itemDrawSteps.length === 0) {
        setIsAnimating(false); controlBar.classList.remove('visible');
        btnAnimate.disabled = false; btnAnimate.style.opacity = '1';
        document.getElementById('stats-3d-panel').style.display = 'none';
        return;
    }

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitIfPaused = () => new Promise(resolve => {
        const check = () => { if (animStopped || !animPaused) resolve(); else setTimeout(check, 100); };
        check();
    });

    for (let i = 0; i < itemDrawSteps.length; i++) {
        if (animStopped) break;
        await waitIfPaused();
        if (animStopped) break;

        const step = itemDrawSteps[i];
        if (step.furnaceIndex !== currentFurnaceIndex) {
            setCurrentFurnaceIndex(step.furnaceIndex);
            rebuildSceneUpTo(i, itemDrawSteps, filterMaterialName);
            /* Fix: 更新统计面板 */
            update3DStatsPanel(globalFurnacesResult[step.furnaceIndex]);
        } else {
            itemsGroup.add(step.mesh);
        }

        const filterLabel = filterMaterialName ? ' · 仅显示【' + filterMaterialName + '】' : '';
        document.getElementById('anim-progress-text').textContent =
            '(' + (i + 1) + '/' + itemDrawSteps.length + ') · 将【' + step.itemName + '】吊装至 ' + step.furnaceName + ' · 坐标(' + step.x + ',' + step.y + ',' + step.z + ')' + filterLabel;

        const speedMs = parseInt(document.getElementById('anim-speed-select').value) || 400;
        await sleep(speedMs);
    }

    document.getElementById('anim-progress-text').textContent = '';
    controlBar.classList.remove('visible');
    if (!animStopped) { /* already at correct furnace */ }
    else {
        renderSingleFurnace(currentFurnaceIndex, filterMaterialName);
    }

    /* Fix: 动画结束后更新统计面板 */
    if (globalFurnacesResult && globalFurnacesResult.length > currentFurnaceIndex) {
        update3DStatsPanel(globalFurnacesResult[currentFurnaceIndex]);
    }

    btnAnimate.disabled = false; btnAnimate.style.opacity = '1';
    setIsAnimating(false); setAnimPaused(false); setAnimStopped(false);
}

function rebuildSceneUpTo(stepIndex, allSteps, filterMaterialName) {
    while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);
    const furnaceIndex = allSteps[stepIndex].furnaceIndex;
    const furnace = globalFurnacesResult[furnaceIndex];
    const baseY = -120;

    const basketGroup = createBasketFrame(furnace.w, furnace.h, furnace.d, 100);
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
        if (allSteps[i].furnaceIndex === furnaceIndex) itemsGroup.add(allSteps[i].mesh);
    }

    controls.target.set(0, furnace.h / 2 + baseY, 0);
    camera.position.set(furnace.w * 1.5, furnace.h * 1.8 + baseY, furnace.d * 2.5);
    controls.update();
}

// ==================== MASTER VIEW ====================

export function renderMasterPlan(plan) {
    while (masterScene.children.length > 2) masterScene.remove(masterScene.children[masterScene.children.length - 1]);
    const fw = plan.furnaceW || 800, fh = plan.furnaceH || 600, fd = plan.furnaceD || 600;

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
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(item.color),
            transparent: true, opacity: 0.85,
            roughness: 0.3, metalness: 0.2
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