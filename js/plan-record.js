// plan-record.js
import {
    globalFurnacesResult,
    globalUnpackedItems,
    placementRules,
    globalPredictions
} from './state.js';

function clonePlain(obj) {
    return JSON.parse(JSON.stringify(obj || null));
}

function calcFurnaceVolume(f) {
    return (f.w || 0) * (f.h || 0) * (f.d || 0);
}

function calcPackedVolume(f) {
    return (f.packedItems || []).reduce((sum, item) => {
        return sum + ((item.w || 0) * (item.h || 0) * (item.d || 0));
    }, 0);
}

function normalizePlacedItem(item, index) {
    return {
        placedItemId: item.id || `PLACED-${index}`,
        materialBatchId: item.itemCode || item.name || `MAT-${index}`,

        name: item.name || '',
        shape: item.shape || 'cuboid',

        position: {
            x: item.x || 0,
            y: item.y || 0,
            z: item.z || 0
        },

        size: {
            width: item.w || 0,
            height: item.h || 0,
            depth: item.d || 0
        },

        algorithmSize: {
            width: item.w_algo || item.w || 0,
            height: item.h_algo || item.h || 0,
            depth: item.d_algo || item.d || 0
        },

        rotation: {
            x: 0,
            y: 0,
            z: 0
        },

        layer: item.layer || 1,
        weightKg: item.weight || 0,
        color: item.color || '#999999',

        material: item.material || '',
        process: item.process || '',
        hardnessTarget: item.hardness || '',
        customer: item.customer || '',
        itemCode: item.itemCode || '',
        showName: item.showName || '',
        orderDate: item.orderDate || '',
        deliveryDate: item.deliveryDate || '',
        remark: item.remark || '',
        rotationInfo: item.rotationInfo || '',
        originalDims: item.originalDims || null
    };
}

function normalizeFurnace(f, index) {
    const furnaceVolume = calcFurnaceVolume(f);
    const packedVolume = calcPackedVolume(f);

    return {
        furnaceInstanceId: f.instanceId || `FURNACE-HEAT-${index + 1}`,
        instanceName: f.instanceId || `炉次 #${index + 1}`,

        typeName: f.typeName || '',
        equipmentId: f.equipmentId || '',
        toolingId: f.toolingId || '',

        toolingType: f.toolingType || 'standard-basket',
        basketType: f.basketType || 'grid',
        params: clonePlain(f.params || {}),

        dimensions: {
            width: f.w || 0,
            height: f.h || 0,
            depth: f.d || 0,
            unit: 'mm'
        },

        maxWeightKg: f.max_weight || 0,
        totalWeightKg: f.totalWeight || 0,
        itemCount: (f.packedItems || []).length,

        spaceUtilization: furnaceVolume > 0 ? packedVolume / furnaceVolume : 0,
        weightUtilization: f.max_weight > 0 ? (f.totalWeight || 0) / f.max_weight : 0,

        spacingMm: f.spacing || 5,

        // 标准料框是真实搁板；环形工装这里先作为 loadingLevels 使用
        shelvesUsed: clonePlain(f.shelvesUsed || []),
        loadingLevels: (f.shelvesUsed || []).map((s, i) => ({
            level: i + 2,
            y: s.y || 0,
            type: f.toolingType === 'ring-tooling' ? 'virtual-loading-level' : 'physical-shelf',
            thickness: s.thickness || 0
        })),

        packedItems: (f.packedItems || []).map(normalizePlacedItem),

        /**
         * 一期关键：保留当前运行时结构快照。
         * 这样导入时可以直接恢复 globalFurnacesResult，避免历史页和当前3D渲染再次脱节。
         */
        runtimeFurnace: clonePlain(f)
    };
}

