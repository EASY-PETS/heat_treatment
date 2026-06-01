/**
 * basket-model.js - 料框（篮筐）三维建模模块
 * 
 * 功能：
 *   生成真实热处理料框的三维网格模型
 *   替代原有的简单透明Box，提供更真实的工业视觉效果
 * 
 * 特点：
 *   - 100mm × 100mm 网格结构
 *   - 五面封闭（底部+四周），顶部开放
 *   - 粗钢筋边框 + 细钢筋网格
 *   - 深灰色金属材质，半透明
 */

import * as THREE from 'three';

/**
 * 创建料框网格模型
 * 
 * @param {number} width - 料框宽度（X方向，mm）
 * @param {number} height - 料框高度（Y方向，mm）
 * @param {number} depth - 料框深度（Z方向，mm）
 * @param {number} baseY - 基准Y坐标（通常为-120）
 * @returns {THREE.Group} 料框模型组
 */
export function createBasketModel(width, height, depth, baseY = -120) {
    const basketGroup = new THREE.Group();
    basketGroup.userData = { isBasket: true };

    // 网格尺寸：100mm × 100mm
    const gridSize = 100;
    
    // 钢筋粗细
    const frameBarRadius = 3;  // 边框粗钢筋半径
    const gridBarRadius = 1.5; // 网格细钢筋半径
    
    // 材质：深灰色金属
    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a4a4a,
        transparent: true,
        opacity: 0.6,
        roughness: 0.7,
        metalness: 0.5,
        side: THREE.DoubleSide
    });
    
    const gridMaterial = new THREE.MeshStandardMaterial({
        color: 0x5a5a5a,
        transparent: true,
        opacity: 0.5,
        roughness: 0.6,
        metalness: 0.4,
        side: THREE.DoubleSide
    });

    // ==================== 边框（粗钢筋） ====================
    
    /**
     * 创建圆柱形钢筋
     */
    function createBar(length, radius, material) {
        const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
        return new THREE.Mesh(geometry, material);
    }

    // 底部边框（4根）
    const bottomFrontBar = createBar(width, frameBarRadius, frameMaterial);
    bottomFrontBar.rotation.z = Math.PI / 2;
    bottomFrontBar.position.set(0, baseY, depth / 2);
    basketGroup.add(bottomFrontBar);

    const bottomBackBar = createBar(width, frameBarRadius, frameMaterial);
    bottomBackBar.rotation.z = Math.PI / 2;
    bottomBackBar.position.set(0, baseY, -depth / 2);
    basketGroup.add(bottomBackBar);

    const bottomLeftBar = createBar(depth, frameBarRadius, frameMaterial);
    bottomLeftBar.rotation.x = Math.PI / 2;
    bottomLeftBar.position.set(-width / 2, baseY, 0);
    basketGroup.add(bottomLeftBar);

    const bottomRightBar = createBar(depth, frameBarRadius, frameMaterial);
    bottomRightBar.rotation.x = Math.PI / 2;
    bottomRightBar.position.set(width / 2, baseY, 0);
    basketGroup.add(bottomRightBar);

    // 顶部边框（4根）
    const topFrontBar = createBar(width, frameBarRadius, frameMaterial);
    topFrontBar.rotation.z = Math.PI / 2;
    topFrontBar.position.set(0, baseY + height, depth / 2);
    basketGroup.add(topFrontBar);

    const topBackBar = createBar(width, frameBarRadius, frameMaterial);
    topBackBar.rotation.z = Math.PI / 2;
    topBackBar.position.set(0, baseY + height, -depth / 2);
    basketGroup.add(topBackBar);

    const topLeftBar = createBar(depth, frameBarRadius, frameMaterial);
    topLeftBar.rotation.x = Math.PI / 2;
    topLeftBar.position.set(-width / 2, baseY + height, 0);
    basketGroup.add(topLeftBar);

    const topRightBar = createBar(depth, frameBarRadius, frameMaterial);
    topRightBar.rotation.x = Math.PI / 2;
    topRightBar.position.set(width / 2, baseY + height, 0);
    basketGroup.add(topRightBar);

    // 垂直边框（4根）
    const verticalFL = createBar(height, frameBarRadius, frameMaterial);
    verticalFL.position.set(-width / 2, baseY + height / 2, depth / 2);
    basketGroup.add(verticalFL);

    const verticalFR = createBar(height, frameBarRadius, frameMaterial);
    verticalFR.position.set(width / 2, baseY + height / 2, depth / 2);
    basketGroup.add(verticalFR);

    const verticalBL = createBar(height, frameBarRadius, frameMaterial);
    verticalBL.position.set(-width / 2, baseY + height / 2, -depth / 2);
    basketGroup.add(verticalBL);

    const verticalBR = createBar(height, frameBarRadius, frameMaterial);
    verticalBR.position.set(width / 2, baseY + height / 2, -depth / 2);
    basketGroup.add(verticalBR);

    // ==================== 底面网格 ====================
    
    // X方向网格线（沿宽度方向）
    const numGridX = Math.floor(width / gridSize);
    for (let i = 1; i < numGridX; i++) {
        const x = -width / 2 + i * gridSize;
        const bar = createBar(depth, gridBarRadius, gridMaterial);
        bar.rotation.x = Math.PI / 2;
        bar.position.set(x, baseY, 0);
        basketGroup.add(bar);
    }

    // Z方向网格线（沿深度方向）
    const numGridZ = Math.floor(depth / gridSize);
    for (let i = 1; i < numGridZ; i++) {
        const z = -depth / 2 + i * gridSize;
        const bar = createBar(width, gridBarRadius, gridMaterial);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0, baseY, z);
        basketGroup.add(bar);
    }

    // ==================== 四周侧壁网格 ====================
    
    // 前侧壁（Z = depth/2）
    const numGridYFront = Math.floor(height / gridSize);
    for (let i = 1; i < numGridYFront; i++) {
        const y = baseY + i * gridSize;
        const bar = createBar(width, gridBarRadius, gridMaterial);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0, y, depth / 2);
        basketGroup.add(bar);
    }

    // 后侧壁（Z = -depth/2）
    for (let i = 1; i < numGridYFront; i++) {
        const y = baseY + i * gridSize;
        const bar = createBar(width, gridBarRadius, gridMaterial);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0, y, -depth / 2);
        basketGroup.add(bar);
    }

    // 左侧壁（X = -width/2）
    for (let i = 1; i < numGridYFront; i++) {
        const y = baseY + i * gridSize;
        const bar = createBar(depth, gridBarRadius, gridMaterial);
        bar.rotation.x = Math.PI / 2;
        bar.position.set(-width / 2, y, 0);
        basketGroup.add(bar);
    }

    // 右侧壁（X = width/2）
    for (let i = 1; i < numGridYFront; i++) {
        const y = baseY + i * gridSize;
        const bar = createBar(depth, gridBarRadius, gridMaterial);
        bar.rotation.x = Math.PI / 2;
        bar.position.set(width / 2, y, 0);
        basketGroup.add(bar);
    }

    // 前侧壁垂直网格线
    for (let i = 1; i < numGridX; i++) {
        const x = -width / 2 + i * gridSize;
        const bar = createBar(height, gridBarRadius, gridMaterial);
        bar.position.set(x, baseY + height / 2, depth / 2);
        basketGroup.add(bar);
    }

    // 后侧壁垂直网格线
    for (let i = 1; i < numGridX; i++) {
        const x = -width / 2 + i * gridSize;
        const bar = createBar(height, gridBarRadius, gridMaterial);
        bar.position.set(x, baseY + height / 2, -depth / 2);
        basketGroup.add(bar);
    }

    // 左侧壁垂直网格线
    for (let i = 1; i < numGridZ; i++) {
        const z = -depth / 2 + i * gridSize;
        const bar = createBar(height, gridBarRadius, gridMaterial);
        bar.position.set(-width / 2, baseY + height / 2, z);
        basketGroup.add(bar);
    }

    // 右侧壁垂直网格线
    for (let i = 1; i < numGridZ; i++) {
        const z = -depth / 2 + i * gridSize;
        const bar = createBar(height, gridBarRadius, gridMaterial);
        bar.position.set(width / 2, baseY + height / 2, z);
        basketGroup.add(bar);
    }

    return basketGroup;
}

