// ==================== Three.js 场景管理模块 ====================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { 
    SCENE_CONFIG, 
    CAMERA_CONFIG, 
    LIGHT_CONFIG, 
    FURNACE_BORDER_COLOR,
    MATERIAL_CONFIG,
    EDGE_COLOR,
    ANIMATION_CONFIG,
    COG_SPHERE_COLOR,
    COG_SPHERE_RADIUS
} from '../utils/constants.js';
import { calculateCenterOfGravity } from '../utils/helpers.js';

/**
 * Three.js 场景管理器
 */
class SceneManager {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.itemsGroup = null;
        this.furnaceGroups = [];
        this.animationId = null;
        this._highlightPulseId = null;
        this._highlightPulseTime = 0;
    }

    /**
     * 初始化场景
     */
    init() {
        // 创建场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(SCENE_CONFIG.backgroundColor);

        // 创建相机
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(
            CAMERA_CONFIG.fov,
            aspect,
            CAMERA_CONFIG.near,
            CAMERA_CONFIG.far
        );

        // 创建渲染器
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        // 创建控制器
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // 添加灯光
        this._setupLights();

        // 添加网格
        this._setupGrid();

        // 创建工件组
        this.itemsGroup = new THREE.Group();
        this.scene.add(this.itemsGroup);

        // 监听窗口大小变化
        window.addEventListener('resize', () => this._onWindowResize());

        // 开始渲染循环
        this._animate();

        return this;
    }

    /**
     * 设置灯光
     */
    _setupLights() {
        // 环境光
        const ambientLight = new THREE.AmbientLight(
            LIGHT_CONFIG.ambient.color,
            LIGHT_CONFIG.ambient.intensity
        );
        this.scene.add(ambientLight);

        // 主光源
        const mainLight = new THREE.DirectionalLight(
            LIGHT_CONFIG.main.color,
            LIGHT_CONFIG.main.intensity
        );
        mainLight.position.set(
            LIGHT_CONFIG.main.position.x,
            LIGHT_CONFIG.main.position.y,
            LIGHT_CONFIG.main.position.z
        );
        this.scene.add(mainLight);

        // 填充光
        const fillLight = new THREE.DirectionalLight(
            LIGHT_CONFIG.fill.color,
            LIGHT_CONFIG.fill.intensity
        );
        fillLight.position.set(
            LIGHT_CONFIG.fill.position.x,
            LIGHT_CONFIG.fill.position.y,
            LIGHT_CONFIG.fill.position.z
        );
        this.scene.add(fillLight);
    }

    /**
     * 设置网格
     */
    _setupGrid() {
        const gridHelper = new THREE.GridHelper(
            SCENE_CONFIG.gridSize,
            SCENE_CONFIG.gridDivisions,
            SCENE_CONFIG.gridColor,
            SCENE_CONFIG.gridCenterColor
        );
        gridHelper.position.y = SCENE_CONFIG.groundOffset;
        this.scene.add(gridHelper);
    }

    /**
     * 窗口大小变化处理
     */
    _onWindowResize() {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    /**
     * 渲染循环
     */
    _animate() {
        this.animationId = requestAnimationFrame(() => this._animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * 清空场景中的工件
     */
    clearItems() {
        while (this.itemsGroup.children.length > 0) {
            this.itemsGroup.remove(this.itemsGroup.children[0]);
        }
        this.furnaceGroups = [];
    }

    /**
     * 获取炉膛数量
     */
    getFurnaceCount() {
        return this.furnaceGroups.length;
    }

    /**
     * 设置指定炉膛的可见性
     * @param {number} index - 炉膛索引
     * @param {boolean} visible - 是否可见
     */
    setFurnaceVisible(index, visible) {
        if (index >= 0 && index < this.furnaceGroups.length) {
            this.furnaceGroups[index].visible = visible;
        }
    }

    /**
     * 切换指定炉膛的可见性
     * @param {number} index - 炉膛索引
     * @returns {boolean} 切换后的可见状态
     */
    toggleFurnaceVisible(index) {
        if (index >= 0 && index < this.furnaceGroups.length) {
            const group = this.furnaceGroups[index];
            group.visible = !group.visible;
            return group.visible;
        }
        return true;
    }

    /**
     * 设置所有炉膛可见
     */
    showAllFurnaces() {
        this.furnaceGroups.forEach(g => { g.visible = true; });
    }

    // ==================== 规则9: 物料高亮定位 ====================

    /**
     * 高亮指定批次名称的所有工件
     * 遍历所有炉膛组，找到匹配批次名的工件并将其发光/高亮
     * @param {string} batchName - 批次名称
     */
    highlightItemsByName(batchName) {
        this.clearHighlight();
        if (!batchName) return;
        
        this.furnaceGroups.forEach(group => {
            group.children.forEach(child => {
                // 工件是 Mesh 且有 material.color（炉膛边框元素没有 material.color 或者在不同的 sub-group 中）
                if (child.isMesh && child.material && child.material.color && child.userData && child.userData.batchName === batchName) {
                    // 高亮：修改材质 emissive 发光
                    child.userData._originalEmissive = child.material.emissive ? child.material.emissive.getHex() : null;
                    child.userData._originalEmissiveIntensity = child.material.emissiveIntensity || 0;
                    child.userData._originalOpacity = child.material.opacity;
                    child.material.emissive = new THREE.Color(child.material.color);
                    child.material.emissiveIntensity = 0.9;
                    child.material.opacity = 1.0;
                    child.material.needsUpdate = true;
                    
                    // 给工件添加脉冲缩放效果标记
                    child.userData._highlighted = true;
                }
            });
        });
        
        // 启动高亮动画（脉冲）
        this._startHighlightPulse();
    }

    /**
     * 清除所有工件高亮
     */
    clearHighlight() {
        this._stopHighlightPulse();
        
        this.furnaceGroups.forEach(group => {
            group.children.forEach(child => {
                if (child.isMesh && child.material && child.userData && child.userData._highlighted) {
                    // 恢复原始材质属性
                    if (child.userData._originalEmissive !== null && child.userData._originalEmissive !== undefined) {
                        child.material.emissive.setHex(child.userData._originalEmissive);
                    } else {
                        child.material.emissive = new THREE.Color(0x000000);
                    }
                    child.material.emissiveIntensity = child.userData._originalEmissiveIntensity || 0;
                    child.material.opacity = child.userData._originalOpacity || 0.85;
                    child.material.needsUpdate = true;
                    child.userData._highlighted = false;
                    delete child.userData._originalEmissive;
                    delete child.userData._originalEmissiveIntensity;
                    delete child.userData._originalOpacity;
                }
            });
        });
    }

    /**
     * 相机聚焦到高亮工件所在位置
     * @param {Array} furnacesResult - 当前炉膛结果数据
     */
    focusOnHighlightedItems(furnacesResult) {
        if (!furnacesResult || furnacesResult.length === 0) return;
        
        // 找到所有高亮的工件，计算其中心位置
        const highlightedPositions = [];
        const spaceGap = ANIMATION_CONFIG.spaceGap;
        
        let totalWidth = 0;
        furnacesResult.forEach(f => { totalWidth += f.w + spaceGap; });
        totalWidth -= spaceGap;
        const startX = -totalWidth / 2;
        let currentXOffset = startX;
        
        furnacesResult.forEach((furnace, fi) => {
            const xPos = currentXOffset + (furnace.w / 2);
            const group = this.furnaceGroups[fi];
            
            furnace.packedItems.forEach(item => {
                if (!group) return;
                
                let foundHighlighted = false;
                group.children.forEach(child => {
                    if (child.isMesh && child.userData && child.userData._highlighted) {
                        foundHighlighted = true;
                    }
                });
                
                if (foundHighlighted) {
                    const targetX = xPos + item.x - (furnace.w / 2) + (item.w / 2);
                    const targetY = item.y + (item.h / 2) + SCENE_CONFIG.groundOffset;
                    const targetZ = item.z - (furnace.d / 2) + (item.d / 2);
                    highlightedPositions.push({ x: targetX, y: targetY, z: targetZ });
                }
            });
            
            currentXOffset += furnace.w + spaceGap;
        });
        
        if (highlightedPositions.length === 0) return;
        
        // 计算高亮工件组的中心
        let cx = 0, cy = 0, cz = 0;
        highlightedPositions.forEach(p => { cx += p.x; cy += p.y; cz += p.z; });
        cx /= highlightedPositions.length;
        cy /= highlightedPositions.length;
        cz /= highlightedPositions.length;
        
        // 计算包围盒大小来确定合适的相机距离
        let maxDist = 0;
        highlightedPositions.forEach(p => {
            const dx = p.x - cx;
            const dy = p.y - cy;
            const dz = p.z - cz;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > maxDist) maxDist = dist;
        });
        
        const cameraDistance = Math.max(maxDist * 3, 500);
        
        this.controls.target.set(cx, cy, cz);
        this.camera.position.set(cx, cy + cameraDistance * 0.6, cz + cameraDistance);
        this.controls.update();
    }

    /**
     * 启动高亮脉冲动画
     */
    _startHighlightPulse() {
        if (this._highlightPulseId) return;
        this._highlightPulseTime = 0;
        this._highlightPulseId = requestAnimationFrame((t) => this._highlightPulseLoop(t));
    }

    /**
     * 停止高亮脉冲动画
     */
    _stopHighlightPulse() {
        if (this._highlightPulseId) {
            cancelAnimationFrame(this._highlightPulseId);
            this._highlightPulseId = null;
        }
    }

    /**
     * 高亮脉冲循环（正弦波变化发光强度）
     */
    _highlightPulseLoop(timestamp) {
        if (!this._highlightPulseId) return;
        
        if (!this._highlightPulseTime) this._highlightPulseTime = timestamp;
        const elapsed = (timestamp - this._highlightPulseTime) * 0.001; // 秒
        const intensity = 0.5 + 0.4 * Math.sin(elapsed * 3.0); // 0.1 ~ 0.9 正弦波
        
        this.furnaceGroups.forEach(group => {
            group.children.forEach(child => {
                if (child.isMesh && child.material && child.userData && child.userData._highlighted) {
                    child.material.emissiveIntensity = intensity;
                }
            });
        });
        
        this._highlightPulseId = requestAnimationFrame((t) => this._highlightPulseLoop(t));
    }

    /**
     * 创建文字精灵 (Canvas生成纹理)
     */
    _createTextSprite(text, fontSize, color, bgColor) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        if (bgColor) {
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        
        ctx.font = `bold ${fontSize || 48}px -apple-system, "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = color || '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
        
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(120, 60, 1);
        return sprite;
    }

    /**
     * 创建炉膛模型（含边框、半透明侧面、进炉方向箭头）
     * - 四个侧面使用半透明材质，顶部无面板以示装料入口
     * - 进炉方向（Z+）面使用不同颜色区分炉门侧
     */
    createFurnaceBox(width, height, depth, xPosition, furnaceName = '') {
        const group = new THREE.Group();
        const groundY = SCENE_CONFIG.groundOffset;
        const halfW = width / 2;
        const halfH = height / 2;
        const halfD = depth / 2;
        
        // 1. 炉膛线框（白色边框）
        const geometry = new THREE.BoxGeometry(width, height, depth);
        const edges = new THREE.EdgesGeometry(geometry);
        const line = new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: FURNACE_BORDER_COLOR, linewidth: 2 })
        );
        line.position.set(xPosition, halfH + groundY, 0);
        group.add(line);

        // 2. 四个侧面半透明面板（炉壁，顶部留空 = 装料入口）
        const sideMat = new THREE.MeshStandardMaterial({
            color: 0x334466,
            roughness: 0.6,
            metalness: 0.5,
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        // 炉门侧（Z+，进炉方向）使用更明显的颜色
        const doorMat = new THREE.MeshStandardMaterial({
            color: 0x445577,
            roughness: 0.4,
            metalness: 0.6,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        // 左面 (X-)
        const leftGeo = new THREE.PlaneGeometry(depth, height);
        const leftPanel = new THREE.Mesh(leftGeo, sideMat);
        leftPanel.rotation.y = -Math.PI / 2;
        leftPanel.position.set(xPosition - halfW, halfH + groundY, 0);
        group.add(leftPanel);

        // 右面 (X+)
        const rightGeo = new THREE.PlaneGeometry(depth, height);
        const rightPanel = new THREE.Mesh(rightGeo, sideMat);
        rightPanel.rotation.y = Math.PI / 2;
        rightPanel.position.set(xPosition + halfW, halfH + groundY, 0);
        group.add(rightPanel);

        // 后面 (Z-)
        const backGeo = new THREE.PlaneGeometry(width, height);
        const backPanel = new THREE.Mesh(backGeo, sideMat);
        backPanel.position.set(xPosition, halfH + groundY, -halfD);
        group.add(backPanel);

        // 前面 / 炉门侧 (Z+)，进炉方向，使用区分颜色
        const frontGeo = new THREE.PlaneGeometry(width, height);
        const frontPanel = new THREE.Mesh(frontGeo, doorMat);
        frontPanel.position.set(xPosition, halfH + groundY, halfD);
        group.add(frontPanel);

        // 3. 侧面竖向肋条/加强筋特征（沿四角纵向，突出工业感）
        const ribMat = new THREE.MeshStandardMaterial({
            color: 0x556688,
            roughness: 0.4,
            metalness: 0.7,
            transparent: true,
            opacity: 0.35,
            depthWrite: false
        });
        const ribWidth = 8;
        const ribDepth = 6;
        const ribHeight = height;
        const ribY = halfH + groundY;
        // 四角的竖向肋条
        const ribPositions = [
            { x: xPosition - halfW + ribDepth/2, z: -halfD, ry: 0 },
            { x: xPosition - halfW + ribDepth/2, z: halfD, ry: 0 },
            { x: xPosition + halfW - ribDepth/2, z: -halfD, ry: 0 },
            { x: xPosition + halfW - ribDepth/2, z: halfD, ry: 0 },
        ];
        ribPositions.forEach(rp => {
            const ribGeo = new THREE.BoxGeometry(ribDepth, ribHeight, ribWidth);
            const rib = new THREE.Mesh(ribGeo, ribMat);
            rib.position.set(rp.x, ribY, rp.z);
            group.add(rib);
        });
        // 顶部横肋（四边，暗示顶部开口边框）
        const topRibGeoH = new THREE.BoxGeometry(width, 5, 6);
        const topRibGeoV = new THREE.BoxGeometry(6, 5, depth);
        const topEdgeY = groundY + height;
        const topRibs = [
            { g: topRibGeoH, x: xPosition, y: topEdgeY, z: -halfD },
            { g: topRibGeoH, x: xPosition, y: topEdgeY, z: halfD },
            { g: topRibGeoV, x: xPosition - halfW, y: topEdgeY, z: 0 },
            { g: topRibGeoV, x: xPosition + halfW, y: topEdgeY, z: 0 },
        ];
        const topEdgeMat = new THREE.MeshStandardMaterial({
            color: 0x8899aa,
            roughness: 0.3,
            metalness: 0.8,
            transparent: true,
            opacity: 0.5,
            depthWrite: false
        });
        topRibs.forEach(tr => {
            const topRib = new THREE.Mesh(tr.g, topEdgeMat);
            topRib.position.set(tr.x, tr.y, tr.z);
            group.add(topRib);
        });

        // 4. 进炉方向箭头 — Z轴正方向（炉门侧）
        const arrowGroup = new THREE.Group();
        
        // 箭头杆
        const shaftGeo = new THREE.CylinderGeometry(4, 4, 60, 8);
        const shaftMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x7f1d1d, roughness: 0.3 });
        const shaft = new THREE.Mesh(shaftGeo, shaftMat);
        shaft.rotation.x = Math.PI / 2;
        shaft.position.set(0, 0, 30);
        arrowGroup.add(shaft);
        
        // 箭头尖
        const headGeo = new THREE.ConeGeometry(12, 30, 8);
        const headMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x7f1d1d, roughness: 0.3 });
        const head = new THREE.Mesh(headGeo, headMat);
        head.rotation.x = -Math.PI / 2;
        head.position.set(0, 0, 65);
        arrowGroup.add(head);
        
        // 箭头整体放在炉门侧(Z+)前方
        arrowGroup.position.set(xPosition, groundY + height * 0.3, halfD + 50);
        group.add(arrowGroup);
        
        return group;
    }

    /**
     * 创建工件网格
     */
    createItemMesh(item) {
        let geometry;
        if (item.shape === 'cylinder') {
            geometry = new THREE.CylinderGeometry(item.w / 2, item.w / 2, item.h, 32);
        } else {
            geometry = new THREE.BoxGeometry(item.w, item.h, item.d);
        }

        const material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(item.color),
            ...MATERIAL_CONFIG
        });

        const mesh = new THREE.Mesh(geometry, material);
        
        // 存储批次名用于高亮定位
        mesh.userData = { batchName: item.name || '' };
        
        // 添加边缘线
        const edges = new THREE.EdgesGeometry(geometry);
        mesh.add(new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: EDGE_COLOR })
        ));

        return mesh;
    }

    /**
     * 设置工件位置
     */
    setItemPosition(mesh, x, y, z) {
        mesh.position.set(x, y, z);
    }

    /**
     * 创建重心标记球体（规则6）
     * @param {number} x - 绝对X坐标
     * @param {number} y - 绝对Y坐标
     * @param {number} z - 绝对Z坐标
     * @returns {THREE.Group} 重心标记组
     */
    _createCOGMarker(x, y, z) {
        const cogGroup = new THREE.Group();
        
        // 半透明红色球体
        const sphereGeo = new THREE.SphereGeometry(COG_SPHERE_RADIUS, 32, 32);
        const sphereMat = new THREE.MeshStandardMaterial({
            color: COG_SPHERE_COLOR,
            emissive: 0x660000,
            roughness: 0.2,
            metalness: 0.1,
            transparent: true,
            opacity: 0.8
        });
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        cogGroup.add(sphere);
        
        // 十字准心环（规则6：线框结构标注）
        const ringGeoX = new THREE.TorusGeometry(COG_SPHERE_RADIUS * 1.5, 2, 8, 16);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
        const ringX = new THREE.Mesh(ringGeoX, ringMat);
        ringX.rotation.y = Math.PI / 2;
        cogGroup.add(ringX);
        
        const ringGeoZ = new THREE.TorusGeometry(COG_SPHERE_RADIUS * 1.5, 2, 8, 16);
        const ringZ = new THREE.Mesh(ringGeoZ, ringMat);
        cogGroup.add(ringZ);
        
        // 垂直线（从重心向下引线至炉底标注）
        const dashMat = new THREE.LineDashedMaterial({
            color: 0xff4444,
            dashSize: 8,
            gapSize: 4,
            linewidth: 1
        });
        const points = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, -COG_SPHERE_RADIUS * 5, 0)
        ];
        const dashGeo = new THREE.BufferGeometry().setFromPoints(points);
        const dashLine = new THREE.Line(dashGeo, dashMat);
        dashLine.computeLineDistances();
        cogGroup.add(dashLine);
        
        cogGroup.position.set(x, y, z);
        return cogGroup;
    }

    /**
     * 渲染装炉结果 — 所有炉膛居中于场景原点
     */
    renderPackingResult(furnacesResult) {
        this.clearItems();

        const spaceGap = ANIMATION_CONFIG.spaceGap;

        // 计算总宽度，所有炉膛居中放置在原点附近
        let totalWidth = 0;
        furnacesResult.forEach(f => { totalWidth += f.w + spaceGap; });
        totalWidth -= spaceGap;
        const startX = -totalWidth / 2;

        let currentXOffset = startX;

        furnacesResult.forEach((furnace, index) => {
            const xPos = currentXOffset + (furnace.w / 2);

            // 为每个炉膛创建独立的 Group（含边框和工件）
            const furnaceGroup = new THREE.Group();
            furnaceGroup.name = `furnace-${index}-${furnace.instanceId}`;

            // 添加炉膛边框（含半透明侧面、进炉方向箭头）
            const furnaceBox = this.createFurnaceBox(furnace.w, furnace.h, furnace.d, xPos, furnace.instanceId);
            furnaceGroup.add(furnaceBox);

            // 料框底部面板 — 带网格纹理的半透明底面，展示摆料区域
            const trayGeo = new THREE.PlaneGeometry(furnace.w, furnace.d);
            const trayMat = new THREE.MeshBasicMaterial({
                color: 0x2a3a5f,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.25,
                depthWrite: false
            });
            const trayPlane = new THREE.Mesh(trayGeo, trayMat);
            trayPlane.rotation.x = -Math.PI / 2;
            trayPlane.position.set(xPos, SCENE_CONFIG.groundOffset + 1, 0);
            furnaceGroup.add(trayPlane);
            
            // 料框底部高亮边框线
            const trayEdgeGeo = new THREE.EdgesGeometry(trayGeo);
            const trayEdge = new THREE.LineSegments(
                trayEdgeGeo,
                new THREE.LineBasicMaterial({ color: 0x8899cc, transparent: true, opacity: 0.7 })
            );
            trayEdge.rotation.x = -Math.PI / 2;
            trayEdge.position.copy(trayPlane.position);
            furnaceGroup.add(trayEdge);

            // 料框底部十字辅助线（摆料定位参考）
            const crossLenX = furnace.w * 0.8;
            const crossLenZ = furnace.d * 0.8;
            const crossMat = new THREE.LineBasicMaterial({ color: 0x556688, transparent: true, opacity: 0.4, depthTest: true });
            const crossGeoX = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(xPos - crossLenX / 2, SCENE_CONFIG.groundOffset + 1.5, 0),
                new THREE.Vector3(xPos + crossLenX / 2, SCENE_CONFIG.groundOffset + 1.5, 0)
            ]);
            furnaceGroup.add(new THREE.Line(crossGeoX, crossMat));
            const crossGeoZ = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(xPos, SCENE_CONFIG.groundOffset + 1.5, -crossLenZ / 2),
                new THREE.Vector3(xPos, SCENE_CONFIG.groundOffset + 1.5, crossLenZ / 2)
            ]);
            furnaceGroup.add(new THREE.Line(crossGeoZ, crossMat));

            // 炉膛四周立柱特征（4角标记）
            const pillarRadius = 5;
            const pillarHeight = furnace.h;
            const pillarMat = new THREE.MeshStandardMaterial({
                color: 0x556688,
                roughness: 0.5,
                metalness: 0.6,
                transparent: true,
                opacity: 0.5
            });
            const halfW = furnace.w / 2;
            const halfD = furnace.d / 2;
            const pillarY = SCENE_CONFIG.groundOffset + pillarHeight / 2;
            const corners = [
                [xPos - halfW, pillarY, -halfD],
                [xPos + halfW, pillarY, -halfD],
                [xPos - halfW, pillarY, halfD],
                [xPos + halfW, pillarY, halfD]
            ];
            corners.forEach(([cx, cy, cz]) => {
                const pillarGeo = new THREE.CylinderGeometry(pillarRadius, pillarRadius, pillarHeight, 8);
                const pillar = new THREE.Mesh(pillarGeo, pillarMat);
                pillar.position.set(cx, cy, cz);
                furnaceGroup.add(pillar);
            });

            // 添加工件
            furnace.packedItems.forEach(item => {
                const mesh = this.createItemMesh(item);

                const targetX = xPos + item.x - (furnace.w / 2) + (item.w / 2);
                const targetY = item.y + (item.h / 2) + SCENE_CONFIG.groundOffset;
                const targetZ = item.z - (furnace.d / 2) + (item.d / 2);

                this.setItemPosition(mesh, targetX, targetY, targetZ);
                furnaceGroup.add(mesh);
            });

            // 规则6: 计算并标注装炉重心位置
            if (furnace.packedItems.length > 0) {
                const itemsWithWeight = furnace.packedItems.map(item => ({
                    x: item.x + item.w / 2,
                    y: item.y + item.h / 2,
                    z: item.z + item.d / 2,
                    weight: item.weight || 1
                }));
                
                const cog = calculateCenterOfGravity(itemsWithWeight);
                
                const cogAbsX = xPos - (furnace.w / 2) + cog.x;
                const cogAbsY = cog.y + SCENE_CONFIG.groundOffset;
                const cogAbsZ = cog.z - (furnace.d / 2);
                
                const cogMarker = this._createCOGMarker(cogAbsX, cogAbsY, cogAbsZ);
                furnaceGroup.add(cogMarker);
                
                const cogLabel = this._createTextSprite(
                    `⚖️ 重心 (${Math.round(cog.x)}, ${Math.round(cog.y)}, ${Math.round(cog.z)})`,
                    28, '#ff4444', 'rgba(0,0,0,0.7)'
                );
                cogLabel.position.set(cogAbsX, cogAbsY + COG_SPHERE_RADIUS * 3, cogAbsZ);
                cogLabel.scale.set(180, 40, 1);
                furnaceGroup.add(cogLabel);
            }

            this.itemsGroup.add(furnaceGroup);
            this.furnaceGroups.push(furnaceGroup);

            currentXOffset += furnace.w + spaceGap;
        });

        // 调整相机位置（所有炉膛已居中于原点）
        this._adjustCamera(furnacesResult, totalWidth);
    }

    /**
     * 获取当前可见的炉膛数据
     */
    _getVisibleFurnaces(furnacesResult) {
        if (!furnacesResult || furnacesResult.length === 0) return [];
        return furnacesResult.filter((f, idx) => {
            if (idx >= this.furnaceGroups.length) return true;
            return this.furnaceGroups[idx].visible;
        });
    }

    /**
     * 调整相机位置（炉膛已居中于原点，相机从前方斜上方观察）
     */
    _adjustCamera(furnacesResult, totalWidth) {
        const visibleFurnaces = this._getVisibleFurnaces(furnacesResult);
        if (visibleFurnaces.length === 0) return;

        const maxH = Math.max(...visibleFurnaces.map(f => f.h));
        const maxD = Math.max(...visibleFurnaces.map(f => f.d));
        const furnaceCount = visibleFurnaces.length;

        // 动态调整相机距离，确保场景居中
        const countFactor = Math.max(1, Math.sqrt(furnaceCount) * 0.7);
        const cameraDistance = Math.max(maxH, maxD, totalWidth * 0.5) * (2.0 + countFactor * 0.3);

        // 目标点在原点（炉膛已居中）
        this.controls.target.set(0, maxH * 0.35, 0);
        this.camera.position.set(0, maxH * 2.0, cameraDistance);
        this.controls.update();
    }

    /**
     * 视角对准 - 切换到指定视角（炉膛已居中于原点）
     * @param {string} viewName - 'front' | 'top' | 'side' | 'default'
     * @param {Object} furnacesResult - 当前炉膛结果数据
     */
    focusOnView(viewName, furnacesResult) {
        const visibleFurnaces = this._getVisibleFurnaces(furnacesResult);
        if (!visibleFurnaces || visibleFurnaces.length === 0) return;

        const maxH = Math.max(...visibleFurnaces.map(f => f.h));
        const maxD = Math.max(...visibleFurnaces.map(f => f.d));
        const centerY = maxH / 2 + SCENE_CONFIG.groundOffset;

        const distance = Math.max(maxH, maxD) * 2.5;

        switch (viewName) {
            case 'front':
                // 正视图：从正面(Z+)看
                this.camera.position.set(0, centerY, distance);
                this.controls.target.set(0, centerY, 0);
                break;
            case 'top':
                // 顶视图：从顶部(Y+)看
                this.camera.position.set(0, distance, 0);
                this.controls.target.set(0, SCENE_CONFIG.groundOffset, 0);
                break;
            case 'side':
                // 侧视图：从侧面(X+)看
                this.camera.position.set(distance, centerY, 0);
                this.controls.target.set(0, centerY, 0);
                break;
            case 'default':
            default:
                // 默认3D透视
                this.camera.position.set(0, maxH * 2.4, maxD * 2.8);
                this.controls.target.set(0, 0, 0);
                break;
        }
        this.controls.update();
    }

    /**
     * 销毁场景
     */
    dispose() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        this._stopHighlightPulse();
        
        window.removeEventListener('resize', this._onWindowResize);
        
        if (this.renderer) {
            this.renderer.dispose();
            this.container.removeChild(this.renderer.domElement);
        }
    }
}

export default SceneManager;