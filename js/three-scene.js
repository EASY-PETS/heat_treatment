/**
 * three-scene.js - All Three.js Related Code (V2.3)
 *
 * V2.3 Updates:
 *   - Task: 托盘式搁板料框（Tray Basket）3D模型
 *   - Task: 每个炉膛独立 basketType 参数
 *   - Task: 标尺系统修复 — 原点(0,0,0)为基础，向正方向延伸
 *   - Task: 炉膛沿X轴排列，第1台 X=0，后续依次偏移
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
    itemsGroup,
    globalFurnacesResult, shelfMeshes, globalUnpackedItems,
    isAnimating, animPaused, animStopped,
    currentFurnaceIndex, selectedFurnaceCardId, selectedMaterialCardId,
    originalOpacityStore, opacityResetTimerId,
    placementRules,
    currentBasketType, displaySettings,
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
 *
 * 生成纯色蜂窝图案,每条六边形边长约 100mm（按100px/pixel的虚拟比例）。
 * Canvas 尺寸 256×256，供一个料框侧面使用。
 *
 * @returns {HTMLCanvasElement} 蜂窝纹理canvas
 */
function createHoneycombTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 浅灰背景（模拟镂空部分 — 透明/空心）
    ctx.fillStyle = 'rgba(200, 200, 210, 0.15)';
    ctx.fillRect(0, 0, size, size);

    // 蜂窝参数
    const hexRadius = 30;
    const hexHeight = hexRadius * Math.sqrt(3);
    const hexWidth = hexRadius * 2;

    // 深灰色六边形线条绘制（代表金属框架）
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

/**
 * 创建普通网格料框 — 钢筋网格焊接结构
 * 五面封闭（底部+四周），顶部开口
 *
 * V2.3: 保持不变，仍为默认料框类型
 */
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

        // 边框
        const corners = [
            origin.clone(),
            origin.clone().add(dirU.clone().multiplyScalar(lenU)),
            origin.clone().add(dirU.clone().multiplyScalar(lenU)).add(dirV.clone().multiplyScalar(lenV)),
            origin.clone().add(dirV.clone().multiplyScalar(lenV))
        ];
        for (let i = 0; i < 4; i++) {
            faceGroup.add(createBar(corners[i], corners[(i + 1) % 4], frameRadius, frameMaterial));
        }

        // 网格线
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

    // 顶部边框
    const topCorners = [
        new THREE.Vector3(0, h, 0), new THREE.Vector3(w, h, 0),
        new THREE.Vector3(w, h, d), new THREE.Vector3(0, h, d)
    ];
    for (let i = 0; i < 4; i++) {
        group.add(createBar(topCorners[i], topCorners[(i + 1) % 4], frameRadius, frameMaterial));
    }

    // 四角立柱
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

/**
 * 创建蜂窝料框（Honeycomb Basket）— V2.2
 *
 * 使用纹理 + 半透明面板实现蜂窝镂空视觉效果，避免大量几何体导致性能问题。
 *
 * 结构特点：
 *   - 底部 + 四个侧面 = 5个面（顶部开口）
 *   - 每个面由纹理alpha map + 粗钢筋边框组成
 *   - 侧面为半透明面板贴六边形蜂窝纹理
 *   - 底部保留钢筋网格（承重）
 *
 * V2.3: 保持不变
 */
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

    // 5个蜂窝面板：底 + 前 + 后 + 左 + 右
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

    // 底部边框
    group.add(createEdgeBar(0, 0, 0, w, 0, 0));
    group.add(createEdgeBar(w, 0, 0, w, 0, d));
    group.add(createEdgeBar(w, 0, d, 0, 0, d));
    group.add(createEdgeBar(0, 0, d, 0, 0, 0));

    // 顶部边框
    group.add(createEdgeBar(0, h, 0, w, h, 0));
    group.add(createEdgeBar(w, h, 0, w, h, d));
    group.add(createEdgeBar(w, h, d, 0, h, d));
    group.add(createEdgeBar(0, h, d, 0, h, 0));

    // 四角立柱
    group.add(createEdgeBar(0, 0, 0, 0, h, 0));
    group.add(createEdgeBar(w, 0, 0, w, h, 0));
    group.add(createEdgeBar(w, 0, d, w, h, d));
    group.add(createEdgeBar(0, 0, d, 0, h, d));

    group.userData = { isBasketFrame: true, basketType: 'honeycomb' };
    return group;
}

