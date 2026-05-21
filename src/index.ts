import {fetchPost, Plugin, Setting, showMessage} from "siyuan";
import type {IMenu} from "siyuan";
import "./index.scss";

const STORAGE_NAME = "settings";
const PENDING_SYNC_STORAGE = "pending-sync";
const CUSTOM_SY_AV_VIEW = "custom-sy-av-view";
const DEFAULT_ASSET_FIELD_NAME = "内容图";
const IMAGE_EXTENSIONS = [
    ".apng",
    ".avif",
    ".bmp",
    ".gif",
    ".jpeg",
    ".jpg",
    ".png",
    ".svg",
    ".webp",
];
const AUTO_SYNC_DELAY_MS = 1500;
const PENDING_SYNC_MAX_ITEMS = 500;
const PENDING_SYNC_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONTENT_IMAGE_SYNC_ICON = `<svg class="b3-menu__icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="12.5" width="9" height="6.5" rx="1.4"/><path d="m4.5 17.1 1.8-1.7 1.4 1.2 1.2-1 1.6 1.5"/><circle cx="9.7" cy="14.5" r=".6" fill="currentColor" stroke="none"/><ellipse cx="16" cy="5" rx="4" ry="2"/><path d="M12 5v5c0 1.1 1.8 2 4 2s4-.9 4-2V5"/><path d="M12 7.5c0 1.1 1.8 2 4 2s4-.9 4-2"/><path d="M8.4 11.1c1.7-2.2 3.8-3.4 6.4-3.7"/><path d="m12.7 4.9 2.7 2.3-2.5 2.4"/></svg>`;

interface PluginSettings {
    assetFieldName: string;
    replaceExisting: boolean;
    autoSyncVisible: boolean;
}

interface SiyuanResponse<T> {
    code: number;
    msg?: string;
    data: T;
}

interface AVRenderData {
    id: string;
    name: string;
    viewID: string;
    viewType: string;
    view: AVView;
}

interface AVView {
    columns?: AVColumn[];
    fields?: AVColumn[];
    rows?: AVRow[];
    cards?: AVCard[];
    groups?: AVView[];
}

interface AVColumn {
    id: string;
    name: string;
    type: string;
}

interface AVRow {
    id: string;
    cells: AVCell[];
}

interface AVCard {
    id: string;
    values: AVCell[];
}

interface AVCell {
    id: string;
    valueType: string;
    value?: AVCellValue;
}

interface AVCellValue {
    id?: string;
    keyID?: string;
    blockID?: string;
    type: string;
    isDetached?: boolean;
    block?: {
        id?: string;
        content?: string;
    };
    mAsset?: AVAsset[];
}

interface AVAsset {
    type: "image";
    name: string;
    content: string;
}

interface SyncRecord {
    itemID: string;
    cells: AVCell[];
}

interface AssetRow {
    root_id?: string;
    block_id?: string;
    path?: string;
    name?: string;
    title?: string;
}

interface BatchValue {
    keyID: string;
    itemID: string;
    value: AVCellValue;
}

interface SyncResult {
    changed: number;
    scanned: number;
    skipped?: number;
}

interface DatabaseSyncResult extends SyncResult {
    databases: number;
    matchedItems: number;
    matchedContextIDs: string[];
}

interface SyncAVOptions {
    onlyItemIDs?: string[];
    emptyResultGuard?: boolean;
}

interface CollectImagesOptions {
    preferKramdown?: boolean;
}

interface ImageCollection {
    assets: Map<string, AVAsset[]>;
    confirmedEmptyIDs: Set<string>;
}

interface AVKeyValues {
    key: AVColumn;
    values?: AVCellValue[];
}

interface BlockRootRow {
    id: string;
    root_id?: string;
}

interface BlockAttributeViewKeys {
    avID: string;
    avName: string;
    blockIDs: string[];
    keyValues: AVKeyValues[];
}

interface PendingBoundItem {
    avID: string;
    avName: string;
    itemID: string;
    fieldID: string;
    fieldName: string;
}

interface PendingSyncItem {
    changedBlockID: string;
    contextIDs: string[];
    boundItems: PendingBoundItem[];
    updatedAt: number;
    attempts: number;
}

interface PendingSyncData {
    items: PendingSyncItem[];
}

interface AVMenuDetail {
    menu?: {
        addItem(item: IMenu): void;
    };
    element?: Element;
    selectRowElements?: Iterable<Element> | ArrayLike<Element>;
}

interface WsOperation {
    action?: string;
    id?: string;
    rootID?: string;
    parentID?: string;
    previousID?: string;
    nextID?: string;
    blockID?: string;
    blockIDs?: string[];
}

interface WsTransaction {
    doOperations?: WsOperation[];
    undoOperations?: WsOperation[];
}

const defaultSettings: PluginSettings = {
    assetFieldName: DEFAULT_ASSET_FIELD_NAME,
    replaceExisting: true,
    autoSyncVisible: false,
};

export default class DbContentImagesPlugin extends Plugin {
    private settingsData: PluginSettings = {...defaultSettings};
    private fieldNameInput?: HTMLInputElement;
    private replaceExistingInput?: HTMLInputElement;
    private autoSyncInput?: HTMLInputElement;
    private autoSyncTimer = 0;
    private pendingSyncFlushTimer = 0;
    private documentSyncRunning = false;
    private pendingSyncRunning = false;
    private imageObserver?: MutationObserver;
    private databaseObserver?: MutationObserver;
    private pendingDocumentSyncIDs = new Set<string>();
    private pendingSyncData: PendingSyncData = {items: []};
    private syncingAvIDs = new Set<string>();
    private wsHandler = (event: CustomEvent) => this.handleWsEvent(event);
    private avMenuHandler = (event: CustomEvent) => this.addAVMenuItem(event);

