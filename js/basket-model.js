/**
 * basket-model.js - 料框（篮筐）三维建模模块
 *
 * 从 three-scene.js 中提取所有料框建模函数，
 * 包含网格料框、蜂窝料框、托盘料框、圆环节点料框、
 * 挂具、环形工装、实心料框，以及统一入口 createBasketFrame 和搁板 createShelfMesh。
 *
 * Dependencies:
 *   - THREE.js (imported via importmap)
 *   - geometry-utils.js (createBar, getHollowHexagonGeometry, getRingGeometry, getArmGeometry, 常量)
 */

import * as THREE from 'three';
import {
    createBar,
    getHollowHexagonGeometry,
    getRingGeometry,
    getArmGeometry,
    HEX_OUTER_RADIUS,
    HEX_BORDER_WIDTH,
    ARM_RADIUS,
    ARM_LENGTH
} from './geometry-utils.js';

// ==================== TOOLING-TO-BASKET MAPPING (V4.8) ====================

/**
 * 工装类型 → 料框 3D 建模类型映射
 * 用于 createBasketFrame 根据 furnace.toolingType 选择正确的建模函数
 */
export const TOOLING_TO_BASKET = {
    'standard-basket': 'grid',
    'mesh-basket': 'honeycomb',
    'special-jig': 'tray',
    'material-tray': 'tray',
    'hanger': 'hanger',
    'ring-tooling': 'ringnode'
};

// ==================== HONEYCOMB PANEL ====================

/**
 * 在指定面上创建蜂窝六边形 InstancedMesh 面板（修复图案溢出版）
 * @param {string} faceType - 'bottom'|'front'|'back'|'left'|'right'
 * @param {number} w - 料框宽度
 * @param {number} h - 料框高度
 * @param {number} d - 料框深度
 * @param {THREE.Material} material - 材质
 * @returns {THREE.InstancedMesh}
 */
function createHoneycombPanel(faceType, w, h, d, material) {
    const hexGeo = getHollowHexagonGeometry();
    const outerR = HEX_OUTER_RADIUS; // 外径 25mm
    const hexW = outerR * 2;         // 50mm
    const hexH = outerR * Math.sqrt(3); // 43.3mm
    const colSpacing = hexW * 0.75;  // 列间距 37.5mm
    const rowSpacing = hexH;         // 行间距 43.3mm

    let panelU, panelV, ox, oy, oz, ux, uy, uz, vx, vy, vz, rotX, rotY, rotZ;

    switch (faceType) {
        case 'bottom':
            panelU = w; panelV = d;
            ox = 0; oy = 0; oz = 0;
            ux = 1; uy = 0; uz = 0;
            vx = 0; vy = 0; vz = 1;
            rotX = -Math.PI / 2; rotY = 0; rotZ = 0;
            break;
        case 'front':
            panelU = w; panelV = h;
            ox = 0; oy = 0; oz = d;
            ux = 1; uy = 0; uz = 0;
            vx = 0; vy = 1; vz = 0;
            rotX = 0; rotY = 0; rotZ = 0;
            break;
        case 'back':
            panelU = w; panelV = h;
            ox = 0; oy = 0; oz = 0;
            ux = 1; uy = 0; uz = 0;
            vx = 0; vy = 1; vz = 0;
            rotX = 0; rotY = 0; rotZ = 0;
            break;
        case 'left':
            panelU = d; panelV = h;
            ox = 0; oy = 0; oz = 0;
            ux = 0; uy = 0; uz = 1;
            vx = 0; vy = 1; vz = 0;
            rotX = 0; rotY = Math.PI / 2; rotZ = 0;
            break;
        case 'right':
            panelU = d; panelV = h;
            ox = w; oy = 0; oz = 0;
            ux = 0; uy = 0; uz = 1;
            vx = 0; vy = 1; vz = 0;
            rotX = 0; rotY = Math.PI / 2; rotZ = 0;
            break;
        default: return null;
    }

    // 安全内缩边距
    const safetyMargin = outerR + 5;
    const availU = panelU - 2 * safetyMargin;
    const availV = panelV - 2 * safetyMargin;

    let cols = Math.floor(availU / colSpacing) + 1;
    let rows = Math.floor((availV - (cols > 1 ? rowSpacing / 2 : 0)) / rowSpacing) + 1;

    if (cols < 1) cols = 1;
    if (rows < 1) rows = 1;

    const totalGridW = (cols - 1) * colSpacing;
    const totalGridH = (rows - 1) * rowSpacing + (cols > 1 ? rowSpacing / 2 : 0);

    const startU = (panelU - totalGridW) / 2;
    const startV = (panelV - totalGridH) / 2;

    const mesh = new THREE.InstancedMesh(hexGeo.clone(), material, cols * rows);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let idx = 0;

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const u = startU + col * colSpacing;
            const v = startV + row * rowSpacing + (col % 2) * rowSpacing / 2;

            dummy.position.set(
                ox + u * ux + v * vx,
                oy + u * uy + v * vy,
                oz + u * uz + v * vz
            );
            dummy.rotation.set(rotX, rotY, rotZ);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(idx, dummy.matrix);
            idx++;
        }
    }

    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
}