/**
 * V2.3: 创建托盘式搁板料框（Tray Basket）— 新增
 *
 * 实际热处理现场常用于齿轮、模具、法兰、圆环件、大尺寸工件的摆放。
 *
 * 结构特点：
 *   - 无四周围栏（与网格料框的区别）
 *   - 底部实心搁板（钢板面板）
 *   - 底部下方 10 个支撑梁均匀排列
 *   - 支撑块高度 50mm，宽度=炉宽，深度=炉深/10
 *
 * 3D表现：
 *   底板（半透明面板）
 *   +
 *   10个支撑梁（圆柱形钢筋）
 *   形成托盘结构
 *
 * @param {number} w - 料框宽度 (mm)
 * @param {number} h - 料框高度 (mm)
 * @param {number} d - 料框深度 (mm)
 * @returns {THREE.Group} 托盘式料框模型组
 */
function createTrayBasketFrame(w, h, d) {
    const group = new THREE.Group();

    const supportHeight = 50;        // 支撑块高度 50mm
    const supportCount = 10;        // 10个支撑梁
    const supportSpacing = d / supportCount;  // 均匀排列间距
    const frameRadius = 4;          // 钢筋半径

    // 底部搁板材质 — 半透明钢板
    const trayMaterial = new THREE.MeshStandardMaterial({
        color: 0x667788,
        roughness: 0.45,
        metalness: 0.8,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    // 支撑梁材质
    const supportMaterial = new THREE.MeshStandardMaterial({
        color: 0x445566,
        roughness: 0.5,
        metalness: 0.85,
        transparent: true,
        opacity: 0.75,
        depthWrite: false
    });

    // 边框材质（仅底部四周框架，无围栏）
    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x556677,
        roughness: 0.5,
        metalness: 0.85,
        transparent: true,
        opacity: 0.8,
        depthWrite: false
    });

    /**
     * 1. 底部实心搁板面板
     *   位置在支撑块上方 supportHeight 处
     */
    const bottomPanelGeo = new THREE.PlaneGeometry(w, d);
    const bottomPanel = new THREE.Mesh(bottomPanelGeo, trayMaterial.clone());
    bottomPanel.rotation.x = -Math.PI / 2;
    bottomPanel.position.set(w / 2, supportHeight, d / 2);
    group.add(bottomPanel);

    /**
     * 2. 10个支撑梁均匀排列
     *   每个支撑梁从 Y=0 到 Y=supportHeight
     *   沿 Z 方向均匀分布
     */
    for (let i = 0; i < supportCount; i++) {
        const zCenter = supportSpacing * (i + 0.5);  // 支撑梁中心 Z 坐标
        const start = new THREE.Vector3(0, 0, zCenter);
        const end = new THREE.Vector3(0, supportHeight, zCenter);
        // 沿X方向延伸到炉膛宽度 — 用 createBar 从(0, 0, zCenter)到(w, 0, zCenter)表示水平支撑梁
        const startH = new THREE.Vector3(0, supportHeight * 0.3, zCenter);
        const endH = new THREE.Vector3(w, supportHeight * 0.3, zCenter);
        group.add(createBar(startH, endH, frameRadius, supportMaterial));
    }

    /**
     * 3. 底部四周边框（无围栏，仅底部框架）
     */
    function createEdgeBar(x1, y1, z1, x2, y2, z2) {
        return createBar(
            new THREE.Vector3(x1, y1, z1),
            new THREE.Vector3(x2, y2, z2),
            frameRadius, frameMaterial
        );
    }

    // 底部框架（Y = 0 高度位置作为地面）
    const baseY = 0;
    group.add(createEdgeBar(0, baseY, 0, w, baseY, 0));
    group.add(createEdgeBar(w, baseY, 0, w, baseY, d));
    group.add(createEdgeBar(w, baseY, d, 0, baseY, d));
    group.add(createEdgeBar(0, baseY, d, 0, baseY, 0));

    /**
     * 4. 标记料框类型元数据
     */
    group.userData = { isBasketFrame: true, basketType: 'tray' };
    return group;
}

/**
 * 创建实心料框 — 简单Box线框表示
 * V2.3: 保持不变
 */
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
 * V2.3: 统一料框创建入口 — 根据 basketType 参数选择对应类型
 *
 * 不再读取全局 currentBasketType，而是接收每个炉膛独立的 basketType。
 * 这实现了"每个炉膛独立配置料框类型"的需求。
 *
 * @param {number} w - 宽度 (mm)
 * @param {number} h - 高度 (mm)
 * @param {number} d - 深度 (mm)
 * @param {number} gridSize - 网格尺寸（仅 grid 类型使用）
 * @param {string} basketType - 料框类型 ('grid'|'honeycomb'|'tray'|'solid')
 * @returns {THREE.Group}
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

