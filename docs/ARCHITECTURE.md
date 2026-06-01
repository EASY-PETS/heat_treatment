# 热处理预装炉智能体 — Architecture Document

## Folder Structure

```
/heat_treatment/
├── furnace.html              # Application entry point (HTML shell)
├── css/
│   └── main.css              # All application styles
├── js/
│   ├── app.js                # Application startup & event coordination
│   ├── state.js              # Central shared application state
│   ├── three-scene.js        # All Three.js rendering code
│   ├── furnace-engine.js     # Packing algorithms (core business logic)
│   ├── ui.js                 # DOM UI rendering & interaction
│   └── pdf-export.js         # PDF report generation & export
├── docs/
│   └── ARCHITECTURE.md       # This document
└── 热处理工件导入模板.xlsx    # Excel import template
```

## Module Responsibilities

### `furnace.html`
- HTML shell only: contains the DOM structure (top bar, panels, modals)
- Loads external CSS (`css/main.css`)
- Loads external JS (`html2pdf`, `SheetJS/XLSX`)
- Loads Three.js via importmap
- Single `<script type="module" src="js/app.js">` tag for all application logic

### `css/main.css`
- All application styles
- Dark theme with CSS custom properties (variables)
- Panel layouts, card styles, modal overlays
- PDF template styles
- No JavaScript dependencies

### `js/state.js`
- **Central application state** — single source of truth
- Exports all mutable state variables as ES module exports
- Provides setter functions for state mutation
- Contains `masterPlans` data (pre-loaded historical plans)
- Contains `placementRules` configuration
- No business logic — only data

### `js/three-scene.js`
- **All Three.js code** lives here
- Scene initialization (`initThree`, `initMasterThree`)
- Furnace rendering (`renderSingleFurnace`)
- Shelf mesh management (`disposeShelfMeshes`, `renderShelvesForFurnace`)
- Opacity/highlight management (`highlightItemsInScene`, `resetAllItemOpacityToOpaque`)
- Loading animation (`playLoadingAnimation`)
- Master plan 3D rendering (`renderMasterPlan`)
- Helper functions (`generateUniqueColor`, `findResultIndexByFid`, `getSelectedMaterialName`)
- Imports from `state.js` and `three`/`OrbitControls`

### `js/furnace-engine.js`
- **Core business module** — packing algorithms
- `solveHeterogeneousPacking()` — default 3D bin packing
- `solveShelfLayeredPacking()` — shelf-layered algorithm
- `solveShelfLayeredMultiFurnace()` — multi-furnace wrapper
- `solveCenterOfGravityPacking()` — center-of-gravity algorithm
- `solveCenterOfGravityMultiFurnace()` — multi-furnace wrapper
- `executePacking()` — main routing entry point
- Imports `placementRules` from `state.js`

### `js/ui.js`
- **DOM UI rendering** — furnace cards, material cards, detail panels
- `getFurnaceDataFromCard()` / `getMaterialDataFromCard()` — DOM data extractors
- `createFurnaceCard()` / `createMaterialCard()` — card factory functions
- `showFurnaceDetail()` / `showMaterialDetail()` — detail form rendering
- `saveFurnaceDetail()` / `saveMaterialDetail()` — form save handlers
- Furnace drag-to-sort and sort buttons
- `updateTopSummary()`, `updateFurnaceNav()`, `updateCenterStats()` — UI sync
- `showCapacityFeedback()` — notification banner
- Placement rules modal (`openRulesModal`, `saveRulesModal`)
- Master view list management (`initMasterView`)
- Excel import (`parseExcelData`, `showImportPreview`, `applyImportData`)
- JSON import (`openJsonImportModal`, `parseJsonPlan`, `renderJsonPreview`, `importJsonPlanToMaster`)
- Imports from `state.js` and `three-scene.js`

