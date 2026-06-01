/**
 * three-scene.js - All Three.js Related Code
 *
 * Purpose:
 *   Contains scene creation, camera setup, renderer setup, object rendering,
 *   highlighting, transparency effects, material focus, animation, and shelf rendering.
 *
 * Dependencies:
 *   - THREE.js (imported via importmap)
 *   - OrbitControls (from three/addons)
 *   - state.js
 *
 * Future Extension:
 *   - Custom shaders for material visualization
 *   - VR/AR furnace inspection
 *   - Real-time sensor data overlay
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
    setItemsGroup,
    setShelfMeshes,
    setIsAnimating, setAnimPaused, setAnimStopped,
    setCurrentFurnaceIndex, setSelectedFurnaceCardId,
    setOriginalOpacityStore, setOpacityResetTimerId
} from './state.js';

/**
 * Color palette for unique material color generation.
 * @type {string[]}
 */
const COLOR_PALETTE = [
    '#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6',
    '#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a',
    '#ff5722','#607d8b','#673ab7','#009688','#ff9800',
    '#795548','#f44336','#2196f3','#4caf50','#ffeb3b',
    '#ff6b6b','#4ecdc4','#45b7d1','#96ceb4','#ffeaa7',
    '#dda0dd','#98d8c8','#f7dc6f','#bb8fce','#85c1e9'
];

// ==================== COLOR GENERATOR ====================

/**
 * Generate a unique color for a new material.
 * Uses palette first, then generates random colors avoiding duplicates.
 *
 * @param {Set<string>} usedColors - Set of already-used colors
 * @returns {string} Hex color string
 */
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

/**
 * Initialize the main Three.js scene for furnace viewing.
 * Creates scene, camera, renderer, lights, grid, and starts animation loop.
 *
 * Future Extension:
 *   - Post-processing effects (bloom, SSAO)
 *   - Multiple viewports
 */
export function initThree() {
    const container = document.getElementById('canvas-container');
    const newScene = new THREE.Scene();
    newScene.background = new THREE.Color(0x0e0e12);
    setScene(newScene);

    const newCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 10000);
    setCamera(newCamera);

    const newRenderer = new THREE.WebGLRenderer({ antialias: true });
    newRenderer.setSize(container.clientWidth, container.clientHeight);
    newRenderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(newRenderer.domElement);
    setRenderer(newRenderer);

    const newControls = new OrbitControls(newCamera, newRenderer.domElement);
    newControls.enableDamping = true;
    newControls.dampingFactor = 0.05;
    setControls(newControls);

    newScene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.7);
    mainLight.position.set(400, 800, 500);
    newScene.add(mainLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-400, -200, -300);
    newScene.add(fillLight);

    const gridHelper = new THREE.GridHelper(4000, 80, 0x222233, 0x151520);
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

/**
 * Initialize the Master View (装料大师) Three.js scene.
 * Created on demand when user clicks "装料大师" button.
 */
export function initMasterThree() {
    const container = document.getElementById('master-canvas-container');
    const msScene = new THREE.Scene();
    msScene.background = new THREE.Color(0x080810);
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

    msScene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const ml = new THREE.DirectionalLight(0xffffff, 0.7);
    ml.position.set(400, 800, 500);
    msScene.add(ml);

    const grid = new THREE.GridHelper(4000, 80, 0x222233, 0x151520);
    grid.position.y = -120;
    msScene.add(grid);

    function animateMaster() {
        requestAnimationFrame(animateMaster);
        msControls.update();
        msRenderer.render(msScene, msCamera);
    }
    animateMaster();
}

// ==================== SHELF MESH MANAGEMENT ====================

/**
 * Dispose all dynamically generated shelf meshes, freeing GPU memory.
 * Called when clearing scene, switching furnaces, or regenerating plans.
 *
 * Future Extension:
 *   - Pool shelf meshes for reuse
 */
export function disposeShelfMeshes() {
    shelfMeshes.forEach(mesh => {
        if (mesh.parent) mesh.parent.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
            } else {
                mesh.material.dispose();
            }
        }
    });
    setShelfMeshes([]);
}

/**
 * Create semi-transparent shelf models for visual reference.
 * Automatically detects unique Y-layers from packedItems and creates
 * thin box geometries at each shelf height.
 *
 * @param {Object} furnace - {w, h, d, packedItems}
 * @param {number} baseY - Base Y offset (typically -120)
 */