// ==================== SHELF GRID MESH ====================

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

    function createGridFace(width_, depth_, originX, originY, originZ) {
        const faceGroup = new THREE.Group();
        const origin = new THREE.Vector3(originX, originY, originZ);
        const dirU = new THREE.Vector3(1, 0, 0);
        const dirV = new THREE.Vector3(0, 0, 1);
        const lenU = width_, lenV = depth_;

        const corners = [origin.clone(),
            origin.clone().add(dirU.clone().multiplyScalar(lenU)),
            origin.clone().add(dirU.clone().multiplyScalar(lenU)).add(dirV.clone().multiplyScalar(lenV)),
            origin.clone().add(dirV.clone().multiplyScalar(lenV))];
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

    group.add(createGridFace(w, d, 0, 0, 0));
    group.add(createGridFace(w, d, 0, thickness, 0));

    const mat = frameMaterial;
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

export function renderShelvesForFurnace(furnace, baseY) {
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

    shelfYs.forEach(shelfY => {
        if (shelfY + shelfThickness > fh) {
            console.warn('[搁板渲染] 搁板高度 ' + shelfY + 'mm 超出炉膛总高度 ' + fh + 'mm，已跳过');
            return;
        }

        const shelfGroup = createShelfGridMesh(fw, fd, shelfThickness, 100);
        const shelfCenterY = shelfY + shelfThickness / 2 + baseY;
        shelfGroup.position.set(0, shelfCenterY, 0);
        shelfGroup.userData = { isShelfMesh: true, shelfY: shelfY, thickness: shelfThickness };

        itemsGroup.add(shelfGroup);
        shelfMeshes.push(shelfGroup);
    });
}

// ==================== RULER / AXES SYSTEM (V2.3) ====================

/**
 * AxesGroup 引用 — 用于动态更新标尺/网格/坐标轴显示
 */
let mainSceneGridHelper = null;
let mainSceneAxesHelper = null;
let mainSceneRulerGroup = null;

function updateMainSceneDisplayVisibility() {
    if (mainSceneGridHelper) mainSceneGridHelper.visible = displaySettings.showGrid;
    if (mainSceneAxesHelper) mainSceneAxesHelper.visible = displaySettings.showAxes;
    if (mainSceneRulerGroup) mainSceneRulerGroup.visible = displaySettings.showRulers;
}

/**
 * V2.3: 修复标尺系统 — 从原点(0,0,0)开始，向正方向延伸
 *
 * 标尺规则：
 *   - 0mm 刻度从原点开始
 *   - 每 100mm 一个主刻度
 *   - 向 X/Y/Z 正方向延伸
 *
 * @param {number} maxRange - 标尺最大范围 (mm)
 */
function createRulerGroup(maxRange) {
    const group = new THREE.Group();
    const step = 100; // 每 100mm 一个刻度
    const range = maxRange || 4000;

    /**
     * V2.3: 原点定义
     * X=0, Y=-120(地面), Z=0 为场景参考原点
     * 标尺从该原点向正方向展开
     */
    const originY = -120;

    // X轴标尺（沿 X 轴，Z=0 平面，Y=originY）
    // 刻度值: 0, 100, 200, 300, ...
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
        // 标尺文字放在地面 Y 位置 + 偏移
        sprite.position.set(x, originY + 5, 20);
        sprite.scale.set(80, 40, 1);
        group.add(sprite);
    }

    // Z轴标尺（沿 Z 轴，X=0 平面，Y=originY）
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

    // Y轴标尺（向上，从 originY 开始）
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

// ==================== THREE.JS INITIALIZATION (V2.3) ====================

export function initThree() {
    const container = document.getElementById('canvas-container');
    const newScene = new THREE.Scene();
    newScene.background = new THREE.Color(0xf5f5f5);
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

    /* 光照 */
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

    /* V2.3: 地面网格 — 原点(0,-120,0)为中心，深色线条在白色背景上可见 */
    const gridHelper = new THREE.GridHelper(4000, 80, 0x333333, 0x555555);
    gridHelper.position.y = -120;
    newScene.add(gridHelper);

    /* V2.3: 坐标轴 — 从原点开始的深色坐标轴 */
    const customAxesGroup = new THREE.Group();
    const axesLen = 2000;
    const originY = -120;

    // X轴 - 深红
    const xLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, originY, 0), new THREE.Vector3(axesLen, originY, 0)
    ]);
    customAxesGroup.add(new THREE.Line(xLineGeo, new THREE.LineBasicMaterial({ color: 0xcc0000, linewidth: 1 })));

    // Y轴 - 深绿 (从地面向上)
    const yLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, originY, 0), new THREE.Vector3(0, axesLen + originY, 0)
    ]);
    customAxesGroup.add(new THREE.Line(yLineGeo, new THREE.LineBasicMaterial({ color: 0x006600, linewidth: 1 })));

    // Z轴 - 深蓝
    const zLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, originY, 0), new THREE.Vector3(0, originY, axesLen)
    ]);
    customAxesGroup.add(new THREE.Line(zLineGeo, new THREE.LineBasicMaterial({ color: 0x0000cc, linewidth: 1 })));

    newScene.add(customAxesGroup);

    /* V2.3: 标尺刻度组 — 从原点开始 */
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