// ==================== RING NODE PANEL ====================

/**
 * 在指定面上创建圆环节点 InstancedMesh 阵列（V3.5）
 *
 * 每个单元 = 1 个中空圆环（Torus） + 4 个连接臂（±X, ±Z 方向）。
 * 分为两层 InstancedMesh：ringsInstanced（所有圆环） + armsInstanced（所有连接臂）。
 * 相邻单元的连接臂端点重合，自然形成 ◯—🞎—◯ 的视觉结构。
 *
 * @param {string} face - 面类型
 * @param {number} w - 料框宽度
 * @param {number} h - 料框高度
 * @param {number} d - 料框深度
 * @param {THREE.Material} ringMaterial - 圆环材质
 * @param {THREE.Material} armMaterial - 连接臂材质
 * @returns {THREE.Group} 包含两个 InstancedMesh 的 Group
 */
function createRingNodePanel(face, w, h, d, ringMaterial, armMaterial) {
    const panelGroup = new THREE.Group();

    // 核心参数控制
    const spacing = 100;
    const ringRadius = spacing * 0.25;
    const ringTube = spacing * 0.05;
    const armRadius = spacing * 0.05;

    let gridW = 0, gridH = 0;
    if (face === 'bottom') { gridW = w; gridH = d; }
    else if (face === 'front' || face === 'back') { gridW = w; gridH = h; }
    else if (face === 'left' || face === 'right') { gridW = d; gridH = h; }

    const safetyMargin = ringRadius + ringTube + 5;

    let cols = Math.floor((gridW - 2 * safetyMargin) / spacing) + 1;
    let rows = Math.floor((gridH - 2 * safetyMargin) / spacing) + 1;

    if (cols < 1) cols = 1;
    if (rows < 1) rows = 1;

    const totalGridW = (cols - 1) * spacing;
    const totalGridH = (rows - 1) * spacing;

    const startU = (gridW - totalGridW) / 2;
    const startV = (gridH - totalGridH) / 2;

    const ringGeo = new THREE.TorusGeometry(ringRadius, ringTube, 8, 24);
    const armGeo = new THREE.CylinderGeometry(armRadius, armRadius, spacing, 8);

    const ringCount = cols * rows;
    const armCount = (cols - 1) * rows + cols * (rows - 1);

    const ringMesh = new THREE.InstancedMesh(ringGeo, ringMaterial, ringCount);
    const armMesh = new THREE.InstancedMesh(armGeo, armMaterial, armCount);

    let ringIdx = 0;
    let armIdx = 0;
    const dummy = new THREE.Object3D();

    function applyTransform(u, v, type) {
        let x = 0, y = 0, z = 0;
        let rx = 0, ry = 0, rz = 0;

        switch (face) {
            case 'bottom':
                if (type === 'ring') { x = u; y = 0; z = v; rx = Math.PI / 2; }
                else if (type === 'hArm') { x = u + spacing / 2; y = 0; z = v; rz = Math.PI / 2; }
                else if (type === 'vArm') { x = u; y = 0; z = v + spacing / 2; rx = Math.PI / 2; }
                break;
            case 'front':
                if (type === 'ring') { x = u; y = v; z = d; rx = 0; }
                else if (type === 'hArm') { x = u + spacing / 2; y = v; z = d; rz = Math.PI / 2; }
                else if (type === 'vArm') { x = u; y = v + spacing / 2; z = d; rz = 0; }
                break;
            case 'back':
                if (type === 'ring') { x = u; y = v; z = 0; rx = 0; }
                else if (type === 'hArm') { x = u + spacing / 2; y = v; z = 0; rz = Math.PI / 2; }
                else if (type === 'vArm') { x = u; y = v + spacing / 2; z = 0; rz = 0; }
                break;
            case 'left':
                if (type === 'ring') { x = 0; y = v; z = u; ry = Math.PI / 2; }
                else if (type === 'hArm') { x = 0; y = v; z = u + spacing / 2; rx = Math.PI / 2; }
                else if (type === 'vArm') { x = 0; y = v + spacing / 2; z = u; rz = 0; }
                break;
            case 'right':
                if (type === 'ring') { x = w; y = v; z = u; ry = Math.PI / 2; }
                else if (type === 'hArm') { x = w; y = v; z = u + spacing / 2; rx = Math.PI / 2; }
                else if (type === 'vArm') { x = w; y = v + spacing / 2; z = u; rz = 0; }
                break;
        }

        dummy.position.set(x, y, z);
        dummy.rotation.set(rx, ry, rz);
        dummy.updateMatrix();
    }

    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            const u = startU + i * spacing;
            const v = startV + j * spacing;

            applyTransform(u, v, 'ring');
            ringMesh.setMatrixAt(ringIdx++, dummy.matrix);

            if (i < cols - 1) {
                applyTransform(u, v, 'hArm');
                armMesh.setMatrixAt(armIdx++, dummy.matrix);
            }

            if (j < rows - 1) {
                applyTransform(u, v, 'vArm');
                armMesh.setMatrixAt(armIdx++, dummy.matrix);
            }
        }
    }

    ringMesh.instanceMatrix.needsUpdate = true;
    armMesh.instanceMatrix.needsUpdate = true;

    panelGroup.add(ringMesh);
    panelGroup.add(armMesh);

    return panelGroup;
}