### `js/pdf-export.js`
- **PDF export logic** — all report generation
- `showPdfSelectModal()` — furnace selection modal
- `exportSingleFurnacePDF()` — main PDF export pipeline
- `createFurnaceInfoPage()` — furnace info + rules page
- `createWorklistPage()` — workpiece coordinates table
- `createUnpackedItemsPage()` — unloaded items list
- `exportFurnaceJSON()` — JSON export for master plans
- Helper functions: `createRulerOverlay`, `createViewPage`, `createSignaturePage`, `createMaterialLegendPage`
- Imports from `state.js` and `ui.js`

### `js/app.js`
- **Application coordinator** — wires everything together
- `init()` — initializes Three.js scene, creates default cards, binds all event listeners
- `executeAndRender()` — orchestrates plan generation: collects data → runs algorithm → renders scene → updates UI
- `navigateFurnace()` — coordinates furnace navigation
- `showMasterView()` / `hideMasterView()` — master view toggle
- All DOM event bindings in one place
- No business logic — only orchestration
- Imports from all other modules

## Application Startup Flow

```
1. Browser loads furnace.html
   ├── Loads css/main.css
   ├── Loads html2pdf.js (global)
   ├── Loads xlsx.full.min.js (global XLSX)
   ├── Loads Three.js importmap
   └── Executes <script type="module" src="js/app.js">

2. js/app.js init() runs:
   ├── Calls initThree() from three-scene.js → creates scene, camera, renderer
   ├── Creates 2 default furnace cards via ui.js
   ├── Updates top summary
   └── Binds 40+ event listeners to DOM elements
```

## State Flow

```
User Action → Event Handler (app.js)
  ├── Reads DOM data (ui.js: getFurnaceDataFromCard, getMaterialDataFromCard)
  ├── Updates state (state.js setter functions)
  ├── Runs algorithm (furnace-engine.js: executePacking)
  ├── Updates state with results (globalFurnacesResult, globalUnpackedItems)
  ├── Renders 3D scene (three-scene.js: renderSingleFurnace)
  └── Updates UI panels (ui.js: updateFurnaceNav, updateCenterStats, updateTopSummary)
```

## Three.js Flow

```
initThree()
  └── Creates scene, camera, renderer, controls, lights, grid
  └── Creates itemsGroup (THREE.Group) attached to scene
  └── Starts render loop

renderSingleFurnace(index)
  └── Clears itemsGroup
  └── Creates furnace wireframe (LineSegments)
  └── Creates item meshes (BoxGeometry or CylinderGeometry)
  └── Positions items relative to furnace origin
  └── Optionally renders shelf planes
```

## Future Extension Strategy

### AI Copilot
- **Target module:** `furnace-engine.js`
- Add `js/ai/` folder with optimization algorithms
- Replace `executePacking()` routing with AI-powered decision
- Add feedback loop: AI learns from user adjustments

### Feishu Bitable Integration
- **New module:** `js/integrations/feishu.js`
- Import/export data to Feishu Bitable
- Sync furnace configs and material lists

### Multi-company Support
- **Target module:** `state.js`
- Add `companyId` to state
- Namespace data by company

### Rule Engine
- **Target module:** `furnace-engine.js`
- Externalize placement rules into configurable rule sets
- Add rule priority/precedence system

### Furnace/Material Management Pages
- **New HTML pages:** `furnace-management.html`, `material-management.html`
- Share `state.js` and core modules
- Add routing in `app.js`

### PDF Preview Page
- **Target module:** `pdf-export.js`
- Add live preview before download
- Add template customization

## Key Design Decisions

1. **ES Modules over monolithic script** — enables clean dependency graph
2. **Central state over scattered variables** — state.js is the single source of truth
3. **Separation of concerns** — UI, 3D, algorithms, PDF all in separate modules
4. **app.js as coordinator** — no business logic, only wiring
5. **No framework** — vanilla ES modules for simplicity and zero build step
6. **Function callbacks for cross-module coordination** — avoids circular imports (e.g., `updateCenterStats(onFurnaceClick)`)