export function renderShelvesForFurnace(furnace, baseY) {
    const shelfYs = new Set();
    furnace.packedItems.forEach(item => {
        if (typeof item.y === 'number' && !isNaN(item.y)) {
            if (item.y > 0) shelfYs.add(item.y);
        }
    });

    if (shelfYs.size === 0) return;

    const shelfThickness = 2;
    const fw = furnace.w;
    const fd = furnace.d;
    const fh = furnace.h;

    shelfYs.forEach(shelfY => {
        if (shelfY + shelfThickness > fh) {
            console.warn(`[搁板渲染] 搁板高度 ${shelfY}mm 超出炉膛总高度 ${fh}mm，已跳过`);
            return;
        }

        const shelfGeo = new THREE.BoxGeometry(fw, shelfThickness, fd);
        const shelfMat = new THREE.MeshStandardMaterial({
            color: 0xb4b4c8,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            roughness: 0.6,
            metalness: 0.3,
            side: THREE.DoubleSide
        });

        const shelfMesh = new THREE.Mesh(shelfGeo, shelfMat);
        const shelfCenterY = shelfY + shelfThickness / 2 + baseY;
        shelfMesh.position.set(0, shelfCenterY, 0);
        shelfMesh.userData = { isShelfMesh: true, shelfY: shelfY };

        itemsGroup.add(shelfMesh);
        shelfMeshes.push(shelfMesh);
    });
}

// ==================== SCENE RENDERING ====================

/**
 * Render a single furnace's contents in the 3D scene.
 * Clears existing itemsGroup, renders furnace wireframe + all packed items,
 * optionally dimming non-matching materials for highlight mode.
 *
 * @param {number} index - Index into globalFurnacesResult
 * @param {string|null} filterMaterialName - If set, dim non-matching items
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

    // Furnace wireframe
    const containerGeo = new THREE.BoxGeometry(furnace.w, furnace.h, furnace.d);
    const containerEdges = new THREE.EdgesGeometry(containerGeo);
    const containerLine = new THREE.LineSegments(containerEdges, new THREE.LineBasicMaterial({ color: 0xe67e22, linewidth: 2 }));
    containerLine.position.set(0, furnace.h / 2 + baseY, 0);
    itemsGroup.add(containerLine);

    // Render each packed item
    furnace.packedItems.forEach(item => {
        const isFiltered = filterMaterialName && item.name !== filterMaterialName;
        let geometry;
        if (item.shape === 'cylinder') geometry = new THREE.CylinderGeometry(item.w / 2, item.w / 2, item.h, 32);
        else geometry = new THREE.BoxGeometry(item.w, item.h, item.d);

        const material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(item.color),
            transparent: true,
            opacity: isFiltered ? 0.12 : 0.85,
            roughness: 0.3, metalness: 0.2
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = { itemName: item.name, itemId: item.id };
        const edgeMat = new THREE.LineBasicMaterial({ color: isFiltered ? 0x333333 : 0x000000 });
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

    // Render shelves if shelf-layered mode is active
    if (placementRules.useShelfLayered && furnace.packedItems.length > 0) {
        renderShelvesForFurnace(furnace, baseY);
    }
}

// ==================== SCENE NAVIGATION ====================

/**
 * Navigate to previous/next furnace in results.
 * @param {number} direction - -1 for previous, +1 for next
 */
export function navigateFurnace(direction) {
    if (!globalFurnacesResult || globalFurnacesResult.length === 0) return;

    resetAllItemOpacityToOpaque();

    setCurrentFurnaceIndex(
        (currentFurnaceIndex + direction + globalFurnacesResult.length) % globalFurnacesResult.length
    );

    const filterName = getSelectedMaterialName();

    // Update is delegated to app.js which will call renderSingleFurnace + UI updates
    return { filterName, newIndex: currentFurnaceIndex };
}

/**
 * Get the name of the currently selected material card (for filtering).
 * @returns {string|null}
 */
export function getSelectedMaterialName() {
    if (!selectedMaterialCardId) return null;
    const card = document.getElementById(selectedMaterialCardId);
    if (!card) return null;
    return card.querySelector('.m-name').textContent;
}

// ==================== OPACITY / HIGHLIGHT MANAGEMENT ====================

/**
 * Reset all item meshes in itemsGroup to opaque default state.
 * Called before regenerating scenes to prevent stale transparency states.
 */