/**
 * 创建搁板网格模型（与料框相同的网格体系）
 * 
 * @param {number} width - 搁板宽度（mm）
 * @param {number} depth - 搁板深度（mm）
 * @param {number} thickness - 搁板厚度（mm）
 * @param {number} yPosition - 搁板Y坐标位置
 * @returns {THREE.Group} 搁板模型组
 */
export function createShelfModel(width, depth, thickness, yPosition) {
    const shelfGroup = new THREE.Group();
    shelfGroup.userData = { isShelf: true, shelfY: yPosition };

    const gridSize = 100;
    const frameBarRadius = 2.5;
    const gridBarRadius = 1.2;

    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0xb4b4c8,
        transparent: true,
        opacity: 0.6,
        roughness: 0.6,
        metalness: 0.3,
        side: THREE.DoubleSide
    });

    const gridMaterial = new THREE.MeshStandardMaterial({
        color: 0xc4c4d8,
        transparent: true,
        opacity: 0.5,
        roughness: 0.5,
        metalness: 0.2,
        side: THREE.DoubleSide
    });

    function createBar(length, radius, material) {
        const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
        return new THREE.Mesh(geometry, material);
    }

    const centerY = yPosition + thickness / 2;

    // 边框（4根）
    const frontBar = createBar(width, frameBarRadius, frameMaterial);
    frontBar.rotation.z = Math.PI / 2;
    frontBar.position.set(0, centerY, depth / 2);
    shelfGroup.add(frontBar);

    const backBar = createBar(width, frameBarRadius, frameMaterial);
    backBar.rotation.z = Math.PI / 2;
    backBar.position.set(0, centerY, -depth / 2);
    shelfGroup.add(backBar);

    const leftBar = createBar(depth, frameBarRadius, frameMaterial);
    leftBar.rotation.x = Math.PI / 2;
    leftBar.position.set(-width / 2, centerY, 0);
    shelfGroup.add(leftBar);

    const rightBar = createBar(depth, frameBarRadius, frameMaterial);
    rightBar.rotation.x = Math.PI / 2;
    rightBar.position.set(width / 2, centerY, 0);
    shelfGroup.add(rightBar);

    // X方向网格线
    const numGridX = Math.floor(width / gridSize);
    for (let i = 1; i < numGridX; i++) {
        const x = -width / 2 + i * gridSize;
        const bar = createBar(depth, gridBarRadius, gridMaterial);
        bar.rotation.x = Math.PI / 2;
        bar.position.set(x, centerY, 0);
        shelfGroup.add(bar);
    }

    // Z方向网格线
    const numGridZ = Math.floor(depth / gridSize);
    for (let i = 1; i < numGridZ; i++) {
        const z = -depth / 2 + i * gridSize;
        const bar = createBar(width, gridBarRadius, gridMaterial);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0, centerY, z);
        shelfGroup.add(bar);
    }

    return shelfGroup;
}