    async onload() {
        await this.loadSettings();
        await this.loadPendingSyncData();
        this.eventBus.on("ws-main", this.wsHandler);
        this.eventBus.on("open-menu-av", this.avMenuHandler);
        this.updateDocumentImageObserver();

        this.addCommand({
            langKey: "syncCurrentDatabase",
            callback: () => {
                this.syncCurrentDatabase().catch((error) => this.showError(error));
            },
        });

        this.addCommand({
            langKey: "syncVisibleDatabases",
            callback: () => {
                this.syncVisibleDatabases().catch((error) => this.showError(error));
            },
        });

        this.setting = new Setting({
            confirmCallback: () => {
                this.saveSettingsFromInputs().catch((error) => this.showError(error));
            },
        });

        this.setting.addItem({
            title: this.i18n.assetFieldName,
            description: this.i18n.assetFieldNameDesc,
            createActionElement: () => {
                this.fieldNameInput = document.createElement("input");
                this.fieldNameInput.className = "b3-text-field fn__block";
                this.fieldNameInput.value = this.settingsData.assetFieldName;
                this.fieldNameInput.placeholder = DEFAULT_ASSET_FIELD_NAME;
                return this.fieldNameInput;
            },
        });

        this.setting.addItem({
            title: this.i18n.replaceExisting,
            description: this.i18n.replaceExistingDesc,
            createActionElement: () => {
                this.replaceExistingInput = this.createSwitch(this.settingsData.replaceExisting);
                return this.replaceExistingInput;
            },
        });

        this.setting.addItem({
            title: this.i18n.autoSyncVisible,
            description: this.i18n.autoSyncVisibleDesc,
            createActionElement: () => {
                this.autoSyncInput = this.createSwitch(this.settingsData.autoSyncVisible);
                return this.autoSyncInput;
            },
        });
    }

    onunload() {
        this.eventBus.off("ws-main", this.wsHandler);
        this.eventBus.off("open-menu-av", this.avMenuHandler);
        this.stopDocumentImageObserver();
        this.stopDatabaseObserver();
        window.clearTimeout(this.autoSyncTimer);
        window.clearTimeout(this.pendingSyncFlushTimer);
    }

    uninstall() {
        this.removeData(STORAGE_NAME);
        this.removeData(PENDING_SYNC_STORAGE);
    }

    private async loadSettings() {
        this.data[STORAGE_NAME] = {...defaultSettings};
        try {
            await this.loadData(STORAGE_NAME);
        } catch (error) {
            console.debug(`[${this.name}] load settings failed`, error);
        }
        this.settingsData = this.normalizeSettings(this.data[STORAGE_NAME]);
    }

    private async loadPendingSyncData() {
        this.data[PENDING_SYNC_STORAGE] = {items: []};
        try {
            await this.loadData(PENDING_SYNC_STORAGE);
        } catch (error) {
            console.debug(`[${this.name}] load pending sync failed`, error);
        }

        this.pendingSyncData = this.normalizePendingSyncData(this.data[PENDING_SYNC_STORAGE]);
        if (this.prunePendingSyncData()) {
            await this.savePendingSyncData();
        }
    }

    private async savePendingSyncData() {
        this.pendingSyncData = this.normalizePendingSyncData(this.pendingSyncData);
        await this.saveData(PENDING_SYNC_STORAGE, this.pendingSyncData);
    }

    private async saveSettingsFromInputs() {
        this.settingsData = {
            assetFieldName: (this.fieldNameInput?.value || DEFAULT_ASSET_FIELD_NAME).trim() || DEFAULT_ASSET_FIELD_NAME,
            replaceExisting: !!this.replaceExistingInput?.checked,
            autoSyncVisible: !!this.autoSyncInput?.checked,
        };
        await this.saveData(STORAGE_NAME, this.settingsData);
        this.updateDocumentImageObserver();
        showMessage(this.i18n.settingsSaved);
    }

    private normalizeSettings(raw: unknown): PluginSettings {
        const data = raw as Partial<PluginSettings> | undefined;
        return {
            assetFieldName: (data?.assetFieldName || DEFAULT_ASSET_FIELD_NAME).trim() || DEFAULT_ASSET_FIELD_NAME,
            replaceExisting: typeof data?.replaceExisting === "boolean" ? data.replaceExisting : defaultSettings.replaceExisting,
            autoSyncVisible: typeof data?.autoSyncVisible === "boolean" ? data.autoSyncVisible : defaultSettings.autoSyncVisible,
        };
    }

    private normalizePendingSyncData(raw: unknown): PendingSyncData {
        const data = raw as Partial<PendingSyncData> | undefined;
        const items = Array.isArray(data?.items) ? data.items : [];
        return {
            items: items
                .map((item) => this.normalizePendingSyncItem(item))
                .filter((item): item is PendingSyncItem => !!item),
        };
    }

    private normalizePendingSyncItem(raw: unknown): PendingSyncItem | undefined {
        const item = raw as Partial<PendingSyncItem> | undefined;
        const changedBlockID = typeof item?.changedBlockID === "string" ? item.changedBlockID : "";
        const contextIDs = Array.isArray(item?.contextIDs) ?
            Array.from(new Set(item.contextIDs.filter((id): id is string => typeof id === "string" && id.length > 0))) :
            [];
        const boundItems = Array.isArray(item?.boundItems) ?
            item.boundItems
                .map((boundItem) => this.normalizePendingBoundItem(boundItem))
                .filter((boundItem): boundItem is PendingBoundItem => !!boundItem) :
            [];

        if (!changedBlockID || contextIDs.length === 0 || boundItems.length === 0) {
            return undefined;
        }

        return {
            changedBlockID,
            contextIDs,
            boundItems,
            updatedAt: typeof item?.updatedAt === "number" ? item.updatedAt : Date.now(),
            attempts: typeof item?.attempts === "number" ? item.attempts : 0,
        };
    }

    private normalizePendingBoundItem(raw: unknown): PendingBoundItem | undefined {
        const item = raw as Partial<PendingBoundItem> | undefined;
        const avID = typeof item?.avID === "string" ? item.avID : "";
        const itemID = typeof item?.itemID === "string" ? item.itemID : "";
        if (!avID || !itemID) {
            return undefined;
        }

        return {
            avID,
            avName: typeof item?.avName === "string" ? item.avName : "",
            itemID,
            fieldID: typeof item?.fieldID === "string" ? item.fieldID : "",
            fieldName: typeof item?.fieldName === "string" ? item.fieldName : "",
        };
    }