// ==================== GRID BASKET FRAME ====================

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

// ==================== HONEYCOMB BASKET FRAME ====================

function createHoneycombBasketFrame(w, h, d) {
    const group = new THREE.Group();

    const panelMaterial = new THREE.MeshStandardMaterial({
        color: 0x556677,
        roughness: 0.55,
        metalness: 0.7,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    group.add(createHoneycombPanel('bottom', w, h, d, panelMaterial));
    group.add(createHoneycombPanel('front', w, h, d, panelMaterial));
    group.add(createHoneycombPanel('back', w, h, d, panelMaterial));
    group.add(createHoneycombPanel('left', w, h, d, panelMaterial));
    group.add(createHoneycombPanel('right', w, h, d, panelMaterial));

    const frameRadius = 4.5;
    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x445566,
        roughness: 0.5,
        metalness: 0.85,
        transparent: true,
        opacity: 0.75,
        depthWrite: false
    });

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

// ==================== TRAY BASKET FRAME ====================

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

// ==================== RING NODE BASKET FRAME ====================

/**
 * V3.5: 圆环节点网格料框 — 使用 InstancedMesh 阵列，高效模拟工业铸造料筐视觉效果
 *
 * 结构：
 *   - 五面（底 + 前后左右）圆环节点面板
 *   - 每个面板 = 圆环 InstancedMesh + 连接臂 InstancedMesh 阵列
 *   - 粗钢筋边框框架
 */
export function createRingNodeBasketFrame(w, h, d) {
    const group = new THREE.Group();

    const ringMaterial = new THREE.MeshStandardMaterial({
        color: 0x667788,
        roughness: 0.5,
        metalness: 0.75,
        transparent: true,
        opacity: 0.85,
        depthWrite: true
    });

    const armMaterial = new THREE.MeshStandardMaterial({
        color: 0x556677,
        roughness: 0.55,
        metalness: 0.7,
        transparent: true,
        opacity: 0.8,
        depthWrite: true
    });

    group.add(createRingNodePanel('bottom', w, h, d, ringMaterial, armMaterial));
    group.add(createRingNodePanel('front', w, h, d, ringMaterial, armMaterial));
    group.add(createRingNodePanel('back', w, h, d, ringMaterial, armMaterial));
    group.add(createRingNodePanel('left', w, h, d, ringMaterial, armMaterial));
    group.add(createRingNodePanel('right', w, h, d, ringMaterial, armMaterial));

    const frameRadius = 2.0;
    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x334455,
        roughness: 0.4,
        metalness: 0.9,
    });

    function createEdgeBar(x1, y1, z1, x2, y2, z2) {
        const p1 = new THREE.Vector3(x1, y1, z1);
        const p2 = new THREE.Vector3(x2, y2, z2);

        const direction = new THREE.Vector3().subVectors(p2, p1);
        const length = direction.length();

        const barGeo = new THREE.CylinderGeometry(frameRadius, frameRadius, length, 8);
        const bar = new THREE.Mesh(barGeo, frameMaterial);

        bar.position.copy(p1).add(direction.multiplyScalar(0.5));

        const up = new THREE.Vector3(0, 1, 0);
        bar.quaternion.setFromUnitVectors(up, direction.normalize());

        return bar;
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

    group.userData = { isBasketFrame: true, basketType: 'ringnode' };
    return group;
}

// ==================== HANGER FRAME ====================

/**
 * V4.8: 挂具工装 3D 占位模型 — 顶部横梁 + 垂直挂钩
 *
 * @param {number} w - 宽度 (mm)
 * @param {number} h - 高度 (mm)
 * @param {number} d - 深度 (mm)
 * @param {Object} [params={}] - 工装参数 { hookSpacing, maxHangWeight }
 * @returns {THREE.Group}
 */
function createHangerFrame(w, h, d, params = {}) {
    const group = new THREE.Group();

    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x886644,
        roughness: 0.5,
        metalness: 0.7,
        transparent: true,
        opacity: 0.6,
        depthWrite: false
    });

    const hookMaterial = new THREE.MeshStandardMaterial({
        color: 0x665533,
        roughness: 0.55,
        metalness: 0.75,
        transparent: true,
        opacity: 0.5,
        depthWrite: false
    });

    group.add(createBar(
        new THREE.Vector3(0, h, d / 2),
        new THREE.Vector3(w, h, d / 2),
        6, frameMaterial
    ));

    group.add(createBar(
        new THREE.Vector3(0, 0, d / 2),
        new THREE.Vector3(w, 0, d / 2),
        6, frameMaterial
    ));

    const hookSpacing = params.hookSpacing || 80;
    for (let x = hookSpacing; x < w; x += hookSpacing) {
        group.add(createBar(
            new THREE.Vector3(x, h, d / 2),
            new THREE.Vector3(x, 0, d / 2),
            3, hookMaterial
        ));
    }

    group.userData = { isBasketFrame: true, basketType: 'hanger' };
    return group;
}