export function resetAllItemOpacityToOpaque() {
    if (!itemsGroup) return;
    itemsGroup.children.forEach(child => {
        if (!child.isMesh) return;
        if (!child.material) return;
        child.material.transparent = true;
        child.material.opacity = 0.85;
        child.material.needsUpdate = true;
        child.children.forEach(subChild => {
            if (subChild.isLineSegments && subChild.material && subChild.material.isLineBasicMaterial) {
                subChild.material.color = new THREE.Color(0x000000);
            }
        });
        if (child.material.emissive !== undefined) {
            child.material.emissive = new THREE.Color(0x000000);
            child.material.emissiveIntensity = 0;
        }
    });
    originalOpacityStore.clear();
}

/**
 * Highlight items matching a specific card in the 3D scene.
 * Selected items get emissive glow + full opacity.
 * Non-selected items become semi-transparent (opacity 0.2).
 * Pass null to reset all items to opaque.
 *
 * @param {string|null} cardId - Material card ID to highlight, or null to reset
 */
export function highlightItemsInScene(cardId) {
    if (opacityResetTimerId) { clearTimeout(opacityResetTimerId); setOpacityResetTimerId(null); }

    if (!cardId) {
        resetAllItemOpacityToOpaque();
        return;
    }

    if (!globalFurnacesResult || currentFurnaceIndex >= globalFurnacesResult.length) return;
    const card = document.getElementById(cardId);
    if (!card) return;
    const selectedName = card.querySelector('.m-name').textContent;

    itemsGroup.children.forEach(child => {
        if (!child.isMesh) return;
        if (!child.material || child.material.isLineBasicMaterial) return;

        const isSelected = (child.userData && child.userData.itemName === selectedName);

        if (isSelected) {
            if (child.material.emissive !== undefined) {
                child.material.emissive = new THREE.Color(0x666666);
                child.material.emissiveIntensity = 0.7;
            }
            child.material.transparent = true;
            child.material.opacity = 1.0;
            child.material.needsUpdate = true;
        } else {
            const origTransparent = child.material.transparent;
            const origOpacity = child.material.opacity;
            originalOpacityStore.set(child, { transparent: origTransparent, opacity: origOpacity });

            child.material.transparent = true;
            child.material.opacity = 0.2;
            child.material.needsUpdate = true;

            child.children.forEach(subChild => {
                if (subChild.isLineSegments && subChild.material && subChild.material.isLineBasicMaterial) {
                    subChild.material.color = new THREE.Color(0x222222);
                }
            });
        }
    });
}

// ==================== ANIMATION ====================

/**
 * Play step-by-step furnace loading animation.
 * Places items one-by-one into the scene with pause/resume/stop controls.
 * Starts from the currently selected furnace, optionally filtering by material.
 *
 * Future Extension:
 *   - Record animation timestamps for replay
 *   - Export animation as video
 */
