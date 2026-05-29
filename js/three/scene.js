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
    ANIMATION_CONFIG
} from '../utils/constants.js';

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
     * 创建炉膛边框（含顶部标识、进炉方向箭头）
     */
    createFurnaceBox(width, height, depth, xPosition, furnaceName = '') {
        const group = new THREE.Group();
        const groundY = SCENE_CONFIG.groundOffset;
        
        // 1. 炉膛线框
        const geometry = new THREE.BoxGeometry(width, height, depth);
        const edges = new THREE.EdgesGeometry(geometry);
        const line = new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: FURNACE_BORDER_COLOR, linewidth: 2 })
        );
        line.position.set(xPosition, (height / 2) + groundY, 0);
        group.add(line);
        
        // 2. "顶部" 文字标识 — 放在顶面中心
        const topLabel = this._createTextSprite('⬆ 顶部 TOP', 40, '#ffffff', 'rgba(230, 126, 34, 0.9)');
        topLabel.position.set(xPosition, height + groundY + 35, 0);
        topLabel.scale.set(120, 60, 1);
        group.add(topLabel);
        
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
        arrowGroup.position.set(xPosition, groundY + height * 0.3, depth / 2 + 50);
        group.add(arrowGroup);
        
        // 5. 进炉方向文字标签
        const entryLabel = this._createTextSprite('🔥 进炉方向', 38, '#ffffff', 'rgba(239, 68, 68, 0.9)');
        entryLabel.position.set(xPosition, groundY + height * 0.3, depth / 2 + 95);
        entryLabel.scale.set(140, 50, 1);
        group.add(entryLabel);
        
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
     * 渲染装炉结果
     */
    renderPackingResult(furnacesResult) {
        this.clearItems();

        const spaceGap = ANIMATION_CONFIG.spaceGap;
        let currentXOffset = 0;

        furnacesResult.forEach((furnace, index) => {
            const xPos = currentXOffset + (furnace.w / 2);

            // 为每个炉膛创建独立的 Group（含边框和工件）
            const furnaceGroup = new THREE.Group();
            furnaceGroup.name = `furnace-${index}-${furnace.instanceId}`;

            // 添加炉膛边框（含名称标签）
            const furnaceBox = this.createFurnaceBox(furnace.w, furnace.h, furnace.d, xPos, furnace.instanceId);
            furnaceGroup.add(furnaceBox);

            // 添加工件
            furnace.packedItems.forEach(item => {
                const mesh = this.createItemMesh(item);

                const targetX = xPos + item.x - (furnace.w / 2) + (item.w / 2);
                const targetY = item.y + (item.h / 2) + SCENE_CONFIG.groundOffset;
                const targetZ = item.z - (furnace.d / 2) + (item.d / 2);

                this.setItemPosition(mesh, targetX, targetY, targetZ);
                furnaceGroup.add(mesh);
            });

            this.itemsGroup.add(furnaceGroup);
            this.furnaceGroups.push(furnaceGroup);

            currentXOffset += furnace.w + spaceGap;
        });

        // 调整相机位置
        this._adjustCamera(furnacesResult, currentXOffset - spaceGap);
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
     * 调整相机位置（基于可见炉膛）
     */
    _adjustCamera(furnacesResult, totalWidth) {
        const visibleFurnaces = this._getVisibleFurnaces(furnacesResult);
        if (visibleFurnaces.length === 0) return;

        // 计算可见炉膛的实际范围
        const spaceGap = ANIMATION_CONFIG.spaceGap;
        let visibleTotalWidth = 0;
        visibleFurnaces.forEach(f => { visibleTotalWidth += f.w + spaceGap; });
        visibleTotalWidth -= spaceGap;

        const sceneCenterX = totalWidth / 2;
        this.controls.target.set(sceneCenterX, 0, 0);

        const maxH = Math.max(...visibleFurnaces.map(f => f.h));
        const maxD = Math.max(...visibleFurnaces.map(f => f.d));
        
        this.camera.position.set(sceneCenterX, maxH * 2.2, maxD * 2.5);
        this.controls.update();
    }

    /**
     * 视角对准 - 切换到指定视角（基于可见炉膛）
     * @param {string} viewName - 'front' | 'top' | 'side' | 'default'
     * @param {Object} furnacesResult - 当前炉膛结果数据
     */
    focusOnView(viewName, furnacesResult) {
        const visibleFurnaces = this._getVisibleFurnaces(furnacesResult);
        if (!visibleFurnaces || visibleFurnaces.length === 0) return;

        // 计算可见炉膛的场景中心
        const spaceGap = ANIMATION_CONFIG.spaceGap;
        let totalWidth = 0;
        furnacesResult.forEach(f => { totalWidth += f.w + spaceGap; });
        totalWidth -= spaceGap;

        const sceneCenterX = totalWidth / 2;
        const maxH = Math.max(...visibleFurnaces.map(f => f.h));
        const maxD = Math.max(...visibleFurnaces.map(f => f.d));
        const centerY = maxH / 2 + SCENE_CONFIG.groundOffset;

        const distance = Math.max(maxH, maxD) * 2.5;

        switch (viewName) {
            case 'front':
                // 正视图：从正面(Z+)看
                this.camera.position.set(sceneCenterX, centerY, distance);
                this.controls.target.set(sceneCenterX, centerY, 0);
                break;
            case 'top':
                // 顶视图：从顶部(Y+)看
                this.camera.position.set(sceneCenterX, distance, 0);
                this.controls.target.set(sceneCenterX, SCENE_CONFIG.groundOffset, 0);
                break;
            case 'side':
                // 侧视图：从侧面(X+)看
                this.camera.position.set(distance, centerY, 0);
                this.controls.target.set(sceneCenterX, centerY, 0);
                break;
            case 'default':
            default:
                // 默认3D透视
                this.camera.position.set(sceneCenterX, maxH * 2.2, maxD * 2.5);
                this.controls.target.set(sceneCenterX, 0, 0);
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
        
        window.removeEventListener('resize', this._onWindowResize);
        
        if (this.renderer) {
            this.renderer.dispose();
            this.container.removeChild(this.renderer.domElement);
        }
    }
}

export default SceneManager;