// ==================== RADIAL FRAME ====================

/**
 * V4.8: 环形工装 3D 占位模型 — 圆环轨道 + 径向支撑臂
 *
 * @param {number} w - 宽度 (mm)
 * @param {number} h - 高度 (mm)
 * @param {number} d - 深度 (mm)
 * @param {Object} [params={}] - 工装参数 { innerRadius, outerRadius, angleStep }
 * @returns {THREE.Group}
 */
function createRadialFrame(w, h, d, params = {}) {
    const group = new THREE.Group();

    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x667788,
        roughness: 0.5,
        metalness: 0.75,
        transparent: true,
        opacity: 0.6,
        depthWrite: false
    });

    const armMaterial = new THREE.MeshStandardMaterial({
        color: 0x556677,
        roughness: 0.55,
        metalness: 0.7,
        transparent: true,
        opacity: 0.5,
        depthWrite: false
    });

    const centerX = w / 2;
    const centerZ = d / 2;
    const outerR = params.outerRadius || Math.min(w, d) / 2 - 50;
    const innerR = params.innerRadius || outerR * 0.5;
    const angleStep = params.angleStep || 30;

    const torusGeo = new THREE.TorusGeometry(outerR, 5, 8, 48);
    const torus = new THREE.Mesh(torusGeo, frameMaterial);
    torus.position.set(centerX, h / 2, centerZ);
    torus.rotation.x = Math.PI / 2;
    group.add(torus);

    for (let angle = 0; angle < 360; angle += angleStep) {
        const rad = (angle * Math.PI) / 180;
        const innerX = centerX + innerR * Math.cos(rad);
        const innerZ = centerZ + innerR * Math.sin(rad);
        const outerX = centerX + outerR * Math.cos(rad);
        const outerZ = centerZ + outerR * Math.sin(rad);

        group.add(createBar(
            new THREE.Vector3(innerX, h / 2, innerZ),
            new THREE.Vector3(outerX, h / 2, outerZ),
            3, armMaterial
        ));
    }

    function createEdgeBar(x1, y1, z1, x2, y2, z2) {
        return createBar(
            new THREE.Vector3(x1, y1, z1),
            new THREE.Vector3(x2, y2, z2),
            4, frameMaterial
        );
    }

    group.add(createEdgeBar(0, 0, 0, w, 0, 0));
    group.add(createEdgeBar(w, 0, 0, w, 0, d));
    group.add(createEdgeBar(w, 0, d, 0, 0, d));
    group.add(createEdgeBar(0, 0, d, 0, 0, 0));
    group.add(createEdgeBar(0, 0, 0, 0, h, 0));
    group.add(createEdgeBar(w, 0, 0, w, h, 0));
    group.add(createEdgeBar(w, 0, d, w, h, d));
    group.add(createEdgeBar(0, 0, d, 0, h, d));
    group.add(createEdgeBar(0, h, 0, w, h, 0));
    group.add(createEdgeBar(w, h, 0, w, h, d));
    group.add(createEdgeBar(w, h, d, 0, h, d));
    group.add(createEdgeBar(0, h, d, 0, h, 0));

    group.userData = { isBasketFrame: true, basketType: 'radial' };
    return group;
}

// ==================== UNIFIED BASKET ENTRY POINT ====================

/**
 * 统一料框创建入口 — 根据 basketType 参数选择对应类型
 * @param {number} w - 宽度
 * @param {number} h - 高度
 * @param {number} d - 深度
 * @param {number} [gridSize=100] - 网格间距（仅 grid 类型使用）
 * @param {string} [basketType='grid'] - 料框类型
 * @returns {THREE.Group}
 */
export function createBasketFrame(w, h, d, gridSize, basketType) {
    const type = basketType || 'grid';
    switch (type) {
        case 'honeycomb':
            return createHoneycombBasketFrame(w, h, d);
        case 'tray':
            return createTrayBasketFrame(w, h, d);
        case 'ringnode':
            return createRingNodeBasketFrame(w, h, d);
        case 'hanger':
            return createHangerFrame(w, h, d);
        case 'radial':
            return createRadialFrame(w, h, d);
        case 'grid':
        default:
            return createGridBasketFrame(w, h, d, gridSize || 100);
    }
}

// ==================== SHELF MESH ====================

/**
 * 创建搁板 InstancedMesh（重构版：修复边缘溢出 + 垂直拉伸厚度可配置）
 * @param {number} w - 搁板宽度
 * @param {number} d - 搁板深度
 * @param {number} thickness - 搁板配置厚度 (由外部渲染循环动态传入)
 * @returns {THREE.InstancedMesh}
 */