// ==================== SCENE RENDERING (V2.3) ====================

/**
 * V2.3: 炉膛排列规则
 *
 * 基于原点(0,0,0)的 X 正向偏移排列多台炉膛：
 *   第1台炉 X=0
 *   第2台炉 X=炉宽1 + 200 (间距)
 *   第3台炉 X=炉宽1 + 炉宽2 + 400
 *
 * 每台炉膛在 Z 轴上居中对齐，Y 轴从地面(baseY)开始
 */

/**
 * 计算多个炉膛在 X 方向的累积偏移
 * @param {Array} furnaces - 炉膛结果数组
 * @param {number} index - 当前炉膛索引
 * @param {number} spacing - 炉膛间距 (mm)
 * @returns {number} X偏移量
 */
function computeFurnaceXOffset(furnaces, index, spacing) {
    const gap = spacing || 200;
    let offset = 0;
    for (let i = 0; i < index; i++) {
        offset += furnaces[i].w + gap;
    }
    return offset;
}

/**
 * V2.3: 渲染单个炉膛 — 支持独立 basketType
 *
 * 每台炉膛根据其 basketType 渲染不同样式的料框。
 * 料框类型从 furnace.basketType 读取，默认为 'grid'。
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

    /**
     * V2.3: 炉膛沿X轴排列
     * 第1台 X=0，后续依次增加偏移量
     * 偏移值从 furnace.xOffset 读取（由 executeAndRender 设置）
     */
    const xOffset = furnace.xOffset || 0;

    /**
     * V2.3: 使用每台炉膛独立的 basketType
     * 从 furnace.basketType 读取，若不存在则默认 'grid'
     */
    const basketType = furnace.basketType || 'grid';
    const basketGroup = createBasketFrame(furnace.w, furnace.h, furnace.d, 100, basketType);
    // 料框位置：X偏移 + 居中Z轴，底部对齐地面
    basketGroup.position.set(xOffset - furnace.w / 2, baseY, -furnace.d / 2);
    itemsGroup.add(basketGroup);

    // 蓝色外轮廓边框
    const containerGeo = new THREE.BoxGeometry(furnace.w, furnace.h, furnace.d);
    const containerEdges = new THREE.EdgesGeometry(containerGeo);
    const containerLine = new THREE.LineSegments(containerEdges,
        new THREE.LineBasicMaterial({ color: 0x0066cc, linewidth: 1, transparent: true, opacity: 0.5 }));
    containerLine.position.set(xOffset, furnace.h / 2 + baseY, 0);
    itemsGroup.add(containerLine);

    // 渲染工件
    furnace.packedItems.forEach(item => {
        const isFiltered = filterMaterialName && item.name !== filterMaterialName;
        let geometry;
        if (item.shape === 'cylinder') {
            geometry = new THREE.CylinderGeometry(item.w / 2, item.w / 2, item.h, 32);
        } else {
            geometry = new THREE.BoxGeometry(item.w, item.h, item.d);
        }

        const originalColor = new THREE.Color(item.color);
        const material = new THREE.MeshStandardMaterial({
            color: originalColor,
            transparent: true,
            opacity: isFiltered ? 0.12 : 0.85,
            roughness: 0.3, metalness: 0.2
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = {
            itemName: item.name,
            itemId: item.id,
            furnaceIndex: index,
            originalColor: item.color,
            itemMaterial: item.material || '',
            itemProcess: item.process || ''
        };
        const edgeMat = new THREE.LineBasicMaterial({ color: isFiltered ? 0xcccccc : 0x444444 });
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMat));
        mesh.position.set(
            xOffset + item.x - furnace.w / 2 + item.w / 2,
            item.y + item.h / 2 + baseY,
            item.z - furnace.d / 2 + item.d / 2
        );
        itemsGroup.add(mesh);
    });

    controls.target.set(xOffset, furnace.h / 2 + baseY, 0);
    camera.position.set(xOffset + furnace.w * 1.5, furnace.h * 1.8 + baseY, furnace.d * 2.5);
    controls.update();

    if (placementRules.useShelfLayered && furnace.packedItems.length > 0) {
        renderShelvesForFurnace(furnace, baseY);
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

    // 基础统计
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

let currentHighlightGroup = null;
const originalColorStore = new Map();

export function resetAllItemOpacityToOpaque() {
    if (!itemsGroup) return;

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

        if (originalColorStore.has(child)) {
            const stored = originalColorStore.get(child);
            if (stored.originalColorHex) {
                child.material.color.set(stored.originalColorHex);
            }
            originalColorStore.delete(child);
        } else if (child.userData && child.userData.originalColor) {
            child.material.color.set(child.userData.originalColor);
        }

        child.children.forEach(subChild => {
            if (subChild.isLineSegments && subChild.material && subChild.material.isLineBasicMaterial) {
                subChild.material.color = new THREE.Color(0x444444);
                subChild.material.linewidth = 1;
            }
        });

        if (child.material.emissive !== undefined) {
            child.material.emissive = new THREE.Color(0x000000);
            child.material.emissiveIntensity = 0;
        }
    });

    originalOpacityStore.clear();
}

