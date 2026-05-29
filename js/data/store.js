// ==================== 数据存储模块 ====================

import { STORAGE_KEYS, DEFAULT_FURNACES, DEFAULT_ITEMS, DEFAULT_SPACING } from '../utils/constants.js';
import { deepClone } from '../utils/helpers.js';

/**
 * 数据存储管理器
 * 支持 LocalStorage 和 IndexedDB 两种方式
 */
class DataStore {
    constructor() {
        this.storageType = 'localStorage'; // 默认使用 LocalStorage
    }

    /**
     * 保存炉膛数据
     */
    saveFurnaces(furnaces) {
        try {
            localStorage.setItem(STORAGE_KEYS.furnaces, JSON.stringify(furnaces));
            return true;
        } catch (e) {
            console.error('保存炉膛数据失败:', e);
            return false;
        }
    }

    /**
     * 读取炉膛数据
     */
    loadFurnaces() {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.furnaces);
            if (data) {
                return JSON.parse(data);
            }
            return deepClone(DEFAULT_FURNACES);
        } catch (e) {
            console.error('读取炉膛数据失败:', e);
            return deepClone(DEFAULT_FURNACES);
        }
    }

    /**
     * 保存工件数据
     */
    saveItems(items) {
        try {
            localStorage.setItem(STORAGE_KEYS.items, JSON.stringify(items));
            return true;
        } catch (e) {
            console.error('保存工件数据失败:', e);
            return false;
        }
    }

    /**
     * 读取工件数据
     */
    loadItems() {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.items);
            if (data) {
                return JSON.parse(data);
            }
            return deepClone(DEFAULT_ITEMS);
        } catch (e) {
            console.error('读取工件数据失败:', e);
            return deepClone(DEFAULT_ITEMS);
        }
    }

    /**
     * 保存设置
     */
    saveSettings(settings) {
        try {
            localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
            return true;
        } catch (e) {
            console.error('保存设置失败:', e);
            return false;
        }
    }

    /**
     * 读取设置
     */
    loadSettings() {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.settings);
            if (data) {
                return JSON.parse(data);
            }
            return { spacing: DEFAULT_SPACING };
        } catch (e) {
            console.error('读取设置失败:', e);
            return { spacing: DEFAULT_SPACING };
        }
    }

    /**
     * 保存装炉结果
     */
    saveResults(results) {
        try {
            localStorage.setItem(STORAGE_KEYS.results, JSON.stringify(results));
            return true;
        } catch (e) {
            console.error('保存结果失败:', e);
            return false;
        }
    }

    /**
     * 读取装炉结果
     */
    loadResults() {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.results);
            if (data) {
                return JSON.parse(data);
            }
            return null;
        } catch (e) {
            console.error('读取结果失败:', e);
            return null;
        }
    }

    /**
     * 清除所有数据
     */
    clearAll() {
        try {
            Object.values(STORAGE_KEYS).forEach(key => {
                localStorage.removeItem(key);
            });
            return true;
        } catch (e) {
            console.error('清除数据失败:', e);
            return false;
        }
    }

    /**
     * 导出所有数据为JSON
     */
    exportAllData() {
        return {
            furnaces: this.loadFurnaces(),
            items: this.loadItems(),
            settings: this.loadSettings(),
            results: this.loadResults(),
            exportTime: new Date().toISOString()
        };
    }

    /**
     * 导入数据
     */
    importData(data) {
        try {
            if (data.furnaces) this.saveFurnaces(data.furnaces);
            if (data.items) this.saveItems(data.items);
            if (data.settings) this.saveSettings(data.settings);
            if (data.results) this.saveResults(data.results);
            return true;
        } catch (e) {
            console.error('导入数据失败:', e);
            return false;
        }
    }
}

// 创建全局数据存储实例
const dataStore = new DataStore();

export default dataStore;