export function createShelfMesh(w, d, thickness) {
    const outerR = HEX_OUTER_RADIUS;    // 外径 25mm
    const hexW = outerR * 2;            // 50mm
    const hexH = outerR * Math.sqrt(3);    // 43.3mm
    const colSpacing = hexW * 0.75;     // 列间距 37.5mm
    const rowSpacing = hexH;            // 行间距 43.3mm

    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 6 + i * Math.PI / 3;
        const x = outerR * Math.cos(angle);
        const y = outerR * Math.sin(angle);
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }
    shape.closePath();

    const innerR = outerR - HEX_BORDER_WIDTH;
    if (innerR > 0) {
        const hole = new THREE.Path();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 6 + i * Math.PI / 3;
            const x = innerR * Math.cos(angle);
            const y = innerR * Math.sin(angle);
            if (i === 0) hole.moveTo(x, y);
            else hole.lineTo(x, y);
        }
        hole.closePath();
        shape.holes.push(hole);
    }

    const extrudeSettings = {
        depth: thickness || 5,
        bevelEnabled: false
    };
    const hexExtrudeGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    const safetyMargin = outerR + 5;
    const availW = w - 2 * safetyMargin;
    const availD = d - 2 * safetyMargin;

    let cols = Math.floor(availW / colSpacing) + 1;
    let rows = Math.floor((availD - (cols > 1 ? rowSpacing / 2 : 0)) / rowSpacing) + 1;

    if (cols < 1) cols = 1;
    if (rows < 1) rows = 1;

    const totalGridW = (cols - 1) * colSpacing;
    const totalGridD = (rows - 1) * rowSpacing + (cols > 1 ? rowSpacing / 2 : 0);

    const material = new THREE.MeshStandardMaterial({
        color: 0x556677,
        roughness: 0.55,
        metalness: 0.7,
        transparent: true,
        opacity: 0.6,
        depthWrite: true
    });

    const mesh = new THREE.InstancedMesh(hexExtrudeGeo, material, cols * rows);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let idx = 0;

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const cx = -totalGridW / 2 + col * colSpacing;
            const cz = -totalGridD / 2 + row * rowSpacing + (col % 2) * rowSpacing / 2;

            dummy.position.set(cx, 0, cz);
            dummy.rotation.set(-Math.PI / 2, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();

            mesh.setMatrixAt(idx, dummy.matrix);
            idx++;
        }
    }

    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData = { isShelfMesh: true };
    return mesh;
}

// ==================== GRID FACE PANEL HELPER ====================

/**
 * 创建单个网格面板 — 用于标准料框的五个面（底、前、后、左、右）
 * @param {string} faceType - 'bottom'|'front'|'back'|'left'|'right'
 * @param {number} w - 宽度
 * @param {number} h - 高度
 * @param {number} d - 深度
 * @param {number} gridSize - 网格间距 (mm)
 * @param {number} frameRadius - 边框钢筋半径
 * @param {THREE.Material} frameMaterial - 边框材质
 * @param {number} gridRadius - 内部网格钢筋半径
 * @param {THREE.Material} gridMaterial - 网格材质
 * @returns {THREE.Group}
 */
function createGridFacePanel(faceType, w, h, d, gridSize, frameRadius, frameMaterial, gridRadius, gridMaterial) {
    const group = new THREE.Group();

    // 定义每个面的四个角点
    let corners;
    switch (faceType) {
        case 'bottom':
            corners = [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(w, 0, 0),
                new THREE.Vector3(w, 0, d),
                new THREE.Vector3(0, 0, d)
            ];
            break;
        case 'front':
            corners = [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(w, 0, 0),
                new THREE.Vector3(w, h, 0),
                new THREE.Vector3(0, h, 0)
            ];
            break;
        case 'back':
            corners = [
                new THREE.Vector3(0, 0, d),
                new THREE.Vector3(w, 0, d),
                new THREE.Vector3(w, h, d),
                new THREE.Vector3(0, h, d)
            ];
            break;
        case 'left':
            corners = [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, 0, d),
                new THREE.Vector3(0, h, d),
                new THREE.Vector3(0, h, 0)
            ];
            break;
        case 'right':
            corners = [
                new THREE.Vector3(w, 0, 0),
                new THREE.Vector3(w, 0, d),
                new THREE.Vector3(w, h, d),
                new THREE.Vector3(w, h, 0)
            ];
            break;
        default:
            return group;
    }

    // 四边外框
    for (let i = 0; i < 4; i++) {
        group.add(createBar(corners[i], corners[(i + 1) % 4], frameRadius, frameMaterial));
    }

    // 计算面内方向向量
    const uDir = new THREE.Vector3().subVectors(corners[1], corners[0]); // 水平方向 (c0→c1)
    const vDir = new THREE.Vector3().subVectors(corners[3], corners[0]); // 垂直方向 (c0→c3)
    const uLen = uDir.length();
    const vLen = vDir.length();
    uDir.normalize();
    vDir.normalize();

    const origin = corners[0];

    // 沿 v 方向的水平网格线
    {
        let v = gridSize;
        while (v < vLen) {
            const start = origin.clone().add(vDir.clone().multiplyScalar(v));
            const end = start.clone().add(uDir.clone().multiplyScalar(uLen));
            group.add(createBar(start, end, gridRadius, gridMaterial));
            v += gridSize;
        }
    }

    // 沿 u 方向的垂直网格线
    {
        let u = gridSize;
        while (u < uLen) {
            const start = origin.clone().add(uDir.clone().multiplyScalar(u));
            const end = start.clone().add(vDir.clone().multiplyScalar(vLen));
            group.add(createBar(start, end, gridRadius, gridMaterial));
            u += gridSize;
        }
    }

    return group;
}