export function highlightItemsInScene(cardId) {
    if (opacityResetTimerId) { clearTimeout(opacityResetTimerId); setOpacityResetTimerId(null); }

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

            if (!originalColorStore.has(child) && child.userData && child.userData.originalColor) {
                originalColorStore.set(child, { originalColorHex: child.userData.originalColor });
            }
            const origColor = (child.userData && child.userData.originalColor) ? child.userData.originalColor : '#' + child.material.color.getHexString();
            child.material.color.set(origColor);

            if (child.material.emissive !== undefined) {
                child.material.emissive = new THREE.Color(0xffffff);
                child.material.emissiveIntensity = 0.6;
            }
            child.material.transparent = true;
            child.material.opacity = 1.0;
            child.material.needsUpdate = true;

            child.children.forEach(subChild => {
                if (subChild.isLineSegments && subChild.material && subChild.material.isLineBasicMaterial) {
                    subChild.material.color = new THREE.Color(0xffffff);
                    subChild.material.linewidth = 3;
                }
            });

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
                    color: 0xffaa00,
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
            if (!originalColorStore.has(child) && child.userData && child.userData.originalColor) {
                originalColorStore.set(child, { originalColorHex: child.userData.originalColor });
            }

            const origTransparent = child.material.transparent;
            const origOpacity = child.material.opacity;
            originalOpacityStore.set(child, { transparent: origTransparent, opacity: origOpacity });

            child.material.transparent = true;
            child.material.opacity = 0.15;
            child.material.needsUpdate = true;

            child.children.forEach(subChild => {
                if (subChild.isLineSegments && subChild.material && subChild.material.isLineBasicMaterial) {
                    subChild.material.color = new THREE.Color(0xcccccc);
                }
            });

            if (child.material.emissive !== undefined) {
                child.material.emissive = new THREE.Color(0x000000);
                child.material.emissiveIntensity = 0;
            }
        }
    });

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

// ==================== IMPROVED ANIMATION (V2.2) ====================

/**
 * V2.2: 装料动画改进
 *
 * 工件生成于料框上方 → 缓慢下降 → 落入目标位置 → 完成摆放
 * 阶梯式启动：第一件 0.0s→0.5s，第二件 0.1s→0.6s，第三件 0.2s→0.7s
 * 形成流水式装料效果
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

    // V2.3: 动画中使用每台炉膛独立的 basketType
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
        const xOffset = furnace.xOffset || 0;
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

            // 目标位置（包含 xOffset）
            const targetX = xOffset + item.x - furnace.w / 2 + item.w / 2;
            const targetY = item.y + item.h / 2 + baseY;
            const targetZ = item.z - furnace.d / 2 + item.d / 2;

            // V2.2: 初始位置在料框上方高处
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

    // V2.3: 历史方案默认使用 'grid' 料框类型
    const basketGroup = createBasketFrame(fw, fh, fd, 100, 'grid');
    basketGroup.position.set(-fw / 2, -120, -fd / 2);
    masterScene.add(basketGroup);

    // 轮廓线
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