    private createSwitch(checked: boolean) {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "b3-switch fn__flex-center";
        input.checked = checked;
        return input;
    }

    private async syncCurrentDatabase() {
        const avElement = this.findCurrentAVElement();
        if (!avElement) {
            showMessage(this.i18n.noCurrentDatabase);
            return;
        }
        const result = await this.syncAVElement(avElement);
        this.showSyncResult(result);
    }

    private async syncVisibleDatabases() {
        const result = await this.syncDatabaseElements(true);
        if (result.databases === 0) {
            showMessage(this.i18n.noVisibleDatabase);
            return;
        }

        this.showSyncResult(result);
    }

    private async syncSelectedDatabaseItems(element: HTMLElement, itemIDs: string[]) {
        if (itemIDs.length === 0) {
            const result = await this.syncAVElement(element);
            this.showSyncResult(result);
            return;
        }

        const result = await this.syncAVElement(element, {onlyItemIDs: itemIDs});
        this.showSyncResult(result);
    }

    private async syncChangedDocumentBlocks(blockIDs: string[]) {
        const context = await this.resolveBoundDocumentSyncContext(blockIDs);
        if (context.entries.length === 0) {
            return {changed: 0, scanned: 0};
        }

        return this.syncBoundAttributeViewEntries(context.entries);
    }

    private async resolveBoundDocumentSyncContext(blockIDs: string[]) {
        const contextIDs = await this.resolveContextBlockIDs(blockIDs);
        if (contextIDs.length === 0) {
            return {contextIDs, entries: [], boundItems: []};
        }

        const entries = await this.getBoundAttributeViewEntries(contextIDs);
        return {
            contextIDs,
            entries,
            boundItems: this.getPendingBoundItems(entries),
        };
    }

    private async syncDatabaseElements(visibleOnly: boolean, emptyResultGuard = false): Promise<DatabaseSyncResult> {
        const elements = this.findAVElements(visibleOnly);
        let changed = 0;
        let scanned = 0;
        let skipped = 0;
        for (const element of elements) {
            const result = await this.syncAVElement(element, {emptyResultGuard});
            changed += result.changed;
            scanned += result.scanned;
            skipped += result.skipped || 0;
        }
        return {changed, scanned, skipped, databases: elements.length, matchedItems: scanned, matchedContextIDs: []};
    }

    private async syncDatabaseItemsForBlocks(blockIDs: string[], visibleOnly: boolean, emptyResultGuard = false): Promise<DatabaseSyncResult> {
        const contextIDs = await this.resolveContextBlockIDs(blockIDs);
        return this.syncDatabaseItemsForContextIDs(contextIDs, visibleOnly, emptyResultGuard);
    }

    private async syncDatabaseItemsForContextIDs(
        contextIDs: string[],
        visibleOnly: boolean,
        emptyResultGuard = false,
        avIDs?: Set<string>,
    ): Promise<DatabaseSyncResult> {
        const contextIDSet = new Set(contextIDs);
        if (contextIDSet.size === 0) {
            return {changed: 0, scanned: 0, databases: 0, matchedItems: 0, matchedContextIDs: []};
        }

        const elements = this.findAVElements(visibleOnly)
            .filter((element) => !avIDs || avIDs.has(element.getAttribute("data-av-id") || ""));
        let changed = 0;
        let scanned = 0;
        let skipped = 0;
        let matchedItems = 0;
        const matchedContextIDs = new Set<string>();
        for (const element of elements) {
            const items = await this.getDatabaseItemsByBoundBlocks(element, contextIDSet);
            if (items.length === 0) {
                continue;
            }

            matchedItems += items.length;
            items.forEach((item) => matchedContextIDs.add(item.boundBlockID));
            const result = await this.syncAVElement(element, {
                onlyItemIDs: items.map((item) => item.itemID),
                emptyResultGuard,
            });
            changed += result.changed;
            scanned += result.scanned;
            skipped += result.skipped || 0;
        }

        return {changed, scanned, skipped, databases: elements.length, matchedItems, matchedContextIDs: Array.from(matchedContextIDs)};
    }

    private async getDatabaseItemsByBoundBlocks(element: HTMLElement, blockIDs: Set<string>) {
        const result = await this.renderAttributeView(element);
        const fields = this.getFields(result.view);
        const assetField = this.findAssetField(fields);
        if (!assetField) {
            return [];
        }

        const fieldIndex = fields.findIndex((field) => field.id === assetField.id);
        return this.collectBoundRows(this.collectRecords(result.view), fieldIndex, assetField.id)
            .filter((row) => blockIDs.has(row.boundBlockID))
            .map((row) => ({itemID: row.record.itemID, boundBlockID: row.boundBlockID}));
    }

    private async syncBoundAttributeViewEntries(entries: BlockAttributeViewKeys[]) {
        const targets: Array<{
            avID: string;
            itemID: string;
            field: AVColumn;
            value?: AVCellValue;
        }> = [];
        const seenTargets = new Set<string>();

        for (const entry of entries) {
            const itemID = this.getItemIDFromKeyValues(entry.keyValues);
            if (!itemID) {
                continue;
            }

            const target = this.findAssetKeyValue(entry.keyValues);
            if (!target) {
                continue;
            }

            const targetID = `${entry.avID}:${itemID}:${target.field.id}`;
            if (seenTargets.has(targetID)) {
                continue;
            }
            seenTargets.add(targetID);
            targets.push({
                avID: entry.avID,
                itemID,
                field: target.field,
                value: target.value,
            });
        }

        if (targets.length === 0) {
            return {changed: 0, scanned: 0};
        }

        const imageCollection = await this.collectImages(targets.map((target) => target.itemID), {preferKramdown: true});
        const updatesByAvID = new Map<string, BatchValue[]>();
        let changed = 0;
        let skipped = 0;
        for (const target of targets) {
            const images = imageCollection.assets.get(target.itemID) || [];
            const current = target.value?.mAsset || [];
            if (images.length === 0 && current.length > 0 && !imageCollection.confirmedEmptyIDs.has(target.itemID)) {
                console.debug(`[${this.name}] skip empty automatic sync result`, target.itemID);
                skipped++;
                continue;
            }
            if (this.sameAssets(current, images)) {
                continue;
            }

            const updates = updatesByAvID.get(target.avID) || [];
            updates.push({
                keyID: target.field.id,
                itemID: target.itemID,
                value: {
                    id: target.value?.id,
                    keyID: target.field.id,
                    blockID: target.itemID,
                    type: "mAsset",
                    mAsset: images,
                },
            });
            updatesByAvID.set(target.avID, updates);
            changed++;
        }

        for (const [avID, updates] of updatesByAvID) {
            await this.updateCells(avID, updates);
        }
        return {changed, scanned: targets.length, skipped};
    }