// ==================== TOOLING: STANDARD BASKET (V5.0) ====================

function createStandardBasketTooling(w, h, d, extras = {}) {
    const group = new THREE.Group();
    const frameRadius = 5;
    const gridRadius = 2;
    const gridSize = 100;

    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x445566,
        roughness: 0.5,
        metalness: 0.85,
        transparent: true,
        opacity: 0.75,
        depthWrite: true
    });

    const gridMaterial = new THREE.MeshStandardMaterial({
        color: 0x334455,
        roughness: 0.55,
        metalness: 0.8,
        transparent: true,
        opacity: 0.55,
        depthWrite: true
    });

    // 使用已存在的 createGridFacePanel（需要您确认该函数在文件内已定义，根据您的文件内容，它确实存在）
    group.add(createGridFacePanel('bottom', w, h, d, gridSize, frameRadius, frameMaterial, gridRadius, gridMaterial));
    group.add(createGridFacePanel('front', w, h, d, gridSize, frameRadius, frameMaterial, gridRadius, gridMaterial));
    group.add(createGridFacePanel('back', w, h, d, gridSize, frameRadius, frameMaterial, gridRadius, gridMaterial));
    group.add(createGridFacePanel('left', w, h, d, gridSize, frameRadius, frameMaterial, gridRadius, gridMaterial));
    group.add(createGridFacePanel('right', w, h, d, gridSize, frameRadius, frameMaterial, gridRadius, gridMaterial));

    const topCorners = [
        new THREE.Vector3(0, h, 0), new THREE.Vector3(w, h, 0),
        new THREE.Vector3(w, h, d), new THREE.Vector3(0, h, d)
    ];
    for (let i = 0; i < 4; i++) {
        group.add(createBar(topCorners[i], topCorners[(i + 1) % 4], frameRadius, frameMaterial));
    }

    function edge(x1, y1, z1, x2, y2, z2) {
        return createBar(new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x2, y2, z2), frameRadius, frameMaterial);
    }
    group.add(edge(0, 0, 0, 0, h, 0));
    group.add(edge(w, 0, 0, w, h, 0));
    group.add(edge(w, 0, d, w, h, d));
    group.add(edge(0, 0, d, 0, h, d));

    group.userData = { toolingType: 'standard-basket', isTooling: true };
    return group;
}

function createGridBasketTooling(w, h, d, extras = {}) {
    return createHoneycombBasketFrame(w, h, d);
}

function createMaterialTrayTooling(w, h, d, extras = {}) {
    const group = new THREE.Group();
    const baseThickness = 8;
    const trayMaterial = new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.45, metalness: 0.8, transparent: true, opacity: 0.7, depthWrite: true });
    const lipMaterial = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.5, metalness: 0.85, transparent: true, opacity: 0.75, depthWrite: true });
    const hexMaterial = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.55, metalness: 0.7, transparent: true, opacity: 0.6, depthWrite: true });

    const bottomGeo = new THREE.BoxGeometry(w, baseThickness, d);
    const bottomMesh = new THREE.Mesh(bottomGeo, trayMaterial);
    bottomMesh.position.set(w / 2, baseThickness / 2, d / 2);
    group.add(bottomMesh);
    group.add(createHoneycombPanel('bottom', w, baseThickness, d, hexMaterial));

    const lipRadius = 4;
    group.add(createBar(new THREE.Vector3(0, baseThickness, d), new THREE.Vector3(w, baseThickness, d), lipRadius, lipMaterial));
    group.add(createBar(new THREE.Vector3(0, baseThickness, 0), new THREE.Vector3(w, baseThickness, 0), lipRadius, lipMaterial));
    group.add(createBar(new THREE.Vector3(0, baseThickness, 0), new THREE.Vector3(0, baseThickness, d), lipRadius, lipMaterial));
    group.add(createBar(new THREE.Vector3(w, baseThickness, 0), new THREE.Vector3(w, baseThickness, d), lipRadius, lipMaterial));

    const baseFrameR = 3;
    group.add(createBar(new THREE.Vector3(0, 0, 0), new THREE.Vector3(w, 0, 0), baseFrameR, lipMaterial));
    group.add(createBar(new THREE.Vector3(w, 0, 0), new THREE.Vector3(w, 0, d), baseFrameR, lipMaterial));
    group.add(createBar(new THREE.Vector3(w, 0, d), new THREE.Vector3(0, 0, d), baseFrameR, lipMaterial));
    group.add(createBar(new THREE.Vector3(0, 0, d), new THREE.Vector3(0, 0, 0), baseFrameR, lipMaterial));

    group.userData = { toolingType: 'material-tray', isTooling: true };
    return group;
}