export function buildCurrentDigitalTwinRecord(options = {}) {
    const title = options.title || '当前装炉方案';

    return {
        schemaVersion: 'heat-treatment-digital-twin-v1',
        recordType: 'furnace-loading-record',

        meta: {
            planId: 'PLAN-' + Date.now(),
            title,
            createdAt: new Date().toISOString(),
            createdBy: options.createdBy || 'local-user',
            source: 'ai-loading-workbench',
            status: 'planned',
            appVersion: 'local-dev',
            algorithmVersion: 'packing-engine-current'
        },

        factory: options.factory || {},

        equipment: options.equipment || {},

        tooling: options.tooling || {},

        process: {
            strategy: placementRules.strategy || 'balanced',
            rules: clonePlain(placementRules)
        },

        materials: options.materials || [],

        loadingPlan: {
            coordinateSystem: {
                origin: 'furnace-center-bottom',
                unit: 'mm',
                axes: {
                    x: 'width',
                    y: 'height',
                    z: 'depth'
                }
            },

            strategy: placementRules.strategy || 'balanced',
            rules: clonePlain(placementRules),

            furnaces: (globalFurnacesResult || []).map(normalizeFurnace),
            unpackedItems: clonePlain(globalUnpackedItems || [])
        },

        simulation: {
            simulationId: '',
            simulationType: 'template-based-approximation',
            modelVersion: '',
            thermal: {},
            airflow: {},
            radiation: {},
            summary: {}
        },

        energy: {
            planned: {},
            actual: {},
            breakdown: {},
            baseline: {},
            timeSeries: []
        },

        performance: {
            planned: {},
            actual: {},
            kpi: {}
        },

        quality: {
            inspectionStatus: '',
            passRate: null,
            hardnessResults: [],
            deformationResults: [],
            defects: []
        },

        predictions: clonePlain(globalPredictions || null),

        attachments: {},
        audit: {
            events: [
                {
                    type: 'exported',
                    at: new Date().toISOString(),
                    by: options.createdBy || 'local-user'
                }
            ]
        }
    };
}

export function downloadJsonFile(data, filename) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 0);
}

export function isDigitalTwinRecord(data) {
    return data &&
        data.schemaVersion === 'heat-treatment-digital-twin-v1' &&
        data.recordType === 'furnace-loading-record' &&
        data.loadingPlan &&
        Array.isArray(data.loadingPlan.furnaces);
}

export function parseDigitalTwinRecord(jsonStr) {
    const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;

    if (!isDigitalTwinRecord(data)) {
        throw new Error('不是 heat-treatment-digital-twin-v1 装炉数字孪生记录');
    }

    return data;
}

export function getRuntimeFurnacesFromRecord(record) {
    if (!isDigitalTwinRecord(record)) {
        throw new Error('无法从非标准装炉记录中恢复炉次');
    }

    return record.loadingPlan.furnaces.map(f => {
        if (f.runtimeFurnace) return f.runtimeFurnace;

        return {
            instanceId: f.instanceName || f.furnaceInstanceId,
            typeName: f.typeName || '',
            w: f.dimensions?.width || 0,
            h: f.dimensions?.height || 0,
            d: f.dimensions?.depth || 0,
            max_weight: f.maxWeightKg || 0,
            totalWeight: f.totalWeightKg || 0,
            spacing: f.spacingMm || 5,
            toolingType: f.toolingType || 'standard-basket',
            basketType: f.basketType || 'grid',
            params: f.params || {},
            shelvesUsed: f.shelvesUsed || [],
            packedItems: (f.packedItems || []).map(item => ({
                id: item.placedItemId,
                name: item.name,
                shape: item.shape,
                x: item.position?.x || 0,
                y: item.position?.y || 0,
                z: item.position?.z || 0,
                w: item.size?.width || 0,
                h: item.size?.height || 0,
                d: item.size?.depth || 0,
                w_algo: item.algorithmSize?.width || item.size?.width || 0,
                h_algo: item.algorithmSize?.height || item.size?.height || 0,
                d_algo: item.algorithmSize?.depth || item.size?.depth || 0,
                weight: item.weightKg || 0,
                color: item.color || '#999999',
                material: item.material || '',
                process: item.process || '',
                hardness: item.hardnessTarget || '',
                customer: item.customer || '',
                itemCode: item.itemCode || '',
                showName: item.showName || '',
                rotationInfo: item.rotationInfo || '',
                originalDims: item.originalDims || null
            }))
        };
    });
}