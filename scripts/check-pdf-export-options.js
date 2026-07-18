const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

    const fieldDefaults = applyPdfTemplateDefaults(PDF_TEMPLATE.FIELD_LARGE);
    assert.equal(fieldDefaults.includeCoordinateList, false);
    assert.equal(fieldDefaults.includeHighDensityZoom, true);
    assert.equal(fieldDefaults.orientation, PDF_ORIENTATION);

    assert.equal(Object.isFrozen(PDF_EXPORT_DEFAULTS), true);
    assert.equal(Object.isFrozen(PDF_EXPORT_DEFAULTS.selectedFurnaceIds), true);

    console.log('PDF export options checks passed.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