function createSpecialJigTooling(w, h, d, extras = {}) {
    const group = new THREE.Group();
    const frameRadius = 5;
    const rodDiameter = extras.rodDiameter || 10;
    const rodRadius = rodDiameter / 2;
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.5, metalness: 0.85, transparent: true, opacity: 0.75, depthWrite: true });
    const rodMaterial = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.45, metalness: 0.8, transparent: true, opacity: 0.7, depthWrite: true });
    const hexMaterial = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.55, metalness: 0.7, transparent: true, opacity: 0.6, depthWrite: true });

    function edge(x1, y1, z1, x2, y2, z2) {
        return createBar(new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x2, y2, z2), frameRadius, frameMaterial);
    }
    group.add(edge(0, 0, 0, w, 0, 0));
    group.add(edge(w, 0, 0, w, 0, d));
    group.add(edge(w, 0, d, 0, 0, d));
    group.add(edge(0, 0, d, 0, 0, 0));
    group.add(edge(0, h, 0, w, h, 0));
    group.add(edge(w, h, 0, w, h, d));
    group.add(edge(w, h, d, 0, h, d));
    group.add(edge(0, h, d, 0, h, 0));
    group.add(edge(0, 0, 0, 0, h, 0));
    group.add(edge(w, 0, 0, w, h, 0));
    group.add(edge(w, 0, d, w, h, d));
    group.add(edge(0, 0, d, 0, h, d));
    group.add(createHoneycombPanel('bottom', w, h, d, hexMaterial));

    const rodPositions = [
        { x: w * 0.25, z: d * 0.25 }, { x: w * 0.5, z: d * 0.25 }, { x: w * 0.75, z: d * 0.25 },
        { x: w * 0.25, z: d * 0.5  }, { x: w * 0.75, z: d * 0.5  },
        { x: w * 0.25, z: d * 0.75 }, { x: w * 0.5, z: d * 0.75 }, { x: w * 0.75, z: d * 0.75 }
    ];
    rodPositions.forEach(pos => {
        const rodGeo = new THREE.CylinderGeometry(rodRadius, rodRadius, h, 16);
        const rodMesh = new THREE.Mesh(rodGeo, rodMaterial);
        rodMesh.position.set(pos.x, h / 2, pos.z);
        group.add(rodMesh);
    });

    group.userData = { toolingType: 'special-jig', isTooling: true };
    return group;
}

function createRingToolingTooling(w, h, d, extras = {}) {
    const group = new THREE.Group();
    const centerX = w / 2;
    const centerZ = d / 2;
    const outerRadius = Math.min(w, d) / 2 - 30;
    const tubeRadius = 8;
    const rodDiameter = extras.rodDiameter || 40;
    const rodRadius = rodDiameter / 2;
    const discCount = extras.ringCount || 3;

    const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.5, metalness: 0.75, transparent: true, opacity: 0.7, depthWrite: true });
    const rodMaterial = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.45, metalness: 0.8, transparent: true, opacity: 0.7, depthWrite: true });
    const hexMaterial = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.55, metalness: 0.7, transparent: true, opacity: 0.6, depthWrite: true });

    const hexGeo = getHollowHexagonGeometry();
    const outerR = HEX_OUTER_RADIUS;
    const colSpacing = (outerR * 2) * 0.75;
    const rowSpacing = outerR * Math.sqrt(3);

    const safetyMargin = outerR + 5;
    const availSize = outerRadius * 2 - 2 * safetyMargin;
    let cols = Math.floor(availSize / colSpacing) + 1;
    let rows = Math.floor((availSize - (cols > 1 ? rowSpacing / 2 : 0)) / rowSpacing) + 1;
    cols = Math.max(1, cols); rows = Math.max(1, rows);
    const totalGridW = (cols - 1) * colSpacing;
    const totalGridH = (rows - 1) * rowSpacing + (cols > 1 ? rowSpacing / 2 : 0);

    const hexMesh = new THREE.InstancedMesh(hexGeo.clone(), hexMaterial, cols * rows);
    const dummy = new THREE.Object3D();
    let idx = 0;
    const clipRadius = outerRadius - safetyMargin;
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const u = -totalGridW / 2 + col * colSpacing;
            const v = -totalGridH / 2 + row * rowSpacing + (col % 2) * rowSpacing / 2;
            if (Math.hypot(u, v) > clipRadius) continue;
            dummy.position.set(centerX + u, 0, centerZ + v);
            dummy.rotation.set(-Math.PI / 2, 0, 0);
            dummy.updateMatrix();
            hexMesh.setMatrixAt(idx++, dummy.matrix);
        }
    }
    hexMesh.count = idx;
    group.add(hexMesh);

    const rodGeo = new THREE.CylinderGeometry(rodRadius, rodRadius, h, 16);
    const rodMesh = new THREE.Mesh(rodGeo, rodMaterial);
    rodMesh.position.set(centerX, h / 2, centerZ);
    group.add(rodMesh);

    for (let i = 0; i < discCount; i++) {
        const discY = h * (i + 1) / (discCount + 1);
        const discHexMesh = new THREE.InstancedMesh(hexGeo.clone(), hexMaterial, cols * rows);
        let discIdx = 0;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const u = -totalGridW / 2 + col * colSpacing;
                const v = -totalGridH / 2 + row * rowSpacing + (col % 2) * rowSpacing / 2;
                if (Math.hypot(u, v) > clipRadius) continue;
                dummy.position.set(centerX + u, discY, centerZ + v);
                dummy.rotation.set(-Math.PI / 2, 0, 0);
                dummy.updateMatrix();
                discHexMesh.setMatrixAt(discIdx++, dummy.matrix);
            }
        }
        discHexMesh.count = discIdx;
        group.add(discHexMesh);
        const outerRing = new THREE.Mesh(new THREE.TorusGeometry(outerRadius, tubeRadius, 16, 64), ringMaterial);
        outerRing.position.set(centerX, discY, centerZ);
        outerRing.rotation.x = Math.PI / 2;
        group.add(outerRing);
    }

    const bottomRing = new THREE.Mesh(new THREE.TorusGeometry(outerRadius, 3, 8, 64), ringMaterial);
    bottomRing.position.set(centerX, 5, centerZ);
    bottomRing.rotation.x = Math.PI / 2;
    group.add(bottomRing);

    // group.userData = { toolingType: 'ring-tooling', isTooling: true };
    // 收集圆盘搁板信息
    const shelves = [];
    // 底部圆盘（Y=0）也视为一个搁板
    shelves.push({ y: 0, thickness: 5, radius: outerRadius });
    for (let i = 0; i < discCount; i++) {
        const discY = h * (i + 1) / (discCount + 1);
        shelves.push({ y: discY, thickness: 5, radius: outerRadius });
    }
    group.userData = {
        toolingType: 'ring-tooling',
        isTooling: true,
        radialRadius: outerRadius,      // 有效半径
        shelves: shelves,               // 内置搁板列表
        useInternalShelves: true        // 标记使用内置搁板
    };
    return group;
}