    private async syncAVElement(element: HTMLElement, options: SyncAVOptions = {}) {
        const avID = element.getAttribute("data-av-id") || "";
        if (!avID) {
            return {changed: 0, scanned: 0};
        }
        if (this.syncingAvIDs.has(avID)) {
            return {changed: 0, scanned: 0};
        }

        this.syncingAvIDs.add(avID);
        try {
            const result = await this.renderAttributeView(element);
            const fields = this.getFields(result.view);
            const assetField = this.findAssetField(fields);
            if (!assetField) {
                throw new Error(this.i18n.noAssetField.replace("${field}", this.settingsData.assetFieldName));
            }

            const onlyItems = new Set(options.onlyItemIDs || []);
            let records = this.collectRecords(result.view);
            if (onlyItems.size > 0) {
                records = records.filter((record) => onlyItems.has(record.itemID));
            }
            const fieldIndex = fields.findIndex((field) => field.id === assetField.id);
            const rows = this.collectBoundRows(records, fieldIndex, assetField.id);
            const imageCollection = await this.collectImages(rows.map((row) => row.boundBlockID), {
                preferKramdown: options.emptyResultGuard,
            });
            const updates: BatchValue[] = [];
            let skipped = 0;

            for (const row of rows) {
                const images = imageCollection.assets.get(row.boundBlockID) || [];
                const current = row.assetCell.value?.mAsset || [];
                if (
                    options.emptyResultGuard &&
                    images.length === 0 &&
                    current.length > 0 &&
                    !imageCollection.confirmedEmptyIDs.has(row.boundBlockID)
                ) {
                    console.debug(`[${this.name}] skip empty automatic sync result`, row.record.itemID);
                    skipped++;
                    continue;
                }
                if (!this.settingsData.replaceExisting && current.length > 0) {
                    continue;
                }
                if (this.sameAssets(current, images)) {
                    continue;
                }
                updates.push({
                    keyID: assetField.id,
                    itemID: row.record.itemID,
                    value: {
                        id: row.assetCell.value?.id || row.assetCell.id,
                        keyID: assetField.id,
                        blockID: row.record.itemID,
                        type: "mAsset",
                        mAsset: images,
                    },
                });
            }

            if (updates.length > 0) {
                await this.updateCells(avID, updates);
            }

            return {changed: updates.length, scanned: rows.length, skipped};
        } finally {
            this.syncingAvIDs.delete(avID);
        }
    }

    private addAVMenuItem(event: CustomEvent) {
        const detail = event.detail as AVMenuDetail | undefined;
        if (!detail?.menu || !(detail.element instanceof HTMLElement)) {
            return;
        }

        const itemIDs = this.getMenuItemIDs(detail);
        detail.menu.addItem({
            id: "syncContentImages",
            iconHTML: CONTENT_IMAGE_SYNC_ICON,
            label: itemIDs.length > 1 ? this.i18n.syncSelectedContentImages : this.i18n.syncContentImages,
            click: () => {
                this.syncSelectedDatabaseItems(detail.element as HTMLElement, itemIDs).catch((error) => this.showError(error));
            },
        });
    }

    private getMenuItemIDs(detail: AVMenuDetail) {
        const ids = Array.from(detail.selectRowElements || [])
            .map((element) => this.getAVRowItemID(element))
            .filter((id) => id.length > 0);
        return Array.from(new Set(ids));
    }

    private getAVRowItemID(element: Element) {
        return element.getAttribute("data-id") ||
            element.querySelector('[data-dtype="block"] .av__celltext')?.getAttribute("data-id") ||
            "";
    }

