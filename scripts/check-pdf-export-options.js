const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function assertManifestRecordConsistency(manifest, record) {
    const furnaces = record.loadingPlan.furnaces;
    const ids = furnaces.map(furnace => furnace.furnaceInstanceId);
    const itemCount = furnaces.reduce((sum, furnace) => sum + furnace.packedItems.length, 0);
    const totalWeight = furnaces.reduce((sum, furnace) => sum + furnace.totalWeightKg, 0);
    assert.equal(manifest.summary.furnaceCount, furnaces.length);
    assert.equal(manifest.summary.itemCount, itemCount);
    assert.ok(Math.abs(manifest.summary.totalWeight - totalWeight) < 0.001);
    assert.deepEqual(manifest.options.selectedFurnaceIds, manifest.summary.furnaceIds);
    assert.deepEqual(ids, manifest.summary.furnaceIds);
}

function loadPaginationHelpers() {
    const modulePath = path.resolve(__dirname, '../js/pdf-six-page.js');
    const source = fs.readFileSync(modulePath, 'utf8');
    const block = source.match(/const TABLE_PAGINATION_LAYOUTS[\s\S]*?(?=const SVG_W)/)?.[0];
    assert.ok(block, 'production pagination helpers must remain statically discoverable');
    const executable = block
        .replace('const TABLE_PAGINATION_LAYOUTS', 'const TABLE_PAGINATION_LAYOUTS')
        .replace('export function getSafeTableRowCount', 'function getSafeTableRowCount')
        .replace('export function paginatePdfTableRows', 'function paginatePdfTableRows');
    return Function(`${executable}; return { TABLE_PAGINATION_LAYOUTS, getSafeTableRowCount, paginatePdfTableRows };`)();
}

function assertSafePagination({ TABLE_PAGINATION_LAYOUTS, getSafeTableRowCount, paginatePdfTableRows }) {
    const coordinateLayout = TABLE_PAGINATION_LAYOUTS.coordinateList;
    const zoomLayout = TABLE_PAGINATION_LAYOUTS.densityZoom;
    assert.equal(getSafeTableRowCount(coordinateLayout), 22);
    assert.equal(getSafeTableRowCount(zoomLayout), 22);

    [39, 122].forEach(total => {
        const source = Array.from({ length: total }, (_, index) => index + 1);
        [coordinateLayout, zoomLayout].forEach(layout => {
            const chunks = paginatePdfTableRows(source, layout);
            const flattened = chunks.flatMap(chunk => chunk.items);
            assert.deepEqual(flattened, source);
            chunks.forEach((chunk, index) => {
                assert.equal(chunk.start, index * 22);
                assert.ok(chunk.items.length > 0 && chunk.items.length <= 22);
            });
        });
    });
}

async function loadOptionsModule() {
    const modulePath = path.resolve(__dirname, '../js/pdf-export-options.js');
    const source = fs.readFileSync(modulePath, 'utf8');
    const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    return import(dataUrl);
}

async function main() {
    const {
        PDF_EXPORT_DEFAULTS,
        PDF_ORIENTATION,
        PDF_TEMPLATE,
        applyPdfTemplateDefaults,
        normalizePdfExportOptions
    } = await loadOptionsModule();

    const empty = normalizePdfExportOptions();
    assert.deepEqual(empty, {
        schemaVersion: '1.0',
        template: PDF_TEMPLATE.STANDARD,
        orientation: PDF_ORIENTATION,
        includeCoordinateList: true,
        includeHighDensityZoom: true,
        exportJson: false,
        selectedFurnaceIds: []
    });

    const source = {
        template: PDF_TEMPLATE.FIELD_LARGE,
        orientation: 'portrait',
        includeCoordinateList: true,
        includeHighDensityZoom: false,
        exportJson: true,
        selectedFurnaceIds: [2, '1', 2, -1, 'bad', '0', 0, '12'],
        unknownField: 'discard me'
    };
    const snapshot = structuredClone(source);
    const normalized = normalizePdfExportOptions(source);

    assert.deepEqual(source, snapshot, 'normalization must not mutate its input');
    assert.deepEqual(normalized, {
        schemaVersion: '1.0',
        template: PDF_TEMPLATE.FIELD_LARGE,
        orientation: PDF_ORIENTATION,
        includeCoordinateList: true,
        includeHighDensityZoom: false,
        exportJson: true,
        selectedFurnaceIds: [2, 1, 0, 12]
    });
    assert.equal('unknownField' in normalized, false);

    const furnaceIdBoundaries = normalizePdfExportOptions({
        selectedFurnaceIds: [
            0,
            '12',
            7,
            '0',
            12,
            '',
            '   ',
            null,
            undefined,
            true,
            false,
            1.5,
            -1,
            '-2',
            '1.0',
            '1e2',
            '12px',
            {},
            [],
            ['3']
        ]
    });
    assert.deepEqual(
        furnaceIdBoundaries.selectedFurnaceIds,
        [0, 12, 7],
        'furnace IDs must be strict non-negative integers, deduplicated in input order'
    );

    const invalid = normalizePdfExportOptions({
        template: 'unknown',
        orientation: 'portrait',
        includeCoordinateList: 'yes',
        includeHighDensityZoom: 1,
        exportJson: null,
        selectedFurnaceIds: '0'
    });
    assert.deepEqual(invalid, empty);

    const legacyAliasesAreDiscarded = normalizePdfExportOptions({
        includeWorklist: false,
        includeCoordinates: false,
        densityZoom: false,
        regionZoom: true,
        exportJson: true,
        selectedFurnaceIds: [1]
    });
    assert.deepEqual(legacyAliasesAreDiscarded, {
        schemaVersion: '1.0',
        template: PDF_TEMPLATE.STANDARD,
        orientation: PDF_ORIENTATION,
        includeCoordinateList: true,
        includeHighDensityZoom: true,
        exportJson: true,
        selectedFurnaceIds: [1]
    }, 'legacy aliases must not enter the canonical options pipeline');

    const fieldDefaults = applyPdfTemplateDefaults(PDF_TEMPLATE.FIELD_LARGE);
    assert.equal(fieldDefaults.includeCoordinateList, false);
    assert.equal(fieldDefaults.includeHighDensityZoom, true);
    assert.equal(fieldDefaults.orientation, PDF_ORIENTATION);

    assert.equal(Object.isFrozen(PDF_EXPORT_DEFAULTS), true);
    assert.equal(Object.isFrozen(PDF_EXPORT_DEFAULTS.selectedFurnaceIds), true);

    const manifest = {
        options: { selectedFurnaceIds: ['标准料框 (炉次 #1)', '网篮 (炉次 #1)'] },
        summary: {
            furnaceCount: 2,
            itemCount: 140,
            totalWeight: 28,
            furnaceIds: ['标准料框 (炉次 #1)', '网篮 (炉次 #1)']
        }
    };
    const record = {
        loadingPlan: {
            furnaces: [
                { furnaceInstanceId: '标准料框 (炉次 #1)', totalWeightKg: 25.6, packedItems: Array(128).fill({}) },
                { furnaceInstanceId: '网篮 (炉次 #1)', totalWeightKg: 2.4, packedItems: Array(12).fill({}) }
            ]
        }
    };
    assertManifestRecordConsistency(manifest, record);
    assertSafePagination(loadPaginationHelpers());

    console.log('PDF export options checks passed.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