export async function playLoadingAnimation() {
    if (isAnimating || !globalFurnacesResult || globalFurnacesResult.length === 0) return;

    // Determine starting furnace
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

    setIsAnimating(true);
    setAnimPaused(false);
    setAnimStopped(false);

    const btnAnimate = document.getElementById('btn-animate');
    btnAnimate.disabled = true; btnAnimate.style.opacity = '0.5';

    const controlBar = document.getElementById('anim-control-bar');
    controlBar.classList.add('visible');

    resetAllItemOpacityToOpaque();
    disposeShelfMeshes();
    while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);

    const baseY = -120;
    const itemDrawSteps = [];

    // Build animation steps: start from startFurnaceIndex, wrap around
    const furnaceCount = globalFurnacesResult.length;
    const orderedIndices = [];
    for (let i = 0; i < furnaceCount; i++) {
        orderedIndices.push((startFurnaceIndex + i) % furnaceCount);
    }

    // Pre-create initial furnace wireframe
    const initialFurnace = globalFurnacesResult[orderedIndices[0]];
    const initialContainerGeo = new THREE.BoxGeometry(initialFurnace.w, initialFurnace.h, initialFurnace.d);
    const initialContainerLine = new THREE.LineSegments(
        new THREE.EdgesGeometry(initialContainerGeo),
        new THREE.LineBasicMaterial({ color: 0xe67e22, linewidth: 2 })
    );
    initialContainerLine.position.set(0, initialFurnace.h / 2 + baseY, 0);
    initialContainerLine.userData = { isFurnaceWireframe: true };
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
            mesh.userData = { itemName: item.name, itemId: item.id };
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x000000 })));
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
        setIsAnimating(false);
        controlBar.classList.remove('visible');
        btnAnimate.disabled = false; btnAnimate.style.opacity = '1';
        return;
    }

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitIfPaused = () => new Promise(resolve => {
        const check = () => {
            if (animStopped || !animPaused) resolve();
            else setTimeout(check, 100);
        };
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
        } else {
            itemsGroup.add(step.mesh);
        }

        // Update progress text
        const filterLabel = filterMaterialName ? ` · 仅显示【${filterMaterialName}】` : '';
        document.getElementById('anim-progress-text').textContent =
            `(${i + 1}/${itemDrawSteps.length}) · 将【${step.itemName}】吊装至 ${step.furnaceName} · 坐标(${step.x},${step.y},${step.z})${filterLabel}`;

        // Update banner in stats
        const cspBody = document.getElementById('csp-body');
        const banner = document.createElement('div');
        banner.id = 'anim-banner';
        banner.style.cssText = 'background:#4f46e5;padding:8px 12px;border-radius:4px;font-size:10px;color:#fff;margin:0 12px 6px 12px;border-left:3px solid #00ffff;';
        banner.innerHTML = `🚚 装炉引导 (${i + 1}/${itemDrawSteps.length}) · 将【${step.itemName}】吊装至 <b>${step.furnaceName}</b> · 坐标(${step.x},${step.y},${step.z})`;
        const existing = document.getElementById('anim-banner');
        if (existing) existing.remove();
        document.getElementById('center-stats-panel').insertBefore(banner, cspBody);

        const speedMs = parseInt(document.getElementById('anim-speed-select').value) || 400;
        await sleep(speedMs);
    }

    // Cleanup
    const existingBanner = document.getElementById('anim-banner');
    if (existingBanner) existingBanner.remove();

    controlBar.classList.remove('visible');
    document.getElementById('anim-progress-text').textContent = '';

    if (!animStopped) {
        // Already at the correct furnace — UI will be updated by caller
    } else {
        renderSingleFurnace(currentFurnaceIndex, filterMaterialName);
    }

    btnAnimate.disabled = false; btnAnimate.style.opacity = '1';
    setIsAnimating(false);
    setAnimPaused(false);
    setAnimStopped(false);
}

/**
 * Rebuild scene up to a specific animation step.
 * Used internally by playLoadingAnimation when switching furnaces mid-animation.
 */
function rebuildSceneUpTo(stepIndex, allSteps, filterMaterialName) {
    while (itemsGroup.children.length > 0) itemsGroup.remove(itemsGroup.children[0]);
    const furnaceIndex = allSteps[stepIndex].furnaceIndex;
    const furnace = globalFurnacesResult[furnaceIndex];
    const baseY = -120;

    const containerGeo = new THREE.BoxGeometry(furnace.w, furnace.h, furnace.d);
    const containerLine = new THREE.LineSegments(
        new THREE.EdgesGeometry(containerGeo),
        new THREE.LineBasicMaterial({ color: 0xe67e22, linewidth: 2 })
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

/**
 * Render a master plan in the master Three.js scene.
 * @param {Object} plan - Master plan object {furnaceW, furnaceH, furnaceD, items}
 */
export function renderMasterPlan(plan) {
    while (masterScene.children.length > 2) masterScene.remove(masterScene.children[masterScene.children.length - 1]);

    const fw = plan.furnaceW || 800;
    const fh = plan.furnaceH || 600;
    const fd = plan.furnaceD || 600;

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
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x000000 })));
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

    const approverLine = plan.approver ? `<span style="color:#10b981;">审批人: ${plan.approver}</span> &nbsp;` : '';
    document.getElementById('master-detail-panel').innerHTML = `
        <strong>${plan.title}</strong> &nbsp;
        <span style="color:#888;font-size:10px;">${plan.furnaceType} · ${plan.date} · 操作员: ${plan.operator}</span><br>
        ${approverLine}<span style="color:#a78bfa;">利用率: ${plan.utilization} · 总重: ${plan.totalWeight} · ${plan.itemCount}件</span><br>
        <span style="color:#aaa;">${plan.description}</span>
    `;
}

// ==================== HELPERS ====================

/**
 * Find the index in globalFurnacesResult matching a furnace card's fid.
 * @param {number} fid - Furnace card data-fid attribute value
 * @returns {number} Index or -1
 */
export function findResultIndexByFid(fid) {
    if (!globalFurnacesResult) return -1;
    const cardEl = document.getElementById(`furnace-card-${fid}`);
    if (!cardEl) return -1;
    const name = cardEl.querySelector('.f-card-name').textContent;
    for (let i = 0; i < globalFurnacesResult.length; i++) {
        if (globalFurnacesResult[i].typeName === name) return i;
    }
    return -1;
}