/**
 * geometry-utils.js - 通用几何工具函数
 *
 * 从 three-scene.js 和 furnace-engine.js 中提取，
 * 包含 createBar、中空六边形、圆环/连接臂几何体缓存、工件姿态优化等纯工具函数。
 *
 * Dependencies:
 *   - THREE.js (imported via importmap)
 */

import * as THREE from 'three';

// ==================== 六边形几何参数 ====================

/** 六边形几何参数 */
export const HEX_OUTER_RADIUS = 25;  // 外径 25mm（直径 50mm）
export const HEX_BORDER_WIDTH = 4;   // 边框宽度 4mm

// ==================== 圆环节点几何参数 ====================

/** 圆环节点几何参数 */
export const RING_OUTER_RADIUS = 18;     // 圆环外径 mm（直径 36mm）
export const RING_TUBE_RADIUS = 3;       // 圆环管径 mm（管壁粗细）
export const ARM_RADIUS = 2.5;           // 连接臂半径 mm
export const ARM_LENGTH = 35;            // 连接臂半长（从环心到臂端点）mm
export const RING_NODE_SPACING = (RING_OUTER_RADIUS + ARM_LENGTH) * 2; // 单元间距 ≈ 106mm
export const RING_NODE_HALF_SPACE = RING_OUTER_RADIUS + ARM_LENGTH;    // 半间距 ≈ 53mm

// ==================== HELPER: CREATE BAR (CYLINDER ROD) ====================

/**
 * 创建圆柱形钢筋线段 — 用于料框网格建模和搁板建模的通用工具
 * @param {THREE.Vector3} start - 起点
 * @param {THREE.Vector3} end - 终点
 * @param {number} radius - 半径
 * @param {THREE.Material} material - 材质
 * @returns {THREE.Mesh} 圆柱钢筋mesh
 */
export function createBar(start, end, radius, material) {
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

// ==================== HOLLOW HEXAGON GEOMETRY ====================

/**
 * 创建中空六边形边框几何体 — 供 InstancedMesh 复用
 * 外六边形 + 内六边形孔洞 = 边框效果
 *
 * @param {number} outerRadius - 外六边形半径（顶点到中心）
 * @param {number} innerRadius - 内六边形半径
 * @returns {THREE.ShapeGeometry}
 */
export function createHollowHexagonGeometry(outerRadius, innerRadius) {
    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 6 + i * Math.PI / 3;
        const x = outerRadius * Math.cos(angle);
        const y = outerRadius * Math.sin(angle);
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }
    shape.closePath();

    if (innerRadius > 0) {
        const hole = new THREE.Path();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 6 + i * Math.PI / 3;
            const x = innerRadius * Math.cos(angle);
            const y = innerRadius * Math.sin(angle);
            if (i === 0) hole.moveTo(x, y);
            else hole.lineTo(x, y);
        }
        hole.closePath();
        shape.holes.push(hole);
    }

    return new THREE.ShapeGeometry(shape, 1);
}

/** 缓存中空六边形几何体（供料框复用） */
let cachedHexGeometry = null;
/**
 * 获取缓存的中空六边形几何体，如果不存在则创建。
 * @returns {THREE.ShapeGeometry}
 */
export function getHollowHexagonGeometry() {
    if (!cachedHexGeometry) {
        cachedHexGeometry = createHollowHexagonGeometry(HEX_OUTER_RADIUS, HEX_OUTER_RADIUS - HEX_BORDER_WIDTH);
    }
    return cachedHexGeometry;
}

// ==================== RING NODE GEOMETRY ====================

/** 缓存圆环几何体（Torus — 8 段径向 × 16 段周向，面数极低） */
let cachedRingGeometry = null;
/**
 * 获取缓存的圆环几何体，如果不存在则创建。
 * @returns {THREE.TorusGeometry}
 */
export function getRingGeometry() {
    if (!cachedRingGeometry) {
        cachedRingGeometry = new THREE.TorusGeometry(RING_OUTER_RADIUS, RING_TUBE_RADIUS, 8, 16);
    }
    return cachedRingGeometry;
}

/** 缓存连接臂几何体（Cylinder — 6 段，长度 = 2×ARM_LENGTH） */
let cachedArmGeometry = null;
/**
 * 获取缓存的连接臂几何体，如果不存在则创建。
 * @returns {THREE.CylinderGeometry}
 */
export function getArmGeometry() {
    if (!cachedArmGeometry) {
        cachedArmGeometry = new THREE.CylinderGeometry(ARM_RADIUS, ARM_RADIUS, ARM_LENGTH * 2, 6);
    }
    return cachedArmGeometry;
}

// ==================== 摆放姿态优化 ====================

/**
 * 为工件计算最佳摆放姿态。
 * 原则：
 *   - 长方体：最小面积面朝下
 *   - 圆柱体：根据高径比决策
 *     * 细长圆柱（h > d）：保持直立（底面为圆，高度不变）
 *     * 扁平圆盘（d >= h）：侧放（交换高度与直径），使圆盘边缘（线接触）搁板
 *
 * @param {Object} item - { shape, w, d, h }
 * @param {boolean} allowOptimization - 是否启用姿态优化
 * @param {number} [discFlipRatio=1.0] - 圆盘翻转比率阈值（圆柱高度/直径 < 此值则侧放）
 * @returns {{ w: number, d: number, h: number, rotationInfo: string, needsRotation: boolean }}
 */
export function optimizePosture(item, allowOptimization, discFlipRatio = 1.0) {
    if (!allowOptimization) {
        return { w: item.w, d: item.d, h: item.h, rotationInfo: '保持原姿态', needsRotation: false };
    }

    // 圆柱体特殊处理
    if (item.shape === 'cylinder') {
        const diameter = item.w;   // w = d = 直径
        const height = item.h;
        const ratio = discFlipRatio;
        if (height / diameter >= ratio) {
            // 细长圆柱（或未达翻转阈值），保持直立
            return { w: diameter, d: diameter, h: height, rotationInfo: '圆柱保持直立（底面圆）', needsRotation: false };
        } else {
            // 扁平圆盘，侧放：交换直径和高度 → 新高度 = 原直径，新底面 = 厚度×直径
            // 修正：侧放后 d 应为 diameter（几何体沿Z方向物理占据），避免碰撞检测误判导致重叠
            return { w: height, d: diameter, h: diameter, rotationInfo: '圆盘侧放（边缘线接触搁板）', needsRotation: true };
        }
    }

    // 长方体：最小面积面朝下
    const dims = [
        { label: 'L', value: item.w },
        { label: 'W', value: item.d },
        { label: 'H', value: item.h }
    ];
    dims.sort((a, b) => a.value - b.value);
    const newW = dims[0].value;
    const newD = dims[1].value;
    const newH = dims[2].value;
    const rotationInfo = `底面: ${newW}×${newD}mm, 高度: ${newH}mm（最小面积面朝下）`;
    return { w: newW, d: newD, h: newH, rotationInfo, needsRotation: false };
}