    private async getBoundAttributeViewEntries(blockIDs: string[]) {
        const entries: BlockAttributeViewKeys[] = [];
        const seen = new Set<string>();
        for (const id of blockIDs) {
            const blockEntries = await this.post<BlockAttributeViewKeys[]>("/api/av/getAttributeViewKeys", {id});
            for (const entry of blockEntries || []) {
                const itemID = this.getItemIDFromKeyValues(entry.keyValues);
                const key = `${entry.avID}:${itemID}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                entries.push(entry);
            }
        }
        return entries;
    }

    private getItemIDFromKeyValues(keyValues: AVKeyValues[]) {
        return keyValues
            .find((keyValue) => keyValue.key?.type === "block")
            ?.values?.[0]?.blockID || "";
    }

    private findAssetKeyValue(keyValues: AVKeyValues[]) {
        const field = this.findAssetField(keyValues.map((keyValue) => keyValue.key).filter(Boolean));
        if (!field) {
            return undefined;
        }

        const keyValue = keyValues.find((item) => item.key?.id === field.id);
        return {
            field,
            value: keyValue?.values?.[0],
        };
    }

    private getPendingBoundItems(entries: BlockAttributeViewKeys[]) {
        const items: PendingBoundItem[] = [];
        const seen = new Set<string>();
        for (const entry of entries) {
            const itemID = this.getItemIDFromKeyValues(entry.keyValues);
            if (!entry.avID || !itemID) {
                continue;
            }

            const assetKeyValue = this.findAssetKeyValue(entry.keyValues);
            const item: PendingBoundItem = {
                avID: entry.avID,
                avName: entry.avName || "",
                itemID,
                fieldID: assetKeyValue?.field.id || "",
                fieldName: assetKeyValue?.field.name || "",
            };
            const key = this.getPendingBoundItemKey(item);
            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            items.push(item);
        }
        return items;
    }

    private getPendingBoundItemKey(item: PendingBoundItem) {
        return `${item.avID}:${item.itemID}:${item.fieldID}`;
    }

    private async renderAttributeView(element: HTMLElement) {
        return this.post<AVRenderData>("/api/av/renderAttributeView", {
            id: element.getAttribute("data-av-id"),
            blockID: element.getAttribute("data-node-id") || "",
            viewID: this.getViewID(element),
            pageSize: -1,
            createIfNotExist: false,
        });
    }

    private getViewID(element: HTMLElement) {
        return element.getAttribute(CUSTOM_SY_AV_VIEW) ||
            element.querySelector(".layout-tab-bar .item--focus")?.getAttribute("data-id") ||
            "";
    }

    private getFields(view: AVView): AVColumn[] {
        if (Array.isArray(view.columns) && view.columns.length > 0) {
            return view.columns;
        }
        if (Array.isArray(view.fields) && view.fields.length > 0) {
            return view.fields;
        }
        for (const group of view.groups || []) {
            const fields = this.getFields(group);
            if (fields.length > 0) {
                return fields;
            }
        }
        return [];
    }

    private findAssetField(fields: AVColumn[]) {
        const configuredName = this.settingsData.assetFieldName.trim();
        const named = fields.find((field) => field.type === "mAsset" && field.name === configuredName);
        if (named) {
            return named;
        }

        const assetFields = fields.filter((field) => field.type === "mAsset");
        if (configuredName === DEFAULT_ASSET_FIELD_NAME && assetFields.length === 1) {
            return assetFields[0];
        }
        return undefined;
    }

    private collectRecords(view: AVView): SyncRecord[] {
        const records: SyncRecord[] = [];
        for (const row of view.rows || []) {
            records.push({itemID: row.id, cells: row.cells || []});
        }
        for (const card of view.cards || []) {
            records.push({itemID: card.id, cells: card.values || []});
        }
        for (const group of view.groups || []) {
            records.push(...this.collectRecords(group));
        }
        return records;
    }

    private collectBoundRows(records: SyncRecord[], fieldIndex: number, assetFieldID: string) {
        const rows: Array<{
            record: SyncRecord;
            boundBlockID: string;
            assetCell: AVCell;
        }> = [];

        for (const record of records) {
            const blockCell = record.cells.find((cell) => cell.valueType === "block" && cell.value?.block?.id);
            if (!blockCell?.value?.block?.id || blockCell.value.isDetached) {
                continue;
            }

            const assetCell = record.cells[fieldIndex] ||
                record.cells.find((cell) => cell.value?.keyID === assetFieldID || cell.valueType === "mAsset");
            if (!assetCell) {
                continue;
            }

            rows.push({
                record,
                boundBlockID: blockCell.value.block.id,
                assetCell,
            });
        }

        return rows;
    }

    private async collectImages(boundBlockIDs: string[], options: CollectImagesOptions = {}): Promise<ImageCollection> {
        const ids = Array.from(new Set(boundBlockIDs.filter(Boolean)));
        const imageMap = new Map<string, AVAsset[]>();
        const confirmedEmptyIDs = new Set<string>();
        ids.forEach((id) => imageMap.set(id, []));

        if (ids.length === 0) {
            return {assets: imageMap, confirmedEmptyIDs};
        }

        const kramdownIDs = await this.collectKramdownImages(ids, imageMap, confirmedEmptyIDs);
        const indexedIDs = options.preferKramdown ? ids.filter((id) => !kramdownIDs.has(id)) : ids;
        if (indexedIDs.length > 0) {
            await this.collectIndexedAssets(indexedIDs, imageMap);
        }

        for (const [id, assets] of imageMap.entries()) {
            imageMap.set(id, this.deduplicateAssets(assets));
        }
        return {assets: imageMap, confirmedEmptyIDs};
    }

    private async collectKramdownImages(ids: string[], imageMap: Map<string, AVAsset[]>, confirmedEmptyIDs: Set<string>) {
        const checkedIDs = new Set<string>();
        try {
            const kramdowns = await this.post<Record<string, string>>("/api/block/getBlockKramdowns", {
                ids,
                mode: "md",
            });
            for (const id of ids) {
                if (!Object.prototype.hasOwnProperty.call(kramdowns, id)) {
                    continue;
                }
                checkedIDs.add(id);
                const assets = this.extractImageLinks(kramdowns[id] || "");
                if (assets.length === 0) {
                    confirmedEmptyIDs.add(id);
                }
                imageMap.get(id)?.push(...assets);
            }
        } catch (error) {
            console.debug(`[${this.name}] getBlockKramdowns failed`, error);
        }
        return checkedIDs;
    }

    private async collectIndexedAssets(ids: string[], imageMap: Map<string, AVAsset[]>) {
        const quotedIDs = ids.map((id) => this.sqlString(id)).join(",");
        const stmt = `SELECT root_id, block_id, path, name, title FROM assets WHERE root_id IN (${quotedIDs}) OR block_id IN (${quotedIDs}) ORDER BY id`;

        try {
            const rows = await this.post<AssetRow[]>("/api/query/sql", {stmt});
            for (const row of rows) {
                const asset = this.toImageAsset(row.path || "", row.name || row.title || "");
                if (!asset) {
                    continue;
                }
                for (const id of ids) {
                    if (row.root_id === id || row.block_id === id) {
                        imageMap.get(id)?.push(asset);
                    }
                }
            }
        } catch (error) {
            console.debug(`[${this.name}] asset SQL query failed`, error);
        }
    }

    private async updateCells(avID: string, values: BatchValue[]) {
        try {
            await this.post("/api/av/batchSetAttributeViewBlockAttrs", {
                avID,
                values,
            });
            return;
        } catch (error) {
            console.debug(`[${this.name}] batch update failed, falling back`, error);
        }

        for (const value of values) {
            await this.post("/api/av/setAttributeViewBlockAttr", {
                avID,
                ...value,
            });
        }
    }

    private extractImageLinks(markdown: string) {
        const assets: AVAsset[] = [];
        const markdownImage = /!\[[^\]]*]\(([^)]*)\)/g;
        let match: RegExpExecArray | null;
        while ((match = markdownImage.exec(markdown)) !== null) {
            const asset = this.toImageAsset(this.normalizeMarkdownDestination(match[1]));
            if (asset) {
                assets.push(asset);
            }
        }

        const htmlImage = /<img\b[^>]*\b(?:src|data-src)=(["'])(.*?)\1/gi;
        while ((match = htmlImage.exec(markdown)) !== null) {
            const asset = this.toImageAsset(match[2]);
            if (asset) {
                assets.push(asset);
            }
        }

        return this.deduplicateAssets(assets);
    }

    private normalizeMarkdownDestination(destination: string) {
        let value = destination.trim();
        if (value.startsWith("<") && value.endsWith(">")) {
            value = value.slice(1, -1);
        }
        const titleIndex = value.search(/\s+["'][^"']*["']\s*$/);
        if (titleIndex > 0) {
            value = value.slice(0, titleIndex);
        }
        return this.decodeHtml(value);
    }

    private toImageAsset(content: string, name = ""): AVAsset | undefined {
        const cleaned = this.decodeHtml(content.trim());
        if (!cleaned || !this.isImagePath(cleaned)) {
            return undefined;
        }

        return {
            type: "image",
            name: name.trim() || this.basename(cleaned),
            content: cleaned,
        };
    }

    private isImagePath(path: string) {
        const lower = path.split("#")[0].split("?")[0].toLowerCase();
        return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
    }

    private basename(path: string) {
        const withoutQuery = path.split("#")[0].split("?")[0];
        const normalized = withoutQuery.replace(/\\/g, "/");
        const name = normalized.slice(normalized.lastIndexOf("/") + 1);
        try {
            return decodeURIComponent(name);
        } catch {
            return name;
        }
    }

    private deduplicateAssets(assets: AVAsset[]) {
        const seen = new Set<string>();
        const deduped: AVAsset[] = [];
        for (const asset of assets) {
            if (seen.has(asset.content)) {
                continue;
            }
            seen.add(asset.content);
            deduped.push(asset);
        }
        return deduped;
    }

    private sameAssets(left: AVAsset[], right: AVAsset[]) {
        if (left.length !== right.length) {
            return false;
        }
        return left.every((asset, index) =>
            asset.type === right[index].type &&
            asset.name === right[index].name &&
            asset.content === right[index].content);
    }

    private findCurrentAVElement() {
        const selection = window.getSelection();
        const anchor = selection?.anchorNode;
        if (anchor) {
            const element = anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement;
            const avElement = element?.closest(".av[data-av-id]");
            if (avElement instanceof HTMLElement) {
                return avElement;
            }
        }

        const activeElement = document.activeElement;
        const activeAV = activeElement?.closest?.(".av[data-av-id]");
        if (activeAV instanceof HTMLElement) {
            return activeAV;
        }

        return document.querySelector(".protyle:not(.fn__none) .av[data-av-id]") as HTMLElement ||
            this.findAVElements(false)[0] ||
            null;
    }

    private findAVElements(visibleOnly: boolean) {
        const elements = Array.from(document.querySelectorAll(".av[data-av-id]")) as HTMLElement[];
        const seen = new Set<string>();
        return elements.filter((element) => {
            const id = element.getAttribute("data-av-id") || "";
            if (!id || seen.has(id) || (visibleOnly && element.offsetParent === null)) {
                return false;
            }
            seen.add(id);
            return true;
        });
    }

    private handleWsEvent(event: CustomEvent) {
        if (!this.settingsData.autoSyncVisible) {
            return;
        }

        const blockIDs = this.getDocumentMutationBlockIDs(event.detail);
        if (blockIDs.length === 0) {
            return;
        }

        this.scheduleDocumentSync(blockIDs);
    }

    private updateDocumentImageObserver() {
        if (this.settingsData.autoSyncVisible) {
            this.startDocumentImageObserver();
            this.startDatabaseObserver();
            this.schedulePendingSyncFlush(0);
            return;
        }

        this.stopDocumentImageObserver();
        this.stopDatabaseObserver();
    }

    private startDocumentImageObserver() {
        if (this.imageObserver || typeof MutationObserver === "undefined") {
            return;
        }

        this.imageObserver = new MutationObserver((records) => this.handleDocumentImageMutations(records));
        this.imageObserver.observe(document.body, {
            attributeFilter: ["src", "data-src"],
            attributeOldValue: true,
            attributes: true,
            childList: true,
            subtree: true,
        });
    }

    private stopDocumentImageObserver() {
        this.imageObserver?.disconnect();
        this.imageObserver = undefined;
    }

    private startDatabaseObserver() {
        if (this.databaseObserver || typeof MutationObserver === "undefined") {
            return;
        }

        this.databaseObserver = new MutationObserver((records) => {
            if (!this.settingsData.autoSyncVisible || this.pendingSyncData.items.length === 0) {
                return;
            }

            if (records.some((record) => this.hasAVElementNode(record.addedNodes))) {
                this.schedulePendingSyncFlush();
            }
        });
        this.databaseObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    private stopDatabaseObserver() {
        this.databaseObserver?.disconnect();
        this.databaseObserver = undefined;
        window.clearTimeout(this.pendingSyncFlushTimer);
    }

    private hasAVElementNode(nodes: NodeList) {
        return Array.from(nodes).some((node) => {
            if (!(node instanceof HTMLElement)) {
                return false;
            }

            return node.matches(".av[data-av-id]") || !!node.querySelector(".av[data-av-id]");
        });
    }

    private handleDocumentImageMutations(records: MutationRecord[]) {
        if (!this.settingsData.autoSyncVisible) {
            return;
        }

        const blockIDs: string[] = [];
        for (const record of records) {
            if (record.type === "attributes") {
                const blockID = this.getImageAttributeChangeBlockID(record);
                if (blockID) {
                    blockIDs.push(blockID);
                }
                continue;
            }

            const blockID = this.getChildImageChangeBlockID(record);
            if (blockID) {
                blockIDs.push(blockID);
            }
        }

        if (blockIDs.length > 0) {
            this.scheduleDocumentSync(blockIDs);
        }
    }

    private getImageAttributeChangeBlockID(record: MutationRecord) {
        if (!(record.target instanceof HTMLImageElement)) {
            return "";
        }

        const blockID = this.getImageMutationBlockID(record.target);
        if (!blockID) {
            return "";
        }

        const added = this.toImageAsset(this.getImageElementContent(record.target) || "");
        const removed = this.toImageAsset(record.oldValue || "");
        if (!added && !removed) {
            return "";
        }

        if (added && removed && added.content === removed.content) {
            return "";
        }

        return blockID;
    }

    private getChildImageChangeBlockID(record: MutationRecord) {
        if (!this.hasImageAssetNode(record.addedNodes) && !this.hasImageAssetNode(record.removedNodes)) {
            return "";
        }

        return this.getImageMutationBlockID(record.target) ||
            Array.from(record.addedNodes).map((node) => this.getImageMutationBlockID(node)).find(Boolean) ||
            Array.from(record.removedNodes).map((node) => this.getImageMutationBlockID(node)).find(Boolean) ||
            "";
    }

    private hasImageAssetNode(nodes: NodeList) {
        return Array.from(nodes).some((node) => this.hasImageAsset(node));
    }

    private hasImageAsset(node: Node) {
        if (!(node instanceof HTMLElement)) {
            return false;
        }

        if (node instanceof HTMLImageElement) {
            return !!this.toImageAsset(this.getImageElementContent(node) || "");
        }

        return Array.from(node.querySelectorAll("img")).some((img) =>
            !!this.toImageAsset(this.getImageElementContent(img) || ""));
    }

    private getImageElementContent(element: HTMLImageElement) {
        return element.getAttribute("data-src") || element.getAttribute("src") || "";
    }

    private getImageMutationBlockID(target: Node) {
        const element = target instanceof HTMLElement ? target : target.parentElement;
        const blockElement = element?.closest("[data-node-id]");
        if (!(blockElement instanceof HTMLElement) || blockElement.closest(".av")) {
            return "";
        }

        return blockElement.getAttribute("data-node-id") || "";
    }

    private scheduleDocumentSync(blockIDs: string[]) {
        blockIDs.forEach((id) => this.pendingDocumentSyncIDs.add(id));
        window.clearTimeout(this.autoSyncTimer);
        this.autoSyncTimer = window.setTimeout(() => {
            this.flushPendingDocumentSync().catch((error) => this.showError(error));
        }, AUTO_SYNC_DELAY_MS);
    }

    private schedulePendingSyncFlush(delay = AUTO_SYNC_DELAY_MS) {
        if (!this.settingsData.autoSyncVisible || this.pendingSyncData.items.length === 0) {
            return;
        }

        window.clearTimeout(this.pendingSyncFlushTimer);
        this.pendingSyncFlushTimer = window.setTimeout(() => {
            this.flushPendingSyncWithOpenedDatabases().catch((error) => this.showError(error));
        }, delay);
    }

    private async flushPendingDocumentSync() {
        if (this.documentSyncRunning) {
            return;
        }

        const blockIDs = Array.from(this.pendingDocumentSyncIDs);
        this.pendingDocumentSyncIDs.clear();
        if (blockIDs.length === 0) {
            return;
        }

        this.documentSyncRunning = true;
        try {
            const context = await this.resolveBoundDocumentSyncContext(blockIDs);
            if (context.boundItems.length === 0) {
                return;
            }

            const avIDs = new Set(context.boundItems.map((item) => item.avID));
            const openTargetResult = await this.syncDatabaseItemsForContextIDs(context.contextIDs, false, true, avIDs);
            if (openTargetResult.matchedItems > 0 && !openTargetResult.skipped) {
                return;
            }

            let directCompleted = false;
            try {
                const boundResult = await this.syncBoundAttributeViewEntries(context.entries);
                directCompleted = boundResult.scanned > 0 && !boundResult.skipped;
            } catch (error) {
                console.debug(`[${this.name}] bound automatic sync failed`, error);
            }

            if (openTargetResult.matchedItems > 0 && directCompleted) {
                return;
            }

            await this.enqueuePendingDocumentSync(blockIDs, context.contextIDs, context.boundItems);
        } finally {
            this.documentSyncRunning = false;
            if (this.pendingDocumentSyncIDs.size > 0) {
                window.clearTimeout(this.autoSyncTimer);
                this.autoSyncTimer = window.setTimeout(() => {
                    this.flushPendingDocumentSync().catch((error) => this.showError(error));
                }, AUTO_SYNC_DELAY_MS);
            }
        }
    }

    private async enqueuePendingDocumentSync(blockIDs: string[], contextIDs: string[], boundItems: PendingBoundItem[]) {
        const changedBlockIDs = Array.from(new Set(blockIDs.filter(Boolean)));
        const normalizedContextIDs = Array.from(new Set(contextIDs.filter(Boolean)));
        const normalizedBoundItems = this.deduplicatePendingBoundItems(boundItems);
        if (changedBlockIDs.length === 0 || normalizedContextIDs.length === 0 || normalizedBoundItems.length === 0) {
            return;
        }

        const now = Date.now();
        const itemsByKey = new Map<string, PendingSyncItem>();
        for (const item of this.pendingSyncData.items) {
            itemsByKey.set(this.getPendingSyncItemKey(item.changedBlockID, item.boundItems), item);
        }

        for (const changedBlockID of changedBlockIDs) {
            const key = this.getPendingSyncItemKey(changedBlockID, normalizedBoundItems);
            const existing = itemsByKey.get(key);
            itemsByKey.set(key, {
                changedBlockID,
                contextIDs: normalizedContextIDs,
                boundItems: normalizedBoundItems,
                updatedAt: now,
                attempts: existing?.attempts || 0,
            });
        }

        this.pendingSyncData = {items: Array.from(itemsByKey.values())};
        this.prunePendingSyncData();
        await this.savePendingSyncData();
        this.schedulePendingSyncFlush(0);
    }

    private async flushPendingSyncWithOpenedDatabases() {
        if (this.pendingSyncRunning || !this.settingsData.autoSyncVisible) {
            return;
        }

        if (this.prunePendingSyncData()) {
            await this.savePendingSyncData();
        }
        if (this.pendingSyncData.items.length === 0) {
            return;
        }

        this.pendingSyncRunning = true;
        try {
            const contextIDSet = new Set<string>();
            const avIDs = new Set<string>();
            for (const item of this.pendingSyncData.items) {
                item.contextIDs.forEach((id) => contextIDSet.add(id));
                item.boundItems.forEach((boundItem) => avIDs.add(boundItem.avID));
            }

            const contextIDs = Array.from(contextIDSet);
            const result = await this.syncDatabaseItemsForContextIDs(contextIDs, false, true, avIDs);
            const matchedContextIDs = new Set(result.matchedContextIDs);
            let changedQueue = false;

            if (matchedContextIDs.size > 0 && !result.skipped) {
                const remaining = this.pendingSyncData.items.filter((item) =>
                    !item.contextIDs.some((id) => matchedContextIDs.has(id)));
                changedQueue = remaining.length !== this.pendingSyncData.items.length;
                this.pendingSyncData = {items: remaining};
            } else {
                this.pendingSyncData = {
                    items: this.pendingSyncData.items.map((item) => ({
                        ...item,
                        attempts: item.attempts + 1,
                    })),
                };
                changedQueue = true;
            }

            if (this.prunePendingSyncData()) {
                changedQueue = true;
            }
            if (changedQueue) {
                await this.savePendingSyncData();
            }
        } finally {
            this.pendingSyncRunning = false;
        }
    }

    private deduplicatePendingBoundItems(items: PendingBoundItem[]) {
        const deduped: PendingBoundItem[] = [];
        const seen = new Set<string>();
        for (const item of items) {
            const key = this.getPendingBoundItemKey(item);
            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            deduped.push(item);
        }
        return deduped;
    }

    private getPendingSyncItemKey(changedBlockID: string, boundItems: PendingBoundItem[]) {
        const boundKey = boundItems
            .map((item) => this.getPendingBoundItemKey(item))
            .sort()
            .join(",");
        return `${changedBlockID}|${boundKey}`;
    }

    private prunePendingSyncData() {
        const now = Date.now();
        const before = this.pendingSyncData.items.length;
        let items = this.pendingSyncData.items
            .filter((item) => now - item.updatedAt <= PENDING_SYNC_TTL_MS)
            .sort((left, right) => right.updatedAt - left.updatedAt);
        if (items.length > PENDING_SYNC_MAX_ITEMS) {
            items = items.slice(0, PENDING_SYNC_MAX_ITEMS);
        }

        this.pendingSyncData = {items};
        return before !== items.length;
    }

    private getDocumentMutationBlockIDs(detail: unknown) {
        const data = detail as {cmd?: string; data?: WsTransaction[]} | undefined;
        if (data?.cmd !== "transactions" || !Array.isArray(data.data)) {
            return [];
        }

        const ids: string[] = [];
        for (const transaction of data.data) {
            const operations = [
                ...(transaction.doOperations || []),
                ...(transaction.undoOperations || []),
            ];
            for (const operation of operations) {
                if (!this.isDocumentMutationAction(operation.action || "")) {
                    continue;
                }
                this.collectOperationBlockIDs(operation, ids);
            }
        }
        return Array.from(new Set(ids));
    }

    private isDocumentMutationAction(action: string) {
        if (!action || action.includes("AttrView")) {
            return false;
        }

        return [
            "update",
            "insert",
            "delete",
            "move",
            "append",
            "appendInsert",
            "prependInsert",
        ].indexOf(action) >= 0;
    }

    private collectOperationBlockIDs(operation: WsOperation, ids: string[]) {
        [
            operation.id,
            operation.rootID,
            operation.parentID,
            operation.previousID,
            operation.nextID,
            operation.blockID,
        ].forEach((id) => {
            if (id) {
                ids.push(id);
            }
        });
        (operation.blockIDs || []).forEach((id) => ids.push(id));
    }

    private async resolveContextBlockIDs(blockIDs: string[]) {
        const ids = Array.from(new Set(blockIDs.filter(Boolean)));
        if (ids.length === 0) {
            return [];
        }

        const contextIDs = new Set(ids);
        try {
            const rows = await this.post<BlockRootRow[]>("/api/query/sql", {
                stmt: `SELECT id, root_id FROM blocks WHERE id IN (${ids.map((id) => this.sqlString(id)).join(",")})`,
            });
            for (const row of rows || []) {
                if (row.id) {
                    contextIDs.add(row.id);
                }
                if (row.root_id) {
                    contextIDs.add(row.root_id);
                }
            }
        } catch (error) {
            console.debug(`[${this.name}] resolve changed block roots failed`, error);
        }

        return Array.from(contextIDs);
    }

    private post<T>(url: string, data: unknown): Promise<T> {
        return new Promise((resolve, reject) => {
            fetchPost(url, data, (response: SiyuanResponse<T>) => {
                if (response.code !== 0) {
                    reject(new Error(response.msg || `${url} failed with code ${response.code}`));
                    return;
                }
                resolve(response.data);
            });
        });
    }

    private sqlString(value: string) {
        return `'${value.replace(/'/g, "''")}'`;
    }

    private decodeHtml(value: string) {
        const textarea = document.createElement("textarea");
        textarea.innerHTML = value;
        return textarea.value;
    }

    private showSyncResult(result: {changed: number; scanned: number}) {
        showMessage(this.i18n.syncSummary.replace("${changed}", `${result.changed}`).replace("${scanned}", `${result.scanned}`));
    }

    private showError(error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        showMessage(`${this.name}: ${message}`);
    }
}
