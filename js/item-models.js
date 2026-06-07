/**
 * item-models.js - 工件 3D 建模模块
 *
 * 从 three-scene.js 中提取工件 Mesh 创建逻辑，
 * 负责根据 item.shape 生成几何体、材质、边缘线，计算炉膛局部坐标系位置。
 *
 * Dependencies:
 *   - THREE.js (imported via importmap)
 */

import * as THREE from 'three';

/**
 * 创建工件 3D Mesh
 *
 * @param {Object} item - 工件数据 { id, shape, w, h, d, color, needsRotation, x, y, z }
 * @param {Object} furnaceConfig - 炉膛配置 { w, h, d }
 * @param {number} baseY - 炉膛基础 Y 偏移（料框底部在场景中的 Y 坐标，如 -120）
 * @param {boolean} [isFiltered=false] - 是否为筛选模式下被过滤的工件（降低透明度）
 * @returns {THREE.Mesh}
 */
export function createItemMesh(item, furnaceConfig, baseY, isFiltered = false) {
    const fw = furnaceConfig.w;

    let geometry;
    if (item.shape === 'cylinder') {
        if (item.needsRotation) {
            // 侧放圆盘：h = 原直径(大值), w = 原厚度(小值)
            // CylinderGeometry 半径用直径/2，高度用厚度
            geometry = new THREE.CylinderGeometry(item.h / 2, item.h / 2, item.w, 32);
        } else {
            geometry = new THREE.CylinderGeometry(item.w / 2, item.w / 2, item.h, 32);
        }
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

    // 扁平圆盘侧放旋转
    if (item.shape === 'cylinder' && item.needsRotation) {
        mesh.rotation.z = Math.PI / 2;
    }

    const meshOriginalY = item.y + item.h / 2 + baseY;

    mesh.userData = {
        itemName: item.name,
        itemId: item.id,
        originalColor: item.color,
        itemMaterial: item.material || '',
        itemProcess: item.process || '',
        itemWeight: item.weight || 0,
        itemDimensions: item.originalDims || { l: item.w, w: item.d, h: item.h },
        _originalY: meshOriginalY
    };

    const edgeColor = isFiltered ? 0xcccccc : 0x444444;
    const edgeMat = new THREE.LineBasicMaterial({ color: edgeColor });
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMat));

    // 工件位置：基于炉膛局部坐标系（料框原点对齐 baseY）
    mesh.position.set(
        item.x - fw / 2 + item.w / 2,
        meshOriginalY,
        item.z - furnaceConfig.d / 2 + item.d / 2
    );

    return mesh;
}

/**
 * 创建动画用工件 Mesh（与 createItemMesh 类似，但材质固定为不透明、关闭阴影）
 * 用于 playLoadingAnimation 中的工件
 *
 * @param {Object} item - 工件数据
 * @param {Object} furnaceConfig - 炉膛配置 { w, h, d }
 * @param {number} baseY - 炉膛基础 Y 偏移
 * @returns {THREE.Mesh}
 */
export function createAnimItemMesh(item, furnaceConfig, baseY) {
    const fw = furnaceConfig.w;

    let geometry;
    if (item.shape === 'cylinder') {
        if (item.needsRotation) {
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

    const targetX = item.x - fw / 2 + item.w / 2;
    const targetY = item.y + item.h / 2 + baseY;
    const startY = furnaceConfig.h + baseY + 300;

    mesh.position.set(targetX, startY, item.z - furnaceConfig.d / 2 + item.d / 2);

    return mesh;
}