function createMeshBasketTooling(w, h, d, extras = {}) {
    const group = createHoneycombBasketFrame(w, h, d);
    group.userData = { toolingType: 'mesh-basket', isTooling: true };
    return group;
}

function createHangerTooling(w, h, d, extras = {}) {
    const group = new THREE.Group();
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x886644, roughness: 0.5, metalness: 0.7, transparent: true, opacity: 0.6 });
    const hookMaterial = new THREE.MeshStandardMaterial({ color: 0x665533, roughness: 0.55, metalness: 0.75, transparent: true, opacity: 0.5 });
    const hexMaterial = new THREE.MeshStandardMaterial({ color: 0x887766, roughness: 0.55, metalness: 0.65, transparent: true, opacity: 0.5, depthWrite: true });

    group.add(createBar(new THREE.Vector3(0, h, d / 2), new THREE.Vector3(w, h, d / 2), 6, frameMaterial));
    group.add(createBar(new THREE.Vector3(0, 0, d / 2), new THREE.Vector3(w, 0, d / 2), 6, frameMaterial));
    const hookSpacing = extras.hookSpacing || 80;
    for (let x = hookSpacing; x < w; x += hookSpacing) {
        group.add(createBar(new THREE.Vector3(x, h, d / 2), new THREE.Vector3(x, 0, d / 2), 3, hookMaterial));
    }
    group.add(createHoneycombPanel('bottom', w, h, d, hexMaterial));
    group.userData = { toolingType: 'hanger', isTooling: true };
    return group;
}

function createStackedBasket(type, w, h, d, count, extras = {}) {
    const group = new THREE.Group();
    const layers = Math.min(Math.max(1, count), 6);
    const createSingle = () => createHoneycombBasketFrame(w, h, d);
    for (let i = 0; i < layers; i++) {
        const basket = createSingle();
        basket.position.y = i * h;
        group.add(basket);
    }
    group.userData = { toolingType: type, isTooling: true, stacked: true, layerCount: layers, singleHeight: h, totalHeight: layers * h };
    return group;
}

/**
 * 工装空壳模型工厂方法 — 根据工装类型创建空工装 3D 模型
 * @param {string} type - 工装类型标识符
 * @param {number} width - 宽度 (mm)
 * @param {number} height - 高度 (mm)
 * @param {number} depth - 深度 (mm)
 * @param {Object} [extras={}] - 工装专属参数
 * @returns {THREE.Group}
 */
export function createEmptyTooling(type, width, height, depth, extras = {}) {
    switch (type) {
        case 'standard-basket':
            return createStandardBasketTooling(width, height, depth, extras);
        case 'grid-basket':
            if (extras.basketCount && extras.basketCount > 1) return createStackedBasket(type, width, height, depth, extras.basketCount, extras);
            return createGridBasketTooling(width, height, depth, extras);
        case 'mesh-basket':
            if (extras.basketCount && extras.basketCount > 1) return createStackedBasket(type, width, height, depth, extras.basketCount, extras);
            return createGridBasketTooling(width, height, depth, extras);
        case 'material-tray':
            return createMaterialTrayTooling(width, height, depth, extras);
        case 'special-jig':
            return createSpecialJigTooling(width, height, depth, extras);
        case 'ring-tooling':
            return createRingToolingTooling(width, height, depth, extras);
        case 'hanger':
            return createHangerTooling(width, height, depth, extras);
        default:
            console.warn(`[createEmptyTooling] 未知工装类型 "${type}"，回退到标准料框`);
            return createStandardBasketTooling(width, height, depth, extras);
    }
}